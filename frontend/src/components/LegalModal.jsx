import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { LegalContent, LEGAL_TITLES, LEGAL_STAND } from './legal';

// Overlay for the legal texts wherever a #/datenschutz-style route can't be used:
// in the Android app every logged-out route except #/login redirects to the login,
// and inside the logged-in app the routes would leave the current view. Rendered
// into <body> so a transformed/overflow-hidden parent (e.g. Settings) can't clip it.
// `children` + `title` let the landing page reuse it for other long-form info.
export default function LegalModal({ doc, title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(7, 9, 13, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        boxSizing: 'border-box'
      }}
    >
      <div
        className="glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title || LEGAL_TITLES[doc] || ''}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '550px',
          maxHeight: '85dvh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(9, 176, 183, 0.1)'
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--glass-border)'
        }}>
          <h2 style={{
            fontSize: '1.2rem',
            fontFamily: 'var(--font-title)',
            fontWeight: '800',
            margin: 0,
            color: 'var(--text-primary)'
          }}>
            {title || LEGAL_TITLES[doc] || ''}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.25rem',
              borderRadius: '50%'
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{
          padding: '1.5rem',
          overflowY: 'auto',
          textAlign: 'left',
          fontSize: '0.875rem',
          lineHeight: '1.6',
          color: 'var(--text-secondary)'
        }}>
          {children || <LegalContent doc={doc} />}
          {!children && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1.5rem', marginBottom: 0 }}>
              {LEGAL_STAND}
            </p>
          )}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--glass-border)',
          background: 'rgba(255, 255, 255, 0.01)'
        }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            style={{ minHeight: '36px', height: '36px', padding: '0 1.25rem', fontSize: '0.85rem' }}
          >
            Schließen
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const LINK_DOCS = [
  ['datenschutz', 'Datenschutz'],
  ['nutzungsbedingungen', 'Nutzungsbedingungen'],
  ['impressum', 'Impressum'],
];

// Footer row "Datenschutz • Nutzungsbedingungen • Impressum"; each opens the overlay.
export function LegalLinks({ onOpen, style }) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '0.35rem 0.75rem',
      fontSize: '0.75rem',
      color: 'var(--text-muted)',
      ...style
    }}>
      {LINK_DOCS.map(([doc, label], i) => (
        <React.Fragment key={doc}>
          {i > 0 && <span aria-hidden="true" style={{ opacity: 0.3 }}>&bull;</span>}
          <button
            type="button"
            onClick={() => onOpen(doc)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', padding: '0.25rem', minHeight: 'auto', fontSize: 'inherit' }}
          >
            {label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
