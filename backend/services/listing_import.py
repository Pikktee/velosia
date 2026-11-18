"""Übernahme vorhandener Plattform-Anzeigen in Velosia (V2.8.21, zuerst Kleinanzeigen).

Ablauf: Die App öffnet in ihrer WebView „Meine Anzeigen“ der Plattform, wo der
Nutzer ohnehin eingeloggt ist. Die Engine liest dort nur die Liste (ID, Titel,
Status) und schickt sie an POST /api/import/listings. Der Server legt für jede
neue Anzeige sofort ein Angebot an (Titel + Status, damit es gleich in der Liste
steht) und füllt es danach im Hintergrund aus der ÖFFENTLICHEN Anzeigenseite:
Beschreibung, Preis, Preisart, Zustand, Merkmale, Kategorie, Erstelldatum und
alle Fotos. Gelesen wird damit nur, was jeder Besucher sieht, und zwar mit
demselben Client und derselben Zurückhaltung wie der Status-Abruf
(services/http_client, Abrufe nacheinander mit Abstand).

Die Vinted-Kategorie wählt danach ein kleiner Text-Aufruf der KI
(pick_vinted_category), damit das übernommene Angebot gleich auf Vinted
eingestellt werden kann. Bilder-Kontingent kostet der Import nicht.
"""

import html
import json
import os
import queue
import random
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from data import kleinanzeigen_taxonomy as katax
from services import http_client, listing_status, listing_urls

KLEINANZEIGEN = listing_urls.KLEINANZEIGEN
SUPPORTED_PLATFORMS = (KLEINANZEIGEN,)

# Stand der Übernahme in Draft.import_status: NULL = fertig (oder nie importiert).
PENDING = "pending"
FAILED = "failed"

# Kontostatus aus KAs Verwaltungsliste (m-meine-anzeigen-verwalten.json):
# "paused" ist dort eine reservierte Anzeige; "inactive" (abgelaufen/beendet)
# wird nicht übernommen.
KA_STATES = {"active": listing_status.ONLINE, "paused": listing_status.RESERVIERT}

MAX_ITEMS = 300
MAX_PHOTOS = 20
# Abstand zwischen zwei Anzeigenseiten. Der Import liest nur die eigenen Anzeigen
# eines Nutzers, aber einige Dutzend am Stück sollen nicht wie ein Crawler wirken.
SPACING_S = float(os.getenv("IMPORT_SPACING_S", "3"))
# Größte Bildstufe auf KAs CDN (1200×1600, JPEG; „.AUTO“ liefert AVIF).
KA_IMAGE_RULE = "$_57.JPG"

KA_CONDITION = {
    "neu": "Neu",
    "sehr gut": "Sehr gut",
    "gut": "Gut",
    "in ordnung": "In Ordnung",
    "defekt": "Defekt",
}


# ---------------------------------------------------------------------------
# Titelvergleich (Verknüpfen mit vorhandenen Angeboten)
# ---------------------------------------------------------------------------

def normalize_title(value: Optional[str]) -> str:
    """Wie normalizeSearch im Frontend: ohne Groß/Klein, Akzente, Satzzeichen."""
    s = unicodedata.normalize("NFKD", str(value or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[\W_]+", " ", s).strip()


def ka_title_key(title: Optional[str]) -> str:
    """Vergleichsschlüssel: KA kürzt Titel beim Einstellen auf 65 Zeichen."""
    return normalize_title(listing_status.clamp_title(title, listing_status.KA_TITLE_MAX))


# ---------------------------------------------------------------------------
# Kleinanzeigen-Anzeigenseite lesen
# ---------------------------------------------------------------------------

_KA_BREADCRUMB = re.compile(r'id="vap-brdcrmb".*?</div>', re.S)
_KA_CATEGORY_HREF = re.compile(r'href="/s-[^"/]*/c(\d{1,6})"')
_IMG_TAG = re.compile(r"<img\b[^>]*>", re.S)
_KA_IMAGE_SRC = re.compile(
    r'data-imgsrc="(https://img\.kleinanzeigen\.de/api/v1/prod-ads/images/[0-9a-f]{2}/[0-9a-f-]{36})'
)
_KA_DETAIL = re.compile(
    r'<li class="addetailslist--detail">\s*([^<]*)<span class="addetailslist--detail--value"[^>]*>(.*?)</span>',
    re.S,
)
_KA_DATE = re.compile(r'id="viewad-extra-info".*?<span>(\d{2})\.(\d{2})\.(\d{4})</span>', re.S)
_TAG = re.compile(r"<[^>]+>")


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", fragment or ""))).strip()


def ka_photo_urls(page: str) -> List[str]:
    """Fotos der Galerie (nicht die Vorschaubilder darunter oder fremde Anzeigen),
    in ihrer Reihenfolge, als größte JPEG-Stufe."""
    urls = []
    for tag in _IMG_TAG.findall(page or ""):
        if 'id="viewad-image"' not in tag:
            continue
        m = _KA_IMAGE_SRC.search(tag)
        if m and m.group(1) not in urls:
            urls.append(m.group(1))
    return [f"{u}?rule={KA_IMAGE_RULE}" for u in urls[:MAX_PHOTOS]]


def ka_details(page: str) -> Dict[str, str]:
    """Merkmale der Detailliste („Zustand“, „Art“, „Farbe“ …)."""
    out = {}
    for label, value in _KA_DETAIL.findall(page or ""):
        k, v = _text(label), _text(value)
        if k and v and len(k) <= 60 and len(v) <= 120:
            out[k] = v
    return out


def ka_created(page: str) -> Optional[datetime]:
    m = _KA_DATE.search(page or "")
    if not m:
        return None
    try:
        return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), 12, 0)
    except ValueError:
        return None


_NODE_BY_ID: Dict[str, Dict] = {}
for _n in katax.NODES:
    _last = _n["path"].rsplit("/", 1)[-1]
    if _last.isdigit():
        _NODE_BY_ID.setdefault(_last, _n)


def ka_category(page: str, details: Dict[str, str]) -> Optional[str]:
    """Breadcrumb der Taxonomie („Elektronik > Haushaltsgeräte > Staubsauger“).
    Die Brotkrumen der Seite enden auf Ebene 2 (`/s-…/c176`); die c-Nummer ist die
    Knoten-ID unserer Taxonomie. Ebene 3 steht als Merkmal „Art“ in der Detailliste."""
    block = _KA_BREADCRUMB.search(page or "")
    if not block:
        return None
    node = None
    for cid in reversed(_KA_CATEGORY_HREF.findall(block.group(0))):
        node = _NODE_BY_ID.get(cid)
        if node:
            break
    if not node:
        return None
    if not node.get("leaf"):
        leaf = katax.leaf_under(node["path"], details.get("Art") or details.get("Typ"))
        if not leaf:
            names = {katax._norm(v) for v in details.values()}
            leaf = next((c for c in katax.children_of(node["path"]) if katax._norm(c["name"]) in names), None)
        if leaf:
            node = leaf
    return node.get("breadcrumb")


_KA_SHIPPING_RE = re.compile(r'class="boxedarticle--details--shipping"[^>]*>([^<]*)<')


def ka_pickup_only(page: str) -> bool:
    """Neben dem Preis steht „Nur Abholung“ statt „+ Versand ab …“ (live 2026-11)."""
    m = _KA_SHIPPING_RE.search(page or "")
    return bool(m and "nur abholung" in m.group(1).lower())


def ka_condition(details: Dict[str, str]) -> Optional[str]:
    return KA_CONDITION.get((details.get("Zustand") or "").strip().lower())


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    """Erstelldatum aus KAs Liste (ISO, mit oder ohne Zeitzone) → naive UTC."""
    if not value or not isinstance(value, str):
        return None
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})", value.strip())
    if m:
        try:
            return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), 12, 0)
        except ValueError:
            return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# ---------------------------------------------------------------------------
# Hintergrund-Übernahme
# ---------------------------------------------------------------------------

class _Config:
    session_factory: Optional[Callable] = None
    upload_dir: str = "uploads"
    # (db, user, fn) -> Ergebnis von fn(); bucht den KI-Verbrauch dem Nutzer zu.
    with_ai_usage: Optional[Callable] = None
    remove_files: Optional[Callable] = None


_cfg = _Config()
_queue: "queue.Queue[int]" = queue.Queue()
_queued = set()
_lock = threading.Lock()
_worker: Optional[threading.Thread] = None


def configure(session_factory, upload_dir, with_ai_usage, remove_files) -> None:
    _cfg.session_factory = session_factory
    _cfg.upload_dir = upload_dir
    _cfg.with_ai_usage = with_ai_usage
    _cfg.remove_files = remove_files


def enqueue(draft_ids) -> None:
    global _worker
    with _lock:
        for did in draft_ids:
            if did not in _queued:
                _queued.add(did)
                _queue.put(did)
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="listing-import", daemon=True)
            _worker.start()


def resume_pending() -> None:
    """Nach einem Neustart: angefangene Übernahmen fortsetzen."""
    if not _cfg.session_factory:
        return
    import models
    db = _cfg.session_factory()
    try:
        ids = [d.id for d in db.query(models.Draft.id).filter(models.Draft.import_status == PENDING).all()]
    finally:
        db.close()
    if ids:
        print(f"[import] setze {len(ids)} angefangene Übernahmen fort.", flush=True)
        enqueue(ids)


def _run() -> None:
    while True:
        did = _queue.get()
        try:
            fill_draft(did)
        except Exception as e:  # nie den Worker verlieren
            print(f"[import] Angebot {did} fehlgeschlagen: {e}", flush=True)
        finally:
            with _lock:
                _queued.discard(did)
        time.sleep(SPACING_S + random.uniform(0, 1.5))


def _store_photos(urls: List[str]) -> List[str]:
    import image_store
    paths = []
    for url in urls:
        data = http_client.fetch_image(url)
        if not data:
            continue
        try:
            path, _local = image_store.store_bytes(data, _cfg.upload_dir)
        except Exception as e:
            print(f"[import] Foto nicht gespeichert: {e}", flush=True)
            continue
        paths.append(path)
    return paths


def fill_draft(draft_id: int) -> None:
    """Füllt ein angelegtes Angebot aus seiner öffentlichen KA-Anzeigenseite."""
    import models
    db = _cfg.session_factory()
    try:
        draft = db.get(models.Draft, draft_id)
        if not draft or draft.import_status != PENDING:
            return
        url = listing_urls.safe_listing_url(KLEINANZEIGEN, draft.ka_listing_id, draft.ka_listing_url)
        if not url:
            draft.import_status = FAILED
            db.commit()
            return
        status, offer, resp = listing_status.read_kleinanzeigen(url)
        now = datetime.utcnow()
        if status == listing_status.GELOESCHT:
            draft.ka_status, draft.ka_status_at, draft.import_status = status, now, None
            db.commit()
            return
        if resp is None or resp.status_code != 200:
            draft.import_status = FAILED
            db.commit()
            print(f"[import] Anzeigenseite für Angebot {draft_id} nicht lesbar "
                  f"({getattr(resp, 'status_code', 'kein Abruf')}).", flush=True)
            return
        page = resp.text or ""
        details = ka_details(page)
        user_id = draft.user_id
        db.close()  # Fotos laden dauert; keine Sitzung offen halten

        photos = _store_photos(ka_photo_urls(page))

        db = _cfg.session_factory()
        draft = db.get(models.Draft, draft_id)
        if not draft or draft.import_status != PENDING:
            # In der Zwischenzeit gelöscht: geladene Fotos wieder entfernen.
            if _cfg.remove_files:
                _cfg.remove_files(photos)
            return

        title = offer.get("title") or draft.title
        description = offer.get("description")
        draft.title = title
        if description:
            draft.description = description
        if offer.get("price") is not None:
            draft.price = offer["price"]
        if offer.get("price_type") in ("FIXED", "NEGOTIABLE"):
            draft.price_type = offer["price_type"]
        draft.condition = ka_condition(details) or draft.condition
        if ka_pickup_only(page):
            draft.delivery = "PICKUP"
        category = ka_category(page, details)
        if category:
            draft.category = category
        if details:
            draft.attributes = json.dumps(details, ensure_ascii=False)
        if photos:
            draft.image_path = photos[0]
            draft.image_paths = json.dumps(photos)
        draft.ka_status = status if status != listing_status.UNBEKANNT else (draft.ka_status or listing_status.ONLINE)
        draft.ka_status_at = now
        draft.ka_published_at = ka_created(page) or draft.ka_published_at
        # Ausgangswerte = die Online-Werte: ein frisch übernommenes Angebot hat
        # keine „Online-Änderungen“.
        for field in ("price", "title", "description"):
            value = getattr(draft, field)
            setattr(draft, f"ka_online_{field}", offer.get(field))
            setattr(draft, f"ka_listed_{field}", offer.get(field) if offer.get(field) is not None else value)
        draft.ka_online_price_type = offer.get("price_type")
        draft.import_status = None
        db.commit()

        if not draft.vinted_category and title and _cfg.with_ai_usage:
            vinted = _pick_vinted(db, user_id, title, description or "")
            if vinted:
                draft = db.get(models.Draft, draft_id)
                if draft and not draft.vinted_category:
                    draft.vinted_category = vinted
                    db.commit()
    finally:
        db.close()


def _pick_vinted(db, user_id: int, title: str, description: str) -> Optional[str]:
    import models
    from services.gemini_service import pick_vinted_category
    user = db.get(models.User, user_id)
    if not user:
        return None
    try:
        return _cfg.with_ai_usage(db, user, lambda: pick_vinted_category(title, description[:1500]))
    except Exception as e:
        print(f"[import] Vinted-Kategorie nicht gewählt: {e}", flush=True)
        return None
