"""eBay's official REST APIs (application token, no user login).

Used for eBay as the third platform (V2.8):
  * Taxonomy API — eBay's category for a title and the item specifics
    ("Artikelmerkmale") a category asks for: which are required, which values are
    allowed, single or multiple choice.
  * Browse API   — status, price, title and description of a published listing.

Why an API and not the public pages: eBay answers server-side reads of its item
pages with 403 (bot protection, checked 2026-11). We do not work around that; the
Browse API reads the same public data with eBay's permission.

Credentials: EBAY_CLIENT_ID (App ID) and EBAY_CLIENT_SECRET (Cert ID) of a
production keyset from developer.ebay.com. Without them every function returns
None and eBay simply works without prepared item specifics / status polling.
"""

import base64
import os
import threading
import time
from typing import Optional

import requests

API = "https://api.ebay.com"
MARKETPLACE = os.getenv("EBAY_MARKETPLACE", "EBAY_DE")
# eBay.de's category tree id (stable; get_default_category_tree_id confirms it).
CATEGORY_TREE_ID = os.getenv("EBAY_CATEGORY_TREE_ID", "77")
_SCOPE = "https://api.ebay.com/oauth/api_scope"
_TIMEOUT = 15

_token_lock = threading.Lock()
_token = {"value": None, "expires": 0.0}

# Aspect metadata changes rarely; one fetch per category and process lifetime
# (bounded) is plenty.
_ASPECT_CACHE: dict = {}
_ASPECT_CACHE_MAX = 500


def configured() -> bool:
    return bool(os.getenv("EBAY_CLIENT_ID") and os.getenv("EBAY_CLIENT_SECRET"))


def _app_token() -> Optional[str]:
    """Client-credentials token (valid ~2 h), cached until shortly before expiry."""
    if not configured():
        return None
    with _token_lock:
        if _token["value"] and time.time() < _token["expires"] - 120:
            return _token["value"]
        basic = base64.b64encode(
            f"{os.getenv('EBAY_CLIENT_ID')}:{os.getenv('EBAY_CLIENT_SECRET')}".encode()
        ).decode()
        try:
            resp = requests.post(
                f"{API}/identity/v1/oauth2/token",
                headers={
                    "Authorization": f"Basic {basic}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials", "scope": _SCOPE},
                timeout=_TIMEOUT,
            )
        except requests.RequestException as e:
            print(f"[ebay] Token-Abruf fehlgeschlagen: {e}", flush=True)
            return None
        if resp.status_code != 200:
            print(f"[ebay] Token-Abruf: HTTP {resp.status_code} {resp.text[:200]}", flush=True)
            return None
        data = resp.json()
        _token["value"] = data.get("access_token")
        _token["expires"] = time.time() + float(data.get("expires_in") or 0)
        return _token["value"]


def _get(path: str, params: dict):
    """(status_code, json or None). status 0 = not configured / transport error."""
    token = _app_token()
    if not token:
        return 0, None
    try:
        resp = requests.get(
            f"{API}{path}",
            params=params,
            headers={
                "Authorization": f"Bearer {token}",
                "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
                "Accept-Language": "de-DE",
            },
            timeout=_TIMEOUT,
        )
    except requests.RequestException as e:
        print(f"[ebay] {path} fehlgeschlagen: {e}", flush=True)
        return 0, None
    if resp.status_code == 401:
        # Token revoked or rotated early: fetch a fresh one next time.
        with _token_lock:
            _token["value"] = None
    try:
        body = resp.json()
    except ValueError:
        body = None
    return resp.status_code, body


# ---------------------------------------------------------------------------
# Taxonomy
# ---------------------------------------------------------------------------

def suggest_category(query: str) -> Optional[dict]:
    """eBay's best category for a title: {"id": "112529", "breadcrumb":
    "TV, Video & Audio > Kopfhörer > Kopfhörer"} or None."""
    query = (query or "").strip()[:350]
    if not query:
        return None
    code, body = _get(
        f"/commerce/taxonomy/v1/category_tree/{CATEGORY_TREE_ID}/get_category_suggestions",
        {"q": query},
    )
    if code != 200 or not isinstance(body, dict):
        return None
    for sug in body.get("categorySuggestions") or []:
        cat = sug.get("category") or {}
        cat_id = cat.get("categoryId")
        if not cat_id:
            continue
        # Ancestors come leaf-first; the root ("Alle Kategorien") is level 0.
        ancestors = sorted(
            sug.get("categoryTreeNodeAncestors") or [],
            key=lambda a: a.get("categoryTreeNodeLevel") or 0,
        )
        names = [a.get("categoryName") for a in ancestors if (a.get("categoryTreeNodeLevel") or 0) > 0]
        names.append(cat.get("categoryName"))
        return {"id": str(cat_id), "breadcrumb": " > ".join(n for n in names if n)}
    return None


def category_aspects(category_id: str) -> Optional[list]:
    """Item specifics of a leaf category, simplified:
    [{"name": "Produktart", "required": True, "mode": "SELECTION_ONLY",
      "multi": False, "values": ["In-Ear-Kopfhörer", …]}, …] or None."""
    if not category_id:
        return None
    if category_id in _ASPECT_CACHE:
        return _ASPECT_CACHE[category_id]
    code, body = _get(
        f"/commerce/taxonomy/v1/category_tree/{CATEGORY_TREE_ID}/get_item_aspects_for_category",
        {"category_id": category_id},
    )
    if code != 200 or not isinstance(body, dict):
        return None
    aspects = []
    for a in body.get("aspects") or []:
        name = a.get("localizedAspectName")
        if not name:
            continue
        c = a.get("aspectConstraint") or {}
        aspects.append({
            "name": name,
            "required": bool(c.get("aspectRequired")),
            "recommended": c.get("aspectUsage") == "RECOMMENDED",
            "mode": c.get("aspectMode") or "FREE_TEXT",
            "multi": c.get("itemToAspectCardinality") == "MULTI",
            "values": [v.get("localizedValue") for v in (a.get("aspectValues") or []) if v.get("localizedValue")],
        })
    if len(_ASPECT_CACHE) >= _ASPECT_CACHE_MAX:
        _ASPECT_CACHE.clear()
    _ASPECT_CACHE[category_id] = aspects
    return aspects


# ---------------------------------------------------------------------------
# Browse (status of a published listing)
# ---------------------------------------------------------------------------

def get_item(legacy_item_id: str):
    """("ok", item) for a live listing, ("gone", None) when eBay no longer serves
    it (ended: sold or taken down), (None, None) when unknown (not configured,
    transport error, rate limit)."""
    code, body = _get(
        "/buy/browse/v1/item/get_item_by_legacy_id",
        {"legacy_item_id": str(legacy_item_id)},
    )
    if code == 200 and isinstance(body, dict):
        return "ok", body
    if code == 404:
        return "gone", None
    if code == 400 and isinstance(body, dict):
        # Ended items answer 400/11001 "item … is no longer available" on some
        # marketplaces instead of 404.
        for err in body.get("errors") or []:
            if str(err.get("errorId")) in ("11001", "11006"):
                return "gone", None
    return None, None
