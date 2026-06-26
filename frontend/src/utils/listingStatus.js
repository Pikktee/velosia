// Shared presentation metadata for published-listing statuses, so the list and
// the detail view render identical badges. Status vocabulary comes from the
// backend (services/listing_status.py): online | reserviert | verkauft |
// geloescht | unbekannt.

export const STATUS_META = {
  online:     { label: 'Online',     color: '#34d399', bg: 'rgba(52, 211, 153, 0.14)' },
  reserviert: { label: 'Reserviert', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.14)' },
  verkauft:   { label: 'Verkauft',   color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.14)' },
  geloescht:  { label: 'Gelöscht',   color: '#f87171', bg: 'rgba(248, 113, 113, 0.14)' },
  unbekannt:  { label: 'Unbekannt',  color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.14)' },
};

export const statusMeta = (status) => STATUS_META[status] || STATUS_META.unbekannt;

// True if the draft has at least one published listing on either platform.
export const hasListing = (draft) =>
  !!(draft && (draft.ka_listing_url || draft.vinted_listing_url ||
               draft.ka_listing_id || draft.vinted_listing_id));

// Terminal statuses — a listing in one of these is "done" (off the market).
export const TERMINAL = new Set(['verkauft', 'geloescht']);

// Short platform label for compact list chips.
export const platformShort = (key) => (key === 'kleinanzeigen' ? 'KA' : 'Vinted');

// After how many days an *active* listing earns a gentle "seit X Tagen" nudge
// (invitation to lower the price / re-list). Soft signal — uses created_at as a
// proxy for "online since".
export const STALE_DAYS = 21;

// Which list section a draft belongs to: 'draft' (not yet listed), 'active'
// (live on ≥1 platform), or 'done' (terminal on every platform it's on).
export const draftSection = (draft) => {
  const platforms = listingPlatforms(draft);
  if (platforms.length === 0) return 'draft';
  return platforms.every((p) => TERMINAL.has(p.status)) ? 'done' : 'active';
};

// Group drafts into the three sections, preserving incoming order.
export const groupDrafts = (drafts) => {
  const groups = { draft: [], active: [], done: [] };
  (drafts || []).forEach((d) => { groups[draftSection(d)].push(d); });
  return groups;
};

// Days since the draft was created (proxy for "online since").
export const listingAgeDays = (draft) => {
  if (!draft || !draft.created_at) return 0;
  const ms = Date.now() - new Date(draft.created_at).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
};

// Cross-posting conflict: sold on one platform while still online/reserved on the
// other — the actionable "take it down elsewhere" moment.
export const crossPostConflict = (draft) => {
  const platforms = listingPlatforms(draft);
  if (platforms.length < 2) return null;
  const sold = platforms.find((p) => p.status === 'verkauft');
  const live = platforms.find((p) => p.status === 'online' || p.status === 'reserviert');
  if (sold && live) return { draft, sold, live };
  return null;
};

// Compact status summary for the list row: one chip when all platforms agree,
// a per-platform split (plus a conflict flag) when they diverge.
export const statusSummary = (draft) => {
  const platforms = listingPlatforms(draft);
  if (platforms.length === 0) return null;
  const distinct = [...new Set(platforms.map((p) => p.status))];
  if (distinct.length === 1) {
    return { mode: 'collapsed', status: distinct[0], platforms };
  }
  return { mode: 'split', platforms, conflict: !!crossPostConflict(draft) };
};

// The platforms this draft is published on, with their status + public URL.
export const listingPlatforms = (draft) => {
  const out = [];
  if (draft && (draft.ka_listing_url || draft.ka_listing_id)) {
    out.push({
      key: 'kleinanzeigen',
      name: 'Kleinanzeigen',
      status: draft.ka_status || 'unbekannt',
      url: draft.ka_listing_url || null,
      at: draft.ka_status_at || null,
    });
  }
  if (draft && (draft.vinted_listing_url || draft.vinted_listing_id)) {
    out.push({
      key: 'vinted',
      name: 'Vinted',
      status: draft.vinted_status || 'unbekannt',
      url: draft.vinted_listing_url || null,
      at: draft.vinted_status_at || null,
    });
  }
  return out;
};
