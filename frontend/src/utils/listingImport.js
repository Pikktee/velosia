// Übernahme vorhandener Plattform-Anzeigen (2.8.21). Nur in der App: sie öffnet
// „Meine Anzeigen“ der Plattform in ihrer WebView (dort ist der Nutzer eingeloggt),
// die Engine liest die Liste und der Server füllt die Angebote im Hintergrund.
import { createImportToken } from './api';
import { showError } from './toast';

export const canImportListings = () =>
  typeof window !== 'undefined' && typeof window.VelosiaBridge?.supportsImport === 'function';

export async function startListingImport(platform = 'kleinanzeigen') {
  try {
    const token = await createImportToken();
    window.VelosiaBridge.importFromPlatform(platform, token);
  } catch (err) {
    showError(err.message || 'Die Übernahme konnte nicht gestartet werden.');
  }
}

// Ein übernommenes Angebot, das der Server noch aus der Anzeigenseite füllt.
export const isImportPending = (draft) => draft?.import_status === 'pending';
