# Vintamie - AI-Powered Listing Automation

Vintamie automates listing items on Second-Hand platforms (Vinted and Kleinanzeigen) by capturing photos, generating titles, descriptions, categories, and prices using Vision AI, and autofilling listing forms via a WebExtension or a native Android WebView Shell.

## V2 Features (Multi-User & Price Scraper)
*   **Multi-User Auth:** JWT-based user session authentication (registration, login, profile check) securing all API requests.
*   **Live Price Scraper:** Scraping search results from Kleinanzeigen using BeautifulSoup, estimating median prices, and linking source comparisons directly in drafts.

---

## Autofill & Category Architecture (V2.4+)

Autofilling Vinted/Kleinanzeigen forms is driven by a **single shared engine**, `shared/autofill-engine.js` (pure DOM JS, no platform APIs). It is the single source of truth and is **mirrored by `deploy.py`** into `extension/autofill-engine.js` and `android/app/src/main/assets/autofill-engine.js` — never edit those copies, edit `shared/` and let deploy sync them. Public API: `window.__vintamie.autofill(draft, options)`. The React-safe native value setter (prototype `value` setter + bubbling `input` event) is what makes Vinted (a React SPA) accept programmatic input. `auto_submit` (User setting) controls whether the engine also clicks publish; default false = user reviews and publishes manually.

**Kleinanzeigen category selection is a hash-routed tree, NOT a keyword search.** A category is a link `<a class="category-selection-list-item-link" href="#?path=161/176/staubsauger">`. The engine sets `location.hash = "?path=...&isParent=undefined"` and clicks **"Weiter"** to reach `p-anzeige-aufgeben-schritt2.html` with the category pre-set (the 3rd tree level becomes the "Art" dropdown there).

**Full category coverage (all 3018 leaf categories):**
*   The complete live taxonomy was harvested once via a client-side BFS tree-walk (the tree is embedded in the page JS, so expanding nodes via the hash hits **no network** — safe, triggers no bot detection). Re-harvest only if Kleinanzeigen restructures its tree, using `backend/data/harvest_taxonomy_snippet.js`.
*   Data lives in `backend/data/kleinanzeigen_taxonomy.json` (3168 nodes) and is served by `backend/data/kleinanzeigen_taxonomy.py` (search/resolve helpers + a ~362-line AI selection list with the huge car-model branch collapsed to level 2, ~4k tokens).
*   `gemini_service` has the AI pick an **exact breadcrumb** (`"Elektronik > Haushaltsgeräte > Staubsauger"`); the server resolves it losslessly to the tree path (breadcrumbs are globally unique). If the AI picks a 2nd-level category, the server descends to the leaf via the `Art` attribute.
*   `Draft.category` stores the breadcrumb; `Draft.category_path` is a **derived `@property`** (no DB column / migration) that maps it to the path, exposed in `DraftResponse` and consumed by the engine.
*   The legacy curated `backend/data/kleinanzeigen_categories.py` is kept only for generic attribute cleaning + `CONDITION_TO_ZUSTAND`; category selection now goes through the full taxonomy.

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

Vintamie is deployed directly via the Railway CLI, bypassing the GitHub connection state mismatch. 

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
    *   **Custom Domain:** `api.vintamie.henrikheil.net` (Port `8080`)

2.  **Frontend Service:**
    *   **Start Command:** `npm run start` (serves the static production build using Vite preview)
    *   **Environment Variables:**
        *   `VITE_API_URL`: `https://api.vintamie.henrikheil.net`
    *   **Custom Domain:** `vintamie.henrikheil.net` (Port `8080`)

---

## Agent Integration & Auto-Deployment

> [!IMPORTANT]
> **Aktueller Fokus:** Die **Android-App** (der WebView-Wrapper) ist die primäre Zielplattform – alles muss reibungslos in der App laufen. Das bedeutet aber **nicht**, dass nur `/android` bearbeitet wird: Die App ist eine reine WebView-Hülle, die das React-Frontend lädt. Features wie Kamera-Erfassung (`getUserMedia` im Frontend) und KI-Logik (Backend) leben daher in `/frontend` und `/backend` und erscheinen automatisch in der App. Native Kotlin-Änderungen (`/android`) sind nur für echte Wrapper-Belange nötig (Autofill-Bridge, Datei-Chooser, Permissions, OTA-Update). Eine eigenständige Web-App wird perspektivisch nicht mehr aktiv beworben, da das automatisierte Einstellen bei Vinted/Kleinanzeigen zuverlässig nur über die App-WebView (bzw. die WebExtension auf Desktop/Firefox) funktioniert.

> [!IMPORTANT]
> Nach jedem erfolgreichen Ergebnis im Chat (z. B. dem Abschluss einer Feature-Implementierung oder Fehlerbehebung) muss der KI-Agent automatisch ein Git-Push und Deployment durch Ausführen des Skripts `./deploy.py` initiieren.
