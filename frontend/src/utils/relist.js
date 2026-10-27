export const PLATFORM_NAMES = { vinted: 'Vinted', kleinanzeigen: 'Kleinanzeigen' };

// Survives the trip through the platform WebView: deleting the old ad navigates
// the app away from the frontend, so DraftDetail picks the flow up again from this
// marker when it remounts. Only valid briefly — an abandoned delete must not pop
// the sheet days later.
export const RELIST_KEY = 'velosia_relist';
const RELIST_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// Returns the platform whose re-listing is waiting on this draft (and clears the
// marker), or null.
export function takePendingRelist(draftId) {
  try {
    const raw = localStorage.getItem(RELIST_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    const fresh = m && Date.now() - (m.at || 0) < RELIST_MAX_AGE_MS;
    if (!fresh || m.draftId === draftId) localStorage.removeItem(RELIST_KEY);
    return fresh && m.draftId === draftId && PLATFORM_NAMES[m.platform] ? m.platform : null;
  } catch (e) {
    return null;
  }
}
