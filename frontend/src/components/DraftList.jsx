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
      <div className="fade-in glass-panel onboarding-container">
        <div className="onboarding-welcome-badge">
          <Sparkles size={14} />
          <span>Willkommen bei Vintamie</span>
        </div>
        
        <h2 className="onboarding-title">Verwandle Kleidung in bares Geld</h2>
        <p className="onboarding-subtitle">
          Vintamie automatisiert das Erstellen deiner Anzeigen mit künstlicher Intelligenz. In nur drei einfachen Schritten zum fertigen Inserat:
        </p>

        <div className="onboarding-grid">
          <div className="onboarding-card">
            <div className="onboarding-icon-wrapper">
              <Camera size={24} />
            </div>
            <h3 className="onboarding-card-title">1. Foto knipsen</h3>
            <p className="onboarding-card-desc">
              Fotografiere deinen Artikel direkt mit der App oder lade ein Bild aus deiner Galerie.
            </p>
          </div>

          <div className="onboarding-card">
            <div className="onboarding-icon-wrapper">
              <Sparkles size={24} />
            </div>
            <h3 className="onboarding-card-title">2. Vision AI Analyse</h3>
            <p className="onboarding-card-desc">
              Unsere KI erkennt Marke, Zustand, Farbe und schlägt den besten Verkaufspreis vor.
            </p>
          </div>

          <div className="onboarding-card">
            <div className="onboarding-icon-wrapper">
              <FolderHeart size={24} />
            </div>
            <h3 className="onboarding-card-title">3. Blitzschnell online</h3>
            <p className="onboarding-card-desc">
              Exportiere deinen fertigen Entwurf direkt zu Vinted oder Kleinanzeigen.
            </p>
          </div>
        </div>

        <div className="onboarding-footer">
          <p className="onboarding-cta-text">
            Tippe unten auf das Kamerasymbol, um deinen ersten Entwurf zu erstellen!
          </p>
          
          <div className="onboarding-arrow-container">
            <svg className="onboarding-arrow-svg" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M 50,5 C 80,10 80,55 50,85"
                stroke="var(--primary)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="onboarding-arrow-path"
              />
              <polygon
                points="50,85 43,74 57,74"
                fill="var(--primary)"
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
            className="glass-panel glass-card draft-card"
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
