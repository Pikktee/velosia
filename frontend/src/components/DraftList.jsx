import React from 'react';
import { Tag, Sparkles, Trash2, Calendar, ShoppingBag, Camera, FolderHeart } from 'lucide-react';
import { getImageUrl } from '../utils/api';

export default function DraftList({ drafts, onSelectDraft, onDeleteDraft }) {
  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString('de-DE', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (drafts.length === 0) {
    return (
      <div className="fade-in onboarding-wrapper">
        {/* Landscape Arrow (points left, visible only in landscape) */}
        <div className="onboarding-arrow-landscape">
          <svg className="onboarding-arrow-svg-left" viewBox="0 0 40 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Solid background shaft line */}
            <path
              d="M40,12 L2,12"
              stroke="var(--primary)"
              strokeWidth="3"
              opacity="0.3"
              strokeLinecap="round"
            />
            {/* Animated dashed overlay shaft line */}
            <path
              d="M40,12 L2,12"
              stroke="var(--primary)"
              strokeWidth="3"
              strokeLinecap="round"
              className="onboarding-arrow-path-left"
            />
            {/* Arrowhead */}
            <path
              d="M9,5 L2,12 L9,19"
              stroke="var(--primary)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="onboarding-content-layout">
          <div className="onboarding-logo-glow">
            <img src="/favicon.svg" alt="Vintamie Logo" className="onboarding-logo-img" />
          </div>
          
          <div className="onboarding-info">
            <div className="onboarding-welcome-badge">
              <Sparkles size={14} />
              <span>Willkommen bei Vintamie</span>
            </div>
            
            <h2 className="onboarding-title">Verwandle deine Sachen in bares Geld</h2>
            <p className="onboarding-subtitle">
              Vintamie automatisiert das Erstellen deiner Anzeigen mit künstlicher Intelligenz. Mach einfach ein Foto, um loszulegen!
            </p>
            
            <p className="onboarding-cta-text landscape-cta">
              Tippe links auf das Kamerasymbol, um deinen ersten Entwurf zu erstellen!
            </p>
          </div>
        </div>

        {/* Portrait Footer (CTA + Arrow pointing down, visible only in portrait) */}
        <div className="onboarding-footer portrait-footer">
          <p className="onboarding-cta-text portrait-cta">
            Tippe unten auf das Kamerasymbol, um deinen ersten Entwurf zu erstellen!
          </p>
          
          <div className="onboarding-arrow-container">
            <svg className="onboarding-arrow-svg" viewBox="0 0 24 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Solid background shaft line */}
              <path
                d="M12,2 L12,38"
                stroke="var(--primary)"
                strokeWidth="3"
                opacity="0.3"
                strokeLinecap="round"
              />
              {/* Animated dashed overlay shaft line */}
              <path
                d="M12,2 L12,38"
                stroke="var(--primary)"
                strokeWidth="3"
                strokeLinecap="round"
                className="onboarding-arrow-path"
              />
              {/* Arrowhead */}
              <path
                d="M5,31 L12,38 L19,31"
                stroke="var(--primary)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', fontFamily: 'var(--font-title)' }}>
        Deine Entwürfe ({drafts.length})
      </h2>
      
      <div className="drafts-grid">
        {drafts.map((draft) => (
          <div 
            key={draft.id} 
            className="draft-item-card"
            onClick={() => onSelectDraft(draft)}
          >
            {/* Image Thumbnail */}
            <div className="draft-card-thumbnail">
              <img 
                src={getImageUrl(draft.image_path)} 
                alt={draft.title}
                className="draft-card-img"
              />
              
              {/* Price Tag Overlay */}
              <div className="draft-card-price">
                {Math.round(draft.price)} €
              </div>
            </div>

            {/* Content Details */}
            <div className="draft-card-content">
              <h3 className="draft-card-title">
                {draft.title || 'Unbenannter Entwurf'}
              </h3>
              
              {/* Badges */}
              <div className="draft-card-badges">
                <span className="draft-card-badge draft-card-badge-secondary">
                  <Tag size={10} />
                  {draft.category}
                </span>
                
                <span className="draft-card-badge draft-card-badge-primary">
                  <Sparkles size={10} />
                  {draft.condition}
                </span>
              </div>

              {/* Footer row */}
              <div className="draft-card-footer">
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Calendar size={12} />
                  {formatDate(draft.created_at)}
                </span>
                
                {/* Delete button (stop propagation to prevent selecting the card) */}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Möchtest du diesen Entwurf wirklich löschen?')) {
                      onDeleteDraft(draft.id);
                    }
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '0.25rem',
                    transition: 'color 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.target.style.color = 'var(--danger)'}
                  onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
                  title="Löschen"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
