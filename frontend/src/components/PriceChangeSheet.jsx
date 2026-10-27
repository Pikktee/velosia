import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Tag, Check } from 'lucide-react';
import { keepListingPrice } from '../utils/api';
import { formatEuro } from '../utils/listingStatus';
import { showError } from '../utils/toast';

// The price was changed on the platform itself. Offered once when the draft is
// opened: take it over, or keep the draft's price (the online price then becomes
// the new baseline, so this doesn't come back until it changes again). Closing
// via X leaves the hint under the price field.
export default function PriceChangeSheet({ draft, change, onApply, onUpdate, onClose }) {
  const [keeping, setKeeping] = useState(false);
  const online = `${formatEuro(change.price)}${change.type === 'NEGOTIABLE' ? ' VB' : ''}`;

  const handleKeep = async () => {
    if (keeping) return;
    setKeeping(true);
    try {
      onUpdate(await keepListingPrice(draft.id, change.key));
      onClose();
    } catch (err) {
      console.error(err);
      setKeeping(false);
      showError(err.message);
    }
  };

  return createPortal(
    <div className="sync-sheet-overlay" onClick={onClose}>
      <div className="sync-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sync-sheet-x" onClick={onClose} aria-label="Schließen"><X size={18} /></button>
        <div className="sync-sheet-handle" />
        <div className="sync-sheet-head">
          <div className="sync-sheet-icon"><Tag size={22} /></div>
          <div>
            <h3>Preis auf {change.name} geändert</h3>
            <p>{draft.title || 'Angebot'}</p>
          </div>
        </div>
        <div className="price-change-compare">
          <div>
            <span>In Velosia</span>
            <strong>{draft.price != null ? formatEuro(draft.price) : '–'}</strong>
          </div>
          <div>
            <span>Auf {change.name}</span>
            <strong className="price-change-new">{online}</strong>
          </div>
        </div>
        <button className="btn btn-primary sync-sheet-btn" onClick={onApply}>
          <Check size={16} /> {online} übernehmen
        </button>
        <button className="btn sync-sheet-keep" onClick={handleKeep} disabled={keeping}>
          {draft.price != null ? `${formatEuro(draft.price)} behalten` : 'Behalten'}
        </button>
      </div>
    </div>,
    document.body
  );
}
