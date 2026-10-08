"""Canonical form of published-listing ids and URLs.

Listing URLs reach the backend from the engine running on the platform page and
are later fetched server-side by the status poller and shown as links in the
dashboard. Only genuine public listing pages on the platforms' own hosts are
kept; anything else is rebuilt from the numeric listing id or dropped.
"""

import re
from typing import Optional, Tuple
from urllib.parse import urlsplit

VINTED = "vinted"
KLEINANZEIGEN = "kleinanzeigen"
PLATFORMS = (VINTED, KLEINANZEIGEN)

HOSTS = {
    VINTED: {"www.vinted.de", "vinted.de", "www.vinted.fr", "vinted.fr"},
    KLEINANZEIGEN: {"www.kleinanzeigen.de", "kleinanzeigen.de"},
}
ALL_HOSTS = frozenset(h for hosts in HOSTS.values() for h in hosts)

_ID_RE = re.compile(r"^\d{1,15}$")
_PATH_RE = {
    # /items/<id> or /items/<id>-<slug>
    VINTED: re.compile(r"^/items/(\d{1,15})(?:-[^/]*)?/?$"),
    # /s-anzeige/<slug>/<id>-<category>-<location>; the Android shell may also
    # report the short form /s-anzeige/<id>
    KLEINANZEIGEN: re.compile(r"^/s-anzeige/(?:[^/]+/)?(\d{1,15})(?:-[^/]*)?/?$"),
}


def clean_listing_id(value) -> Optional[str]:
    value = str(value).strip() if value is not None else ""
    return value if _ID_RE.match(value) else None


def parse_listing_url(platform: str, url) -> Optional[Tuple[str, str]]:
    """(normalized url, listing id) if `url` is a public listing page of
    `platform` on one of its hosts, else None. Query and fragment are dropped."""
    if platform not in PLATFORMS or not isinstance(url, str) or len(url) > 2048:
        return None
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if (
        parts.scheme != "https"
        or parts.username is not None
        or parts.password is not None
        or port is not None
        or host not in HOSTS[platform]
        # netloc must be exactly the host (no stray '@', ':', whitespace …)
        or parts.netloc.lower() != host
    ):
        return None
    m = _PATH_RE[platform].match(parts.path)
    if not m:
        return None
    return f"https://{host}{parts.path}", m.group(1)


def canonical_url_for_id(platform: str, listing_id: Optional[str]) -> Optional[str]:
    """Listing URL built from the id alone. Vinted resolves /items/<id> (the
    engine builds the same form itself). Kleinanzeigen needs the slug, so no URL
    is invented there."""
    if platform == VINTED and listing_id:
        return f"https://www.vinted.de/items/{listing_id}"
    return None


def canonical_listing(platform: str, listing_id, listing_url) -> Tuple[Optional[str], Optional[str]]:
    """Validated (listing_id, listing_url). Either may be None."""
    lid = clean_listing_id(listing_id)
    parsed = parse_listing_url(platform, listing_url) if listing_url else None
    url = None
    if parsed:
        url, url_id = parsed
        if lid is None:
            lid = url_id
        elif url_id != lid:
            # URL and id disagree — trust neither URL.
            url = None
    if url is None:
        url = canonical_url_for_id(platform, lid)
    return lid, url


def safe_listing_url(platform: str, listing_id, listing_url) -> Optional[str]:
    """URL that may be fetched or linked for a stored listing (older rows were
    stored unvalidated)."""
    return canonical_listing(platform, listing_id, listing_url)[1]


def is_platform_url(url: str) -> bool:
    """https URL on one of the platform hosts (any path) — what the shared HTTP
    client may fetch or follow a redirect to."""
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return (
        parts.scheme == "https"
        and parts.username is None
        and parts.password is None
        and port is None
        and host in ALL_HOSTS
        and parts.netloc.lower() == host
    )
