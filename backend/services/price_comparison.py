from bs4 import BeautifulSoup
import re
import statistics
import urllib.parse
from typing import List, Dict, Any, Optional
from services import http_client

# How many genuine offers feed the statistics. More than a handful so a single
# accessory or bundle in the results can't drag the median around.
MAX_LISTINGS = 15

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


def search_marketplace_prices(keywords: str) -> Dict[str, Any]:
    """
    Searches Kleinanzeigen for the given keywords and returns the comparable
    offers plus median / min / max of their prices. Returns an empty result
    (median None, no listings) when nothing usable was found — never mock data.
    """
    query_encoded = urllib.parse.quote_plus(keywords)
    url = f"https://www.kleinanzeigen.de/s-{query_encoded}/k0"

    try:
        # curl-cffi with a real Chrome fingerprint — survives the Cloudflare challenge.
        response = http_client.fetch(url, timeout=12)
        if response is None or response.status_code != 200:
            code = response.status_code if response is not None else "no-response"
            print(f"WARNING: Preisvergleich: Kleinanzeigen antwortete {code} — keine Vergleichsdaten.")
            return _empty_result()

        listings = _parse_listings(response.text)
        prices = _robust_prices(sorted(l["price"] for l in listings))
        if not prices:
            print(f"WARNING: Preisvergleich: keine verwertbaren Angebote für '{keywords}' "
                  f"(Markup geändert?) — keine Vergleichsdaten.")
            return _empty_result()

        listings = [l for l in listings if l["price"] in prices]
        return {
            "median_price": statistics.median(prices),
            "min_price": min(prices),
            "max_price": max(prices),
            "listings": listings,
        }

    except Exception as e:
        print(f"Error executing price comparison: {e}")
        return _empty_result()
