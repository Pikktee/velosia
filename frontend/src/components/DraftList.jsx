import React from 'react';
import { Tag, Sparkles, Trash2, Calendar, ShoppingBag } from 'lucide-react';
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
      <div className="fade-in glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.02)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', border: '1px solid var(--glass-border)' }}>
          <ShoppingBag size={28} style={{ color: 'var(--text-muted)' }} />
        </div>
        <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Keine Entwürfe vorhanden</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '320px', margin: '0 auto' }}>
          Fotografiere ein Kleidungsstück oder einen Gegenstand, um deinen ersten Entwurf zu erstellen.
        </p>
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
