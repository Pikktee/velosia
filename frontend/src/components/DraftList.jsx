import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Trash2, ChevronRight, RefreshCw, AlertTriangle, Clock, Coins, X, Check } from 'lucide-react';
import { getThumbUrl } from '../utils/api';
import { statusMeta, hasListing, listingPlatforms, draftSection, crossPostConflict, listingAgeDays, STALE_DAYS, platformDeleteUrl } from '../utils/listingStatus';

// dd.mm for compact list signals.
const fmtShort = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};

// Skeleton rows: title widths vary so the placeholder doesn't read as a grid of
// identical bars; later rows fade (--sk-fade) so the list trails off.
const SKELETON_ROWS = [
  { title: '78%', second: '46%', meta: true },
  { title: '64%', second: null, meta: false },
  { title: '85%', second: '38%', meta: true },
  { title: '58%', second: null, meta: false },
  { title: '72%', second: '52%', meta: false },
  { title: '66%', second: null, meta: true },
];

export default function DraftList({ drafts, isLoading, loadError = false, onRetry, onSelectDraft, onDeleteDraft, onBulkDelete, onRefreshStatuses, flashIds = [] }) {
  const [refreshing, setRefreshing] = useState(false);
  // Multi-select: a long press on a row starts it, taps then toggle rows.
  const [picked, setSelected] = useState(() => new Set());
  // Rows that vanished (deleted elsewhere, list reloaded) drop out of the selection.
  const selected = React.useMemo(() => {
    const ids = new Set(drafts.map((d) => d.id));
    return new Set([...picked].filter((id) => ids.has(id)));
  }, [picked, drafts]);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  const selecting = selected.size > 0;

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  // Android back leaves selection mode first (App's onAndroidBack asks here).
  useEffect(() => {
    if (!selecting) return undefined;
    window.__velosiaListBack = () => { clearSelection(); return true; };
    return () => { delete window.__velosiaListBack; };
  }, [selecting]);

  const selectedLive = drafts.filter((d) => selected.has(d.id) && draftSection(d) === 'active').length;

  const handleBulkDelete = async () => {
    if (bulkDeleting || !onBulkDelete) return;
    setBulkDeleting(true);
    setBulkError(null);
    try {
      await onBulkDelete([...selected]);
      setConfirmBulk(false);
      clearSelection();
    } catch (err) {
      console.error(err);
      setBulkError('Löschen fehlgeschlagen. Bitte prüfe deine Verbindung und versuch es nochmal.');
    } finally {
      setBulkDeleting(false);
    }
  };
  const [conflict, setConflict] = useState(null);
  const [pullY, setPullY] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const pullStartY = useRef(0);

  const handlePtrStart = (e) => {
    if (selecting) return;
    if (window.scrollY === 0) {
      pullStartY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  };

  const handlePtrMove = (e) => {
    if (!isPulling) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - pullStartY.current;
    if (diff > 0) {
      const pullDist = Math.min(100, Math.pow(diff, 0.85));
      setPullY(pullDist);
      if (diff > 10 && e.cancelable) {
        e.preventDefault();
      }
    }
  };

  const handlePtrEnd = () => {
    if (!isPulling) return;
    setIsPulling(false);
    if (pullY >= 60) {
      handleRefresh();
    }
    setPullY(0);
  };
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


  if (isLoading && drafts.length === 0) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
        <div className="app-sticky-header">
          <div className="app-header-inner">
            <div className="app-header-bar">
              <h2 className="app-header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Deine Angebote <span className="sk-block" style={{ width: '30px', height: '1.3rem', borderRadius: '99px' }} aria-hidden="true" />
              </h2>
            </div>
          </div>
        </div>
        <div className="app-content-container" style={{ paddingBottom: 'calc(85px + env(safe-area-inset-bottom, 0px))' }} aria-busy="true" aria-label="Angebote werden geladen">
          <ul className="sk-list">
            {SKELETON_ROWS.map((row, i) => (
              <li
                key={i}
                className="sk-row"
                style={{ animationDelay: `${i * 70}ms`, '--sk-fade': Math.max(0.35, 1 - i * 0.13) }}
              >
                <div className="sk-block sk-thumb" />
                <div className="sk-lines">
                  <div className="sk-block sk-line title" style={{ width: row.title }} />
                  {row.second && <div className="sk-block sk-line" style={{ width: row.second }} />}
                  {row.meta && <div className="sk-block sk-line meta" />}
                </div>
                <div className="sk-block sk-price" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // A failed load must NOT masquerade as "no drafts yet" — a returning user with a
  // full list would otherwise see the new-user onboarding screen when merely offline.
  if (loadError && drafts.length === 0) {
    return (
      <div className="fade-in onboarding-wrapper">
        <div className="onboarding-content-layout">
          <div className="onboarding-info" style={{ textAlign: 'center' }}>
            <AlertTriangle size={40} style={{ color: 'var(--primary)', marginBottom: 16 }} />
            <h2 className="onboarding-title">Angebote konnten nicht geladen werden</h2>
            <p className="onboarding-subtitle">
              Bitte prüfe deine Internetverbindung. Deine Angebote sind sicher gespeichert.
            </p>
            {onRetry && (
              <button className="btn-primary" style={{ marginTop: 20 }} onClick={onRetry}>
                <RefreshCw size={16} /> Erneut versuchen
              </button>
            )}
          </div>
        </div>
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

  return (
    <div 
      className="fade-in ptr-container"
      onTouchStart={handlePtrStart}
      onTouchMove={handlePtrMove}
      onTouchEnd={handlePtrEnd}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}
    >
      <div 
        className={`ptr-indicator${pullY > 0 ? ' visible' : ''}${refreshing ? ' refreshing' : ''}`}
        style={
          refreshing 
            ? { transform: 'translateX(-50%) translateY(50px)', opacity: 1, zIndex: 110 } 
            : pullY > 0 
              ? { transform: `translateX(-50%) translateY(${pullY}px)`, zIndex: 110 } 
              : { zIndex: 110 }
        }
      >
        <RefreshCw size={16} />
      </div>

      <div className={`app-sticky-header${selecting ? ' is-selecting' : ''}`}>
        <div className="app-header-inner">
          {selecting ? (
          <div className="app-header-bar select-bar" role="toolbar" aria-label="Auswahl">
            <button className="select-bar-icon" onClick={clearSelection} aria-label="Auswahl beenden" title="Auswahl beenden">
              <X size={22} strokeWidth={2} />
            </button>
            <span className="select-bar-count" aria-live="polite">
              <span key={selected.size} className="select-bar-num">{selected.size}</span> ausgewählt
            </span>
            <button
              className="select-bar-icon danger"
              onClick={() => { setBulkError(null); setConfirmBulk(true); }}
              aria-label={`${selected.size} ${selected.size === 1 ? 'Angebot' : 'Angebote'} löschen`}
              title="Löschen"
            >
              <Trash2 size={21} strokeWidth={2} />
            </button>
          </div>
          ) : (
          <div className="app-header-bar" style={{ justifyContent: 'space-between' }}>
            <h2 className="app-header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Deine Angebote 
              <span className="drafts-count-badge" style={{ fontSize: '0.85rem', padding: '0.15rem 0.5rem', borderRadius: '99px', background: 'rgba(255,255,255,0.08)' }}>
                {drafts.length}
              </span>
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
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
          </div>
          )}
        </div>
      </div>

      <div className="app-content-container" style={{ paddingBottom: 'calc(85px + env(safe-area-inset-bottom, 0px))' }}>
        <ul className="SwipeableList">
          {drafts.map((draft) => (
            <DraftListItem
              key={draft.id}
              draft={draft}
              onSelect={onSelectDraft}
              onDelete={onDeleteDraft}
              flash={flashIds.includes(draft.id)}
              selecting={selecting}
              selected={selected.has(draft.id)}
              onToggleSelect={onBulkDelete ? toggleSelected : null}
            />
          ))}
        </ul>
      </div>

      {conflict && (
        <CrossPostSheet conflict={conflict} onClose={() => setConflict(null)} />
      )}

      {confirmBulk && createPortal(
        <div className="confirm-modal-overlay" onClick={() => !bulkDeleting && setConfirmBulk(false)}>
          <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{selected.size === 1 ? 'Angebot löschen?' : `${selected.size} Angebote löschen?`}</h3>
            <p>
              {selected.size === 1 ? 'Das Angebot wird' : 'Die Angebote werden'} mit allen Fotos dauerhaft aus Velosia gelöscht.
            </p>
            {selectedLive > 0 && (
              <p className="confirm-modal-note">
                {selectedLive === 1 ? '1 davon ist' : `${selectedLive} davon sind`} noch online – die Anzeigen auf Vinted bzw. Kleinanzeigen bleiben bestehen.
              </p>
            )}
            {bulkError && <p className="confirm-modal-error">{bulkError}</p>}
            <div className="confirm-modal-buttons">
              <button className="confirm-btn-cancel" onClick={() => setConfirmBulk(false)} disabled={bulkDeleting}>Abbrechen</button>
              <button className="confirm-btn-delete" onClick={handleBulkDelete} disabled={bulkDeleting}>
                {bulkDeleting ? 'Wird gelöscht …' : 'Löschen'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10; // px of finger movement that still counts as holding still

function DraftListItem({ draft, onSelect, onDelete, flash = false, selecting = false, selected = false, onToggleSelect = null }) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  useEffect(() => cancelLongPress, []);

  const fireLongPress = () => {
    longPressTimer.current = null;
    if (!onToggleSelect || isDeleting) return;
    longPressFired.current = true;
    try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* ignore */ }
    // Long press on an already selected row in selection mode keeps it selected.
    if (!(selecting && selected)) onToggleSelect(draft.id);
  };
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

  // Entering selection mode closes an open swipe action.
  useEffect(() => {
    if (selecting && currentRestOffset.current !== 0) {
      setSwipeOffset(0);
      currentRestOffset.current = 0;
    }
  }, [selecting]);


  const handleTouchStart = (e) => {
    if (isDeleting) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    longPressFired.current = false;
    cancelLongPress();
    if (onToggleSelect && currentRestOffset.current === 0) {
      longPressTimer.current = setTimeout(fireLongPress, LONG_PRESS_MS);
    }
    if (selecting) return; // no swipe-to-delete while selecting
    setIsSwiping(true);
    hasSwiped.current = false;
    isVerticalScroll.current = false;
  };

  const handleTouchMove = (e) => {
    if (longPressTimer.current) {
      const mx = e.touches[0].clientX - startX.current;
      const my = e.touches[0].clientY - startY.current;
      if (Math.abs(mx) > LONG_PRESS_SLOP || Math.abs(my) > LONG_PRESS_SLOP) cancelLongPress();
    }
    if (longPressFired.current) {
      if (e.cancelable) e.preventDefault();
      return;
    }
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
    cancelLongPress();
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
    cancelLongPress();
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
    // The click that ends a long press only finishes the gesture.
    if (longPressFired.current) {
      longPressFired.current = false;
      e.preventDefault();
      return;
    }
    if (selecting) {
      if (onToggleSelect) onToggleSelect(draft.id);
      return;
    }
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
        className={`draft-list-item-card${flash ? ' turbo-flash' : ''}${selecting ? ' selecting' : ''}${selected ? ' selected' : ''}`}
        onClick={handleClick}
        onContextMenu={(e) => {
          // Desktop: right click starts/extends the selection. On touch the
          // long-press timer already handled it (the WebView also sends this).
          if (!onToggleSelect) return;
          e.preventDefault();
          if (longPressFired.current || ('ontouchstart' in window && navigator.maxTouchPoints > 0)) return;
          if (!(selecting && selected)) onToggleSelect(draft.id);
        }}
        role={selecting ? 'checkbox' : undefined}
        aria-checked={selecting ? selected : undefined}
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
              src={getThumbUrl(draft.image_path)}
              alt={draft.title}
              className={`draft-list-item-thumb ${thumbLoaded ? 'is-loaded' : 'is-loading'}`}
              loading="lazy"
              decoding="async"
              width="58"
              height="58"
              onLoad={() => setThumbLoaded(true)}
              onError={() => setThumbLoaded(true)}
              draggable={false}
            />
            <span className="select-check" aria-hidden="true">
              <span className="select-check-dot">{selected && <Check size={14} strokeWidth={3} />}</span>
            </span>
          </div>

          {/* Middle Section: Text details */}
          <div className="draft-list-item-details">
            <h3 className="draft-list-item-title" title={draft.title}>
              {draft.title || 'Unbenanntes Angebot'}
            </h3>
            
            {/* Single flat list: the only persistent row signal is the published
                status (green V / K pills). No "draft" labels, no permanent turbo
                marker — turbo-created items merely flash once via .turbo-flash. */}
            {listingPlatforms(draft).length > 0 && (
              <div className="draft-list-item-meta">
                <ListingStatusMeta draft={draft} />
              </div>
            )}
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
      // The app only opens the ad here; it needs no API token for that.
      window.VelosiaBridge.deleteOnPlatform(draft.id, live.key, platformDeleteUrl(live.key, live.url, draft.ka_listing_id), '');
    } else if (live.url) {
      window.open(platformDeleteUrl(live.key, live.url, draft.ka_listing_id), '_blank', 'noopener');
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
