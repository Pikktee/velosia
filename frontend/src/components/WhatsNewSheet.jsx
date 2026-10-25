import { createPortal } from 'react-dom';
import { Sparkles, Check, Wrench, X } from 'lucide-react';

// The one-time "Neu in Velosia" sheet after an update (rules in utils/whatsNew.js).
// Same bottom-sheet look as the cross-post sync sheet; "Weiter" just closes it.
export default function WhatsNewSheet({ news, onClose }) {
  const { items, fixes, versions } = news;
  const subtitle = versions.length > 1
    ? `Seit Version ${versions[versions.length - 1]}`
    : `Version ${versions[0]}`;

  return createPortal(
    <div className="sync-sheet-overlay" onClick={onClose}>
      <div className="sync-sheet whats-new-sheet" role="dialog" aria-labelledby="whats-new-title" onClick={(e) => e.stopPropagation()}>
        <button className="sync-sheet-x" onClick={onClose} aria-label="Schließen"><X size={18} /></button>
        <div className="sync-sheet-handle" />
        <div className="sync-sheet-head">
          <div className="sync-sheet-icon whats-new-icon"><Sparkles size={22} /></div>
          <div>
            <h3 id="whats-new-title">Neu in Velosia</h3>
            <p>{subtitle}</p>
          </div>
        </div>
        <ul className="whats-new-list">
          {items.map((text) => (
            <li key={text}><Check size={16} /><span>{text}</span></li>
          ))}
          {fixes && (
            <li className="whats-new-fixes"><Wrench size={15} /><span>Bugfixes und kleine Verbesserungen</span></li>
          )}
        </ul>
        <button className="btn btn-primary sync-sheet-btn" onClick={onClose}>Weiter</button>
      </div>
    </div>,
    document.body
  );
}
