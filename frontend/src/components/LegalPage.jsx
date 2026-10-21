import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { LegalContent, LEGAL_TITLES, LEGAL_STAND } from './legal';

// Standalone legal page for #/datenschutz, #/impressum, #/nutzungsbedingungen and
// #/konto-loeschen — gives Google Play and the browser extension stable, directly
// linkable URLs (separate from the in-app overlay, LegalModal).
export default function LegalPage({ doc }) {
  return (
    <div className="fade-in" style={{ maxWidth: '680px', margin: '0 auto', padding: '0 0.25rem' }}>
      <button
        onClick={() => window.location.hash = '#/'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem', padding: '0.5rem 0.25rem', marginBottom: '1rem' }}
      >
        <ArrowLeft size={15} /> Zur Startseite
      </button>

      <h1 style={{
        fontSize: '1.7rem', fontWeight: '800', fontFamily: 'var(--font-title)',
        letterSpacing: '-0.02em', marginBottom: '1.5rem'
      }}>
        {LEGAL_TITLES[doc] || ''}
      </h1>

      <div className="glass-panel" style={{
        padding: '1.6rem 1.5rem',
        borderRadius: 'var(--radius-lg, 16px)',
        textAlign: 'left',
        fontSize: '0.9rem',
        lineHeight: '1.65',
        color: 'var(--text-secondary)'
      }}>
        <LegalContent doc={doc} />
      </div>

      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '1.5rem' }}>
        Velosia · {LEGAL_STAND}
      </p>
    </div>
  );
}
