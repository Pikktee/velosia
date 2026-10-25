import React from 'react';

// Single source of truth for the legal texts, shared by the overlay (LegalModal:
// landing page, login, settings) and the standalone #/datenschutz, #/impressum,
// #/nutzungsbedingungen and #/konto-loeschen routes (the latter give Google Play
// stable, linkable URLs).
//
// ENTWURF: Jede Aussage über Datenverarbeitung ist am Code belegt. Was sich dort
// nicht belegen lässt, steht als sichtbares <Todo> im Text und muss vor dem
// Livegang geklärt und entfernt werden.

const h3 = { fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' };
const h4 = { fontSize: '0.92rem', color: 'var(--text-primary)', margin: '1.25rem 0 0.4rem', fontFamily: 'var(--font-title)' };
const p = { marginBottom: '1rem' };
const section = { marginBottom: '2rem' };
const ul = { margin: '0 0 1rem 0', padding: '0 0 0 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' };
const ol = { margin: '0 0 1.5rem 0', padding: '0 0 0 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' };
const code = { fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--primary)' };

export const LEGAL_TITLES = {
  datenschutz: 'Datenschutzerklärung',
  impressum: 'Impressum',
  nutzungsbedingungen: 'Nutzungsbedingungen',
  'konto-loeschen': 'Konto und Daten löschen',
};

export const LEGAL_STAND = 'Entwurf, Stand: 21. Oktober 2026';

// Visible review marker for anything the code does not prove. Must be resolved
// and removed before the texts go live.
function Todo({ children }) {
  return (
    <span role="note" style={{
      display: 'block',
      margin: '0.5rem 0 1rem',
      padding: '0.55rem 0.75rem',
      border: '1px dashed rgba(245, 158, 11, 0.7)',
      borderRadius: '8px',
      background: 'rgba(245, 158, 11, 0.08)',
      color: '#fbbf24',
      fontSize: '0.8rem',
      lineHeight: 1.45,
    }}>
      <strong>TODO (Henrik):</strong> {children}
    </span>
  );
}

// The four Art. 13 facts every processing step needs, in one consistent block.
function Steckbrief({ zweck, grundlage, dauer, empfaenger }) {
  const rows = [
    ['Zweck', zweck],
    ['Rechtsgrundlage', grundlage],
    ['Speicherdauer', dauer],
    ['Empfänger', empfaenger],
  ];
  return (
    <div style={{
      margin: '0 0 1rem',
      padding: '0.75rem 0.9rem',
      borderLeft: '2px solid var(--primary)',
      background: 'rgba(255, 255, 255, 0.025)',
      borderRadius: '0 8px 8px 0',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.35rem',
    }}>
      {rows.map(([label, value]) => (
        <div key={label}><strong>{label}:</strong> {value}</div>
      ))}
    </div>
  );
}

export function KontoLoeschenContent() {
  return (
    <div>
      <p style={{ marginBottom: '1.5rem' }}>
        Diese Seite erklärt, wie du dein <strong>Velosia</strong>-Konto und alle zugehörigen
        Daten löschen kannst. Velosia (Anbieter: Henrik Heil) automatisiert das Erstellen von
        Second-Hand-Anzeigen für Vinted und Kleinanzeigen.
      </p>

      <h3 style={h3}>Variante 1: Direkt in der App (sofort)</h3>
      <ol style={ol}>
        <li>In der Velosia-App anmelden.</li>
        <li>In der Navigationsleiste unten auf <strong>„Profil“</strong> tippen.</li>
        <li>Ganz unten im <strong>Gefahrenbereich</strong> auf <strong>„Account löschen“</strong> tippen.</li>
        <li>Mit <strong>„Ja, löschen“</strong> bestätigen.</li>
      </ol>
      <p style={{ marginBottom: '1.5rem' }}>
        Dein Konto und alle Daten werden dabei <strong>sofort und unwiderruflich</strong> gelöscht.
        Möchtest du vorher eine Kopie, lade sie unter Profil → <strong>„Deine Daten“</strong> →{' '}
        <strong>„Meine Daten exportieren“</strong> herunter.
      </p>

      <h3 style={h3}>Variante 2: Per E-Mail</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Falls du keinen Zugriff mehr auf die App hast, schreib uns an{' '}
        <strong>mail@henrikheil.net</strong> von der betroffenen E-Mail-Adresse aus. Wir löschen
        dein Konto und alle Daten dann innerhalb von <strong>30 Tagen</strong>.
      </p>

      <h3 style={h3}>Welche Daten werden gelöscht?</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Vollständig und endgültig gelöscht werden: deine <strong>E-Mail-Adresse</strong>, dein
        Passwort bzw. die <strong>Google-Verknüpfung</strong>, deine Einstellungen, alle erstellten{' '}
        <strong>Anzeigen/Entwürfe</strong> samt erfasster Inserats-Links, alle von dir{' '}
        <strong>hochgeladenen Fotos</strong>, deine <strong>Fehlerberichte</strong> samt Screenshots
        sowie ein Eintrag mit derselben E-Mail-Adresse auf der <strong>Tester-Warteliste</strong>.
      </p>

      <h3 style={h3}>Werden Daten aufbewahrt?</h3>
      <p>
        Nach der Löschung bewahren wir <strong>keine</strong> personenbezogenen Konto- oder
        Anzeigendaten auf. Velosia ist kostenlos – es fallen keine Zahlungs- oder Rechnungsdaten an.
        Erhalten bleiben lediglich <strong>technische Auswertungen</strong> der automatischen
        Formularausfüllung (welche Formularfelder gefunden wurden, ohne Anzeigeninhalte), aus denen
        wir bei der Löschung deine Nutzer-ID entfernen – sie haben danach keinen Bezug mehr zu
        deinem Konto und werden 90 Tage nach ihrer Entstehung automatisch gelöscht.
      </p>
      <Todo>
        Außerhalb der Datenbank bleiben bisher: ein Eintrag in der Testerliste der Google Play
        Console und die Benachrichtigungs-Mail zur Warteliste in deinem Postfach. Festlegen, ob du
        beides bei einer Kontolöschung entfernst, und den Satz hier entsprechend ergänzen.
      </Todo>
    </div>
  );
}

export function ImpressumContent() {
  return (
    <div>
      <h3 style={h3}>Angaben gemäß § 5 DDG</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Henrik Heil<br />
        Westendstraße 100<br />
        60325 Frankfurt<br />
        E-Mail: mail@henrikheil.net
      </p>
      <Todo>
        § 5 Abs. 1 Nr. 2 DDG verlangt neben der E-Mail-Adresse einen weiteren Weg zur schnellen,
        unmittelbaren Kontaktaufnahme (z. B. Telefon oder Kontaktformular). Prüfen, ob die
        E-Mail-Adresse allein genügt.
      </Todo>

      <h3 style={h3}>Haftung für Inhalte</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen
        Gesetzen verantwortlich. Für fremde Informationen, die wir lediglich übermitteln oder
        speichern, gelten die Haftungsbeschränkungen der Art. 4 bis 6 der Verordnung (EU) 2022/2065
        (Gesetz über digitale Dienste, DSA). Eine allgemeine Verpflichtung, diese Informationen zu
        überwachen oder aktiv nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit
        hinweisen, besteht nach Art. 8 DSA nicht. Verpflichtungen zur Entfernung oder Sperrung der
        Nutzung von Informationen nach den allgemeinen Gesetzen bleiben unberührt. Sobald wir von
        einer konkreten Rechtsverletzung erfahren, entfernen wir die betroffenen Inhalte umgehend.
      </p>

      <h3 style={h3}>Haftung für Links</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
      </p>

      <h3 style={h3}>Urheberrecht</h3>
      <p>
        Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
      </p>
    </div>
  );
}

export function DatenschutzContent() {
  return (
    <div>
      <p style={p}>
        Diese Datenschutzerklärung gilt für <strong>Velosia</strong>: die Web-App unter
        velosia.henrikheil.net, die Android-App und die Browser-Erweiterung. Sie erklärt, welche
        personenbezogenen Daten wir wofür verarbeiten, auf welcher Rechtsgrundlage, wie lange wir
        sie speichern und wer sie erhält.
      </p>
      <p style={{ marginBottom: '0.5rem' }}><strong>Kurz gesagt:</strong></p>
      <ul style={{ ...ul, marginBottom: '2rem' }}>
        <li>Kein Tracking, keine Werbung, keine Analyse-Dienste.</li>
        <li>Fotos speichern wir ohne Kamera- und Standortdaten (EXIF/GPS).</li>
        <li>
          Die Texte und Preisvorschläge erzeugt eine KI von Google (Gemini). Dafür gehen deine Fotos
          und einige deiner Texte an Google – was genau, steht in Abschnitt 5.
        </li>
        <li>Dein Konto samt allen Daten kannst du jederzeit selbst sofort löschen.</li>
      </ul>

      <section style={section}>
        <h3 style={h3}>1. Verantwortlicher</h3>
        <p style={p}>
          Henrik Heil<br />
          Westendstraße 100<br />
          60325 Frankfurt<br />
          E-Mail: mail@henrikheil.net
        </p>
        <p style={p}>
          Für Fragen zum Datenschutz und um deine Rechte auszuüben (Abschnitt 16), genügt eine
          E-Mail an diese Adresse.
        </p>
      </section>

      <section style={section}>
        <h3 style={h3}>2. Hosting und Server-Protokolle</h3>
        <p style={p}>
          Web-App und Server von Velosia laufen bei der <strong>Railway Corporation</strong> (USA),
          in deren Rechenzentrumsregion <strong>europe-west4 in der EU</strong>. Dort liegen auch die
          Datenbank und die hochgeladenen Fotos. Bei jedem Aufruf verarbeiten die Server technisch
          zwangsläufig deine IP-Adresse, den Zeitpunkt, die aufgerufene Adresse und die Kennung
          deines Browsers bzw. der App. Unser Server schreibt Betriebs- und Fehlermeldungen in das
          Protokoll bei Railway. Diese Meldungen können im Einzelfall Inhalte einer Anfrage enthalten,
          etwa den Suchbegriff, den die KI aus deinen Fotos ermittelt hat (Abschnitt 6).
        </p>
        <Steckbrief
          zweck="Velosia bereitstellen, Sicherheit des Betriebs, Fehlersuche."
          grundlage="Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren und stabilen Betrieb); soweit es um die Nutzung deines Kontos geht, Art. 6 Abs. 1 lit. b DSGVO."
          dauer="Datenbank und Fotos: siehe die folgenden Abschnitte. Protokolle: siehe Hinweis unten."
          empfaenger="Railway Corporation als Auftragsverarbeiter. Zur Übermittlung in die USA siehe Abschnitt 14."
        />
        <Todo>
          Klären und eintragen: (1) Welche Zugriffsdaten protokolliert Railway (HTTP-Logs mit
          IP-Adresse?) und wie lange werden Protokolle aufbewahrt (abhängig vom Railway-Tarif)?
          (2) Ist ein Auftragsverarbeitungsvertrag (DPA) mit Railway abgeschlossen?
        </Todo>
      </section>

      <section style={section}>
        <h3 style={h3}>3. Nutzerkonto und Anmeldung</h3>
        <p style={p}>
          <strong>Registrierung mit E-Mail-Adresse:</strong> Wir speichern deine E-Mail-Adresse und
          dein Passwort – das Passwort nur als bcrypt-Hash, nie im Klartext. Nach der Anmeldung
          erhält dein Gerät einen Anmelde-Schlüssel, der 24 Stunden gilt (Abschnitt 11).
        </p>
        <p style={p}>
          <strong>Konto-Daten:</strong> Zu deinem Konto speichern wir außerdem deine Einstellungen
          (Postleitzahl, Standard-Versandart, Preis-Anpassung, „Automatisch veröffentlichen“,
          Stil-Anweisung für den Beschreibungstext, feste Einleitung und fester Abschluss), den
          Zeitpunkt der Registrierung sowie Nutzungszähler: wie viele Bilder in den letzten
          24 Stunden analysiert wurden (Tageskontingent, Abschnitt 10) und wie viele KI-Anfragen und
          Token insgesamt angefallen sind (für unsere Kostenübersicht). Bei Missbrauch können wir ein
          Konto sperren; auch das wird am Konto vermerkt.
        </p>
        <p style={p}>
          <strong>Anmeldung über Google:</strong> Im Browser zeigen wir den Button „Über Google
          anmelden“ zunächst als eigene Schaltfläche. Erst wenn du ihn antippst, lädt dein Browser
          das Anmeldeskript von Google (accounts.google.com); ab dann erhält Google unter anderem
          deine IP-Adresse und die Information, dass du dich bei Velosia anmelden möchtest. In der
          Android-App läuft die Anmeldung über die Google-Play-Dienste deines Geräts (Abschnitt 12).
          Google übermittelt uns ein signiertes Anmelde-Token. Unser Server prüft es und speichert
          daraus nur deine Google-Kennung („sub“) und deine von Google bestätigte E-Mail-Adresse –
          nicht deinen Namen und nicht dein Profilbild. Gibt es bereits ein Velosia-Konto mit dieser
          E-Mail-Adresse, wird es mit deinem Google-Konto verknüpft; ein bisheriges Passwort wird
          dabei ersetzt und alle bisherigen Anmeldungen werden beendet.
        </p>
        <Steckbrief
          zweck="Konto anlegen, Anmeldung, deine Angebote und Einstellungen deinem Konto zuordnen, Tageskontingent."
          grundlage="Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag). Kostenübersicht und Sperrvermerk: Art. 6 Abs. 1 lit. f DSGVO (Kostenkontrolle, Schutz vor Missbrauch)."
          dauer="Bis du dein Konto löschst. Das geht jederzeit selbst unter Profil → Gefahrenbereich → „Account löschen“ und wirkt sofort."
          empfaenger="Railway (Hosting). Bei der Anmeldung über Google: Google."
        />
        <p style={p}>
          Ohne Konto lässt sich Velosia nicht nutzen; die E-Mail-Adresse und ein Passwort (oder die
          Google-Anmeldung) sind dafür erforderlich.
        </p>
      </section>

      <section style={section}>
        <h3 style={h3}>4. Fotos und Angebote</h3>
        <p style={p}>
          Fotos, die du hochlädst, speichert unser Server neu ab: Er dreht sie richtig herum,
          verkleinert sie auf höchstens 2560 Pixel Kantenlänge und speichert sie als JPEG unter
          einem zufälligen Dateinamen. Dabei fallen alle eingebetteten Metadaten weg – insbesondere
          Kamera- und Standortdaten (EXIF/GPS). Zu jedem Angebot speichern wir außerdem Titel,
          Beschreibung, die Kategorien für Kleinanzeigen und Vinted, Zustand, Preis, weitere
          Merkmale (z. B. Marke, Größe, Farbe), die Vergleichsangebote aus dem Preisvergleich
          (Abschnitt 6) und nach dem Veröffentlichen Link und Status deiner Inserate (Abschnitt 7).
        </p>
        <p style={p}>
          Fotos sind nur über signierte Links abrufbar, die nach rund 14 Tagen ablaufen. Bis dahin
          kann jeder, der einen solchen Link kennt, das Bild ohne Anmeldung öffnen – nur so können
          App, Browser und die Formulare von Vinted und Kleinanzeigen die Bilder laden. Wir geben
          diese Links nur an dich heraus.
        </p>
        <p style={p}>
          Achte darauf, dass auf deinen Fotos keine anderen Personen und keine persönlichen
          Unterlagen zu sehen sind (siehe Nutzungsbedingungen).
        </p>
        <Steckbrief
          zweck="Angebote erstellen, speichern und auf die Plattformen übertragen."
          grundlage="Art. 6 Abs. 1 lit. b DSGVO."
          dauer="Bis du das Foto, das Angebot oder dein Konto löschst."
          empfaenger="Railway (Hosting); Google für die KI-Analyse (Abschnitt 5); Vinted bzw. Kleinanzeigen, wenn du dort inserierst (Abschnitt 7)."
        />
      </section>

      <section style={section}>
        <h3 style={h3}>5. KI-Analyse mit Google Gemini</h3>
        <p style={p}>
          Titel, Beschreibung, Kategorien, Zustand, Merkmale und den Preisvorschlag erzeugt Velosia
          mit einer künstlichen Intelligenz: dem Sprachmodell <strong>Gemini von Google</strong>, das
          wir über die Gemini API nutzen. Dafür sendet unser Server an Google:
        </p>
        <ul style={ul}>
          <li>deine Fotos (für die Analyse auf höchstens 1024 Pixel verkleinert, ohne Metadaten),</li>
          <li>
            die Zusatzangaben, die du beim Erfassen zum Artikel eingibst (Freitext „Details“), und
            einen von dir gewählten Zustand,
          </li>
          <li>
            aus deinen Einstellungen die Stil-Anweisung für den Beschreibungstext sowie deine feste
            Einleitung und deinen festen Abschluss,
          </li>
          <li>
            Titel und Preise fremder Vergleichsanzeigen aus dem Preisvergleich (Abschnitt 6) –
            Telefonnummern, E-Mail-Adressen und Links entfernen wir vorher,
          </li>
          <li>für die Wahl der Vinted-Kategorie den ermittelten Suchbegriff sowie Titel und Beschreibung des Entwurfs,</li>
          <li>im Turbo-Modus die Fotos mehrerer Artikel, damit die KI sie den einzelnen Angeboten zuordnet,</li>
          <li>beim Neu-Erzeugen von Titel oder Beschreibung erneut die Fotos und deine Stil-Angaben.</li>
        </ul>
        <p style={p}>
          Deine E-Mail-Adresse, deine Konto-Kennung oder deine Anmeldedaten senden wir nicht an
          Google. Details, Einleitung und Abschluss gehen dagegen wörtlich in die Anfrage ein –
          schreib dort nichts hinein, was Google nicht erhalten soll.
        </p>
        <p style={p}>
          Die Ergebnisse sind Vorschläge, die du vor dem Veröffentlichen prüfst und änderst. Eine
          automatisierte Entscheidung, die dir gegenüber rechtliche Wirkung entfaltet oder dich
          ähnlich erheblich beeinträchtigt (Art. 22 DSGVO), findet nicht statt.
        </p>
        <Steckbrief
          zweck="Angebotstexte, Kategorien und Preisvorschlag aus deinen Fotos erzeugen."
          grundlage="Art. 6 Abs. 1 lit. b DSGVO."
          dauer="Bei uns: das Ergebnis im Angebot, bis du es löschst. Bei Google: siehe Hinweis unten."
          empfaenger="Google (Gemini API). Übermittlung in die USA: Abschnitt 14."
        />
        <Todo>
          Klären und eintragen: (1) Vertragspartner für die Gemini API (Google LLC oder Google
          Ireland Ltd.) und ob die Datenverarbeitungsbedingungen von Google als
          Auftragsverarbeitung gelten. (2) Läuft Velosia über einen kostenpflichtigen
          (Paid-)Zugang? Nur dann sind Nutzung zum Training und Prüfung durch Menschen
          ausgeschlossen. (3) Wie lange speichert Google Anfragen zur Missbrauchserkennung?
        </Todo>
      </section>

      <section style={section}>
        <h3 style={h3}>6. Preisvergleich auf Kleinanzeigen</h3>
        <p style={p}>
          Aus deinen Fotos und gegebenenfalls deinen Zusatzangaben bildet die KI einen kurzen
          Suchbegriff (z. B. „Apple Mac mini“). Mit diesem Begriff ruft unser Server die öffentliche
          Suchseite von Kleinanzeigen ab – ohne Anmeldung und von unserem Server aus. Kleinanzeigen
          erfährt dabei weder deine IP-Adresse noch deine Kontodaten. Bis zu 15 passende Angebote
          (Titel, Preis, Link) speichern wir in deinem Entwurf, zeigen sie dir an und geben Titel und
          Preis an die KI weiter (Abschnitt 5). Diese Angaben stammen aus öffentlichen Anzeigen
          anderer Personen.
        </p>
        <Steckbrief
          zweck="Einen realistischen Preis vorschlagen."
          grundlage="Art. 6 Abs. 1 lit. b DSGVO; für die Angaben aus fremden öffentlichen Anzeigen Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer Marktpreis-Einschätzung)."
          dauer="Zusammen mit dem Angebot, bis du es oder dein Konto löschst."
          empfaenger="Kleinanzeigen erhält nur den Suchbegriff."
        />
      </section>

      <section style={section}>
        <h3 style={h3}>7. Inserieren auf Vinted und Kleinanzeigen</h3>
        <h4 style={h4}>Ausfüllen der Formulare</h4>
        <p style={p}>
          In der Android-App öffnet Velosia die Seiten von Vinted und Kleinanzeigen in einem
          eingebetteten Browser; am Computer übernimmt das die Browser-Erweiterung. Bei der
          Plattform meldest du dich dort selbst an; Velosia liest deine Zugangsdaten zu Vinted oder
          Kleinanzeigen nicht aus und speichert sie nicht. Ein Skript von Velosia (die
          „Autofill-Engine“) trägt dann Titel, Beschreibung, Preis, Kategorie, Merkmale,
          Postleitzahl und Fotos deines Angebots in das Formular der Plattform ein. Ab dem Eintragen
          verarbeitet die Plattform diese Daten in eigener Verantwortung; es gelten ihre
          Datenschutzhinweise. Veröffentlicht wird erst, wenn du selbst auf den
          Veröffentlichen-Button der Plattform tippst – außer du hast „Automatisch veröffentlichen“
          eingeschaltet.
        </p>
        <h4 style={h4}>Erfassen deiner Inserate</h4>
        <p style={p}>
          Hast du ein Angebot aus Velosia heraus veröffentlicht, erkennt Velosia an der Adresse der
          folgenden Seite bzw. an der Antwort der Plattform die Nummer deines Inserats und meldet
          Plattform, Inseratsnummer und Inserats-Link an unseren Server. Das geschieht nur im
          Anschluss an ein Veröffentlichen aus Velosia; Anzeigen, die du beim Stöbern öffnest, werden
          nicht erfasst.
        </p>
        <h4 style={h4}>Status deiner Inserate</h4>
        <p style={p}>
          Damit du siehst, ob ein Inserat noch online, reserviert, verkauft oder gelöscht ist, ruft
          unser Server die öffentliche Seite deines Inserats ab – automatisch etwa alle 6 Stunden und
          wenn du „Status aktualisieren“ tippst. Der Abruf erfolgt ohne Anmeldung von unserem Server
          aus; verkaufte oder gelöschte Inserate fragen wir nicht mehr ab. Bei Kleinanzeigen kannst
          du „verkauft“ selbst setzen, weil die Plattform das nicht öffentlich anzeigt.
        </p>
        <Steckbrief
          zweck="Angebote auf den Plattformen einstellen und ihren Status anzeigen."
          grundlage="Art. 6 Abs. 1 lit. b DSGVO."
          dauer="Inserats-Link und Status zusammen mit dem Angebot, bis du es oder dein Konto löschst."
          empfaenger="Vinted bzw. Kleinanzeigen (die Angebotsdaten, die du dort einstellst; beim Status-Abruf nur die Anfrage nach der Seite deines Inserats)."
        />
        <h4 style={h4}>Funktions-Telemetrie</h4>
        <p style={p}>
          Nach jedem Ausfüllen meldet die Autofill-Engine an unseren Server, wie es technisch
          gelaufen ist: Plattform, Schritt (Formular oder Kategorie), Version der Engine, für Titel,
          Beschreibung, Preis, Kategorie, Zustand, Größe, Farbe, Material und Marke jeweils nur
          „gefunden bzw. gesetzt: ja oder nein“ sowie die Anzahl der Fotos und Merkmale. Inhalte
          deines Angebots sind nicht enthalten. Wir speichern die Meldung zusammen mit deiner
          Nutzer-ID – sie ist also <strong>pseudonym, nicht anonym</strong>. Daran erkennen wir
          automatisch, wenn Vinted oder Kleinanzeigen ihr Formular geändert haben, und erhalten dann
          eine Warn-E-Mail. Diese enthält nur Plattform, Feldname, Fehlerquote und Engine-Versionen.
          Jede ausgelöste Warnung vermerken wir intern ohne personenbezogene Daten und löschen diesen
          Vermerk nach 90 Tagen.
        </p>
        <Steckbrief
          zweck="Die automatische Formularausfüllung funktionsfähig halten."
          grundlage="Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse, Formularänderungen der Plattformen schnell zu erkennen). Du kannst widersprechen (Abschnitt 16)."
          dauer="90 Tage, danach werden die Meldungen automatisch gelöscht. Löschst du dein Konto, entfernen wir sofort die Nutzer-ID aus deinen Meldungen."
          empfaenger="Railway (Hosting); der E-Mail-Dienst für die Warn-Mails (Abschnitt 13)."
        />
      </section>

      <section style={section}>
        <h3 style={h3}>8. Fehlerberichte</h3>
        <p style={p}>
          Über „Problem melden“ kannst du uns einen Fehlerbericht schicken. Er enthält deine
          Beschreibung, deren Anfang als Titel und Geräteinfos: Browser- bzw. App-Kennung
          (User-Agent), Fenstergröße und Pixeldichte, Plattform und Sprache des Geräts, die gerade
          geöffnete Ansicht der App und den Zeitpunkt. Ein Bildschirmfoto der Seite hinter dem
          Dialog senden wir nur mit, wenn du das Häkchen dafür aktiv setzt. Es kann alles enthalten,
          was in diesem Moment auf dem Bildschirm zu sehen ist. Der Bericht wird deinem Konto
          zugeordnet, damit wir nachfragen können.
        </p>
        <Steckbrief
          zweck="Fehler nachvollziehen und beheben, Rückfragen."
          grundlage="Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer funktionierenden App); du entscheidest selbst, ob du einen Bericht und ein Bildschirmfoto sendest."
          dauer="12 Monate, danach werden Bericht und Bildschirmfoto automatisch gelöscht; früher, wenn wir den Bericht nach der Bearbeitung löschen. Löschst du dein Konto, werden deine Berichte sofort gelöscht."
          empfaenger="Railway (Hosting)."
        />
      </section>

      <section style={section}>
        <h3 style={h3}>9. Tester-Warteliste</h3>
        <p style={p}>
          Auf der Startseite kannst du dich mit deiner E-Mail-Adresse für den Test der Android-App
          vormerken lassen. Wir speichern die Adresse, den Zeitpunkt und als Herkunft „Startseite“
          und erhalten eine Benachrichtigung per E-Mail. Um dich einzuladen, tragen wir deine Adresse
          von Hand in die Testerliste der <strong>Google Play Console</strong> ein – nur so bietet
          Google Play dir die Testversion an. Die Adresse muss deshalb die deines Google-Kontos sein.
        </p>
        <Steckbrief
          zweck="Dich zum Test der Android-App einladen."
          grundlage="Art. 6 Abs. 1 lit. b DSGVO (Maßnahmen auf deine Anfrage hin)."
          dauer="12 Monate nach der Eintragung, danach wird der Eintrag automatisch gelöscht. Auf Wunsch löschen wir ihn sofort; löschst du ein Velosia-Konto mit derselben Adresse, entfällt er ebenfalls sofort. In der Testerliste der Play Console bleibt die Adresse, bis wir sie dort von Hand entfernen."
          empfaenger="Railway (Hosting); der E-Mail-Dienst für die Benachrichtigung (Abschnitt 13); Google (Play Console)."
        />
        <Todo>
          Festlegen, wann Adressen aus der Testerliste der Play Console entfernt werden (z. B. nach
          Ende des Tests oder spätestens nach 12 Monaten), und hier eintragen. Das geschieht nicht
          automatisch.
        </Todo>
      </section>

      <section style={section}>
        <h3 style={h3}>10. Schutz vor Missbrauch</h3>
        <p style={p}>
          Um Angriffe – etwa das Durchprobieren von Passwörtern – und übermäßige Nutzung zu begrenzen,
          zählt unser Server Anfragen je IP-Adresse, bei fehlgeschlagenen Anmeldungen zusätzlich je
          eingegebener E-Mail-Adresse, und je Konto. Diese Zähler liegen nur im Arbeitsspeicher,
          nicht in der Datenbank. Sie werden nach Ablauf ihres Zeitfensters von höchstens einer
          Stunde beim nächsten Aufräumen verworfen und bei jedem Neustart des Servers gelöscht.
          Außerdem ist die KI-Analyse je Konto auf eine bestimmte Zahl von Bildern pro 24 Stunden
          begrenzt; den Zähler dafür speichern wir an deinem Konto.
        </p>
        <Steckbrief
          zweck="Schutz vor Angriffen, Missbrauch und unkontrollierten Kosten."
          grundlage="Art. 6 Abs. 1 lit. f DSGVO."
          dauer="Zähler im Arbeitsspeicher: höchstens eine Stunde nach der letzten Anfrage, bis zum nächsten Aufräumen. Kontingent-Zähler: mit dem Konto."
          empfaenger="Keine."
        />
      </section>

      <section style={section}>
        <h3 style={h3}>11. Speicherung auf deinem Gerät</h3>
        <p style={p}>
          Velosia selbst setzt keine Cookies und bindet keine Analyse- oder Werbedienste ein. Die
          Schriften sind in Velosia eingebettet; bis du den Google-Button antippst, lädt die Web-App
          keine Inhalte von fremden Servern. Im lokalen Speicher deines Browsers bzw. der App
          (localStorage) legen wir nur ab, was für die Funktion nötig ist:
        </p>
        <ul style={ul}>
          <li><span style={code}>velosia_token</span> – dein Anmelde-Schlüssel (24 Stunden gültig); wird beim Abmelden gelöscht,</li>
          <li>
            <span style={code}>velosia_user_email</span> – deine E-Mail-Adresse, damit die
            Browser-Erweiterung anzeigen kann, wer angemeldet ist (in der Android-App steht dort nur
            „Google-Nutzer“); wird beim Abmelden gelöscht,
          </li>
          <li>
            <span style={code}>velosia_return_draft</span> – nur Android: welches Angebot nach dem
            Inserieren wieder geöffnet wird; wird beim nächsten Öffnen der App gelöscht,
          </li>
          <li>
            <span style={code}>velosia_turbo_onboarded</span> und{' '}
            <span style={code}>velosia_detail_onboarding_shown</span> – ob ein Hinweis schon
            angezeigt wurde,
          </li>
          <li>
            <span style={code}>velosia_seen_version</span> und{' '}
            <span style={code}>velosia_seen_app_version</span> – welche Version du zuletzt
            gesehen hast, damit „Neu in Velosia“ nach einem Update nur einmal erscheint.
          </li>
        </ul>
        <Steckbrief
          zweck="Angemeldet bleiben und die App bedienen."
          grundlage="§ 25 Abs. 2 Nr. 2 TDDDG (unbedingt erforderlich für den von dir gewünschten Dienst); für die weitere Verarbeitung Art. 6 Abs. 1 lit. b DSGVO."
          dauer="Wie oben angegeben; du kannst die Daten jederzeit über die Browser- bzw. App-Einstellungen löschen."
          empfaenger="Keine – die Daten bleiben auf deinem Gerät."
        />
      </section>

      <section style={section}>
        <h3 style={h3}>12. Android-App und Browser-Erweiterung</h3>
        <h4 style={h4}>Android-App</h4>
        <ul style={ul}>
          <li>
            <strong>Berechtigungen:</strong> nur Internet und Kamera. Die Kamera nutzt die App, damit
            du Artikel direkt fotografieren kannst; sie fragt beim Start danach. Fotos aus der Galerie
            wählst du über die Dateiauswahl von Android aus, die Velosia nur die ausgewählten Bilder
            freigibt – eine Berechtigung für deine Fotos oder Dateien hat die App nicht.
          </li>
          <li>
            <strong>Eingebetteter Browser:</strong> Deine Anmeldung bei Vinted und Kleinanzeigen
            (deren Cookies) bleibt in der App gespeichert, bis du dich dort abmeldest oder die
            App-Daten löschst. Velosia liest diese Cookies nicht. Andere Seiten öffnen sich in deinem
            Standard-Browser; nur Anmelde-, Sicherheitsabfrage- (Captcha) und Zahlungsseiten, die
            Vinted oder Kleinanzeigen einbinden, bleiben in der App. Die App-Daten sind von
            Android-Sicherungen und von der Übertragung auf ein neues Gerät ausgeschlossen.
          </li>
          <li>
            <strong>Google-Anmeldung:</strong> läuft über die Google-Play-Dienste deines Geräts.
            Google zeigt dir die Kontoauswahl; wir erhalten nur das Anmelde-Token (Abschnitt 3).
          </li>
          <li>
            <strong>Updates:</strong> Beim Start und beim Zurückkehren in die App fragt sie über die
            Update-Schnittstelle von Google Play, ob eine neue Version bereitsteht. Herunterladen und
            Installieren übernimmt Google Play. Damit die App nicht bei jedem Start erneut fragt, merkt
            sie sich auf dem Gerät, zu welcher Version und wann sie zuletzt gefragt hat.
          </li>
          <li>
            <strong>Autofill-Engine:</strong> Die App lädt die aktuelle Version der Engine von
            unserem Server und nutzt sie nur, wenn ihre digitale Signatur gültig ist.
          </li>
          <li>
            Die App enthält keine Analyse-, Absturzmelde- oder Werbe-Bibliotheken. Für Installation
            und Updates über Google Play gelten zusätzlich die Datenschutzbestimmungen von Google.
          </li>
        </ul>
        <h4 style={h4}>Browser-Erweiterung</h4>
        <ul style={ul}>
          <li>
            <strong>Berechtigungen:</strong> Speicher („storage“) und Zugriff nur auf
            velosia.henrikheil.net, api.velosia.henrikheil.net, vinted.de, vinted.fr und
            kleinanzeigen.de (dazu localhost für die Entwicklung).
          </li>
          <li>
            <strong>Gespeichert</strong> im Speicher der Erweiterung (chrome.storage.local):
            Anmelde-Schlüssel, E-Mail-Adresse, die gewählte Server-Adresse, ein kurzlebiger
            Ausfüll-Auftrag (welches Angebot auf welcher Plattform) und eine Markierung nach dem
            Klick auf Veröffentlichen, die 10 Minuten gilt und das Erfassen des Inserats erlaubt
            (Abschnitt 7).
          </li>
          <li>
            Bist du in der Web-App angemeldet, übernimmt die Erweiterung Anmelde-Schlüssel und
            E-Mail-Adresse von dort und löscht sie wieder, wenn du dich in der Web-App abmeldest.
            Alternativ meldest du dich im Fenster der Erweiterung mit E-Mail und Passwort an.
          </li>
          <li>Die Erweiterung lädt keine Inhalte von fremden Servern.</li>
        </ul>
        <Steckbrief
          zweck="Fotos aufnehmen, anmelden, Formulare ausfüllen, App aktuell halten."
          grundlage="Art. 6 Abs. 1 lit. b DSGVO; Update-Prüfung: Art. 6 Abs. 1 lit. f DSGVO (Sicherheitskorrekturen zügig ausliefern); Speichern auf dem Gerät: § 25 Abs. 2 Nr. 2 TDDDG."
          dauer="Siehe die einzelnen Punkte; sonst bis zur Deinstallation."
          empfaenger="Google (Anmeldung, Updates über Google Play)."
        />
      </section>

      <section style={section}>
        <h3 style={h3}>13. E-Mail</h3>
        <p style={p}>
          Wenn du uns eine E-Mail schreibst, verarbeiten wir deine Adresse und deine Nachricht, um
          dir zu antworten (Art. 6 Abs. 1 lit. b DSGVO, wenn es um dein Konto geht, sonst
          Art. 6 Abs. 1 lit. f DSGVO).
        </p>
        <p style={p}>
          Velosia verschickt keine E-Mails an Nutzer. Unser Server sendet nur Benachrichtigungen an
          uns selbst – bei einer neuen Eintragung in die Warteliste mit deiner E-Mail-Adresse, bei
          technischen Warnungen ohne personenbezogene Daten. Dafür nutzt er einen E-Mail-Dienst
          (SMTP).
        </p>
        <Todo>
          Eintragen: (1) Welcher SMTP-Anbieter verschickt die Benachrichtigungen (Name, Sitz,
          AVV/DPA)? (2) Welcher Anbieter betreibt das Postfach mail@henrikheil.net? (3) Wie lange
          werden E-Mails und Benachrichtigungen aufbewahrt?
        </Todo>
      </section>

      <section style={section}>
        <h3 style={h3}>14. Empfänger und Übermittlung in Drittländer</h3>
        <ul style={ul}>
          <li>
            <strong>Railway Corporation</strong>, USA – Hosting als Auftragsverarbeiter. Die Server
            stehen in der EU; ein Zugriff aus den USA (etwa durch Support oder auf behördliche
            Anordnung) ist nicht ausgeschlossen.
          </li>
          <li>
            <strong>Google</strong> – Gemini API (Abschnitt 5), Anmeldung über Google (Abschnitt 3),
            Google Play Console für die Tester-Einladung (Abschnitt 9) sowie Google Play für die
            Android-App (Abschnitt 12). Dabei können Daten in die USA übermittelt werden.
          </li>
          <li><strong>E-Mail-Dienst</strong> für Benachrichtigungen (Abschnitt 13).</li>
          <li>
            <strong>Vinted und Kleinanzeigen</strong> – erhalten deine Angebotsdaten, wenn du dort
            inserierst, und verarbeiten sie in eigener Verantwortung (Abschnitt 7).
          </li>
        </ul>
        <p style={p}>
          Für Übermittlungen in die USA stützen wir uns auf den Angemessenheitsbeschluss der
          EU-Kommission zum EU-US Data Privacy Framework (Art. 45 DSGVO), soweit der Empfänger danach
          zertifiziert ist, und im Übrigen auf die Standardvertragsklauseln der EU-Kommission
          (Art. 46 Abs. 2 lit. c DSGVO).
        </p>
        <Todo>
          Je Empfänger prüfen und eintragen: Ist Railway unter dem Data Privacy Framework
          zertifiziert oder enthält das DPA Standardvertragsklauseln? Gleiches für die
          Google-Gesellschaft der Gemini API und den SMTP-Anbieter.
        </Todo>
      </section>

      <section style={section}>
        <h3 style={h3}>15. Speicherdauer im Überblick</h3>
        <ul style={ul}>
          <li>Konto, Einstellungen, Angebote, Fotos, Inserats-Links: bis du sie bzw. dein Konto löschst.</li>
          <li>Funktions-Telemetrie: 90 Tage; bei Kontolöschung wird die Nutzer-ID sofort entfernt.</li>
          <li>Fehlerberichte samt Bildschirmfotos: 12 Monate; bei Kontolöschung sofort.</li>
          <li>Tester-Warteliste: 12 Monate nach der Eintragung; auf Wunsch oder bei Kontolöschung sofort.</li>
          <li>Interne Vermerke über Warn-E-Mails (ohne personenbezogene Daten): 90 Tage.</li>
          <li>Zähler gegen Missbrauch: nur im Arbeitsspeicher, höchstens etwa eine Stunde.</li>
          <li>Download-Link für deinen Datenexport: 10 Minuten gültig.</li>
          <li>Daten auf deinem Gerät: siehe Abschnitte 11 und 12.</li>
          <li>Server-Protokolle und E-Mails: siehe Abschnitte 2 und 13.</li>
        </ul>
        <p style={p}>
          Abgelaufene Einträge löscht ein automatischer Aufräumlauf einmal täglich; er startet
          jeweils kurz nach einem Neustart des Servers.
        </p>
      </section>

      <section style={section}>
        <h3 style={h3}>16. Deine Rechte</h3>
        <p style={p}>Du hast gegenüber uns das Recht auf</p>
        <ul style={ul}>
          <li>Auskunft über deine gespeicherten Daten (Art. 15 DSGVO),</li>
          <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO),</li>
          <li>Löschung (Art. 17 DSGVO),</li>
          <li>Einschränkung der Verarbeitung (Art. 18 DSGVO),</li>
          <li>Datenübertragbarkeit (Art. 20 DSGVO) und</li>
          <li>Widerspruch gegen die Verarbeitung (Art. 21 DSGVO, siehe unten).</li>
        </ul>
        <p style={p}>
          <strong>Kopie deiner Daten:</strong> Unter Profil → „Deine Daten“ → „Meine Daten
          exportieren“ → „Herunterladen“ erhältst du eine ZIP-Datei mit allem, was Velosia zu deinem
          Konto speichert (Art. 15 Abs. 3 und Art. 20 DSGVO): deine Daten in maschinenlesbarer Form
          (JSON – Konto und Einstellungen ohne Passwort, Angebote, Fehlerberichte, Eintrag in der
          Warteliste, Funktions-Telemetrie), die Fotos deiner Angebote, die Bildschirmfotos deiner
          Fehlerberichte und eine Erklärung der Inhalte (LIESMICH.txt). Der Download-Link gilt
          10 Minuten; in der Android-App öffnet er sich in deinem Browser.
        </p>
        <p style={p}>
          Dein Konto mit allen Daten kannst du jederzeit selbst löschen (Profil → Gefahrenbereich →
          „Account löschen“); Einstellungen und Angebote kannst du in der App selbst ändern. Für
          alles andere genügt eine E-Mail an mail@henrikheil.net.
        </p>
        <div style={{
          margin: '0 0 1rem',
          padding: '0.8rem 0.9rem',
          border: '1px solid var(--glass-border)',
          borderRadius: '8px',
        }}>
          <strong>Widerspruchsrecht (Art. 21 DSGVO):</strong> Soweit wir Daten auf Grundlage
          berechtigter Interessen verarbeiten (Art. 6 Abs. 1 lit. f DSGVO) – etwa die
          Funktions-Telemetrie, Fehlerberichte oder die Server-Protokolle –, kannst du dieser
          Verarbeitung aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit
          widersprechen. Wir verarbeiten die Daten dann nicht mehr, es sei denn, wir können
          zwingende schutzwürdige Gründe nachweisen, die deine Interessen, Rechte und Freiheiten
          überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung
          von Rechtsansprüchen.
        </div>
        <p style={p}>
          <strong>Beschwerderecht (Art. 77 DSGVO):</strong> Du kannst dich bei einer
          Datenschutz-Aufsichtsbehörde beschweren, insbesondere in dem Mitgliedstaat deines
          Aufenthaltsorts, deines Arbeitsplatzes oder des mutmaßlichen Verstoßes. Für uns zuständig
          ist der Hessische Beauftragte für Datenschutz und Informationsfreiheit (HBDI) in
          Wiesbaden.
        </p>
      </section>

      <section>
        <h3 style={h3}>17. Änderungen</h3>
        <p>
          Wir passen diese Datenschutzerklärung an, wenn sich Velosia oder die Rechtslage ändert.
          Es gilt die jeweils hier veröffentlichte Fassung.
        </p>
      </section>
    </div>
  );
}

export function NutzungsbedingungenContent() {
  return (
    <div>
      <section style={section}>
        <h3 style={h3}>1. Geltungsbereich und Anbieter</h3>
        <p style={p}>
          Diese Bedingungen gelten für die Nutzung von <strong>Velosia</strong> – der Web-App, der
          Android-App und der Browser-Erweiterung. Anbieter ist Henrik Heil (Anschrift im
          Impressum). Velosia ist kostenlos. Velosia ist kein Angebot von Vinted oder Kleinanzeigen
          und mit diesen Unternehmen nicht verbunden.
        </p>
      </section>

      <section style={section}>
        <h3 style={h3}>2. Was Velosia macht</h3>
        <p style={p}>
          Velosia erzeugt aus deinen Fotos mithilfe einer KI Vorschläge für Titel, Beschreibung,
          Kategorie, Merkmale und Preis eines Second-Hand-Angebots und füllt damit die
          Inserierformulare von Vinted und Kleinanzeigen für dich aus. Velosia befindet sich in der
          Testphase. Funktionen können sich ändern oder zeitweise nicht verfügbar sein; einen
          Anspruch auf eine bestimmte Verfügbarkeit gibt es nicht. Die KI-Analyse ist je Konto auf
          ein Tageskontingent an Bildern begrenzt.
        </p>
      </section>

      <section style={section}>
        <h3 style={h3}>3. Mindestalter 18 Jahre</h3>
        <p style={p}>
          Du musst mindestens <strong>18 Jahre alt</strong> sein, um Velosia zu nutzen. Mit der
          Registrierung bestätigst du das. Hintergrund: Die Bedingungen der Gemini API von Google,
          die Velosia für die KI-Analyse nutzt, erlauben keine Anwendungen, die sich an Minderjährige
          richten oder voraussichtlich von ihnen genutzt werden.
        </p>
      </section>

      <section style={section}>
        <h3 style={h3}>4. KI-erzeugte Inhalte – bitte prüfen</h3>
        <p style={p}>
          Titel, Beschreibung, Kategorie, Merkmale und Preisvorschlag werden von einer künstlichen
          Intelligenz (Google Gemini) erzeugt. Sie können falsch oder unvollständig sein – etwa eine
          falsche Marke oder Größe, ein übersehener Mangel oder ein unpassender Preis.{' '}
          <strong>Prüfe und korrigiere alle Angaben, bevor du veröffentlichst.</strong> Du bist
          Verkäufer und für den Inhalt deines Inserats verantwortlich, insbesondere für zutreffende
          Angaben zu Zustand und Mängeln.
        </p>
        <p style={p}>
          Schaltest du „Automatisch veröffentlichen“ ein, veröffentlicht Velosia das Inserat ohne
          weitere Prüfung auf der Plattform. Prüfe das Angebot in diesem Fall vorher in Velosia.
        </p>
      </section>

      <section style={section}>
        <h3 style={h3}>5. Deine Fotos und Rechte Dritter</h3>
        <ul style={ul}>
          <li>Lade nur Fotos hoch, die du selbst gemacht hast oder verwenden darfst.</li>
          <li>
            Auf deinen Fotos sollen keine anderen Personen zu erkennen sein – auch nicht im
            Hintergrund oder in Spiegelungen. Ist das doch der Fall, bist du dafür verantwortlich,
            dass die abgebildeten Personen einverstanden sind.
          </li>
          <li>
            Achte darauf, dass keine persönlichen Daten zu sehen sind, etwa Adressen, Dokumente,
            Kfz-Kennzeichen oder Bildschirminhalte.
          </li>
          <li>
            Deine Fotos werden zur Analyse an Google übermittelt (siehe Datenschutzerklärung) und
            beim Inserieren an die jeweilige Plattform.
          </li>
        </ul>
      </section>

      <section style={section}>
        <h3 style={h3}>6. Vinted und Kleinanzeigen</h3>
        <p style={p}>
          Du inserierst mit deinem eigenen Konto bei Vinted bzw. Kleinanzeigen. Dort gelten
          zusätzlich deren Nutzungsbedingungen und Regeln, zum Beispiel zu verbotenen Artikeln, zur
          richtigen Kategorie oder zu Angaben gewerblicher Verkäufer. Velosia füllt die Formulare
          nur für dich aus; ob ein Inserat diesen Regeln entspricht, verantwortest du. Ob und wie
          du Hilfsmittel wie Velosia auf den Plattformen einsetzen darfst, richtet sich ebenfalls
          nach deren Bedingungen. Auf Entscheidungen der Plattformen, etwa das Entfernen eines
          Inserats, haben wir keinen Einfluss. Ändert eine Plattform ihr Formular, kann das
          Ausfüllen vorübergehend unvollständig sein.
        </p>
      </section>

      <section style={section}>
        <h3 style={h3}>7. Unzulässige Nutzung</h3>
        <p style={p}>Nicht erlaubt ist insbesondere,</p>
        <ul style={ul}>
          <li>Velosia für verbotene oder rechtswidrige Angebote zu nutzen,</li>
          <li>Inhalte hochzuladen, die Rechte Dritter verletzen,</li>
          <li>Velosia automatisiert in großer Menge abzufragen, Kontingente zu umgehen oder den Dienst anzugreifen.</li>
        </ul>
      </section>

      <section style={section}>
        <h3 style={h3}>8. Konto beenden und Sperrung</h3>
        <p style={p}>
          Du kannst dein Konto jederzeit in der App löschen; damit endet die Nutzung. Vorher kannst
          du unter Profil → „Deine Daten“ eine Kopie deiner Daten herunterladen. Verstößt du
          gegen diese Bedingungen, können wir dein Konto sperren oder löschen. Wir können Velosia
          einstellen; wir kündigen das vorher in der App an.
        </p>
      </section>

      <section style={section}>
        <h3 style={h3}>9. Haftung</h3>
        <p style={p}>
          Velosia ist ein kostenloses Angebot. Wir haften unbeschränkt bei Vorsatz und grober
          Fahrlässigkeit, bei der Verletzung von Leben, Körper oder Gesundheit sowie nach dem
          Produkthaftungsgesetz. Im Übrigen ist unsere Haftung ausgeschlossen, soweit das gesetzlich
          zulässig ist – insbesondere für Schäden aus falschen KI-Vorschlägen, die du ungeprüft
          veröffentlichst.
        </p>
        <Todo>
          Haftungsklausel von einem Anwalt oder Generator prüfen lassen (Verbraucher-AGB,
          §§ 307 ff. BGB).
        </Todo>
      </section>

      <section style={section}>
        <h3 style={h3}>10. Änderungen dieser Bedingungen</h3>
        <p style={p}>
          Über wesentliche Änderungen informieren wir dich vorab in der App. Bist du nicht
          einverstanden, kannst du dein Konto löschen.
        </p>
      </section>

      <section>
        <h3 style={h3}>11. Anwendbares Recht</h3>
        <p>
          Es gilt deutsches Recht. Bist du Verbraucher mit gewöhnlichem Aufenthalt in einem anderen
          EU-Staat, bleiben die zwingenden Verbraucherschutzvorschriften dieses Staates unberührt.
        </p>
      </section>
    </div>
  );
}

// One switch for all legal documents (used by the standalone page and the overlay).
export function LegalContent({ doc }) {
  switch (doc) {
    case 'impressum': return <ImpressumContent />;
    case 'nutzungsbedingungen': return <NutzungsbedingungenContent />;
    case 'konto-loeschen': return <KontoLoeschenContent />;
    default: return <DatenschutzContent />;
  }
}
