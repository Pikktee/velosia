import { useState, useEffect } from 'react';
import { RefreshCw, Check } from 'lucide-react';
import { refreshListingStatus } from '../utils/api';
import { listingPlatforms, isActive, relistPriceOptions, platformDeleteUrl } from '../utils/listingStatus';
import { PLATFORM_NAMES, rememberRelist } from '../utils/relist';
import Sheet from './Sheet';

// "Neu einstellen": optionally lower the price, take a still-live ad down first
// (so the item is never listed twice), then publish again. The take-down is
// semi-manual like the cross-post sync — the old ad opens in the WebView and the
// user confirms the deletion himself. Back here we check the public page before
// offering the new listing. A sold/deleted ad skips straight to publishing.
export default function RelistSheet({ draft, platform, resumed, initialPrice, onPublish, onUpdate, onClose }) {
  const name = PLATFORM_NAMES[platform];
  const listing = listingPlatforms(draft).find((x) => x.key === platform);
  const needsDelete = !!listing && isActive(listing.status);
  const options = relistPriceOptions(draft.price);
  const [price, setPrice] = useState(() => {
    if (initialPrice != null) return initialPrice;
    return options[0]?.value ?? null;
  });
  // 'delete' → old ad still to remove; 'checking' / 'live' / 'error' → back from
  // the platform, verifying; 'ready' → publish.
  const [phase, setPhase] = useState(() => {
    if (!needsDelete) return 'ready';
    return resumed ? 'checking' : 'delete';
  });

  const verify = async () => {
    try {
      const updated = await refreshListingStatus(draft.id);
      onUpdate(updated);
      const p = listingPlatforms(updated).find((x) => x.key === platform);
      if (!p || p.status === 'geloescht') setPhase('ready');
      else if (p.status === 'unbekannt') setPhase('error'); // page couldn't be read
      else setPhase('live');
    } catch (err) {
      console.error(err);
      setPhase('error');
    }
  };

  useEffect(() => {
    if (resumed && needsDelete) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = () => {
    const url = platformDeleteUrl(platform, listing?.url, draft.ka_listing_id);
    const bridge = typeof window !== 'undefined' ? window.VelosiaBridge : null;
    if (bridge && typeof bridge.deleteOnPlatform === 'function') {
      rememberRelist(draft.id, platform, price);
      try { localStorage.setItem('velosia_return_draft', String(draft.id)); } catch { /* ignore */ }
      bridge.deleteOnPlatform(draft.id, platform, url, '');
    } else if (url) {
      // No navigation away from here, so the sheet simply waits for the user.
      window.open(url, '_blank', 'noopener');
      setPhase('error');
    }
  };

  const publish = () => {
    onClose();
    onPublish(price);
  };

  const check = () => {
    setPhase('checking');
    verify();
  };

  const deleted = phase === 'ready';
  let stepSub = `auf ${name}`;
  if (phase === 'checking') stepSub = 'wird geprüft …';
  else if (phase === 'live') stepSub = `noch online auf ${name}`;
  else if (phase === 'error') stepSub = 'Gelöscht? Dann prüfen.';

  let cta;
  if (phase === 'delete') cta = <button className="btn btn-primary sheet-cta" onClick={handleDelete}>Alte Anzeige löschen</button>;
  else if (phase === 'checking') cta = <button className="btn btn-primary sheet-cta" disabled><RefreshCw size={16} className="spin" /> Wird geprüft</button>;
  else if (phase === 'live') cta = <button className="btn btn-primary sheet-cta" onClick={handleDelete}>Nochmal löschen</button>;
  else if (phase === 'error') cta = <button className="btn btn-primary sheet-cta" onClick={check}><RefreshCw size={16} /> Prüfen</button>;
  else cta = <button className="btn btn-primary sheet-cta" onClick={publish}>{needsDelete ? 'Jetzt neu einstellen' : 'Jetzt einstellen'}</button>;

  return (
    <Sheet title={`${needsDelete ? 'Neu einstellen' : 'Nochmal einstellen'} auf ${name}`} onClose={onClose}>
      {options.length > 1 && (
        <div className="relist-price">
          <span className="sheet-label">Preis</span>
          <div className="relist-price-opts" role="radiogroup" aria-label="Preis">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={price === o.value}
                className={`relist-price-opt${price === o.value ? ' active' : ''}`}
                onClick={() => setPrice(o.value)}
              >
                <strong>{o.value} €</strong>
                <span>{o.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {needsDelete && (
        <ol className="relist-steps">
          <li className={deleted ? 'done' : `current${phase === 'live' ? ' warn' : ''}`}>
            <span className="relist-step-dot">{deleted ? <Check size={14} strokeWidth={3} /> : '1'}</span>
            <span className="relist-step-text">
              <strong>Alte Anzeige löschen</strong>
              {!deleted && <small>{stepSub}</small>}
            </span>
          </li>
          <li className={deleted ? 'current' : 'todo'}>
            <span className="relist-step-dot">2</span>
            <span className="relist-step-text"><strong>Neu hochladen</strong></span>
          </li>
        </ol>
      )}

      {cta}
      {(phase === 'live' || phase === 'error') && (
        <button className="sheet-text-btn" onClick={publish}>Trotzdem neu einstellen</button>
      )}
      <button className="sheet-text-btn" onClick={onClose}>Abbrechen</button>
    </Sheet>
  );
}
