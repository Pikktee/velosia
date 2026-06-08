import React, { useState } from 'react';
import { ArrowLeft, Sparkles, Info } from 'lucide-react';

export default function AnalysisSpecs({ images = [], onBack, onStartAnalysis }) {
  const [condition, setCondition] = useState('Automatisch');
  const [details, setDetails] = useState('');

  const conditions = [
    { value: 'Automatisch', label: 'Automatisch (KI-Einschätzung)', desc: 'Die KI bestimmt den Zustand anhand der Fotos.' },
    { value: 'Neu', label: 'Neu', desc: 'Ungetragen mit Etikett oder OVP, ohne Gebrauchsspuren.' },
    { value: 'Sehr gut', label: 'Sehr gut', desc: 'Wenige Male getragen, minimale Gebrauchsspuren, Top-Zustand.' },
    { value: 'Gut', label: 'Gut', desc: 'Häufiger getragen, normale Gebrauchsspuren, keine großen Mängel.' },
    { value: 'In Ordnung', label: 'In Ordnung', desc: 'Deutliche Gebrauchsspuren, eventuell kleine Mängel (wird unten beschrieben).' }
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    onStartAnalysis(condition, details);
  };

  return (
    <div className="fade-in" style={{ width: '100%', maxWidth: '480px', margin: '0 auto', position: 'relative' }}>
      {/* Background Ambient Glows */}
      <div className="loader-ambient-glow-1" style={{ top: '-10%', left: '-20%' }} />
      <div className="loader-ambient-glow-2" style={{ bottom: '10%', right: '-20%' }} />

      {/* Header Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button
          onClick={onBack}
          className="btn btn-secondary"
          style={{
            minHeight: 'auto',
            width: '40px',
            height: '40px',
            padding: 0,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            color: 'var(--text-secondary)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title="Zurück zur Kamera"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="page-title">
            Angaben verfeinern
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.825rem', margin: '0.15rem 0 0 0' }}>
            Ergebnisse durch zusätzliche Details optimieren
          </p>
        </div>
      </div>

      {/* Image Preview Row */}
      <div style={{
        display: 'flex',
        gap: '0.65rem',
        overflowX: 'auto',
        padding: '0.5rem 0.25rem 1rem 0.25rem',
        marginBottom: '1rem',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none'
      }}>
        {images.map((img) => (
          <div
            key={img.id}
            style={{
              width: '64px',
              height: '64px',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              flexShrink: 0,
              border: '1.5px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
            }}
          >
            <img src={img.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Condition Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <label style={{ 
            fontSize: '0.85rem', 
            fontWeight: '700', 
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Zustand des Artikels
          </label>
          
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            style={{
              width: '100%',
              padding: '0.85rem 1rem',
              background: 'rgba(25, 30, 42, 0.35)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
              outline: 'none',
              cursor: 'pointer',
              boxSizing: 'border-box',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238892b0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 1rem center',
              backgroundSize: '1.2em',
              paddingRight: '2.5rem',
              transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'rgba(9, 176, 183, 0.4)';
              e.target.style.boxShadow = '0 0 10px rgba(9, 176, 183, 0.1)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.05)';
              e.target.style.boxShadow = 'none';
            }}
          >
            {conditions.map((item) => (
              <option 
                key={item.value} 
                value={item.value} 
                style={{ 
                  background: '#141924', 
                  color: 'var(--text-primary)' 
                }}
              >
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {/* Custom Details Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ 
            fontSize: '0.85rem', 
            fontWeight: '700', 
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}>
            Optionale Zusatzinfos
          </label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="z. B. 100% Kaschmir, Fällt etwas kleiner aus, kleiner Fleck am Ärmel (siehe Foto), OVP ist vorhanden..."
            maxLength={500}
            style={{
              width: '100%',
              minHeight: '100px',
              padding: '0.85rem 1rem',
              background: 'rgba(25, 30, 42, 0.35)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
              lineHeight: '1.5',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
              resize: 'vertical',
              outline: 'none',
              transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'rgba(9, 176, 183, 0.4)';
              e.target.style.boxShadow = '0 0 10px rgba(9, 176, 183, 0.1)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.05)';
              e.target.style.boxShadow = 'none';
            }}
          />

        </div>

        {/* Action Button */}
        <button
          type="submit"
          className="btn btn-primary"
          style={{
            marginTop: '0.5rem',
            padding: '0.85rem 1.5rem',
            borderRadius: '99px',
            fontSize: '0.9rem',
            fontWeight: '700',
            background: 'linear-gradient(135deg, var(--secondary) 0%, #d53f8c 100%)',
            color: '#fff',
            border: 'none',
            boxShadow: '0 4px 15px var(--secondary-glow)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            minHeight: '46px',
            width: '100%',
            transition: 'transform 0.2s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <Sparkles size={16} />
          <span>KI-Analyse starten</span>
        </button>
      </form>
    </div>
  );
}
