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

// Edits made on the platform itself (price, title, description): a value last
// read from the live ad differs from its baseline (what the engine published, or
// what the user chose to keep) and from the draft's current value. Values that
// differ per platform on purpose stay quiet once kept. Texts are compared with
// whitespace collapsed, since the platforms reflow line breaks.
const samePrice = (a, b) => Math.abs(a - b) < 0.01;
const sameText = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();

export const onlineChanges = (draft, current = draft) => {
  if (!draft) return [];
  const platforms = [
    { key: 'kleinanzeigen', name: 'Kleinanzeigen', prefix: 'ka', status: draft.ka_status, type: draft.ka_online_price_type },
    { key: 'vinted', name: 'Vinted', prefix: 'vinted', status: draft.vinted_status, type: null },
  ];
  const listed = (prefix) => !!(draft[`${prefix}_listing_id`] || draft[`${prefix}_listing_url`]);
  return platforms.filter((p) => listed(p.prefix) && !TERMINAL.has(p.status)).map((p) => {
    const changes = {};
    const online = (f) => draft[`${p.prefix}_online_${f}`];
    const listed = (f) => draft[`${p.prefix}_listed_${f}`];
    const price = online('price');
    if (price != null && listed('price') != null
        && !samePrice(price, listed('price')) && !samePrice(price, parseFloat(current?.price) || 0)) {
      changes.price = price;
    }
    ['title', 'description'].forEach((f) => {
      const value = online(f);
      if (value != null && listed(f) != null && !sameText(value, listed(f)) && !sameText(value, current?.[f])) {
        changes[f] = value;
      }
    });
    return { key: p.key, name: p.name, type: p.type, changes };
  }).filter((p) => Object.keys(p.changes).length > 0);
};

export const formatEuro = (v) => `${Number.isInteger(v) ? v : v.toFixed(2).replace('.', ',')} €`;

// ── Detail view (V2.7.67) ────────────────────────────────────────────────────
// The detail header carries the status as a subtitle and one icon per platform
// that opens the live ad; everything else sits one tap deeper in sheets.

export const PLATFORM_KEYS = ['kleinanzeigen', 'vinted'];
export const PLATFORM_LETTER = { kleinanzeigen: 'K', vinted: 'V' };
export const PLATFORM_LABEL = { kleinanzeigen: 'Kleinanzeigen', vinted: 'Vinted' };
const PREFIX = { kleinanzeigen: 'ka', vinted: 'vinted' };

const parseUtc = (v) => {
  if (!v) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
};

// Days the current listing on `key` has been live. Rows from before 2.7.67 have
// no published_at, so the draft's creation stands in.
export const publishedDays = (draft, key) => {
  const t = parseUtc(draft?.[`${PREFIX[key]}_published_at`]) || parseUtc(draft?.created_at);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

export const isActive = (status) => status === 'online' || status === 'reserviert';

// Subtitle under the detail title. `tone` 'warn' = something to do; `action`
// says where a tap leads (the 'status' sheet; null = nothing to open).
export const detailSummary = (draft) => {
  const platforms = listingPlatforms(draft);
  if (!platforms.length) return { text: 'Entwurf', tone: 'muted', action: null };
  const conflict = crossPostConflict(draft);
  if (conflict) {
    return { text: `Auf ${conflict.sold.name} verkauft`, tone: 'warn', action: 'status' };
  }
  const stale = platforms.find((p) => isActive(p.status) && publishedDays(draft, p.key) >= STALE_DAYS);
  if (stale) {
    return { text: `${publishedDays(draft, stale.key)} Tage online`, tone: 'warn', action: 'status' };
  }
  const statuses = [...new Set(platforms.map((p) => p.status))];
  if (statuses.length === 1) {
    const label = statusMeta(statuses[0]).label;
    const text = platforms.length > 1 ? `Überall ${label.toLowerCase()}` : `${label} auf ${platforms[0].name}`;
    return { text, tone: statuses[0], action: 'status' };
  }
  // Mixed: name the one that matters most (reserved > online > sold > deleted);
  // the platform icons beside it show the rest.
  const RANK = ['reserviert', 'online', 'verkauft', 'geloescht', 'unbekannt'];
  const lead = [...platforms].sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))[0];
  return { text: `${statusMeta(lead.status).label} auf ${lead.name}`, tone: lead.status, action: 'status' };
};

// Price suggestions when re-listing: as is, −5 %, −10 %; rounded to 5 € from
// 50 € up, to whole euros below. Duplicates (tiny prices) collapse.
export const relistPriceOptions = (price) => {
  const p = parseFloat(price) || 0;
  if (p <= 0) return [];
  const round = (v) => (v >= 50 ? Math.round(v / 5) * 5 : Math.max(1, Math.round(v)));
  const opts = [{ value: p, hint: 'aktuell' }, { value: round(p * 0.95), hint: '−5 %' }, { value: round(p * 0.9), hint: '−10 %' }];
  return opts.filter((o, i) => opts.findIndex((x) => x.value === o.value) === i);
};

// Where to delete a live ad. Kleinanzeigen's public ad page has no delete
// control, its own-ads list ("Meine Anzeigen") has one per ad; the fragment
// tells the app which ad to point at (the app ≥ 2.7.73 scrolls there and
// highlights "Löschen"; older apps just open the list). Vinted: the ad itself.
export const platformDeleteUrl = (platform, url, listingId) => {
  if (platform === 'kleinanzeigen') {
    const id = listingId || (String(url || '').match(/\/s-anzeige\/(?:[^/]+\/)?(\d{1,15})/) || [])[1];
    if (id) return `https://www.kleinanzeigen.de/m-meine-anzeigen.html#velosia-ad=${id}`;
  }
  return url || '';
};
