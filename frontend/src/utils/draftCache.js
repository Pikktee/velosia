// The last loaded drafts list, kept on the device so the app shows it at once
// on start instead of a skeleton while the server answers (stale-while-
// revalidate: the fresh list replaces it a moment later). Image URLs inside are
// signed with day-rounded expiry (~14 days), so cached rows keep their photos.
// Cleared on logout; failures (private mode, quota) just mean no cache.

const KEY = 'velosia_drafts_cache_v1';

// Fields only the detail view needs and that can be large; the detail view gets
// the fresh draft from the next fetch anyway.
const HEAVY = [
  'ka_online_description', 'ka_listed_description',
  'vinted_online_description', 'vinted_listed_description',
];

export const readDraftCache = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

export const writeDraftCache = (drafts) => {
  try {
    // Placeholders of a running analysis (non-numeric ids) are not real drafts.
    const rows = (drafts || []).filter((d) => d && typeof d.id === 'number').map((d) => {
      const slim = { ...d };
      HEAVY.forEach((k) => { delete slim[k]; });
      return slim;
    });
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // Quota or storage unavailable: no cache, nothing else breaks.
  }
};

export const clearDraftCache = () => {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
};
