# Velosia - AI-Powered Listing Automation

Velosia automates listing items on Second-Hand platforms (Vinted and Kleinanzeigen) by capturing photos, generating titles, descriptions, categories, and prices using Vision AI, and autofilling listing forms via a WebExtension or a native Android WebView Shell.

## V2 Features (Multi-User & Price Scraper)
*   **Multi-User Auth:** JWT-based user session authentication (registration, login, profile check) securing all API requests.
*   **Live Price Scraper:** Scraping search results from Kleinanzeigen using BeautifulSoup, estimating median prices, and linking source comparisons directly in drafts.

---

## Autofill & Category Architecture (V2.4+)

Autofilling Vinted/Kleinanzeigen forms is driven by a **single shared engine**, `shared/autofill-engine.js` (pure DOM JS, no platform APIs). It is the single source of truth and is **mirrored by `deploy.py`** into `extension/autofill-engine.js` and `android/app/src/main/assets/autofill-engine.js` — never edit those copies, edit `shared/` and let deploy sync them. Public API: `window.__velosia.autofill(draft, options)`. The React-safe native value setter (prototype `value` setter + bubbling `input` event) is what makes Vinted (a React SPA) accept programmatic input. `auto_submit` (User setting) controls whether the engine also clicks publish; default false = user reviews and publishes manually.

**Kleinanzeigen category selection is a hash-routed tree, NOT a keyword search.** A category is a link `<a class="category-selection-list-item-link" href="#?path=161/176/staubsauger">`. The engine sets `location.hash = "?path=...&isParent=undefined"` and clicks **"Weiter"** to reach `p-anzeige-aufgeben-schritt2.html` with the category pre-set (the 3rd tree level becomes the "Art" dropdown there).

**Full category coverage (all 3018 leaf categories):**
*   The complete live taxonomy was harvested once via a client-side BFS tree-walk (the tree is embedded in the page JS, so expanding nodes via the hash hits **no network** — safe, triggers no bot detection). Re-harvest only if Kleinanzeigen restructures its tree, using `backend/data/harvest_taxonomy_snippet.js`.
*   Data lives in `backend/data/kleinanzeigen_taxonomy.json` (3168 nodes) and is served by `backend/data/kleinanzeigen_taxonomy.py` (search/resolve helpers + a ~362-line AI selection list with the huge car-model branch collapsed to level 2, ~4k tokens).
*   `gemini_service` has the AI pick an **exact breadcrumb** (`"Elektronik > Haushaltsgeräte > Staubsauger"`); the server resolves it losslessly to the tree path (breadcrumbs are globally unique). If the AI picks a 2nd-level category, the server descends to the leaf via the `Art` attribute.
*   `Draft.category` stores the breadcrumb; `Draft.category_path` is a **derived `@property`** (no DB column / migration) that maps it to the path, exposed in `DraftResponse` and consumed by the engine.
*   The legacy curated `backend/data/kleinanzeigen_categories.py` is kept only for generic attribute cleaning + `CONDITION_TO_ZUSTAND`; category selection now goes through the full taxonomy.

**Vinted categories (separate taxonomy):** Vinted has its own catalog tree, completely independent of Kleinanzeigen, so a draft carries **two** category paths.
*   Vinted's full taxonomy (2917 nodes / 2498 leaves) was harvested once from the embedded RSC payload (`self.__next_f`) on `items/new` and baked into `backend/data/vinted_taxonomy.json` + `vinted_taxonomy.py`. Each node has a numeric catalog `id`; the path is the chain of ids (e.g. `1904/4/183/1839`).
*   Vinted's picker is an in-DOM dropdown (`[data-testid="catalog-select-dropdown-content"]`) that drills one level per click. Levels 1–2 render options with `[data-testid="catalog-icon-<ID>"]`; deeper levels render plain `web_ui__Cell` rows carrying only the **name** (no id). The engine's `selectVintedCategory` opens the picker and drills each path level: catalog-id click where available, name match (from the breadcrumb) deeper. NB: the page's `first-category-<ID>` / `role="tab"` elements are the site's top NAV (browse links) — NOT the form picker.
*   The AI resolves the Vinted category in a **separate, graceful text call** (`pick_vinted_category` in `gemini_service`) so quota/parse failures just leave it manual without breaking the draft (Kleinanzeigen still works).
*   `Draft.vinted_category` (a real column, additive migration) stores the breadcrumb; `Draft.vinted_path` is a derived `@property` mapping it to the catalog-id path. Both `vinted_category` and `vinted_path` are exposed in `DraftResponse`. Brand/size/condition pickers are still left manual.

**Automatic health monitoring (telemetry, V2.4.7):** Because Vinted/Kleinanzeigen change their forms occasionally, the engine reports an **anonymous structural outcome** after each autofill (NO listing content — only which core fields resolved + category ✓/✗) to `POST /api/telemetry/autofill` (`models.AutofillEvent`). A background check (`check_autofill_anomaly` in `main.py`) flags when a normally-reliable field/action fails across the recent window and **e-mails the maintainer** (`services/notifications.py`, stdlib smtplib, `models.AlertLog` enforces a 24h per-signal cooldown). Active synthetic crawling of the live forms is deliberately avoided — it triggers the same bot/fraud detection that once IP-banned us. Required Railway env vars for the e-mail alert (alerts are only logged if unset): `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `ALERT_EMAIL_TO`, optional `ALERT_EMAIL_FROM`.

---

## Listing Tracking & Re-Listing (V2.5)

After a listing goes live we capture its **public listing id/URL** and track its status (online / reserviert / verkauft / geloescht) right in the dashboard, plus a one-tap **"Neu einstellen"**.

**Capture (no login, no form crawl).** The engine parses the *published* page URL — Vinted `/items/<id>-slug`, Kleinanzeigen `/s-anzeige/<slug>/<id>-…` — and POSTs `{draft_id, platform, listing_id, listing_url}` to `POST /api/listings/published`. Two capture paths because the platforms publish differently:
*   **Vinted** is a React SPA: publishing navigates `/items/new` → `/items/<id>` *without* a document reload, so a content script matched on the item page never fires. The engine instead runs an in-context watcher (`watchVintedPublish`, started from `autofill()` for the form phase) that polls the URL and captures once the item id appears. Works for manual and auto-submit.
*   **Kleinanzeigen** does a full navigation to the live ad, so a dedicated capture content script (`extension/capture.js`, matched on `/s-anzeige/*`, **not** mirrored from `shared/` — it's a standalone extension file) reads a short-lived `velosia_pending_capture` marker (armed by `content.js` when autofill runs) and reports the id. `capture.js` is also matched on Vinted item pages as a full-reload fallback. Engine helpers `window.__velosia.parseListingUrl` / `captureListing` are the shared single source for both; Android can call `captureListing` from the WebView shell after a KA publish (the one remaining native wire-up — Vinted already works via the watcher).

**Status polling (server-side, curl-cffi).** Reading a *published public ad page* by id is distinct from crawling the form (which got us banned) and is low-volume (only the user's own active listings). `services/http_client.py` is the single outbound choke point — curl-cffi with `impersonate="chrome"` (real Chrome TLS/JA3) defeats Cloudflare/DataDome where plain `requests` got challenged; it also hardened the existing price scraper (which silently fell back to mock data on 403). `services/listing_status.py` maps a page to a status (calibrated against live pages):
*   **Kleinanzeigen**: the status is **not visible text** — KA draws the yellow "Reserviert •" / "Gelöscht •" veil purely client-side from an inline JS config object whose two booleans are nonetheless present in the static (curl-cffi) HTML: `showDeletedVeil:true` → `geloescht`, `showPausedVeil:true` → `reserviert`, both false → `online` (`services/listing_status.py` regex-matches these). A **soft-deleted** ad keeps returning HTTP 200 with `/s-anzeige/` intact and only flips `showDeletedVeil`, so the booleans are primary and the 404 / redirect-off-`/s-anzeige/` heuristic is just the fully-purged fallback. KA exposes **no** public "sold" state (no `showSoldVeil`); the word `verkauft` only appears as free description text and must never be matched. (Calibrated 2026-06 against a live reserved ad + a live soft-deleted ad; an active ad has both veils false. The `s-vac-inc-get.json?adId=` XHR carries only `numVisits`, not status.)
*   **Vinted**: deleted = clean 404; JSON-LD `"availability":"InStock|OutOfStock|SoldOut"` + embedded `is_reserved`/`is_closed` booleans give sold/reserved. Substring matching on raw HTML is unreliable (the page embeds the full translation catalog).

`Draft` gains additive columns `ka_listing_id/url/status/status_at` + `vinted_listing_id/url/status/status_at` (migrated in `main.py`), exposed in `DraftResponse`. Endpoints: `POST /api/listings/{id}/refresh-status` (one draft), `POST /api/listings/refresh-all` (the dashboard's "Status aktualisieren" button). A throttled asyncio background loop (`_status_poll_loop` → `poll_all_active_listings`, every `STATUS_POLL_INTERVAL_MIN`=360 min, requests spaced by `STATUS_POLL_SPACING_S`=4 s, terminal statuses skipped) keeps things fresh without bursts. Frontend: status badges in `DraftList`, a Status section with per-platform badge + "Anzeige öffnen" + "Neu einstellen" in `DraftDetail` (shared meta in `frontend/src/utils/listingStatus.js`).

---

## Project Structure
```
/Users/henrik/Dev/vintamie/
├── backend/          # FastAPI server, SQLite DB, Gemini Vision Service, Auth utils, Scraper
├── frontend/         # Vite + React PWA (fully responsive, glassmorphic dark design)
├── extension/        # manifest.json V3 WebExtension (Chrome / Firefox Android)
├── android/          # Native Android WebView Shell (ready for Android Studio)
└── deploy.py         # Deployment automation script (bumps versions, pushes to Git, deploys to Railway)
```

---

## Developer Guides & Commands

### 1. Backend (FastAPI)
- **Framework:** FastAPI
- **Database:** SQLite (SQLAlchemy) in development, SQLite (with Railway volume) in production.
- **AI SDK:** `google-generativeai` (Gemini 1.5 Flash / 2.5 Flash)
- **Location:** `/Users/henrik/Dev/vintamie/backend`
- **Virtual Env:** `.venv/` (managed by `uv`)
- **Key Commands:**
  - Start Server: `uvicorn main:app --reload --host 0.0.0.0 --port 8000`
  - Install dependencies: `uv pip install -r requirements.txt`
  - Database File: `vintamie.db` (locally) or `/data/vintamie.db` (production volume)

### 2. Frontend (React + Vite)
- **Framework:** React + Vite
- **Styling:** Custom Vanilla CSS (Dark glassmorphism theme in `src/index.css`)
- **Location:** `/Users/henrik/Dev/vintamie/frontend`
- **Key Commands:**
  - Start Dev Server: `npm run dev` (Runs on `http://localhost:5173`)
  - Build App: `npm run build`
  - Start Production Server: `npm run start` (vite preview on `0.0.0.0:$PORT` with allowed hosts)

### 3. WebExtension
- **Manifest Version:** V3
- **Supported Browsers:** Chrome, Edge, Brave (Desktop) and Firefox (Android / Desktop)
- **Location:** `/Users/henrik/Dev/vintamie/extension`
- **Autofill Targets:**
  - Vinted Listing: `*://*.vinted.de/items/new*` and `*://*.vinted.fr/items/new*`
  - Kleinanzeigen Listing: `*://*.kleinanzeigen.de/p-anzeige-aufgeben.html*`

### 4. Android WebView Shell
- **Language:** Kotlin
- **Location:** `/Users/henrik/Dev/vintamie/android`
- **Configuration:** Emulators route to host localhost via `http://10.0.2.2:5173` (Frontend) and `http://10.0.2.2:8000` (Backend).

---

## Production Deployment (Railway)

Velosia is deployed directly via the Railway CLI, bypassing the GitHub connection state mismatch. 

### One-Click Deployment Command
To release a new version, update version numbers in all configuration files, push changes to GitHub, and trigger the Railway builds, run:
```bash
./deploy.py [version] [message]
```
*Example:* `./deploy.py 2.0.2 "Release version 2.0.2 with volume fixes"`
*(If run without arguments, it will automatically bump the patch version and prompt for a commit message).*

### Production Environment Settings

1.  **Backend Service:**
    *   **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
    *   **Persistent Volume:** A 1 GB volume mounted at `/data`.
    *   **Environment Variables:**
        *   `DATABASE_URL`: `sqlite:////data/vintamie.db` (enables persistent SQLite database)
        *   `SECRET_KEY`: Random JWT signing secret
        *   `GEMINI_API_KEY`: Google Gemini API Key
        *   `ACCESS_TOKEN_EXPIRE_MINUTES`: `1440`
    *   **Custom Domain:** `api.velosia.henrikheil.net` (Port `8080`)

2.  **Frontend Service:**
    *   **Start Command:** `npm run start` (serves the static production build using Vite preview)
    *   **Environment Variables:**
        *   `VITE_API_URL`: `https://api.velosia.henrikheil.net`
    *   **Custom Domain:** `velosia.henrikheil.net` (Port `8080`)

---

## Agent Integration & Auto-Deployment

> [!IMPORTANT]
> **Aktueller Fokus:** Die **Android-App** (der WebView-Wrapper) ist die primäre Zielplattform – alles muss reibungslos in der App laufen. Das bedeutet aber **nicht**, dass nur `/android` bearbeitet wird: Die App ist eine reine WebView-Hülle, die das React-Frontend lädt. Features wie Kamera-Erfassung (`getUserMedia` im Frontend) und KI-Logik (Backend) leben daher in `/frontend` und `/backend` und erscheinen automatisch in der App. Native Kotlin-Änderungen (`/android`) sind nur für echte Wrapper-Belange nötig (Autofill-Bridge, Datei-Chooser, Permissions, OTA-Update). Eine eigenständige Web-App wird perspektivisch nicht mehr aktiv beworben, da das automatisierte Einstellen bei Vinted/Kleinanzeigen zuverlässig nur über die App-WebView (bzw. die WebExtension auf Desktop/Firefox) funktioniert.

> [!IMPORTANT]
> Nach jedem erfolgreichen Ergebnis im Chat (z. B. dem Abschluss einer Feature-Implementierung oder Fehlerbehebung) muss der KI-Agent automatisch ein Git-Push und Deployment durch Ausführen des Skripts `./deploy.py` initiieren.
