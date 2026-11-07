import { createPortal } from 'react-dom';

// Plain bottom sheet for the detail view's status/publish/relist flows. Builds on
// the sync-sheet look (dark glass, slide-up); a tap on the backdrop closes it.
export default function Sheet({ title, aside, onClose, children }) {
  return createPortal(
    <div className="sync-sheet-overlay" onClick={onClose}>
      <div className="sync-sheet vs-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sync-sheet-handle" />
        <div className="vs-sheet-head">
          <h3>{title}</h3>
          {aside}
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
