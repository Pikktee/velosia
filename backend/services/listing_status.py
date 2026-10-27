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

Vinted
  * Deleted item = clean 404.
  * JSON-LD <script type="application/ld+json"> carries
    "availability":"InStock" | "OutOfStock" | "SoldOut".
  * The embedded item JSON carries is_reserved / is_closed booleans
    (backslash-escaped inside the RSC payload).
  * The current price is in the same JSON-LD Product: "offers":{"price":9,...}
    (calibrated 2026-10).

Besides the status we read the listing's current price, so a price the user
changed directly on the platform can be taken over into the draft.
"""

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


def _ka_offer(resp):
    """Current price and price type of a live KA ad, or (None, None). A price of
    0 (zu verschenken, auf Anfrage) is no usable price."""
    if resp is None or resp.status_code != 200:
        return None, None
    text = getattr(resp, "text", "") or ""
    m = _KA_PRICE.search(text)
    price = float(m.group(1)) if m else None
    if not price:
        price = None
    t = _KA_PRICE_TYPE.search(text)
    price_type = t.group(1).upper() if t else None
    if price_type not in _KA_PRICE_TYPES:
        price_type = None
    return price, price_type


def check_kleinanzeigen(url):
    """(status, price, price_type) of a KA ad."""
    resp = http_client.fetch(url, timeout=15)
    return (_ka_status(resp),) + _ka_offer(resp)


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


def _vinted_price(resp):
    """Current price from the item's JSON-LD Product offer, or None."""
    if resp is None or resp.status_code != 200:
        return None
    text = getattr(resp, "text", "") or ""
    for block in _LD_JSON.findall(text):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        if not isinstance(data, dict) or data.get("@type") != "Product":
            continue
        offers = data.get("offers")
        if isinstance(offers, list):
            offers = offers[0] if offers else None
        if not isinstance(offers, dict):
            continue
        try:
            price = float(offers.get("price"))
        except (TypeError, ValueError):
            return None
        return price if price > 0 else None
    return None


def check_vinted(url):
    """(status, price) of a Vinted item."""
    resp = http_client.fetch(url, timeout=20)
    return _vinted_status(resp), _vinted_price(resp)


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
        status, price, price_type = check_kleinanzeigen(ka_url)
        updates["ka_status"] = status
        updates["ka_status_at"] = now
        # Only overwrite a known price with a fresh reading, so a failed fetch
        # doesn't wipe the last one. The first reading after publishing is kept
        # as the baseline: only a later change on the platform is worth a hint
        # (prices that differ per platform on purpose are not).
        if price is not None:
            updates["ka_online_price"] = price
            updates["ka_online_price_type"] = price_type
            if getattr(draft, "ka_listed_price", None) is None:
                updates["ka_listed_price"] = price

    v_url = listing_urls.safe_listing_url(
        listing_urls.VINTED, getattr(draft, "vinted_listing_id", None), getattr(draft, "vinted_listing_url", None)
    )
    if v_url and getattr(draft, "vinted_status", None) not in TERMINAL:
        status, price = check_vinted(v_url)
        updates["vinted_status"] = status
        updates["vinted_status_at"] = now
        if price is not None:
            updates["vinted_online_price"] = price
            if getattr(draft, "vinted_listed_price", None) is None:
                updates["vinted_listed_price"] = price

    return updates
