# Velosia – Google Play Store Publishing Guide (Interner Test)

Dieses Dokument beschreibt die Schritte, um die Velosia Android-App über den
**internen Testkanal** der Google Play Console bereitzustellen. Tester treten per
Link bei, installieren aus dem Play Store und bekommen Updates danach **vollautomatisch**
im Hintergrund – Installieren und Aktualisieren wird für sie so einfach wie bei jeder
normalen App.

> Voraussetzung: Ein freigeschalteter Google-Play-Developer-Account (einmalig 25 $,
> Identitätsverifizierung 1–2 Tage). Ist bereits vorhanden.

---

## 0. Was sich gegenüber der alten Distribution geändert hat

* **Kein Selbst-Updater mehr.** Die App hat früher per `/api/app/version` geprüft und
  selbst eine APK heruntergeladen + installiert (`REQUEST_INSTALL_PACKAGES`). Das ist
  **inkompatibel mit dem Play Store** (Signatur-Mismatch zwischen Play-Build und
  side-geladener APK, doppelte Update-Dialoge, sensible Permission). Ersetzt durch die
  **Google Play In-App-Updates-API** (`com.google.android.play:app-update`): Die App
  fragt Play direkt, ob eine neuere Version live ist, lädt sie im Hintergrund (flexibler
  Flow) und zeigt eine „Neu starten"-Snackbar. Auf Nicht-Play-Installs (Dev/Emulator)
  ist das ein No-Op.
* **Echte Release-Signierung.** Der `release`-Build nutzte den Debug-Key (von Play
  abgelehnt). Jetzt wird über `android/keystore.properties` ein echter Upload-Key
  geladen (siehe Schritt 2).

Die Backend-Endpunkte `/api/app/version`, `/api/app/latest-apk`, `/api/app/upload-apk`
werden vom Play-Build nicht mehr aufgerufen (vestigial – können später entfernt werden).

---

## 1. Sicherheits-Richtlinien (Wichtig!)

Die Schlüsseldatei (`velosia-release.jks`) und Passwörter dürfen **niemals** ins Git.
In der `.gitignore` sind bereits gesperrt: `*.jks`, `*.aab`, `*.apk`,
`android/keystore.properties`. `keystore.properties.example` ist die einzige
einscheckbare Vorlage.

Sichere `velosia-release.jks` + Passwörter separat (Passwort-Manager). **Verlierst du
diesen Key, kannst du die App nie wieder aktualisieren** (Play-Apps müssen mit demselben
Upload-Key signiert bleiben – außer du nutzt Play App Signing, siehe Schritt 6, dann ist
nur der Upload-Key betroffen und über Google rotierbar).

---

## 2. Release-Keystore erzeugen & verdrahten (einmalig)

Das Projekt liest die Signierung aus `android/keystore.properties` (siehe
`app/build.gradle`). Fehlt die Datei, fällt der Release-Build auf den Debug-Key zurück –
ein solcher Build darf **nicht** zu Play hochgeladen werden.

1. Keystore erzeugen (im Ordner `android/`):
   ```bash
   keytool -genkeypair -v -keystore velosia-release.jks \
     -keyalg RSA -keysize 2048 -validity 9125 -alias velosia
   ```
   (Passwörter vergeben, Namen eintragen, Rest optional.)
2. Vorlage kopieren und ausfüllen:
   ```bash
   cd android
   cp keystore.properties.example keystore.properties
   ```
   `keystore.properties`:
   ```properties
   storeFile=../velosia-release.jks
   storePassword=…
   keyAlias=velosia
   keyPassword=…
   ```
   `storeFile` ist relativ zum Modul `android/app/` – liegt die `.jks` in `android/`,
   ist der Pfad `../velosia-release.jks`.

---

## 3. Ziel-API 35 (Play-Pflicht!) – Versionen sind vorgesetzt, Build verifizieren

Google Play verlangt für neue Apps und Updates ein **targetSdk innerhalb eines Jahres
nach dem neuesten Android-Release** – aktuell **API 35 (Android 15)**. Die nötigen
Versionen sind bereits im Projekt gesetzt:

* `compileSdk 35` + `targetSdk 35` in `app/build.gradle`
* AGP **8.6.0** in der Top-Level-`build.gradle`
* Gradle-Wrapper **8.7** in `gradle/wrapper/gradle-wrapper.properties`

**Noch zu tun (in Android Studio, da hier nicht kompilierbar):**
1. Projekt öffnen → **Gradle-Sync** ausführen (lädt AGP 8.6.0 + Gradle 8.7). Erfordert
   **JDK 17** (Android Studio bringt es mit; für `./gradlew` von der Shell muss JAVA_HOME
   auf ein JDK 17 zeigen).
2. **Vollen Release-Build** durchführen und auf Lint-/Behavior-Changes von Android 15
   prüfen.
3. Schlägt der Sync mit einer Versions-Inkompatibilität fehl, den **AGP Upgrade
   Assistant** (*Tools → AGP Upgrade Assistant*) den konsistenten Satz wählen lassen.

---

## 4. App in der Play Console anlegen

1. In der Play Console oben rechts **App erstellen**.
2. App-Name: `Velosia`, Standard-Sprache: `Deutsch`, Typ: `App`, `Kostenlos`.
3. Richtlinien akzeptieren → **App erstellen**.
4. Package-Name beim ersten Upload: `com.velosia.app` (fix, nicht mehr änderbar).

---

## 5. Signiertes App Bundle (.aab) bauen

**Variante A – Kommandozeile** (nutzt automatisch `keystore.properties`):
```bash
cd android
./gradlew bundleRelease
# Ergebnis: app/build/outputs/bundle/release/app-release.aab
```

**Variante B – Android Studio:** *Build → Generate Signed Bundle / APK → Android App
Bundle*. Da die Signierung schon über `keystore.properties` konfiguriert ist, kann der
vorhandene Key gewählt werden.

> `versionCode` muss bei **jedem** Upload streng steigen. `./deploy.py` erhöht
> `versionCode` und `versionName` in `app/build.gradle` automatisch – vor dem Build
> einmal laufen lassen bzw. die Werte prüfen.

---

## 6. Play App Signing + Google-Login (SHA-1!)

Beim ersten Upload aktiviert Play standardmäßig **Play App Signing**: Du lädst mit
deinem Upload-Key hoch, Google re-signiert die App mit seinem eigenen App-Signing-Key.

**Wichtig für den nativen Google-Login** (`play-services-auth` ist eingebunden): Der
OAuth-Client in der Google Cloud Console prüft den **SHA-1 des tatsächlichen
Signaturzertifikats**. Bei Play App Signing ist das **Googles** Zertifikat, nicht dein
Upload-Key. Sonst bricht der Google-Login für Play-installierte Builds.

➡️ Nach dem ersten Upload in **Play Console → Release → Setup → App-Signatur** den
**SHA-1 des App-Signing-Keys** kopieren und im **OAuth-2.0-Client (Android)** in der
Google Cloud Console hinterlegen (zusätzlich zum SHA-1 des Upload-Keys für lokale
Builds).

---

## 7. Store-Pflichtangaben (Code-frei, aber Voraussetzung)

* **Datenschutzerklärung-URL** (öffentlich) – die bestehende Datenschutz-Seite der
  Landing Page lässt sich verlinken.
* **Data-Safety-Formular** ausfüllen (welche Daten erhoben/geteilt werden: Fotos, Konto-
  E-Mail, ggf. Standort-PLZ). Pflicht.
* **Content-Rating-Fragebogen**, Zielgruppe, App-Kategorie, kurze Store-Beschreibung,
  App-Icon + mind. 2 Screenshots.
* Da die App fremde Listings (Vinted/Kleinanzeigen) in einer WebView befüllt: prüfen,
  dass die Store-Beschreibung den tatsächlichen Funktionsumfang ehrlich abbildet.

---

## 8. Internen Testkanal einrichten & hochladen

1. Play Console → **Test → Interner Test**.
2. Reiter **Tester**: E-Mail-Liste anlegen (Google-Konten der Tester) und speichern.
3. **Neuen Release erstellen** → `app-release.aab` hochladen.
4. Release-Namen (z. B. `2.5.6`) + Versionshinweise eingeben → **Speichern** →
   **Release überprüfen** → **Einführung für internen Test starten**.

---

## 9. Test-Link verteilen

1. Interner Test → Reiter **Tester** → **Link zum Teilnehmen** kopieren.
2. Link an die Tester senden. Sie treten der Gruppe bei und laden die App direkt aus dem
   Play Store. Updates installieren sich danach **automatisch im Hintergrund**; zusätzlich
   weist die In-App-Updates-API auf eine neue Version hin und bietet „Neu starten" an.

---

## Checkliste vor dem ersten Upload

- [ ] `velosia-release.jks` erzeugt, `android/keystore.properties` ausgefüllt
- [ ] `targetSdk 35` + AGP 8.6+/Gradle 8.7+ (Schritt 3), Build grün
- [ ] `./gradlew bundleRelease` erzeugt ein **release-signiertes** Bundle (nicht Debug)
- [ ] App in der Console angelegt, Data Safety + Datenschutz-URL + Rating gesetzt
- [ ] Nach Upload: App-Signing-SHA-1 im Google-OAuth-Client hinterlegt (Google-Login!)
- [ ] Tester-Liste + Beitrittslink verteilt
