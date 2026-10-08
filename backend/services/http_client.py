"""
Shared outbound HTTP client for Velosia's server-side reads of public
Kleinanzeigen / Vinted pages (price comparison + listing status tracking).

Uses curl-cffi with a real Chrome TLS/JA3 + HTTP2 fingerprint
(`impersonate="chrome"`). Plain `requests` gets challenged by Cloudflare
(Kleinanzeigen) and DataDome (Vinted); impersonation passes those while only
reading the same public pages any visitor sees — no login, no form crawling.

Discipline baked in: a small randomised delay (jitter), a couple of polite
retries with exponential backoff on rate-limit / block responses, and a single
choke point so call sites never hammer. This is for low-volume reads of the
user's *own* listings, not mass scraping.
"""

import os
import time
import random
from urllib.parse import urljoin

from services.listing_urls import is_platform_url

try:
    from curl_cffi import requests as _cffi
    _HAVE_CFFI = True
except Exception:  # pragma: no cover - fallback so the server still boots
    import requests as _cffi  # type: ignore
    _HAVE_CFFI = False

# Chrome impersonation profile (curl-cffi ships several; "chrome" tracks a
# recent stable). Overridable via env without a code change.
IMPERSONATE = os.getenv("HTTP_IMPERSONATE", "chrome")

# Status codes that mean "blocked / slow down", worth a backed-off retry.
_BLOCK_CODES = {403, 429, 503}
_REDIRECT_CODES = {301, 302, 303, 307, 308}
_MAX_REDIRECTS = 5


def _get(url, timeout):
    kwargs = {"timeout": timeout, "allow_redirects": False}
    if _HAVE_CFFI:
        kwargs["impersonate"] = IMPERSONATE
    else:
        kwargs["headers"] = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept-Language": "de,en-US;q=0.7,en;q=0.3",
        }
    return _cffi.get(url, **kwargs)


def _get_following(url, timeout, allow_redirects):
    """GET `url`, following redirects only while they stay on the platform hosts
    (https). A redirect elsewhere is not followed; its 3xx response is returned."""
    resp = _get(url, timeout)
    hops = 0
    while allow_redirects and resp.status_code in _REDIRECT_CODES and hops < _MAX_REDIRECTS:
        location = resp.headers.get("location") if resp.headers else None
        if not location:
            break
        target = urljoin(url, location)
        if not is_platform_url(target):
            print(f"[http_client] Weiterleitung auf fremden Host nicht verfolgt: {target[:200]}", flush=True)
            break
        url = target
        resp = _get(url, timeout)
        hops += 1
    return resp


def fetch(url, *, timeout=15, allow_redirects=True, retries=2, jitter=True):
    """GET a URL with browser impersonation. Returns the response object (which
    may carry a 4xx/5xx status — the caller decides what that means) or None on
    a hard transport failure. Never raises.

    Only https URLs on the Vinted/Kleinanzeigen hosts are fetched, and redirects
    are followed only within those hosts (see listing_urls.is_platform_url)."""
    if not url:
        return None
    if not is_platform_url(url):
        print(f"[http_client] URL nicht erlaubt, Abruf übersprungen: {str(url)[:200]}", flush=True)
        return None

    last_resp = None
    for attempt in range(retries + 1):
        if jitter:
            # Spread requests so a burst (e.g. refresh-all) never looks robotic.
            time.sleep(random.uniform(0.25, 0.9))
        try:
            resp = _get_following(url, timeout, allow_redirects)
        except Exception as e:
            print(f"[http_client] GET {url} failed (attempt {attempt+1}): {e}", flush=True)
            resp = None

        if resp is not None:
            last_resp = resp
            if resp.status_code not in _BLOCK_CODES:
                return resp

        # Blocked or transport error -> exponential backoff before next try.
        if attempt < retries:
            time.sleep(min(8.0, 1.5 * (attempt + 1)) + random.uniform(0, 0.8))

    return last_resp
