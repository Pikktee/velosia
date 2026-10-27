import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, Check, ArrowRight } from 'lucide-react';
import { keepOnlineChanges } from '../utils/api';
import { formatEuro } from '../utils/listingStatus';
import { showError } from '../utils/toast';

// The ad was edited on the platform itself. Offered once when the draft is
// opened: take over everything that changed, or keep the draft as it is (the
// online values then become the new baseline, so this doesn't come back until
// they change there again). Closing via X leaves a banner above the form.
export default function OnlineChangesSheet({ draft, change, onApply, onUpdate, onClose }) {
  const [busy, setBusy] = useState(false);
  const { changes, name } = change;

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleKeep = () => run(async () => {
    try {
      onUpdate(await keepOnlineChanges(draft.id, change.key));
      onClose();
    } catch (err) {
      console.error(err);
      showError(err.message);
    }
  });

  const firstLine = (text) => String(text || '').split('\n').find((l) => l.trim()) || '';

  return createPortal(
    <div className="sync-sheet-overlay" onClick={onClose}>
      <div className="sync-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sync-sheet-x" onClick={onClose} aria-label="Schließen"><X size={18} /></button>
        <div className="sync-sheet-handle" />
        <div className="sync-sheet-head">
          <div className="sync-sheet-icon"><RefreshCw size={22} /></div>
          <div>
            <h3>Auf {name} geändert</h3>
            <p>Du hast die Anzeige dort bearbeitet.</p>
          </div>
        </div>
        <ul className="online-changes-list">
          {changes.price != null && (
            <li>
              <span className="online-changes-label">Preis</span>
              <span className="online-changes-value">
                {draft.price != null && <span className="online-changes-old">{formatEuro(draft.price)}</span>}
                {draft.price != null && <ArrowRight size={13} />}
                <strong>{formatEuro(changes.price)}{change.type === 'NEGOTIABLE' ? ' VB' : ''}</strong>
              </span>
            </li>
          )}
          {changes.title != null && (
            <li>
              <span className="online-changes-label">Titel</span>
              <span className="online-changes-value"><strong>{changes.title}</strong></span>
            </li>
          )}
          {changes.description != null && (
            <li>
              <span className="online-changes-label">Beschreibung</span>
              <span className="online-changes-value"><span className="online-changes-text">{firstLine(changes.description)}</span></span>
            </li>
          )}
        </ul>
        <button className="btn btn-primary sync-sheet-btn" onClick={() => run(onApply)} disabled={busy}>
          <Check size={16} /> Übernehmen
        </button>
        <button className="btn sync-sheet-keep" onClick={handleKeep} disabled={busy}>
          Nicht übernehmen
        </button>
      </div>
    </div>,
    document.body
  );
}
