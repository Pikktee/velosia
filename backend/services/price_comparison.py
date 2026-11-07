from bs4 import BeautifulSoup
import re
import statistics
import urllib.parse
from typing import List, Dict, Any, Optional
from services import http_client
from services.listing_urls import is_platform_url

# How many offers are read from the search page. Generous, because the filters
# below (model numbers, variants, then the AI's same-product check) drop a lot:
# a search for "iPhone 13" returns about as many 13 Pro / 13 mini as 13s.
MAX_LISTINGS = 25

# Words in a title that mark a "Gesuch" (someone wanting to BUY) — those carry
# a buyer's wish price, not a market price. KA also tags them with a "Gesuch"
# badge; the title check catches the ones posted as normal ads.
_WANTED_RE = re.compile(r"\b(suche|gesucht|ankauf|kaufe)\b", re.IGNORECASE)

_PRICE_RE = re.compile(r"(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*€")


def _parse_price(text: str) -> Optional[float]:
    """'1.275 € VB' -> 1275.0, '12,50 €' -> 12.5, 'VB' / 'Zu verschenken' -> None."""
    m = _PRICE_RE.search(text or "")
    if not m:
        return None
    euros = float(m.group(1).replace(".", ""))
    cents = float(f"0.{m.group(2)}") if m.group(2) else 0.0
    return euros + cents


def _empty_result() -> Dict[str, Any]:
    """No usable market data. Deliberately empty — invented numbers here would be
    passed to the AI as 'real market data' and anchor the price to nonsense."""
    return {"median_price": None, "min_price": None, "max_price": None, "listings": []}


def _parse_listings(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    listings: List[Dict[str, Any]] = []
    seen = set()

    # Since the 2026 React/Tailwind rebuild every result is an
    # <article data-adid=… data-href=…>; the old `article.aditem` markup is gone.
    for item in soup.select("article[data-adid]"):
        ad_id = item.get("data-adid")
        if not ad_id or ad_id in seen:  # top ads are repeated further down
            continue
        seen.add(ad_id)

        if item.find(string=lambda t: t and t.strip() == "Gesuch"):
            continue

        title_el = item.find(["h3", "h2"])
        title = title_el.get_text(" ", strip=True) if title_el else ""
        if not title or _WANTED_RE.search(title):
            continue

        # The current price is the bold one; a struck-through old price may sit next to it.
        price_el = item.select_one("p.font-strong")
        price = _parse_price(price_el.get_text(" ", strip=True)) if price_el else None
        if not price:  # "VB" without amount, "Zu verschenken", "Tausch"
            continue

        href = item.get("data-href") or ""
        link = href if href.startswith("http") else f"https://www.kleinanzeigen.de{href}"
        if not is_platform_url(link):
            link = None  # only ever link to the platform itself

        listings.append({"title": title, "price": price, "url": link})
        if len(listings) >= MAX_LISTINGS:
            break

    return listings


def _robust_prices(prices: List[float]) -> List[float]:
    """Drop outliers relative to the median — accessories (a 20 € stand in a
    Mac-mini search) at the bottom, maxed-out Pro configs at the top."""
    if len(prices) < 4:
        return prices
    med = statistics.median(prices)
    kept = [p for p in prices if med * 0.4 <= p <= med * 2.5]
    return kept or prices


# --- Relevance pre-filter -----------------------------------------------------
# Kleinanzeigen's search is fuzzy: "Apple Mac mini M2" also returns M2 Pro,
# "iPhone 13" returns 13 Pro / 13 mini, "WH-1000XM4" sometimes the XM3. These
# deterministic rules drop the obvious mismatches before the AI looks at the
# rest (select_comparable in gemini_service) — and still work when that AI call
# fails.

# Words that turn a model into a different (pricier/cheaper) one when they
# follow a model number: "13 Pro", "M2 Pro", "S23 Ultra", "XM4 Mini".
_VARIANT_WORDS = {"pro", "max", "mini", "plus", "ultra", "lite", "air", "se", "fe", "neo", "edge"}

# Number+unit tokens (storage, voltage, size, …) are not model identifiers —
# many sellers leave them out of the title, so they are not required to match.
_UNIT_TOKEN_RE = re.compile(
    r"^\d+(?:gb|tb|mb|v|w|wh|mah|l|ml|cm|mm|m|kg|g|zoll|hz|mp|x)$|^[wl]\d{2}$"
)

_TOKEN_RE = re.compile(r"[a-z0-9äöüß]+")


def _tokens(text: str) -> List[str]:
    return _TOKEN_RE.findall((text or "").lower())


def _collapsed(text: str) -> str:
    """Lower-case text without spaces/punctuation: "WH1000 XM4" == "wh-1000xm4"."""
    return "".join(_tokens(text))


def _model_tokens(query: str) -> List[str]:
    """Query tokens that identify the model: they carry a digit and are not a
    plain quantity ("13", "m2", "wh1000xm4", "501", "gsr" stays optional).
    Hyphenated model names are joined first ("WH-1000XM4" -> "wh1000xm4")."""
    joined = re.sub(r"(?<=[a-z0-9])-(?=[a-z0-9])", "", (query or "").lower())
    out = []
    for tok in _tokens(joined):
        if any(ch.isdigit() for ch in tok) and not _UNIT_TOKEN_RE.match(tok):
            out.append(tok)
    return out


def _has_model_token(tok: str, title_tokens: List[str], flat: str) -> bool:
    """A pure number ("13", "90", "501") must stand as its own number in the
    title (alone or glued to letters: "iphone13", "13pro") — a substring check
    would find "13" in "130" or "2013". Mixed tokens ("m2", "wh1000xm4") are
    looked up in the collapsed title, which tolerates spaces and hyphens."""
    if tok.isdigit():
        pattern = re.compile(rf"(?<!\d){tok}(?!\d)")
        return any(t == tok or (pattern.search(t) and not t.isdigit()) for t in title_tokens)
    return tok in flat


def _foreign_variant(title: str, query_tokens: set) -> Optional[str]:
    """A variant word that directly follows a model number in the title but is
    not part of the query ("iPhone 13 Pro" for the query "iPhone 13")."""
    toks = _tokens(title)
    for prev, tok in zip(toks, toks[1:]):
        if tok in _VARIANT_WORDS and tok not in query_tokens and any(ch.isdigit() for ch in prev):
            return tok
    return None


def prefilter_listings(listings: List[Dict[str, Any]], query: str) -> List[Dict[str, Any]]:
    """Drop listings whose title lacks a model number of the query or names a
    different variant of it."""
    required = _model_tokens(query)
    query_tokens = set(_tokens(query))
    kept = []
    for item in listings:
        title = item.get("title") or ""
        flat = _collapsed(title)
        title_tokens = _tokens(title)
        if not all(_has_model_token(tok, title_tokens, flat) for tok in required):
            continue
        if _foreign_variant(title, query_tokens):
            continue
        kept.append(item)
    return kept


def summarize_prices(listings: List[Dict[str, Any]], min_count: int = 2) -> Dict[str, Any]:
    """Median / min / max over comparable listings (outliers dropped). Fewer than
    `min_count` usable offers is no market data — a single listing is an anecdote."""
    prices = _robust_prices(sorted(l["price"] for l in listings if l.get("price")))
    if len(prices) < min_count:
        return _empty_result()
    kept = [l for l in listings if l.get("price") in prices]
    return {
        "median_price": statistics.median(prices),
        "min_price": min(prices),
        "max_price": max(prices),
        "listings": kept,
    }


def fetch_listings(keywords: str) -> List[Dict[str, Any]]:
    """Offers from a Kleinanzeigen search, already pre-filtered for the query's
    model (prefilter_listings). Empty list when the search failed."""
    query_encoded = urllib.parse.quote_plus(keywords)
    url = f"https://www.kleinanzeigen.de/s-{query_encoded}/k0"

    try:
        # curl-cffi with a real Chrome fingerprint — survives the Cloudflare challenge.
        response = http_client.fetch(url, timeout=12)
        if response is None or response.status_code != 200:
            code = response.status_code if response is not None else "no-response"
            print(f"WARNING: Preisvergleich: Kleinanzeigen antwortete {code} — keine Vergleichsdaten.")
            return []
        listings = _parse_listings(response.text)
        if not listings:
            print(f"WARNING: Preisvergleich: keine verwertbaren Angebote für '{keywords}' "
                  f"(Markup geändert?) — keine Vergleichsdaten.")
            return []
        kept = prefilter_listings(listings, keywords)
        print(f"Velosia Preisvergleich: {len(listings)} Treffer, {len(kept)} nach Modell-/Variantenfilter.")
        return kept
    except Exception as e:
        print(f"Error executing price comparison: {e}")
        return []


def search_marketplace_prices(keywords: str) -> Dict[str, Any]:
    """
    Searches Kleinanzeigen for the given keywords and returns the comparable
    offers plus median / min / max of their prices. Returns an empty result
    (median None, no listings) when nothing usable was found — never mock data.
    """
    return summarize_prices(fetch_listings(keywords))
