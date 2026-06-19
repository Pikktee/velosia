# Vintamie - AI-Powered Listing Automation

Vintamie automates listing items on Second-Hand platforms (Vinted and Kleinanzeigen) by capturing photos, generating titles, descriptions, categories, and prices using Vision AI, and autofilling listing forms via a WebExtension or a native Android WebView Shell.

## V2 Features (Multi-User & Price Scraper)
*   **Multi-User Auth:** JWT-based user session authentication (registration, login, profile check) securing all API requests.
*   **Live Price Scraper:** Scraping search results from Kleinanzeigen using BeautifulSoup, estimating median prices, and linking source comparisons directly in drafts.

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
