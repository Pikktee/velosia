import React, { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';

export default function AnalysisLoader() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    "Foto wird analysiert... (und Staubkörner digital weggepustet)",
    "Klamotten-Detektiv sucht nach Marke und Details...",
    "Farben und Muster werden einer Stil-Prüfung unterzogen...",
    "Beschreibung wird verfasst (mit extra viel Verkaufs-Charme)...",
    "Preise werden auf Kleinanzeigen gescrapt... Bitte kurz Geduld!",
    "Medianpreis wird berechnet (und 'Was letzte Preis'-Anfragen ignoriert)...",
    "Das perfekte Angebot wird finalisiert... Gleich geschafft!"
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 2800); // 2.8s per step for comfortable reading

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1.5rem', textAlign: 'center' }}>
      {/* Animated Vintamie Logo */}
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 512 512" 
        fill="none" 
        style={{ width: '160px', height: '160px', marginBottom: '2rem', filter: 'drop-shadow(0 8px 24px rgba(9, 176, 183, 0.25))' }}
      >
        <defs>
          <linearGradient id="loader-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#09b0b7" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
          
          <filter id="loader-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Orbit Ring */}
        <circle cx="256" cy="256" r="210" stroke="url(#loader-grad)" strokeWidth="4" strokeDasharray="12 8" opacity="0.18" className="anim-orbit" />
        
        {/* Animated Brand Group */}
        <g filter="url(#loader-glow)" className="anim-hanger">
          {/* Hanger Hook */}
          <path d="M 256 195 V 160 C 256 130, 235 110, 256 85 C 275 60, 295 85, 275 105" stroke="url(#loader-grad)" strokeWidth="16" strokeLinecap="round" fill="none" />

          {/* Hanger Triangle */}
          <path d="M 110 220 L 256 390 L 402 220 C 412 210, 405 195, 390 195 L 122 195 C 107 195, 100 210, 110 220 Z" fill="#07090d" stroke="url(#loader-grad)" strokeWidth="16" strokeLinejoin="round" />

          {/* Camera Lens / AI Core */}
          <circle cx="256" cy="275" r="55" stroke="url(#loader-grad)" strokeWidth="12" fill="#07090d" className="anim-core" />
          <circle cx="256" cy="275" r="22" fill="url(#loader-grad)" />
          <circle cx="264" cy="267" r="6" fill="#fff" opacity="0.8" />
          
          {/* Sparkles */}
          <path d="M 400 100 c 0 12 -8 20 -20 20 c 12 0 20 8 20 20 c 0 -12 8 -20 20 -20 c -12 0 -20 -8 -20 -20 z" fill="#ec4899" className="anim-sparkle-1" />
          <path d="M 100 320 c 0 8 -5 12 -12 12 c 7 0 12 5 12 12 c 0 -7 5 -12 12 -12 c -7 0 -12 -5 -12 -12 z" fill="#09b0b7" className="anim-sparkle-2" />
        </g>
      </svg>

      <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '1.5rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
        Vintamie arbeitet
      </h3>
      
      {/* Cycling step text (dynamic height, no overflow clipping) */}
      <div style={{ minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '0 10px', overflow: 'visible' }}>
        <p
          key={activeStep}
          className="fade-in"
          style={{
            color: 'var(--text-secondary)',
            fontSize: '1rem',
            fontWeight: '500',
            lineHeight: '1.4',
            margin: 0,
            animationDuration: '0.4s',
            overflow: 'visible',
            textAlign: 'center'
          }}
        >
          {steps[activeStep]}
        </p>
      </div>
    </div>
  );
}
