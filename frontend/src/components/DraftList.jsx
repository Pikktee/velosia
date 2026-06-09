import React, { useRef, useEffect, useState } from 'react';
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
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const itemRef = useRef(null);
  const cardRef = useRef(null);
  const hasSwiped = useRef(false);

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString('de-DE', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric'
    });
  };

  const handleTouchStart = (e) => {
    if (isDeleting) return;
    setStartX(e.touches[0].clientX);
    setStartY(e.touches[0].clientY);
    setSwipeOffset(0);
    setIsSwiping(true);
    hasSwiped.current = false;
  };

  const handleTouchMove = (e) => {
    if (!isSwiping || isDeleting) return;
    const currentTouchX = e.touches[0].clientX;
    const currentTouchY = e.touches[0].clientY;
    const diffX = currentTouchX - startX;
    const diffY = currentTouchY - startY;

    // Lock to vertical scroll if vertical motion is dominant
    if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 10) {
      setIsSwiping(false);
      setSwipeOffset(0);
      return;
    }

    // Prevent default browser scrolling/navigation if swiping horizontally
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 5) {
      if (e.cancelable) {
        e.preventDefault();
      }
    }

    if (Math.abs(diffX) > 10) {
      hasSwiped.current = true;
    }

    // Only allow swiping to the left (negative offset)
    if (diffX < 0) {
      setSwipeOffset(diffX);
    } else {
      setSwipeOffset(0);
    }
  };

  const handleTouchEnd = () => {
    if (!isSwiping || isDeleting) return;
    setIsSwiping(false);
    
    const threshold = -80; // Swipe 80px left to trigger deletion
    if (swipeOffset < threshold) {
      triggerDelete();
    } else {
      setSwipeOffset(0);
    }
  };

  const handleTouchCancel = () => {
    if (isDeleting) return;
    setIsSwiping(false);
    setSwipeOffset(0);
  };

  const triggerDelete = () => {
    setIsDeleting(true);
    const card = cardRef.current;
    const item = itemRef.current;
    if (card && item) {
      const rect = card.getBoundingClientRect();
      
      const cardAnim = card.animate([
        { transform: `translateX(${swipeOffset}px)` },
        { transform: `translateX(-100%)` }
      ], { duration: 200, easing: 'ease-out', fill: 'forwards' });

      cardAnim.onfinish = () => {
        const itemAnim = item.animate([
          { height: `${rect.height}px`, opacity: 1, marginBottom: '0.65rem' },
          { height: '0px', opacity: 0, marginBottom: '0px', marginTop: '0px', paddingBlock: '0px' }
        ], { duration: 200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });

        itemAnim.onfinish = () => {
          onDelete(draft.id);
        };
      };
    } else {
      onDelete(draft.id);
    }
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    if (confirm('Möchtest du dieses Angebot wirklich löschen?')) {
      triggerDelete();
    }
  };

  const handleClick = (e) => {
    if (isDeleting) return;
    if (hasSwiped.current) {
      e.preventDefault();
      e.stopPropagation();
      hasSwiped.current = false;
      return;
    }
    onSelect(draft);
  };

  return (
    <li 
      ref={itemRef}
      className="draft-list-item-container-wrap"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Background delete action (red bar with stationary trash icon) */}
      <div className="draft-list-item-swipe-bg">
        <div className="draft-list-item-swipe-trash">
          <Trash2 size={22} color="white" />
        </div>
      </div>

      {/* Foreground card */}
      <div 
        ref={cardRef}
        className="draft-list-item-card"
        onClick={handleClick}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isSwiping ? 'none' : 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
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
      </div>
    </li>
  );
}
