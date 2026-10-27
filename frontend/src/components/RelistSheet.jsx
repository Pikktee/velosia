import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, RefreshCw, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { refreshListingStatus } from '../utils/api';
import { listingPlatforms } from '../utils/listingStatus';
import { RELIST_KEY, PLATFORM_NAMES } from '../utils/relist';

// "Neu einstellen" for an ad that is still live: first take the old ad down,
// then publish again, so the item is never listed twice. The take-down is
// semi-manual like the cross-post sync — we open the old ad in the WebView and
// the user confirms the deletion himself. Back here we check the public page
// before offering the new listing.
export default function RelistSheet({ draft, platform, resumed, onPublish, onUpdate, onClose }) {
  const name = PLATFORM_NAMES[platform];
  // 'delete' → ask to remove the old ad; 'checking' / 'deleted' / 'live' / 'error'
  // → back from the platform, verifying the old ad is gone.
  const [phase, setPhase] = useState(resumed ? 'checking' : 'delete');

  const verify = async () => {
    try {
      const updated = await refreshListingStatus(draft.id);
      onUpdate(updated);
      const p = listingPlatforms(updated).find((x) => x.key === platform);
      if (!p || p.status === 'geloescht') setPhase('deleted');
      else if (p.status === 'unbekannt') setPhase('error'); // page couldn't be read
      else setPhase('live');
    } catch (err) {
      console.error(err);
      setPhase('error');
    }
  };

  const check = () => {
    setPhase('checking');
    verify();
  };

  useEffect(() => {
    if (resumed) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = () => {
    const live = listingPlatforms(draft).find((x) => x.key === platform);
    const url = live?.url || '';
    const bridge = typeof window !== 'undefined' ? window.VelosiaBridge : null;
    if (bridge && typeof bridge.deleteOnPlatform === 'function') {
      try {
        localStorage.setItem(RELIST_KEY, JSON.stringify({ draftId: draft.id, platform, at: Date.now() }));
        localStorage.setItem('velosia_return_draft', String(draft.id));
      } catch (e) { /* ignore */ }
      bridge.deleteOnPlatform(draft.id, platform, url, '');
    } else if (url) {
      // No navigation away from here, so the sheet simply waits for the user.
      window.open(url, '_blank', 'noopener');
      setPhase('error');
    }
  };

  const publish = () => {
    onClose();
    onPublish();
  };

  let body;
  if (phase === 'delete') {
    body = (
      <>
        <div className="sync-sheet-warn">
          <AlertTriangle size={17} />
          <p>Die alte Anzeige ist auf <strong>{name} noch online</strong>. Lösch sie zuerst, sonst steht der Artikel doppelt drin.</p>
        </div>
        <button className="btn btn-primary sync-sheet-btn" onClick={handleDelete}>
          <Trash2 size={16} /> Alte Anzeige öffnen &amp; löschen
        </button>
        <button className="btn sync-sheet-keep" onClick={publish}>
          Ohne Löschen neu einstellen
        </button>
        <p className="sync-sheet-note">
          Du bestätigst das Löschen selbst auf {name}. Danach geht es hier weiter.
        </p>
      </>
    );
  } else if (phase === 'checking') {
    body = (
      <p className="relist-checking">
        <RefreshCw size={15} className="spin" /> Prüfe, ob die alte Anzeige weg ist …
      </p>
    );
  } else if (phase === 'deleted') {
    body = (
      <>
        <p className="relist-ok"><CheckCircle2 size={17} /> Die alte Anzeige ist gelöscht.</p>
        <button className="btn btn-primary sync-sheet-btn" onClick={publish}>
          <Upload size={16} /> Jetzt neu einstellen
        </button>
      </>
    );
  } else if (phase === 'live') {
    body = (
      <>
        <div className="sync-sheet-warn">
          <AlertTriangle size={17} />
          <p>Die alte Anzeige ist auf <strong>{name} noch online</strong>.</p>
        </div>
        <button className="btn btn-primary sync-sheet-btn" onClick={handleDelete}>
          <Trash2 size={16} /> Nochmal öffnen &amp; löschen
        </button>
        <button className="btn sync-sheet-keep" onClick={publish}>
          Trotzdem neu einstellen
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p className="relist-checking">Hast du die alte Anzeige gelöscht?</p>
        <button className="btn btn-primary sync-sheet-btn" onClick={check}>
          <RefreshCw size={16} /> Prüfen
        </button>
        <button className="btn sync-sheet-keep" onClick={publish}>
          Neu einstellen
        </button>
      </>
    );
  }

  return createPortal(
    <div className="sync-sheet-overlay" onClick={onClose}>
      <div className="sync-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sync-sheet-x" onClick={onClose} aria-label="Schließen"><X size={18} /></button>
        <div className="sync-sheet-handle" />
        <div className="sync-sheet-head">
          <div className="sync-sheet-icon"><RefreshCw size={22} /></div>
          <div>
            <h3>Auf {name} neu einstellen</h3>
            <p>{draft.title || 'Angebot'}{draft.price != null ? ` · ${Math.round(draft.price)} €` : ''}</p>
          </div>
        </div>
        {body}
      </div>
    </div>,
    document.body
  );
}
