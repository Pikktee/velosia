// Lädt Google Identity Services (GSI) erst bei Bedarf statt global in index.html.
//
// Hintergrund (DSGVO): Schon das Abrufen von accounts.google.com/gsi/client
// überträgt die IP-Adresse an Google. Deshalb darf das Skript nie beim
// Seitenaufruf (Landing, #/datenschutz, #/impressum …) geladen werden, sondern
// nur nach einer aktiven Nutzeraktion – im Browser-Login beim Antippen von
// „Über Google anmelden“. Die Android-App meldet sich nativ an und braucht GSI nicht.
//
// Das Skript wird höchstens einmal eingefügt; parallele Aufrufe teilen sich
// dasselbe Promise. Schlägt das Laden fehl (Netzfehler, Werbeblocker, Timeout),
// wird der Zwischenspeicher zurückgesetzt, damit ein erneuter Versuch möglich ist.
// Die CSP in vite.config.js muss accounts.google.com/gsi/ weiterhin erlauben.

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const DEFAULT_TIMEOUT_MS = 15000;

let pending = null;

const gsiReady = () => typeof window.google !== 'undefined' && !!window.google.accounts?.id;

/**
 * Fügt das GSI-Skript einmalig ein und löst mit `window.google` auf.
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<typeof window.google>}
 */
export function loadGoogleIdentity({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (gsiReady()) return Promise.resolve(window.google);
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;

    let timer = null;
    const settle = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    };
    const fail = (err) => {
      settle();
      script.remove();
      pending = null;
      reject(err);
    };

    script.onload = () => {
      if (gsiReady()) {
        settle();
        resolve(window.google);
      } else {
        fail(new Error('Google Identity Services ist nach dem Laden nicht verfügbar.'));
      }
    };
    script.onerror = () => fail(new Error('Google Identity Services konnte nicht geladen werden.'));
    timer = setTimeout(
      () => fail(new Error('Zeitüberschreitung beim Laden von Google Identity Services.')),
      timeoutMs,
    );

    document.head.appendChild(script);
  });

  return pending;
}
