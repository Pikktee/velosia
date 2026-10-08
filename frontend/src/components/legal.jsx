import React from 'react';

// Single source of truth for the legal texts, shared by the landing-page modal
// and the standalone #/datenschutz and #/impressum routes (the latter give Google
// Play a stable, linkable privacy-policy URL).

const h3 = { fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' };

export const LEGAL_TITLES = {
  datenschutz: 'Datenschutzerklärung',
  impressum: 'Impressum',
  'konto-loeschen': 'Konto und Daten löschen',
};

const ol = { margin: '0 0 1.5rem 0', padding: '0 0 0 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' };

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
        <li>Oben rechts die <strong>Einstellungen</strong> öffnen.</li>
        <li>Ganz unten auf <strong>„Account löschen"</strong> tippen.</li>
        <li>Mit <strong>„Ja, löschen"</strong> bestätigen.</li>
      </ol>
      <p style={{ marginBottom: '1.5rem' }}>
        Dein Konto und alle Daten werden dabei <strong>sofort und unwiderruflich</strong> gelöscht.
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
        Passwort bzw. die <strong>Google-Verknüpfung</strong>, alle erstellten{' '}
        <strong>Anzeigen/Entwürfe</strong>, alle von dir <strong>hochgeladenen Fotos</strong>,
        deine <strong>Fehlerberichte</strong> samt Screenshots sowie ein eventueller Eintrag auf
        der <strong>Tester-Warteliste</strong>.
      </p>

      <h3 style={h3}>Werden Daten aufbewahrt?</h3>
      <p>
        Nach der Löschung bewahren wir <strong>keine</strong> personenbezogenen Konto- oder
        Anzeigendaten auf. Velosia ist kostenlos – es fallen keine Zahlungs- oder Rechnungsdaten an.
        Erhalten bleiben lediglich <strong>technische Auswertungen</strong> der automatischen
        Formularausfüllung (welche Formularfelder gefunden wurden, ohne Anzeigeninhalte), die
        nach der Löschung keinen Bezug mehr zu deinem Konto haben.
      </p>
    </div>
  );
}

export function ImpressumContent() {
  return (
    <div>
      <h3 style={h3}>Angaben gemäß § 5 TMG</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Henrik Heil<br />
        Westendstraße 100<br />
        60325 Frankfurt<br />
        E-Mail: mail@henrikheil.net
      </p>

      <h3 style={h3}>Haftung für Inhalte</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.
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
      <h3 style={h3}>1. Datenschutz auf einen Blick</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Der Schutz deiner persönlichen Daten hat für uns höchste Priorität. Diese Datenschutzerklärung informiert dich darüber, welche Daten wir erfassen und wie wir sie verwenden.
      </p>

      <h3 style={h3}>2. Datenerfassung in App und auf dieser Website</h3>
      <p style={{ marginBottom: '1.25rem' }}>
        <strong>Registrierungsdaten:</strong> Für die Nutzung unserer Angebots-Automatisierung erheben wir deine E-Mail-Adresse und ein verschlüsseltes Passwort. Bei der Anmeldung über Google erhalten wir zusätzlich deine bei Google hinterlegte E-Mail-Adresse. Diese Daten dienen ausschließlich zur Authentifizierung und Zuordnung deiner Angebote.
      </p>
      <p style={{ marginBottom: '1.5rem' }}>
        <strong>Bilder und Angebote:</strong> Fotos deiner Artikel werden beim Hochladen auf unserem Server neu abgespeichert. Dabei werden alle eingebetteten Metadaten entfernt – insbesondere Kamera- und Standortdaten (EXIF/GPS). Gespeichert und später auf Vinted oder Kleinanzeigen hochgeladen wird nur das Bild selbst. Zur Analyse werden die Fotos an den Google Gemini API Dienst übertragen. Deine Angebote und Fotos bleiben gespeichert, bis du sie oder dein Konto löschst; sie werden nicht für Werbezwecke verwendet.
      </p>

      <h3 style={h3}>3. Weitergabe an Dritte</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Deine Daten werden nicht an unbefugte Dritte weitergegeben. Zur Bildanalyse nutzen wir die Google Gemini API. Es werden hierbei ausschließlich die Bildinhalte übermittelt.
      </p>

      <h3 style={h3}>4. Deine Rechte</h3>
      <p style={{ marginBottom: '1.5rem' }}>
        Du hast jederzeit das Recht auf unentgeltliche Auskunft über Herkunft, Empfänger und Zweck deiner gespeicherten personenbezogenen Daten. Du hast außerdem ein Recht auf Berichtigung, Sperrung oder Löschung dieser Daten. Du kannst dein Konto und alle damit verbundenen Angebote und Bilder jederzeit direkt in deinen Profileinstellungen löschen.
      </p>

      <h3 style={h3}>5. Kontakt</h3>
      <p>
        Bei Fragen zum Datenschutz erreichst du uns unter: mail@henrikheil.net
      </p>
    </div>
  );
}
