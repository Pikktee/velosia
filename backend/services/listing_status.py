"""
Server-side status tracking for published listings.

After a listing is published the engine captures its public URL (no login). Here
we read that *public* page with curl-cffi and map it to a normalised status. This
is low-volume (only the user's own listings, only while still active) and reads
exactly what any visitor sees — deliberately NOT crawling the listing forms (that
is what once got the IP banned).

Status markers were calibrated against live pages (2026-06):

Kleinanzeigen
  * The status is NOT visible text — KA renders the yellow "Reserviert •" /
    "Gelöscht •" veil purely client-side from an inline JS config object. The two
    authoritative, login-free booleans live in that object and ARE present in the
    static (curl-cffi) HTML:
        showDeletedVeil: true  -> "geloescht"   (deleted)
        showPausedVeil:  true  -> "reserviert"   (reserved / paused)
        both false             -> "online"
    A soft-deleted ad keeps returning HTTP 200 with "/s-anzeige/" intact and only
    flips showDeletedVeil — so the redirect/404 heuristic alone misses it; the
    booleans are the primary signal, the redirect/404 a fully-purged fallback.
  * KA exposes no public "sold" state (no showSoldVeil / sold flag). The word
    "verkauft" only appears as free description text and must never be matched.
  * The same config object carries the current price: adPrice: 2300.00 and
    adPriceType: 'NEGOTIABLE' | 'FIXED' (calibrated 2026-10).
  * Title: <h1 id="viewad-title">; description: <p id="viewad-description-text">
    as HTML with <br /> line breaks (calibrated 2026-10).

Vinted
  * Deleted item = clean 404.
  * JSON-LD <script type="application/ld+json"> carries
    "availability":"InStock" | "OutOfStock" | "SoldOut".
  * The embedded item JSON carries is_reserved / is_closed booleans
    (backslash-escaped inside the RSC payload).
  * The current price, title and full description are in the same JSON-LD
    Product: "name", "description", "offers":{"price":9,...} (calibrated 2026-10;
    the description matched the embedded item data on every sampled ad).

Besides the status we read the listing's current price, title and description,
so changes the user made directly on the platform can be taken over into the
draft. Baselines (*_listed_*) are what the engine published — the draft's
values — and tell a change on the platform apart from an untouched ad.
"""

import html
import json
import re

# Normalised status vocabulary (German, matches the UI badges).
ONLINE = "online"
RESERVIERT = "reserviert"
VERKAUFT = "verkauft"
GELOESCHT = "geloescht"
UNBEKANNT = "unbekannt"

# Statuses that won't change again -> skip re-polling to save traffic.
TERMINAL = {VERKAUFT, GELOESCHT}

from services import http_client
from services import listing_urls


# ---------------------------------------------------------------------------
# Kleinanzeigen
# ---------------------------------------------------------------------------

# Authoritative status flags from KA's inline JS config object (see module
# docstring). These drive the client-side veil and are present in the static HTML.
_KA_DELETED_VEIL = re.compile(r"showDeletedVeil\s*:\s*true", re.I)
_KA_PAUSED_VEIL = re.compile(r"showPausedVeil\s*:\s*true", re.I)


def _ka_status(resp):
    if resp is None:
        return UNBEKANNT
    final_url = str(getattr(resp, "url", "") or "")
    code = resp.status_code

    # Fully purged ad: KA 404s or bounces off the ad page back to home/search.
    if code in (404, 410):
        return GELOESCHT
    if final_url and "/s-anzeige/" not in final_url:
        return GELOESCHT
    if code != 200:
        return UNBEKANNT

    text = getattr(resp, "text", "") or ""
    # Primary, authoritative signal — works even for soft-deleted ads that still
    # return 200 with /s-anzeige/ intact.
    if _KA_DELETED_VEIL.search(text):
        return GELOESCHT
    if _KA_PAUSED_VEIL.search(text):
        return RESERVIERT
    return ONLINE


_KA_PRICE = re.compile(r"\badPrice\s*:\s*'?(\d+(?:\.\d+)?)")
_KA_PRICE_TYPE = re.compile(r"\badPriceType\s*:\s*'(\w+)'")
# KA's own price types that map onto the draft's Festpreis/VB.
_KA_PRICE_TYPES = {"FIXED", "NEGOTIABLE"}


_KA_TITLE = re.compile(r'<h1[^>]*\bid="viewad-title"[^>]*>(.*?)</h1>', re.S)
_KA_DESCRIPTION = re.compile(r'<p[^>]*\bid="viewad-description-text"[^>]*>(.*?)</p>', re.S)
_BR = re.compile(r"<br\s*/?>", re.I)
_TAG = re.compile(r"<[^>]+>")
_MAX_TEXT = 10000


def _html_text(fragment):
    """Plain text of an HTML fragment, <br> kept as line breaks."""
    text = html.unescape(_TAG.sub("", _BR.sub("\n", fragment)))
    return "\n".join(line.strip() for line in text.strip().splitlines())[:_MAX_TEXT]


def _ka_offer(resp):
    """Current price, price type, title and description of a live KA ad (each
    None if unreadable). A price of 0 (zu verschenken, auf Anfrage) is no usable
    price."""
    offer = {"price": None, "price_type": None, "title": None, "description": None}
    if resp is None or resp.status_code != 200:
        return offer
    text = getattr(resp, "text", "") or ""
    m = _KA_PRICE.search(text)
    offer["price"] = float(m.group(1)) if m and float(m.group(1)) else None
    t = _KA_PRICE_TYPE.search(text)
    price_type = t.group(1).upper() if t else None
    offer["price_type"] = price_type if price_type in _KA_PRICE_TYPES else None
    m = _KA_TITLE.search(text)
    offer["title"] = _html_text(m.group(1)) or None if m else None
    m = _KA_DESCRIPTION.search(text)
    offer["description"] = _html_text(m.group(1)) or None if m else None
    return offer


def check_kleinanzeigen(url):
    """(status, offer) of a KA ad — offer as in _ka_offer."""
    resp = http_client.fetch(url, timeout=15)
    return _ka_status(resp), _ka_offer(resp)


# ---------------------------------------------------------------------------
# Vinted
# ---------------------------------------------------------------------------

_AVAIL_RE = re.compile(r'"availability"\s*:\s*"(?:https?://schema\.org/)?(\w+)"')
# Tolerate the backslash-escaping the booleans carry inside the RSC payload.
_RESERVED_RE = re.compile(r'is_reserved\\?"\s*:\s*true')
_CLOSED_RE = re.compile(r'is_closed\\?"\s*:\s*true')


def _vinted_status(resp):
    if resp is None:
        return UNBEKANNT
    code = resp.status_code
    if code in (404, 410):
        return GELOESCHT
    if code != 200:
        return UNBEKANNT

    text = getattr(resp, "text", "") or ""

    avail = _AVAIL_RE.search(text)
    if avail:
        token = avail.group(1).lower()
        if token in ("outofstock", "soldout"):
            return VERKAUFT

    # Closed transaction = sold/finished; reserved = held for a buyer.
    if _CLOSED_RE.search(text):
        return VERKAUFT
    if _RESERVED_RE.search(text):
        return RESERVIERT
    return ONLINE


_LD_JSON = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


def _vinted_offer(resp):
    """Current price, title and description from the item's JSON-LD Product
    (each None if unreadable)."""
    offer = {"price": None, "title": None, "description": None}
    if resp is None or resp.status_code != 200:
        return offer
    text = getattr(resp, "text", "") or ""
    for block in _LD_JSON.findall(text):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        if not isinstance(data, dict) or data.get("@type") != "Product":
            continue
        for key, field in (("title", "name"), ("description", "description")):
            value = data.get(field)
            if isinstance(value, str) and value.strip():
                offer[key] = value.strip()[:_MAX_TEXT]
        offers = data.get("offers")
        if isinstance(offers, list):
            offers = offers[0] if offers else None
        if isinstance(offers, dict):
            try:
                price = float(offers.get("price"))
                offer["price"] = price if price > 0 else None
            except (TypeError, ValueError):
                pass
        break
    return offer


def check_vinted(url):
    """(status, offer) of a Vinted item — offer as in _vinted_offer."""
    resp = http_client.fetch(url, timeout=20)
    return _vinted_status(resp), _vinted_offer(resp)


# ---------------------------------------------------------------------------
# Online changes (price/title/description edited on the platform itself)
# ---------------------------------------------------------------------------

KA_TITLE_MAX = 65  # mirrors the engine (shared/autofill-engine.js)


def clamp_title(title, max_len):
    """Port of the engine's clampTitle: what it actually types into a title
    field that is shorter than the draft's title."""
    t = re.sub(r"\s+", " ", str(title or "")).strip()
    if len(t) <= max_len:
        return t
    cut = t[: max_len + 1]
    sp = cut.rfind(" ")
    cut = cut[:sp] if sp >= max_len / 2 else t[:max_len]
    return re.sub(r"[\s,;:\-–(/]+$", "", cut)


def published_values(draft, platform):
    """The values the engine fills in for this draft — the baseline for spotting
    later edits on the platform."""
    title = getattr(draft, "title", None)
    if platform == "kleinanzeigen" and title:
        title = clamp_title(title, KA_TITLE_MAX)
    return {
        "price": getattr(draft, "price", None),
        "title": title,
        "description": getattr(draft, "description", None),
    }


def _offer_updates(draft, prefix, platform, offer):
    """Column updates for a fresh reading. Only readable values overwrite, so a
    failed fetch doesn't wipe the last one; a missing baseline is set from the
    draft (listings published before baselines existed)."""
    updates = {}
    baseline = None
    for field in ("price", "title", "description"):
        value = offer.get(field)
        if value is None:
            continue
        updates[f"{prefix}_online_{field}"] = value
        if getattr(draft, f"{prefix}_listed_{field}", None) is None:
            baseline = baseline or published_values(draft, platform)
            updates[f"{prefix}_listed_{field}"] = baseline[field]
    if offer.get("price") is not None and "price_type" in offer:
        updates[f"{prefix}_online_price_type"] = offer["price_type"]
    return updates


# ---------------------------------------------------------------------------
# Draft-level refresh (pure: returns the column updates, does not commit)
# ---------------------------------------------------------------------------

def refresh_draft_status(draft, now):
    """Poll whichever platforms this draft is published on and return a dict of
    column updates. Terminal statuses (sold/deleted) are not re-polled."""
    updates = {}

    # Stored URLs are re-validated on every poll: rows from before the URL
    # validation may hold anything. An unusable URL is rebuilt from the listing
    # id where possible (Vinted) or skipped.
    ka_url = listing_urls.safe_listing_url(
        listing_urls.KLEINANZEIGEN, getattr(draft, "ka_listing_id", None), getattr(draft, "ka_listing_url", None)
    )
    if ka_url and getattr(draft, "ka_status", None) not in TERMINAL:
        status, offer = check_kleinanzeigen(ka_url)
        updates["ka_status"] = status
        updates["ka_status_at"] = now
        updates.update(_offer_updates(draft, "ka", "kleinanzeigen", offer))

    v_url = listing_urls.safe_listing_url(
        listing_urls.VINTED, getattr(draft, "vinted_listing_id", None), getattr(draft, "vinted_listing_url", None)
    )
    if v_url and getattr(draft, "vinted_status", None) not in TERMINAL:
        status, offer = check_vinted(v_url)
        updates["vinted_status"] = status
        updates["vinted_status_at"] = now
        updates.update(_offer_updates(draft, "vinted", "vinted", offer))

    return updates
