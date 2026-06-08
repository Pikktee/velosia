import React, { useState } from 'react';
import { ArrowLeft, Sparkles, Check, Info } from 'lucide-react';

export default function AnalysisSpecs({ images = [], onBack, onStartAnalysis }) {
  const [condition, setCondition] = useState('Automatisch');
  const [details, setDetails] = useState('');

  const conditions = [
    { value: 'Automatisch', label: 'Automatisch (KI-Einschätzung)', desc: 'Die KI bestimmt den Zustand anhand der Fotos.' },
    { value: 'Neu', label: 'Neu', desc: 'Ungetragen mit Etikett oder OVP, ohne Gebrauchsspuren.' },
    { value: 'Sehr gut', label: 'Sehr gut', desc: 'Wenige Male getragen, minimale Gebrauchsspuren, Top-Zustand.' },
    { value: 'Gut', label: 'Gut', desc: 'Häufiger getragen, normale Gebrauchsspuren, keine großen Mängel.' },
    { value: 'Zufriedenstellend', label: 'Zufriedenstellend', desc: 'Deutliche Gebrauchsspuren, eventuell kleine Mängel (wird unten beschrieben).' }
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
          <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
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
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {conditions.map((item) => {
              const isSelected = condition === item.value;
              return (
                <div
                  key={item.value}
                  onClick={() => setCondition(item.value)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.85rem 1rem',
                    background: isSelected 
                      ? 'linear-gradient(135deg, rgba(9, 176, 183, 0.08) 0%, rgba(236, 72, 153, 0.03) 100%)' 
                      : 'rgba(25, 30, 42, 0.3)',
                    border: isSelected 
                      ? '1px solid rgba(9, 176, 183, 0.45)' 
                      : '1px solid rgba(255, 255, 255, 0.04)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: isSelected ? '0 0 15px rgba(9, 176, 183, 0.06)' : 'none',
                    transform: isSelected ? 'translateX(2px)' : 'none'
                  }}
                >
                  {/* Custom Check Circle */}
                  <div style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: isSelected ? '1px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: isSelected ? 'var(--primary)' : 'transparent',
                    color: '#000',
                    transition: 'all 0.2s ease',
                    flexShrink: 0
                  }}>
                    {isSelected && <Check size={12} strokeWidth={3} />}
                  </div>

                  <div style={{ flexGrow: 1 }}>
                    <div style={{ 
                      fontSize: '0.875rem', 
                      fontWeight: isSelected ? '600' : '500', 
                      color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}>
                      {item.label}
                      {item.value === 'Automatisch' && <Sparkles size={12} style={{ color: 'var(--primary)' }} />}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem', lineHeight: '1.3' }}>
                      {item.desc}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.725rem', padding: '0 0.25rem', lineHeight: '1.4' }}>
            <Info size={12} style={{ flexShrink: 0, marginTop: '0.1rem', color: 'var(--primary)' }} />
            <span>Diese Infos fließen direkt in die automatische Titel- und Beschreibungserstellung der KI ein.</span>
          </div>
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
