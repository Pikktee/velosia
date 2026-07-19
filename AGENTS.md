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
*   `Draft.vinted_category` (a real column, additive migration) stores the breadcrumb; `Draft.vinted_path` is a derived `@property` mapping it to the catalog-id path. Both `vinted_category` and `vinted_path` are exposed in `DraftResponse`.
*   **Zustand/Größe/Farbe/Material/Marke autofill (V2.6.31):** the Gemini prompt already extracts these into `draft.attributes`/`draft.condition` (no extra AI cost). The engine sets them via a shared `selectVintedDropdownValue()` (Zustand/Größe/Farbe/Material — opens the field by label/testid, clicks the matching option, verifies the field actually changed) plus `selectVintedBrand()` (autocomplete search, committed ONLY on an exact suggestion match — never a "custom brand", per the "leer ist besser als halluziniert" rule). Quirks: the size field shares the label "Größe" with the shipping package-size field (excluded via `avoidWords`); jeans sizes are waist-keyed ("W36 / DE 52"); size options live in a `web_ui__BottomSheet__portal` as `<li>` rows whose real control is an inner `<div role="checkbox" class="filter-grid__option">`.

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

## Play-Store-Release, Store-Präsenz & Admin (V2.6)

**Rebrand:** Die App heißt seit V2.6 **Velosia** (vorher „Vintamie"). Bewusst NICHT umbenannt: die DB-Datei `vintamie.db` (lokal + Prod-Volume `/data/vintamie.db`) und der lokale Ordnerpfad `/Users/henrik/Dev/vintamie`. GitHub-Repo: `Pikktee/velosia`.

**Play-Store-Auto-Upload:** `./deploy.py 2.6.x "msg" --play` baut den signierten Release-AAB und lädt ihn über **Gradle Play Publisher** (`com.github.triplet.play`, `play{}`-Block in `android/app/build.gradle`, Ziel `internal`) direkt in die interne Test-Spur. Greift nur, wenn `android/play-deploy-key.json` (Service-Account, gitignored) existiert → CI bleibt unberührt. `deploy.py` setzt `JAVA_HOME` auf die Android-Studio-JBR. Ohne `--play` = reiner Web-Deploy. Release-Stand: **interner Test live**; für Produktion verlangt Google (neues Konto) zuerst einen **geschlossenen Test** (≥12 Tester, 14 Tage). Interner Test wird **nicht** geprüft → Store zeigt bis zum ersten Review eines geprüften Tracks „(unreviewed)" + Platzhalter-Icon (kosmetisch, kein Fehler).

**Android-Berechtigungen:** Nur `INTERNET` + `CAMERA`. `READ_MEDIA_IMAGES`/`READ_EXTERNAL_STORAGE` wurden **entfernt** — der WebView-File-Picker nutzt `fileChooserParams.createIntent()` (ACTION_GET_CONTENT, temporärer Lesezugriff), die Kamera läuft über WebRTC/`onPermissionRequest`. So ist Googles „Fotos & Videos"-Policy erfüllt. **Store-Assets** (512-Icon, 1024×500-Feature-Grafik) liegen als SVG+PNG in `android/store-assets/` (gerendert via qlmanage + sips).

**Öffentliche Frontend-Routen (Hash-Routing, ohne Login erreichbar):** `#/datenschutz`, `#/impressum`, `#/konto-loeschen` (gemeinsame Texte in `frontend/src/components/legal.jsx`, genutzt von Modal **und** `LegalPage.jsx`) — liefern Google Play feste URLs (Datenschutz + Konto-Löschung). `#/testen` (`TesterPage.jsx`) erklärt den geschlossenen Test + Opt-in-Link. Alle in `App.jsx` als `guestRoutes` gewhitelistet.

**Tester-Warteliste:** Landing-Haupt-CTA ist ein E-Mail-Feld → `POST /api/waitlist` (öffentlich, idempotent, `models.WaitlistEntry`, mailt den Maintainer via `services/notifications`). APK-Download wurde von der Landing entfernt; Desktop-Optionen (Chrome-Extension + Web-App) sind in einem eigenen Block. Echtes Google-Play-Badge als Inline-SVG.

**Admin-Panel** (`IssueManagement.jsx`, Settings → nur `User.is_admin`, Route `#/admin/issues`): 3 Tabs — **Bug-Reports**, **Warteliste** (`GET /api/waitlist`), **Benutzer** (`GET /api/admin/users`). Benutzer-Verwaltung: sperren/entsperren (`POST /api/admin/users/{id}/block`, neue Spalte `User.is_blocked`, durchgesetzt in `get_current_user`/`login`/`login_google`), löschen (`DELETE /api/admin/users/{id}`, cascade). Eigenes/Admin-Konto geschützt. **AI-Kosten sind GESCHÄTZT** (kein Token-Tracking): `image_count × EST_COST_PER_IMAGE_EUR` (env, Default 0.0025 €).

---

## UI-Designprinzip: Progressive Disclosure

Velosias Oberfläche folgt bewusst **Progressive Disclosure**: Übersichts-/Listenansichten (v. a. `DraftList`) bleiben **minimal** — Thumbnail, Titel, Datum, Preis und höchstens ein **kompakter, farbcodierter** Veröffentlichungs-Status. **Keine** abgeleiteten Zustands-Labels wie „Bereit" oder „Kategorie prüfen" in der Liste — solche Hinweise gehören eine Ebene tiefer in `DraftDetail`. Im Zweifel: Info **nicht** in die Liste, sondern ins Detail. Listen-Status-Indikatoren sollen kompakt und idealerweise wortlos sein (Plattform-Kürzel in der Status-Farbe), die volle Pro-Plattform-Aufschlüsselung lebt in der Status-Sektion von `DraftDetail`.

---

## Angebots-Lebenszyklus & Cross-Posting-Sync (V2.7)

Aufbauend auf dem Status-Tracking (V2.5) gliedert `DraftList` die Angebote jetzt in **drei Abschnitte** und macht den Nach-dem-Einstellen-Zustand handlungsleitend. Logik liegt in `frontend/src/utils/listingStatus.js`:
*   **Gruppierung:** `draftSection(draft)` → `draft` (noch nicht eingestellt) / `active` (online/reserviert auf ≥1 Plattform) / `done` (auf allen Plattformen `TERMINAL` = verkauft/geloescht); `groupDrafts()` erhält die Reihenfolge. Abschnitte: **Entwürfe / Aktiv / Erledigt**.
*   **Kompakter Status (`statusSummary`):** Stimmen beide Plattformen überein → **ein** Wort-Chip (Status + farbiger Punkt) + graue Plattform-Kürzel. Laufen sie auseinander → **pro-Plattform-Split** + amber **„Aktion"**-Marker (`crossPostConflict`: auf einer Plattform verkauft, auf der anderen noch live). Farbe verstärkt nur, das **Wort** trägt die Bedeutung.
*   **Datum als Signal, nicht als Feld:** kein festes `created_at` mehr in der Liste — nur „verkauft am …" (Erledigt) bzw. ein dezenter „seit X Tagen"-Nudge bei aktiven Angeboten älter als `STALE_DAYS` (21, proxy: `created_at`). Entwürfe zeigen nichts.
*   **Header:** der Status-Refresh ist **icon-only** (`.status-refresh-btn.icon-only`), damit „Deine Angebote" auf schmalen Phones nie umbricht.

**Manuelles „Als verkauft markieren" (Kleinanzeigen):** KA exponiert kein öffentliches „verkauft", also kann der Poller einen KA-Verkauf nie erkennen → in `DraftDetail` setzt der Nutzer ihn per Hand. Endpoint `POST /api/listings/{id}/set-status` (`schemas.ListingStatusSet`, Status aus `_MANUAL_STATUSES`) setzt `{platform}_status` + `_status_at`; dient auch dem Festhalten von „geloescht" nach dem Cross-Platform-Löschen. Frontend: `setListingStatus()` in `api.js`.

**Cross-Platform-Verkaufs-Sync-Sheet (`CrossPostSheet` in `DraftList`):** Nach „Status aktualisieren" (`refresh-all`) sucht die Liste den ersten `crossPostConflict` und öffnet ein Bottom-Sheet „auf X verkauft — auf Y noch online → löschen?". Das Löschen ist bewusst **halb-manuell** (siehe Memory `platform-account-writes-semi-manual`): es öffnet die noch aktive Anzeige (`window.VelosiaBridge.deleteOnPlatform(draftId, platform, url, token)` → native `loadUrl`; Desktop-Fallback `window.open`), die **finale Lösch-Bestätigung tippt der Nutzer selbst**. Kein Headless-Delete. Der neue Kotlin-Bridge-Call lebt in `MainActivity.kt` und greift erst ab dem nächsten App-Build (`--play`); das Frontend prüft die Existenz und fällt sonst auf den Tab-Fallback zurück.

---

## Missbrauchs- & Kostenschutz (V2.7.39)

Drei serverseitige Ebenen — die Clients ändern sich dafür **nicht**.

**Rate-Limiting (`backend/rate_limit.py`):** In-Memory Sliding-Window; der API-Prozess ist ein einzelner uvicorn-Worker (Railway-Startbefehl ohne `--workers`, SQLite-Volume schließt Replicas aus), deshalb sind prozesslokale Zähler autoritativ — bei mehreren Workern müsste das nach Redis wandern. Client-IP = **letzter** `X-Forwarded-For`-Eintrag (den hängt der Railway-Edge an; der erste ist fälschbar). Policies an einer Stelle: Login **8 Fehlversuche/15 min je Konto** — das ist die eigentliche Brute-Force-Abwehr, weil sie am angegriffenen Konto hängt und IP-Rotation nichts nützt — plus **40/5 min je IP**, bewusst locker, weil Mobilfunk-CGNAT Tausende Nutzer hinter eine IP setzt und ein enges IP-Limit Unbeteiligte aussperren würde. Es zählen **nur fehlgeschlagene** Logins (sonst sperrt sich ein Vielnutzer selbst aus), ein erfolgreicher Login löscht die Konto-Historie. Dazu Registrierung 5/h, Google-Login 30/5 min, Warteliste 5/h, Bug-Reports 12/h je Nutzer. `RATE_LIMIT_DISABLED=1` für lokale Tests.

**KI-Kontingent (`consume_ai_quota` in `main.py`):** rollierendes 24h-Fenster pro Nutzer, gezählt in **Bildern** (dieselbe Einheit wie die Kostenschätzung im Admin-Panel), additive Spalten `users.ai_images_used` + `ai_quota_reset_at`. Greift in `/api/upload`, `/api/upload/turbo` und `/api/drafts/{id}/regenerate` **vor** dem Gemini-Call; Admins sind ausgenommen. Env `DAILY_IMAGE_QUOTA` (Default 150, 0 = aus). `/api/drafts/{id}/images` ruft keine KI, bekam aber ein Speicherlimit `MAX_IMAGES_PER_DRAFT` (24).

**Signierte Upload-URLs (`backend/signed_urls.py`):** `/uploads` war ein offener `StaticFiles`-Mount — jedes Foto und **jeder Bug-Report-Screenshot** war ohne Auth abrufbar (UUID-Namen sind unerraten, aber nicht geschützt). Jetzt liefert ein eigener Endpunkt die Datei nur gegen HMAC-Signatur (`?e=<Ablauf>&s=<sig>`, Secret = `SECRET_KEY`) oder gültiges Bearer-Token. **Warum Signatur statt Header:** keiner der drei Clients kann bei Bildern einen Header senden — das Frontend rendert `<img src>`, Android lädt per okhttp-GET ohne Auth, die Engine holt sie aus der Plattform-Seite heraus. Deshalb werden die Pfade **in der API-Antwort** signiert (`field_serializer` in `DraftResponse`/`BugReportResponse`) und alle Clients laufen unverändert weiter — **kein App-Release nötig**. Die DB speichert weiter den rohen Pfad; zurückgereichte Pfade normalisiert `strip_signature` (`DELETE /api/drafts/{id}/images`, `PUT /api/drafts/{id}`). Ablaufzeiten sind **auf volle Tage gerundet**, damit dieselbe Datei stets dieselbe URL bekommt — mit sekundengenauem Ablauf würde jeder Draft-Abruf den Bild-Cache entwerten und alle Thumbnails neu über Mobilfunk laden. Notschalter `UPLOADS_PUBLIC=1`, TTL `UPLOAD_URL_TTL_S` (14 Tage). **Folge:** eine Rotation von `SECRET_KEY` entwertet alle ausgelieferten Bild-URLs — heilt beim nächsten Draft-Abruf von selbst.

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

Add **`--play`** to also build the signed AAB and upload it to the Play **internal** test track in the same run (see „Play-Store-Release" above): `./deploy.py 2.6.x "msg" --play`.

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
