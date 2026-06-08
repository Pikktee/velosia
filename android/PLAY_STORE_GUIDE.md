# Vintamie - Google Play Store Publishing Guide (Internal Testing)

Dieses Dokument beschreibt die Schritte zur Vorbereitung, zum Signieren und zur Bereitstellung der Vintamie Android-App im Google Play Store über den internen Test-Kanal.

---

## 1. Sicherheits-Richtlinien (Wichtig!)
Die kryptografische Schlüsseldatei (`vintamie-release.jks`) und Passwörter dürfen **niemals** in das Git-Repository hochgeladen werden. In der `.gitignore` sind bereits Sperren aktiv, um Folgendes zu ignorieren:
* `*.jks` (Keystore-Schlüssel)
* `android/keystore.properties` (Zugangsdaten)
* `*.aab` (Kompilierte App Bundles)
* `*.apk` (Kompilierte Apps)

Sichere deine Passwörter und die Datei `vintamie-release.jks` separat an einem sicheren Ort (z. B. in deinem Passwort-Manager) ab.

---

## 2. Schritt-für-Schritt Anleitung zur Veröffentlichung

### Schritt 1: Google Play Console Account erstellen
1. Registriere dich unter [play.google.com/apps/publish/signup/](https://play.google.com/apps/publish/signup/).
2. Melde dich mit deinem Google-Konto an und fülle die Profildaten aus.
3. Bezahle die einmalige Registrierungsgebühr von **25 $**.
4. Schließe die Identitätsverifizierung ab (Foto des Ausweises hochladen). Die Freischaltung dauert in der Regel 1–2 Tage.

---

### Schritt 2: Neue App in der Console anlegen
Nach der Freischaltung:
1. Klicke in der Play Console oben rechts auf **App erstellen** (Create app).
2. Gib den App-Namen ein: `Vintamie`.
3. Standard-Sprache: `Deutsch`.
4. App-Typ: `App` (nicht Spiel).
5. Kostenlos/Kostenpflichtig: `Kostenlos`.
6. Akzeptiere die Richtlinien und klicke auf **App erstellen**.

---

### Schritt 3: Signiertes App Bundle (.aab) in Android Studio erstellen
Google Play verlangt für neue Apps das modernere **Android App Bundle (.aab)**-Format. 

1. Öffne das `/android`-Projekt in **Android Studio**.
2. Wähle im oberen Menü: **Build** ➔ **Generate Signed Bundle / APK...**
3. Wähle **Android App Bundle** und klicke auf **Next**.
4. Klicke unter *Key store path* auf **Create new...**
   * *Key store path:* Wähle den Speicherort im Ordner `android/` (z.B. Dateiname: `vintamie-release.jks`).
   * *Password:* Wähle ein sicheres Passwort für den Keystore.
   * *Key Alias:* Trage `vintamie` ein.
   * *Password (Key):* Wähle ein Passwort für den Einzelschlüssel (kann dasselbe sein).
   * *Validity (years):* Belasse es bei `25`.
   * *First and Last Name:* Trage deinen Namen ein. (Restliche Felder optional).
   * Klicke auf **OK**.
5. Klicke im Wizard auf **Next**.
6. Wähle als Build-Variante **release** aus.
7. Klicke auf **Create** (oder *Finish*).
8. Du findest die generierte Datei `app-release.aab` im Unterordner `android/app/release/`.

---

### Schritt 4: Internen Test-Kanal einrichten & App hochladen
1. Gehe in der Google Play Console im linken Menü unter **Bereitstellung** (Release) auf **Interner Test** (Internal testing).
2. Klicke auf den Reiter **Tester** (Testers).
3. Erstelle eine neue E-Mail-Liste (z. B. „Vintamie Tester“) und trage die Google-E-Mail-Adressen deiner Tester ein. Speichere die Liste.
4. Klicke oben rechts auf **Neuen Release erstellen** (Create new release).
5. Klicke auf **Hochladen** (Upload) und wähle die `app-release.aab`-Datei aus.
6. Gib einen Release-Namen ein (z. B. `2.2.19`) und klicke auf **Speichern** und danach auf **Release überprüfen**.
7. Klicke auf **Einführung für internen Test starten** (Start rollout to internal testing).

---

### Schritt 5: Test-Link an Tester senden
1. Gehe in der Play Console wieder auf **Interner Test** -> Reiter **Tester**.
2. Scrolle nach unten zu **Link zum Teilnehmen** (How testers join).
3. Kopiere diesen Link und sende ihn an deine Tester.
4. Über diesen Link können die Tester der Testgruppe beitreten und die App direkt aus dem Google Play Store laden. Updates werden fortan vollautomatisch im Hintergrund installiert.
