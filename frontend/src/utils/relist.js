export const PLATFORM_NAMES = { vinted: 'Vinted', kleinanzeigen: 'Kleinanzeigen' };

// Survives the trip through the platform WebView: deleting the old ad navigates
// the app away from the frontend, so DraftDetail picks the flow up again from this
// marker when it remounts. Only valid briefly — an abandoned delete must not pop
// the sheet days later. Carries the price picked before leaving.
export const RELIST_KEY = 'velosia_relist';
const RELIST_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function rememberRelist(draftId, platform, price) {
  try {
    localStorage.setItem(RELIST_KEY, JSON.stringify({ draftId, platform, price, at: Date.now() }));
  } catch { /* private mode: the flow just doesn't resume */ }
}

// Returns { platform, price } of the re-listing waiting on this draft (and clears
// the marker), or null.
export function takePendingRelist(draftId) {
  try {
    const raw = localStorage.getItem(RELIST_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    const fresh = m && Date.now() - (m.at || 0) < RELIST_MAX_AGE_MS;
    if (!fresh || m.draftId === draftId) localStorage.removeItem(RELIST_KEY);
    if (!fresh || m.draftId !== draftId || !PLATFORM_NAMES[m.platform]) return null;
    return { platform: m.platform, price: typeof m.price === 'number' ? m.price : null };
  } catch {
    return null;
  }
}

// Deleting an ad on the platform (conflict "Löschen") leaves the app too; back
// in the detail view the status is then re-read at once instead of waiting for
// the 2-minute freshness window.
const RECHECK_KEY = 'velosia_recheck_draft';

export function rememberRecheck(draftId) {
  try { localStorage.setItem(RECHECK_KEY, String(draftId)); } catch { /* ignore */ }
}

export function takeRecheck(draftId) {
  try {
    if (localStorage.getItem(RECHECK_KEY) !== String(draftId)) return false;
    localStorage.removeItem(RECHECK_KEY);
    return true;
  } catch {
    return false;
  }
}
