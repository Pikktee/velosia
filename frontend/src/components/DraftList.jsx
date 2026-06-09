import React, { useRef, useEffect } from 'react';
import { Tag, Sparkles, Trash2, Calendar, ShoppingBag, Camera, FolderHeart, ChevronRight } from 'lucide-react';
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
            {/* Solid shaft line */}
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
              Vintamie automatisiert das Erstellen deiner Anzeigen. Mach einfach ein Foto, um loszulegen!
            </p>
            
            <p className="onboarding-cta-text landscape-cta">
              Tippe links auf das Kamerasymbol, um dein erstes Angebot zu erstellen!
            </p>
          </div>
        </div>

        {/* Portrait Footer (CTA + Arrow pointing down, visible only in portrait) */}
        <div className="onboarding-footer portrait-footer">
          <p className="onboarding-cta-text portrait-cta">
            Tippe unten auf das Kamerasymbol, um dein erstes Angebot zu erstellen!
          </p>
          
          <div className="onboarding-arrow-container">
            <svg className="onboarding-arrow-svg" viewBox="0 0 24 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Solid shaft line */}
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
      <div className="drafts-header-row">
        <h2 className="page-title">
          Deine Angebote <span className="drafts-count-badge">{drafts.length}</span>
        </h2>
      </div>

      <ul className="SwipeableList">
        {drafts.map((draft) => (
          <DraftListItem 
            key={draft.id}
            draft={draft}
            onSelect={onSelectDraft}
            onDelete={onDeleteDraft}
          />
        ))}
      </ul>
    </div>
  );
}

function DraftListItem({ draft, onSelect, onDelete }) {
  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString('de-DE', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric'
    });
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    if (confirm('Möchtest du dieses Angebot wirklich löschen?')) {
      onDelete(draft.id);
    }
  };

  return (
    <li 
      className="draft-list-item-card"
      onClick={() => onSelect(draft)}
    >
      <div className="draft-list-item-main">
        {/* Small Thumbnail */}
        <div className="draft-list-item-thumb-container">
          <img 
            src={getImageUrl(draft.image_path)} 
            alt={draft.title}
            className="draft-list-item-thumb"
          />
        </div>

        {/* Middle Section: Text details */}
        <div className="draft-list-item-details">
          <h3 className="draft-list-item-title" title={draft.title}>
            {draft.title || 'Unbenanntes Angebot'}
          </h3>
          
          <div className="draft-list-item-meta">
            {draft.category && (
              <span className="draft-list-item-badge category-badge">
                {draft.category}
              </span>
            )}
            <span className="draft-list-item-date">
              <Calendar size={11} />
              <span>{formatDate(draft.created_at)}</span>
            </span>
          </div>
        </div>

        {/* Right Section: Price & Actions */}
        <div className="draft-list-item-right">
          <div className="draft-list-item-price-container">
            <span className="draft-list-item-price">
              {draft.price !== null && draft.price !== undefined ? `${Math.round(draft.price)} €` : '-- €'}
            </span>
          </div>
          <button 
            className="draft-list-item-delete-btn"
            onClick={handleDeleteClick}
            title="Löschen"
          >
            <Trash2 size={16} />
          </button>
          <ChevronRight size={18} className="draft-list-item-arrow" />
        </div>
      </div>
    </li>
  );
}
