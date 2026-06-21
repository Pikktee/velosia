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

Vinted
  * Deleted item = clean 404.
  * JSON-LD <script type="application/ld+json"> carries
    "availability":"InStock" | "OutOfStock" | "SoldOut".
  * The embedded item JSON carries is_reserved / is_closed booleans
    (backslash-escaped inside the RSC payload).
"""

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


def check_kleinanzeigen(url):
    return _ka_status(http_client.fetch(url, timeout=15))


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


def check_vinted(url):
    return _vinted_status(http_client.fetch(url, timeout=20))


# ---------------------------------------------------------------------------
# Draft-level refresh (pure: returns the column updates, does not commit)
# ---------------------------------------------------------------------------

def refresh_draft_status(draft, now):
    """Poll whichever platforms this draft is published on and return a dict of
    column updates. Terminal statuses (sold/deleted) are not re-polled."""
    updates = {}

    ka_url = getattr(draft, "ka_listing_url", None)
    if ka_url and getattr(draft, "ka_status", None) not in TERMINAL:
        updates["ka_status"] = check_kleinanzeigen(ka_url)
        updates["ka_status_at"] = now

    v_url = getattr(draft, "vinted_listing_url", None)
    if v_url and getattr(draft, "vinted_status", None) not in TERMINAL:
        updates["vinted_status"] = check_vinted(v_url)
        updates["vinted_status_at"] = now

    return updates
