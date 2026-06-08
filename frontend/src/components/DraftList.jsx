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
        <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-title)', fontWeight: 700, margin: 0 }}>
          Deine Angebote <span className="drafts-count-badge">{drafts.length}</span>
        </h2>
        <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span>Wische zum Löschen</span>
        </span>
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
  const itemRef = useRef(null);
  const trackRef = useRef(null);
  const contentRef = useRef(null);
  const deletingRef = useRef(false);

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString('de-DE', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric'
    });
  };

  useEffect(() => {
    const item = itemRef.current;
    const track = trackRef.current;
    const content = contentRef.current;
    if (!item || !track || !content) return;

    // Feature detect scroll-initial-target
    const needsScrollWorkaround = !CSS.supports('scroll-initial-target', 'nearest');

    // Upgrade row into swipeable mode
    item.classList.add('is-initialized');

    if (needsScrollWorkaround) {
      track.scrollLeft = 0;
    }

    const activateThreshold = 0.8;
    const commitThreshold = 0.2;

    const observer = new IntersectionObserver((entries) => {
      if (deletingRef.current) return;
      const entry = entries.at(-1);
      const ratio = entry.intersectionRatio;
      const offset = entry.boundingClientRect.x - entry.rootBounds.x;

      // Ensure we swiped left (revealing the right-side trash spacer)
      if (ratio < commitThreshold && offset < -20) {
        deletingRef.current = true;
        removeItem(item, content, 'right', entry);
        return;
      }

      const isActivating = ratio < activateThreshold && offset < 0;
      item.classList.toggle('is-activating', isActivating);

      if (offset !== 0) {
        item.dataset.swipeDirection = offset > 0 ? 'left' : 'right';
      }
    }, {
      root: track,
      threshold: [commitThreshold, activateThreshold],
    });

    observer.observe(content);

    let resizeObserver = null;
    if (needsScrollWorkaround) {
      resizeObserver = new ResizeObserver(() => {
        if (!deletingRef.current) {
          track.scrollLeft = 0;
        }
      });
      resizeObserver.observe(track);
    }

    return () => {
      observer.disconnect();
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  async function removeItem(item, content, direction, entry) {
    const opts = { duration: 250, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' };
    const rect = entry.boundingClientRect;
    const offset = rect.x - entry.rootBounds.x;
    const translate = -(rect.width + offset);

    item.classList.add('is-removing');
    
    // Animate height collapse and content slide-off
    const itemAnim = item.animate([
      { height: `${rect.height}px`, opacity: 1 }, 
      { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingBlock: '0px' }
    ], opts);
    const contentAnim = content.animate([{ translate: `${translate}px` }], opts);

    try {
      await Promise.allSettled([itemAnim.finished, contentAnim.finished]);
      await onDelete(draft.id);
    } catch (err) {
      console.error("Failed to delete draft:", err);
      // Restore state on error
      item.classList.remove('is-removing');
      deletingRef.current = false;
      
      const restoreOpts = { duration: 200, easing: 'ease-out' };
      item.animate([
        { height: '0px', opacity: 0 }, 
        { height: `${rect.height}px`, opacity: 1 }
      ], restoreOpts);
      content.animate([
        { translate: `${translate}px` }, 
        { translate: '0px' }
      ], restoreOpts);
      
      if (trackRef.current) {
        trackRef.current.scrollLeft = 0;
      }
    }
  }

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    if (confirm('Möchtest du dieses Angebot wirklich löschen?')) {
      const item = itemRef.current;
      const content = contentRef.current;
      if (item && content) {
        deletingRef.current = true;
        const rect = content.getBoundingClientRect();
        removeItem(item, content, 'right', { 
          boundingClientRect: rect, 
          rootBounds: { x: rect.x } 
        });
      } else {
        onDelete(draft.id);
      }
    }
  };

  return (
    <li ref={itemRef} className="SwipeableList-item">
      {/* Red Delete Background & Stationary Trash Icon */}
      <div className="SwipeableList-action-icon right-action">
        <Trash2 size={22} color="white" />
      </div>

      <div ref={trackRef} className="SwipeableList-track">
        <div 
          ref={contentRef} 
          className="SwipeableList-content draft-list-item-content"
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
              <h3 className="draft-list-item-title">
                {draft.title || 'Unbenanntes Angebot'}
              </h3>
              
              <div className="draft-list-item-meta">
                <span className="draft-list-item-badge category-badge">
                  {draft.category}
                </span>
                <span className="draft-list-item-badge condition-badge">
                  {draft.condition}
                </span>
                <span className="draft-list-item-date">
                  <Calendar size={11} />
                  <span>{formatDate(draft.created_at)}</span>
                </span>
              </div>
            </div>

            {/* Right Section: Price & Actions */}
            <div className="draft-list-item-right">
              <div className="draft-list-item-price-container">
                <span className="draft-list-item-price">{Math.round(draft.price)} €</span>
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
        
        {/* Red Spacer Grid Item */}
        <div className="SwipeableList-spacer" />
      </div>
    </li>
  );
}
