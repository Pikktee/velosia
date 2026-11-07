import { ArrowUpRight, ChevronRight, CircleCheck, RefreshCw, Repeat } from 'lucide-react';
import {
  listingPlatforms, statusMeta, isActive, publishedDays, crossPostConflict, formatEuro, STALE_DAYS,
  PLATFORM_KEYS, PLATFORM_LETTER, PLATFORM_LABEL,
} from '../utils/listingStatus';
import Sheet from './Sheet';

// Letter mark of a platform, framed in its status colour (no colour = not listed).
export function PlatformMark({ platform, status, size = 'md' }) {
  const meta = status ? statusMeta(status) : null;
  return (
    <span
      className={`platform-mark platform-mark-${size}${meta ? '' : ' empty'}`}
      style={meta ? { borderColor: meta.color, background: meta.bg } : undefined}
      aria-hidden="true"
    >
      {PLATFORM_LETTER[platform]}
    </span>
  );
}

const freshness = (draft) => {
  const times = ['ka_status_at', 'vinted_status_at']
    .map((k) => draft[k])
    .filter(Boolean)
    .map((v) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`))
    .filter((t) => !Number.isNaN(t));
  if (!times.length) return 'aktualisieren';
  const min = Math.floor((Date.now() - Math.max(...times)) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'vor 1 Tag' : `vor ${d} Tagen`;
};

const PREFIX = { kleinanzeigen: 'ka', vinted: 'vinted' };

// "Deine Anzeigen": one card per platform the draft is listed on, plus a quiet
// card for a platform it isn't on yet.
export function StatusSheet({ draft, priceType, refreshing, settingStatus, onRefresh, onRelist, onPublish, onMarkSold, onDelete, onClose }) {
  const platforms = listingPlatforms(draft);
  const conflict = crossPostConflict(draft);
  const missing = PLATFORM_KEYS.filter((k) => !platforms.some((p) => p.key === k));

  return (
    <Sheet
      title="Deine Anzeigen"
      onClose={onClose}
      aside={(
        <button className="vs-sheet-refresh" onClick={onRefresh} disabled={refreshing} aria-label="Status aktualisieren">
          <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
          {refreshing ? 'prüfe …' : freshness(draft)}
        </button>
      )}
    >
      <div className="listing-cards">
        {platforms.map((p) => {
          const meta = statusMeta(p.status);
          const active = isActive(p.status);
          const isConflict = conflict && conflict.live.key === p.key;
          const days = publishedDays(draft, p.key);
          const isStale = !conflict && active && days >= STALE_DAYS;
          const online = draft[`${PREFIX[p.key]}_online_price`];
          const price = online ?? draft.price;
          let info;
          if (p.status === 'verkauft') info = 'verkauft';
          else if (p.status === 'geloescht') info = 'gelöscht';
          else info = `${days === 0 ? 'seit heute' : days === 1 ? 'seit 1 Tag' : `seit ${days} Tagen`}${price ? ` · ${formatEuro(price)}${p.key === 'kleinanzeigen' && priceType === 'NEGOTIABLE' ? ' VB' : ''}` : ''}`;
          return (
            <div key={p.key} className={`listing-card${isConflict || isStale ? ' warn' : ''}`}>
              <div className="listing-card-head">
                <PlatformMark platform={p.key} status={p.status} size="lg" />
                <div className="listing-card-name">
                  <strong>{p.name}</strong>
                  <span className={isStale ? 'warn' : undefined}>{info}</span>
                </div>
                <span className="listing-card-pill" style={{ color: meta.color, background: meta.bg }}>
                  <i style={{ background: meta.color }} />{meta.label}
                </span>
              </div>
              {isConflict && <p className="listing-card-note">Auf {conflict.sold.name} verkauft</p>}
              <div className="listing-card-actions">
                {isConflict ? (
                  <button className="listing-card-main danger" onClick={() => onDelete(p)}>Löschen <ArrowUpRight size={15} /></button>
                ) : p.url ? (
                  <a className="listing-card-main" href={p.url} target="_blank" rel="noopener noreferrer">Öffnen <ArrowUpRight size={15} /></a>
                ) : null}
                <button className={`listing-card-second${isStale ? ' emph' : ''}`} onClick={() => onRelist(p.key)}>
                  <Repeat size={15} /> {active ? 'Neu einstellen' : 'Nochmal einstellen'}
                </button>
              </div>
              {p.key === 'kleinanzeigen' && active && !isConflict && (
                <button className="sheet-text-btn small" disabled={settingStatus} onClick={() => onMarkSold(p.key)}>
                  <CircleCheck size={14} /> Als verkauft markieren
                </button>
              )}
            </div>
          );
        })}
        {missing.map((k) => (
          <div key={k} className="listing-card missing">
            <PlatformMark platform={k} size="lg" />
            <strong className="listing-card-missing-name">{PLATFORM_LABEL[k]}</strong>
            <button className="btn btn-primary listing-card-publish" onClick={() => onPublish(k)}>Einstellen</button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// "Einstellen auf": the platforms this draft isn't listed on yet.
export function PublishSheet({ draft, onPublish, onClose }) {
  const listed = listingPlatforms(draft).map((p) => p.key);
  const keys = PLATFORM_KEYS.filter((k) => !listed.includes(k));
  return (
    <Sheet title="Einstellen auf" onClose={onClose}>
      <div className="publish-rows">
        {keys.map((k) => (
          <button key={k} className="publish-row" onClick={() => onPublish(k)}>
            <PlatformMark platform={k} size="lg" />
            <strong>{PLATFORM_LABEL[k]}</strong>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
