import React, { useState, useEffect } from 'react';
import { Check, Loader2 } from 'lucide-react';

export default function AnalysisLoader({ isFinished = false, onComplete = () => {}, onCancel }) {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    "Fotos werden per Vision-AI analysiert...",
    "Vergleichspreise werden live gescrapt...",
    "Angebot wird finalisiert..."
  ];

  useEffect(() => {
    if (!isFinished) {
      const interval = setInterval(() => {
        setActiveStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
      }, 3000); // Slower pacing for fewer steps
      return () => clearInterval(interval);
    } else {
      if (activeStep < steps.length) {
        const interval = setInterval(() => {
          setActiveStep((prev) => {
            if (prev < steps.length) {
              return prev + 1;
            }
            clearInterval(interval);
            return prev;
          });
        }, 250); // Fast-forward speed for satisfying checklist complete
        return () => clearInterval(interval);
      } else {
        const timeout = setTimeout(() => {
          onComplete();
        }, 600); // Satisfying pause on all-completed
        return () => clearTimeout(timeout);
      }
    }
  }, [isFinished, activeStep, steps.length, onComplete]);

  const progressPercentage = Math.min(100, ((activeStep + 0.5) / steps.length) * 100);

  return (
    <div className="loader-wrapper fade-in" style={{ width: '100%' }}>
      {/* Background Ambient Glows */}
      <div className="loader-ambient-glow-1" />
      <div className="loader-ambient-glow-2" />

      {/* Animated Vintamie Logo */}
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 512 512" 
        fill="none" 
        style={{ width: '120px', height: '120px', marginBottom: '1.25rem', filter: 'drop-shadow(0 8px 24px rgba(9, 176, 183, 0.25))' }}
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

      <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
        Vintamie arbeitet...
      </h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem', marginBottom: 0 }}>
        Dein Angebot wird in Echtzeit analysiert und erstellt.
      </p>

      {/* Stepper Container */}
      <div className="stepper-container">
        {steps.map((step, idx) => {
          let statusClass = "pending";
          let icon = null;

          if (idx < activeStep) {
            statusClass = "completed";
            icon = <Check size={11} strokeWidth={3} />;
          } else if (idx === activeStep) {
            statusClass = "active";
            icon = <Loader2 className="animate-spin" size={11} strokeWidth={2.5} />;
          } else {
            statusClass = "pending";
            icon = <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'currentColor' }} />;
          }

          return (
            <div key={idx} className={`stepper-item ${statusClass}`}>
              <div className="stepper-icon-wrapper">
                {icon}
              </div>
              <span className="stepper-text">{step}</span>
            </div>
          );
        })}

        {/* Stepper Progress Bar */}
        <div className="stepper-progress-bar">
          <div 
            className="stepper-progress-fill" 
            style={{ width: `${progressPercentage}%` }} 
          />
        </div>
      </div>

      {/* Abbrechen Button */}
      {onCancel && !isFinished && (
        <button
          onClick={onCancel}
          className="btn btn-secondary"
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem 1.5rem',
            borderRadius: '99px',
            fontSize: '0.85rem',
            fontWeight: '600',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            minHeight: '38px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)';
            e.currentTarget.style.color = '#f87171';
            e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
          }}
        >
          Analyse abbrechen
        </button>
      )}
    </div>
  );
}
