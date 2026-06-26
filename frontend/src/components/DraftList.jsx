import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tag, Sparkles, Trash2, Calendar, ShoppingBag, Camera, FolderHeart, ChevronRight, Zap, RefreshCw, AlertTriangle, Clock, Coins, ExternalLink, X } from 'lucide-react';
import { getImageUrl, getAuthToken, setListingStatus } from '../utils/api';
import { statusMeta, hasListing, listingPlatforms, groupDrafts, draftSection, crossPostConflict, listingAgeDays, STALE_DAYS } from '../utils/listingStatus';

// dd.mm for compact list signals.
const fmtShort = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};

export default function DraftList({ drafts, isLoading, onSelectDraft, onDeleteDraft, onRefreshStatuses }) {
  const [refreshing, setRefreshing] = useState(false);
  const [conflict, setConflict] = useState(null);
  const anyListing = drafts.some(hasListing);

  const handleRefresh = async () => {
    if (refreshing || !onRefreshStatuses) return;
    setRefreshing(true);
    try {
      const data = await onRefreshStatuses();
      // Surface the first cross-posting conflict (sold on one platform, still
      // live on the other) as the take-down sheet.
      const found = (data || []).map(crossPostConflict).find(Boolean);
      if (found) setConflict(found);
    } catch (err) {
      console.error('Status-Aktualisierung fehlgeschlagen:', err);
    } finally {
      setRefreshing(false);
    }
  };

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

  if (isLoading && drafts.length === 0) {
    return (
      <div className="fade-in">
        <div className="drafts-header-row">
          <h2 className="page-title">
            Deine Angebote <span className="drafts-count-badge">...</span>
          </h2>
        </div>
        <ul className="SwipeableList">
          {[1, 2, 3].map((key) => (
            <li key={key} className="draft-list-item-container-wrap">
              <div className="draft-list-item-card" style={{ cursor: 'default', pointerEvents: 'none' }}>
                <div className="draft-list-item-main">
                  <div className="draft-list-item-thumb-container skeleton-pulse" />
                  <div className="draft-list-item-details" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div className="skeleton-pulse" style={{ height: '1.2rem', width: '70%', borderRadius: '4px' }} />
                    <div className="skeleton-pulse" style={{ height: '0.8rem', width: '35%', borderRadius: '4px' }} />
                  </div>
                  <div className="draft-list-item-right">
                    <div className="skeleton-pulse" style={{ height: '1.8rem', width: '50px', borderRadius: 'var(--radius-sm)' }} />
                    <ChevronRight size={18} className="draft-list-item-arrow" style={{ opacity: 0.15 }} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

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
            <img src="/favicon.svg" alt="Velosia Logo" className="onboarding-logo-img" />
          </div>
          
          <div className="onboarding-info">
            <div className="onboarding-welcome-badge">
              <Sparkles size={14} />
              <span>Willkommen bei Velosia</span>
            </div>
            
            <h2 className="onboarding-title">Verwandle deine Sachen in bares Geld</h2>
            <p className="onboarding-subtitle">
              Velosia automatisiert das Erstellen deiner Anzeigen. Mach einfach ein Foto, um loszulegen!
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

  const groups = groupDrafts(drafts);
  const sections = [
    { key: 'draft', label: 'Entwürfe', items: groups.draft },
    { key: 'active', label: 'Aktiv', items: groups.active },
    { key: 'done', label: 'Erledigt', items: groups.done },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="fade-in">
      <div className="drafts-header-row">
        <h2 className="page-title">
          Deine Angebote <span className="drafts-count-badge">{drafts.length}</span>
        </h2>
        {anyListing && onRefreshStatuses && (
          <button
            className="status-refresh-btn icon-only"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Status aller Angebote aktualisieren"
            aria-label="Status aller Angebote aktualisieren"
          >
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
          </button>
        )}
      </div>

      {sections.map((sec) => (
        <div key={sec.key} className="draft-section">
          <div className="draft-section-head">
            <span className="draft-section-label">{sec.label}</span>
            <span className="draft-section-count">{sec.items.length}</span>
          </div>
          <ul className="SwipeableList">
            {sec.items.map((draft) => (
              <DraftListItem
                key={draft.id}
                draft={draft}
                onSelect={onSelectDraft}
                onDelete={onDeleteDraft}
              />
            ))}
          </ul>
        </div>
      ))}

      {conflict && (
        <CrossPostSheet conflict={conflict} onClose={() => setConflict(null)} />
      )}
    </div>
  );
}

function DraftListItem({ draft, onSelect, onDelete }) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  
  const itemRef = useRef(null);
  const cardRef = useRef(null);
  
  const currentRestOffset = useRef(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const hasSwiped = useRef(false);
  const isVerticalScroll = useRef(false);

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
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    setIsSwiping(true);
    hasSwiped.current = false;
    isVerticalScroll.current = false;
  };

  const handleTouchMove = (e) => {
    if (!isSwiping || isDeleting) return;
    const currentTouchX = e.touches[0].clientX;
    const currentTouchY = e.touches[0].clientY;
    const diffX = currentTouchX - startX.current;
    const diffY = currentTouchY - startY.current;

    // If vertical scroll took over, ignore horizontal swipe
    if (isVerticalScroll.current) return;

    // Lock to vertical scroll if vertical motion is dominant at start
    if (!hasSwiped.current && Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 10) {
      isVerticalScroll.current = true;
      setIsSwiping(false);
      setSwipeOffset(currentRestOffset.current);
      return;
    }

    // Prevent default browser scrolling/navigation if swiping horizontally
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 5) {
      if (e.cancelable) {
        e.preventDefault();
      }
      hasSwiped.current = true;
    }

    // Calculate new offset based on resting position
    let newOffset = currentRestOffset.current + diffX;

    // Don't allow swiping right past 0
    if (newOffset > 0) {
      newOffset = 0;
    }

    // Capping left swipe to prevent stretching over full width:
    // Max swipe is -100px. Dragging past it has tight rubber-band resistance
    if (newOffset < -100) {
      const excess = newOffset + 100;
      newOffset = -100 + excess * 0.1; // Apply high damping resistance
    }

    setSwipeOffset(newOffset);
  };

  const handleTouchEnd = () => {
    if (!isSwiping || isDeleting) return;
    setIsSwiping(false);
    
    if (isVerticalScroll.current) return;

    const threshold = -40; // Swipe 40px left to trigger snap/reveal
    const actionWidth = -80; // Snapped open resting offset (80px wide button)

    if (currentRestOffset.current === 0) {
      // Swiping left from closed state
      if (swipeOffset < threshold) {
        // Snap open
        setSwipeOffset(actionWidth);
        currentRestOffset.current = actionWidth;
      } else {
        // Snap closed
        setSwipeOffset(0);
        currentRestOffset.current = 0;
      }
    } else {
      // Swiping right from opened state
      // If they swipe back past -40px, snap closed
      if (swipeOffset > -40) {
        setSwipeOffset(0);
        currentRestOffset.current = 0;
      } else {
        // Snap open
        setSwipeOffset(actionWidth);
        currentRestOffset.current = actionWidth;
      }
    }
  };

  const handleTouchCancel = () => {
    if (isDeleting) return;
    setIsSwiping(false);
    setSwipeOffset(currentRestOffset.current);
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
    setShowConfirm(true);
  };

  const handleConfirmDelete = () => {
    setShowConfirm(false);
    triggerDelete();
  };

  const handleCancelDelete = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setShowConfirm(false);
    // Snap closed
    setSwipeOffset(0);
    currentRestOffset.current = 0;
  };

  const handleClick = (e) => {
    if (isDeleting) return;
    if (currentRestOffset.current !== 0) {
      // Card is swiped open: tap to close it
      setSwipeOffset(0);
      currentRestOffset.current = 0;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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
    >
      {/* Background delete action (red bar with stationary trash icon) */}
      <div 
        className="draft-list-item-swipe-bg"
        style={{
          left: isDeleting ? '0px' : `calc(100% - ${Math.abs(swipeOffset)}px)`,
          transition: isSwiping ? 'none' : 'left 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
        onClick={handleDeleteClick}
      >
        <div className="draft-list-item-swipe-trash">
          <Trash2 size={22} color="white" />
        </div>
      </div>

      {/* Foreground card */}
      <div 
        ref={cardRef}
        className="draft-list-item-card"
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
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
            
            {(() => {
              // Turbo is only relevant while the item is still an unlisted draft —
              // once it's live the bolt drops out (less relevant than the status).
              // Reduced to the bolt alone so the row never grows a third line.
              const section = draftSection(draft);
              const showTurbo = draft.is_turbo && section === 'draft';
              const showStatus = section !== 'draft';
              if (!showTurbo && !showStatus) return null;
              return (
                <div className="draft-list-item-meta">
                  {showTurbo && (
                    <span className="turbo-bolt" title="Im Turbo-Modus erstellt">
                      <Zap size={13} />
                    </span>
                  )}
                  {showStatus && <ListingStatusMeta draft={draft} />}
                </div>
              );
            })()}
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

      {/* Custom Confirmation Modal Portal */}
      {showConfirm && createPortal(
        <div className="confirm-modal-overlay" onClick={handleCancelDelete}>
          <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Angebot löschen?</h3>
            <p>Möchtest du dieses Angebot wirklich dauerhaft löschen?</p>
            <div className="confirm-modal-buttons">
              <button className="confirm-btn-cancel" onClick={handleCancelDelete}>Abbrechen</button>
              <button className="confirm-btn-delete" onClick={handleConfirmDelete}>Löschen</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </li>
  );
}

// Compact, wordless per-platform status for a list row: one small letter pill per
// published platform (V / K), tinted in that platform's status colour — green
// online, amber reserviert, blue verkauft, red gelöscht. So the Aktiv section
// answers "where is it live" at a glance. A cross-post conflict (sold here, still
// live there) adds an amber "Aktion" marker; plus a conditional date signal
// ("verkauft am …" / a gentle "seit X Tagen" nudge). Progressive disclosure — the
// full wording lives one level deeper in DraftDetail.
function ListingStatusMeta({ draft }) {
  const platforms = listingPlatforms(draft);
  if (platforms.length === 0) return null;
  const section = draftSection(draft);
  const conflict = crossPostConflict(draft);

  const pills = platforms.map((p) => {
    const meta = statusMeta(p.status);
    return (
      <span
        key={p.key}
        className="pp-pill"
        style={{ color: meta.color, background: meta.bg, borderColor: meta.color }}
        title={`${p.name}: ${meta.label}`}
      >
        {p.key === 'kleinanzeigen' ? 'K' : 'V'}
      </span>
    );
  });

  let signal = null;
  if (section === 'done') {
    const sold = platforms.find((p) => p.status === 'verkauft');
    if (sold && sold.at) {
      signal = (
        <span className="listing-meta-signal sold">
          <Coins size={11} />
          <span>verkauft am {fmtShort(sold.at)}</span>
        </span>
      );
    }
  } else if (section === 'active' && !conflict) {
    const age = listingAgeDays(draft);
    if (age > STALE_DAYS) {
      signal = (
        <span className="listing-meta-signal stale">
          <Clock size={11} />
          <span>seit {age} Tagen</span>
        </span>
      );
    }
  }

  return (
    <>
      <span className="pp-pills">{pills}</span>
      {conflict && (
        <span
          className="draft-list-item-badge listing-action-badge"
          title="Auf einer Plattform verkauft, auf der anderen noch online"
        >
          <AlertTriangle size={11} />
          <span>Aktion</span>
        </span>
      )}
      {signal}
    </>
  );
}

// The cross-platform sell-sync sheet: appears after a refresh detects a sale on
// one platform while the item is still live on the other. The take-down is
// semi-manual — we open the still-live ad (native bridge if present, else a new
// tab) and the user confirms the deletion himself. Never a headless delete.
function CrossPostSheet({ conflict, onClose }) {
  const { draft, sold, live } = conflict;

  const handleDelete = () => {
    if (typeof window !== 'undefined'
        && window.VelosiaBridge
        && typeof window.VelosiaBridge.deleteOnPlatform === 'function') {
      window.VelosiaBridge.deleteOnPlatform(draft.id, live.key, live.url || '', getAuthToken());
    } else if (live.url) {
      window.open(live.url, '_blank', 'noopener');
    }
    onClose();
  };

  return createPortal(
    <div className="sync-sheet-overlay" onClick={onClose}>
      <div className="sync-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sync-sheet-x" onClick={onClose} aria-label="Schließen"><X size={18} /></button>
        <div className="sync-sheet-handle" />
        <div className="sync-sheet-head">
          <div className="sync-sheet-icon"><Coins size={22} /></div>
          <div>
            <h3>Auf {sold.name} verkauft</h3>
            <p>{draft.title || 'Angebot'}{draft.price != null ? ` · ${Math.round(draft.price)} €` : ''}</p>
          </div>
        </div>
        <div className="sync-sheet-warn">
          <AlertTriangle size={17} />
          <p>Der Artikel ist auf <strong>{live.name} noch online</strong>. Nimm ihn dort runter, damit du ihn nicht zweimal verkaufst.</p>
        </div>
        <button className="btn btn-primary sync-sheet-btn" onClick={handleDelete}>
          <Trash2 size={16} /> Auf {live.name} öffnen &amp; löschen
        </button>
        <button className="btn sync-sheet-keep" onClick={onClose}>
          Behalten — ich mach&apos;s selbst
        </button>
        <p className="sync-sheet-note">
          Du bestätigst das Löschen selbst auf {live.name}. Danach aktualisiert sich der Status beim nächsten Abruf.
        </p>
      </div>
    </div>,
    document.body
  );
}
