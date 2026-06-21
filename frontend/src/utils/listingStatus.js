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
