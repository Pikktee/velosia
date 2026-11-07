import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Copy, Check, ExternalLink, Monitor, RefreshCw, AlertCircle, Trash2, Plus, Sparkles, Share2, Camera, TrendingUp, ChevronDown, ChevronLeft, ChevronRight, Star, Tag, Coins, ArrowUp, ArrowUpRight } from 'lucide-react';
import { updateDraft, getImageUrl, getPlatformToken, uploadDraftImages, deleteDraftImage, regenerateDraftField, refreshListingStatus, setListingStatus } from '../utils/api';
import { statusMeta, listingPlatforms, TERMINAL, onlineChanges, detailSummary } from '../utils/listingStatus';
import { StatusSheet, PublishSheet, PlatformMark } from './ListingSheets';
import { showError } from '../utils/toast';
import { PRICE_TYPES } from '../utils/priceType';
import RelistSheet from './RelistSheet';
import OnlineChangesSheet from './OnlineChangesSheet';
import { takePendingRelist, takeRecheck, rememberRecheck } from '../utils/relist';

const ONLINE_FIELD_LABELS = [['price', 'Preis'], ['title', 'Titel'], ['description', 'Beschreibung']];

export default function DraftDetail({ draft, onBack, onUpdateSuccess, onDelete }) {
  const [title, setTitle] = useState(draft.title || '');
  const [description, setDescription] = useState(draft.description || '');
  const [condition, setCondition] = useState(draft.condition || 'Gut');
  const [price, setPrice] = useState(draft.price || 0);
  const [priceType, setPriceType] = useState(draft.price_type_effective || 'FIXED');
  
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved', 'saving', 'error'
  const [hasChanges, setHasChanges] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  const [selectedModalImage, setSelectedModalImage] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imageToDelete, setImageToDelete] = useState(null);
  
  const [regeneratingField, setRegeneratingField] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [settingStatus, setSettingStatus] = useState(false);
  const [showDetected, setShowDetected] = useState(false); // collapsible "Automatisch erkannt"
  // 'status' (Deine Anzeigen) | 'publish' (Einstellen auf) | null
  const [sheet, setSheet] = useState(null);
  const [confirmDeleteDraft, setConfirmDeleteDraft] = useState(false);
  // Platform whose live ad is being opened — shows a loading ring on its icon
  // until the WebView leaves the page.
  const [opening, setOpening] = useState(null);
  const openingTimer = useRef(null);
  useEffect(() => () => clearTimeout(openingTimer.current), []);
  // Re-listing (RelistSheet). Resumed when we come back from deleting the old ad
  // in the platform WebView, with the price picked before leaving.
  const [relist, setRelist] = useState(() => {
    const pending = takePendingRelist(draft.id);
    return pending ? { platform: pending.platform, price: pending.price, resumed: true } : null;
  });
  // Edits made on the platform pop up once when the draft is opened.
  const [onlineChange, setOnlineChange] = useState(() => (relist ? null : onlineChanges(draft)[0] || null));
  // The stored online values are only as fresh as the last status poll (every
  // 6 h or on "Status aktualisieren"), so an edit made on the platform a moment
  // ago would stay unnoticed. Re-read the live ads quietly when the draft is
  // opened and offer what changed — once per opening.
  const onlineOffered = useRef(!!onlineChange);
  const formRef = useRef({ title, description, price });
  formRef.current = { title, description, price };
  useEffect(() => {
    if (relist) return undefined;
    const live = [['ka', draft.ka_listing_url], ['vinted', draft.vinted_listing_url]]
      .filter(([p, url]) => url && !TERMINAL.has(draft[`${p}_status`]));
    if (!live.length) return undefined;
    const forced = takeRecheck(draft.id); // back from deleting an ad on the platform
    const ageMs = Math.min(...live.map(([p]) => {
      const at = draft[`${p}_status_at`];
      if (!at) return Infinity;
      const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at}Z`);
      return Number.isNaN(t) ? Infinity : Date.now() - t;
    }));
    if (!forced && ageMs < 2 * 60 * 1000) return undefined;
    let cancelled = false;
    refreshListingStatus(draft.id).then((updated) => {
      if (cancelled || !updated) return;
      onUpdateSuccess(updated);
      if (onlineOffered.current) return;
      const change = onlineChanges(updated, formRef.current)[0];
      if (change) {
        onlineOffered.current = true;
        setOnlineChange(change);
      }
    }).catch((err) => console.warn('Status-Abruf beim Öffnen fehlgeschlagen:', err));
    return () => { cancelled = true; };
    // Once per opened draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);
  const fileInputRef = useRef(null);

  // Attributes (Größe, Marke, Material, Farbe, …) the AI extracted into a JSON
  // blob. Read-only here — they feed the Vinted autofill; we only surface them.
  const detectedAttributes = React.useMemo(() => {
    if (!draft.attributes) return [];
    try {
      const parsed = JSON.parse(draft.attributes);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.entries(parsed).filter(
          ([, v]) => v !== null && v !== undefined && String(v).trim() !== ''
        );
      }
    } catch (e) {
      console.error('Failed to parse attributes:', e);
    }
    return [];
  }, [draft.attributes]);

  // Computer drafts get four EDITABLE spec fields. The AI only fills them when it
  // can be sure (a Mac mini's storage/RAM aren't visible on a photo), so the user
  // must be able to enter them; the engine then picks them on Vinted. Suggestions
  // use Vinted's own spelling ("256 GB", "Apple M4", "macOS").
  const TECH_FIELDS = [
    { key: 'Speicherkapazität', label: 'Speicher', placeholder: 'z. B. 256 GB', options: ['128 GB', '256 GB', '512 GB', '1 TB', '2 TB'] },
    { key: 'Arbeitsspeicher', label: 'RAM', placeholder: 'z. B. 16 GB', options: ['8 GB', '16 GB', '24 GB', '32 GB', '64 GB'] },
    { key: 'Prozessor', label: 'Prozessor', placeholder: 'z. B. Apple M4', options: ['Apple M1', 'Apple M2', 'Apple M3', 'Apple M4', 'Apple M4 Pro', 'Intel Core i5', 'Intel Core i7'] },
    { key: 'Betriebssystem', label: 'System', placeholder: 'z. B. macOS', options: ['macOS', 'Windows', 'Linux', 'Chrome OS'] },
  ];
  const isComputer = /desktop-computer|laptops|notebooks|> pcs\b/i.test(
    `${draft.vinted_category || ''} | ${draft.category || ''}`
  );
  const techKeys = TECH_FIELDS.map((f) => f.key.toLowerCase());
  const attrValue = (key) => {
    const hit = detectedAttributes.find(([k]) => k.toLowerCase() === key.toLowerCase());
    return hit ? String(hit[1]) : '';
  };
  const [techValues, setTechValues] = useState({});
  useEffect(() => {
    const init = {};
    TECH_FIELDS.forEach((f) => { init[f.key] = attrValue(f.key); });
    setTechValues(init);
    // Re-seed only when another draft is opened or its attributes change on the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, draft.attributes]);

  const saveTechValue = async (key) => {
    const value = (techValues[key] || '').trim();
    if (value === attrValue(key)) return;
    let attrs = {};
    try { attrs = JSON.parse(draft.attributes || '{}') || {}; } catch (e) { attrs = {}; }
    Object.keys(attrs).forEach((k) => { if (k.toLowerCase() === key.toLowerCase()) delete attrs[k]; });
    if (value) attrs[key] = value;
    setSaveStatus('saving');
    try {
      const updated = await updateDraft(draft.id, { attributes: JSON.stringify(attrs) });
      setSaveStatus('saved');
      onUpdateSuccess(updated);
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
    }
  };

  // Parse multiple images
  const allImages = React.useMemo(() => {
    if (draft.image_paths) {
      try {
        const parsed = JSON.parse(draft.image_paths);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error("Failed to parse image_paths:", e);
      }
    }
    return draft.image_path ? [draft.image_path] : [];
  }, [draft.image_paths, draft.image_path]);

  // activeImage state removed since we now use a grid of thumbnails and a modal detail view
  // While a reorder is saving, show the new order right away (see moveImage).
  const [imageOrder, setImageOrder] = useState(null);
  const shownImages = imageOrder || allImages;

  // Detect Android Webview container
  const isAndroidApp = typeof window.VelosiaBridge !== 'undefined';

  const conditions = [
    'Neu',
    'Sehr gut',
    'Gut',
    'In Ordnung'
  ];

  // Track if values differ from the last saved draft
  useEffect(() => {
    const hasDiff =
      title !== (draft.title || '') ||
      description !== (draft.description || '') ||
      condition !== (draft.condition || 'Gut') ||
      (parseFloat(price) || 0) !== (parseFloat(draft.price) || 0);

    setHasChanges(hasDiff);
  }, [title, description, condition, price, draft]);

  // Persist the current field values. Shared by the debounced auto-save and the
  // manual retry shown when a save fails. Defined in render scope so it always
  // closes over the latest field values.
  const saveDraft = async () => {
    setSaveStatus('saving');
    try {
      const updated = await updateDraft(draft.id, {
        title,
        description,
        condition,
        price: parseFloat(price) || 0
      });
      setSaveStatus('saved');
      onUpdateSuccess(updated);
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
    }
  };

  // Festpreis/VB is a single tap, so it is saved right away instead of riding on
  // the debounced text save.
  const handlePriceTypeChange = async (value) => {
    if (value === priceType) return;
    const previous = priceType;
    setPriceType(value);
    try {
      const updated = await updateDraft(draft.id, { price_type: value });
      onUpdateSuccess(updated);
    } catch (err) {
      console.error(err);
      setPriceType(previous);
      showError('Die Preisart konnte nicht gespeichert werden.');
    }
  };

  // Debounced auto-save effect
  useEffect(() => {
    if (!hasChanges) return;
    setSaveStatus('saving');
    const delayDebounceFn = setTimeout(saveDraft, 1200); // snappy but typing-friendly
    return () => clearTimeout(delayDebounceFn);
  }, [title, description, condition, price, hasChanges]);

  // Latest field values, reachable from the unmount cleanup without re-subscribing
  // it on every keystroke.
  const latestRef = useRef({});
  latestRef.current = { title, description, condition, price, hasChanges, saveStatus, draftId: draft.id };

  // Flush a still-pending debounced save on unmount — e.g. the user taps "Zurück"
  // within the 1.2s debounce window, which otherwise clears the timer and loses the
  // last edit. Fire-and-forget: the request outlives the component, so we touch no
  // state afterwards. Idempotent PUT, so a possible overlap with an in-flight save
  // is harmless.
  useEffect(() => {
    return () => {
      const l = latestRef.current;
      if (l.hasChanges && l.saveStatus !== 'saved') {
        updateDraft(l.draftId, {
          title: l.title,
          description: l.description,
          condition: l.condition,
          price: parseFloat(l.price) || 0,
        }).catch(() => {});
      }
    };
  }, []);

  const copyToClipboard = (text, fieldName) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePostInApp = async (platform) => {
    if (isAndroidApp) {
      if (navigator.vibrate) {
        try { navigator.vibrate([15]); } catch (e) { /* ignore */ }
      }
      // The app hands this token to the platform page, so it gets a draft-scoped
      // one rather than the session token.
      let platformToken;
      try {
        platformToken = await getPlatformToken(draft.id);
      } catch (err) {
        console.error(err);
        showError(err.message || 'Veröffentlichen konnte nicht vorbereitet werden.', () => handlePostInApp(platform));
        return;
      }
      // Remember which draft we're publishing so that returning from the platform
      // WebView (back gesture OR after a successful publish) lands back on THIS
      // detail page instead of the list. App.jsx reads this marker on (re)mount.
      try { localStorage.setItem('velosia_return_draft', String(draft.id)); } catch (e) { /* ignore */ }
      window.VelosiaBridge.postToPlatform(draft.id, platform, platformToken);
    }
  };

  const openPlatformPage = (platform) => {
    const urls = {
      vinted: 'https://www.vinted.de/items/new',
      kleinanzeigen: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben.html'
    };
    window.open(urls[platform], '_blank');
  };

  // In the app the engine fills the platform form; on desktop the platform page
  // opens and the extension takes over.
  const publishTo = (platform) => {
    setSheet(null);
    if (isAndroidApp) handlePostInApp(platform);
    else openPlatformPage(platform);
  };

  // Re-list with the price picked in the RelistSheet (saved first, so the engine
  // fills the new ad with it).
  const publishRelist = async (platform, newPrice) => {
    if (newPrice != null && Math.abs(newPrice - (parseFloat(price) || 0)) >= 0.01) {
      try {
        const updated = await updateDraft(draft.id, { price: newPrice });
        setPrice(newPrice);
        onUpdateSuccess(updated);
      } catch (err) {
        console.error(err);
        showError('Der Preis konnte nicht gespeichert werden.', () => publishRelist(platform, newPrice));
        return;
      }
    }
    publishTo(platform);
  };

  // Cross-post conflict: take the still-live ad down on its platform. Semi-manual
  // like everywhere else — the user confirms the deletion there; back here the
  // status is re-read at once.
  const deleteOnPlatform = (p) => {
    setSheet(null);
    const bridge = window.VelosiaBridge;
    if (bridge && typeof bridge.deleteOnPlatform === 'function') {
      rememberRecheck(draft.id);
      try { localStorage.setItem('velosia_return_draft', String(draft.id)); } catch (e) { /* ignore */ }
      bridge.deleteOnPlatform(draft.id, p.key, p.url || '', '');
    } else if (p.url) {
      window.open(p.url, '_blank', 'noopener');
    }
  };

  // Opening the live ad: in the app it loads in the same WebView, so remember this
  // draft — Close (X) and the back gesture then return to its detail view instead of
  // the list (App.jsx reads the marker on remount). Feedback: a short vibration and
  // a loading ring, since the platform page takes a moment to start.
  const openListing = (p) => {
    if (isAndroidApp) {
      try { localStorage.setItem('velosia_return_draft', String(draft.id)); } catch { /* ignore */ }
      try { navigator.vibrate?.(12); } catch { /* ignore */ }
    }
    setOpening(p.key);
    clearTimeout(openingTimer.current);
    openingTimer.current = setTimeout(() => setOpening(null), isAndroidApp ? 10000 : 1200);
  };

  const handleRefreshStatus = async () => {
    if (refreshingStatus) return;
    setRefreshingStatus(true);
    try {
      const updated = await refreshListingStatus(draft.id);
      onUpdateSuccess(updated);
    } catch (err) {
      console.error(err);
      showError(`Status konnte nicht aktualisiert werden: ${err.message}`, handleRefreshStatus);
    } finally {
      setRefreshingStatus(false);
    }
  };

  // Manually set a platform's status — KA has no public "verkauft" state, so the
  // user marks a KA sale by hand.
  const handleSetStatus = async (platform, newStatus) => {
    if (settingStatus) return;
    setSettingStatus(true);
    try {
      const updated = await setListingStatus(draft.id, platform, newStatus);
      onUpdateSuccess(updated);
    } catch (err) {
      console.error(err);
      showError(`Status konnte nicht gesetzt werden: ${err.message}`, () => handleSetStatus(platform, newStatus));
    } finally {
      setSettingStatus(false);
    }
  };

  const handleAddImages = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    uploadImages(files);
  };

  const uploadImages = async (files) => {
    setUploadingImage(true);
    try {
      const updated = await uploadDraftImages(draft.id, files);
      onUpdateSuccess(updated);
    } catch (err) {
      console.error(err);
      showError(`Bilder konnten nicht hochgeladen werden: ${err.message}`, () => uploadImages(files));
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteImage = (imgUrl) => {
    if (!imgUrl) return;
    setImageToDelete(imgUrl);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDeleteImage = async () => {
    if (!imageToDelete) return;
    setShowDeleteConfirm(false);
    const imgUrl = imageToDelete;
    setImageToDelete(null);
    deleteImage(imgUrl);
  };

  const deleteImage = async (imgUrl) => {
    try {
      const updated = await deleteDraftImage(draft.id, imgUrl);
      onUpdateSuccess(updated);
      
      if (selectedModalImage === imgUrl) {
        setSelectedModalImage(null);
      }
    } catch (err) {
      console.error(err);
      showError(`Bild konnte nicht gelöscht werden: ${err.message}`, () => deleteImage(imgUrl));
    }
  };

  // Move a photo to a new position. The first photo is the cover the platforms
  // show in search results, and both the engine and the Android shell upload in
  // image_paths order — so the order here is the order on Vinted/Kleinanzeigen.
  // Optimistic: the grid updates at once, a failed save rolls back.
  const moveImage = async (imgUrl, toIndex) => {
    if (imageOrder) return; // one save at a time
    const current = allImages;
    const from = current.indexOf(imgUrl);
    if (from < 0 || toIndex < 0 || toIndex >= current.length || from === toIndex) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(toIndex, 0, imgUrl);
    setImageOrder(next);
    try {
      const updated = await updateDraft(draft.id, { image_paths: JSON.stringify(next) });
      onUpdateSuccess(updated);
    } catch (err) {
      console.error(err);
      showError(`Reihenfolge konnte nicht gespeichert werden: ${err.message}`, () => moveImage(imgUrl, toIndex));
    } finally {
      setImageOrder(null);
    }
  };

  const handleCancelDeleteImage = () => {
    setShowDeleteConfirm(false);
    setImageToDelete(null);
  };

  const handleRegenerateField = async (field) => {
    if (regeneratingField) return;
    setRegeneratingField(field);
    try {
      const updated = await regenerateDraftField(draft.id, field);
      if (field === 'title') {
        setTitle(updated.title || '');
      } else if (field === 'description') {
        setDescription(updated.description || '');
      }
      onUpdateSuccess(updated);
    } catch (err) {
      console.error(err);
      showError(`KI-Neugenerierung fehlgeschlagen: ${err.message}`, () => handleRegenerateField(field));
    } finally {
      setRegeneratingField(null);
    }
  };

  // Sub-renderers to keep the structure beautiful and manageable

  const renderImageBox = () => {
    return (
      <div className="detail-section-unboxed" style={{ position: 'relative' }}>
        <h3 className="detail-section-title">
          <Camera size={18} style={{ color: 'var(--primary)' }} />
          <span>Fotos</span>
        </h3>

        {/* Uploading overlay */}
        {uploadingImage && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(7, 9, 13, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-md)',
            zIndex: 10,
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
              <RefreshCw size={24} style={{ animation: 'spin 1.5s linear infinite', color: 'var(--primary)' }} />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Bilder werden hochgeladen...</span>
            </div>
          </div>
        )}

        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          multiple 
          accept="image/*" 
          onChange={handleAddImages} 
        />

        {/* Grid of thumbnails */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '0.75rem', width: '100%' }}>
          {shownImages.map((imgUrl, idx) => (
            <div 
              key={imgUrl}
              onClick={() => setSelectedModalImage(imgUrl)}
              className="thumbnail-grid-item"
            >
              <img src={getImageUrl(imgUrl)} alt="" />
              {idx === 0 && shownImages.length > 1 && (
                <span className="thumbnail-cover-badge">Titelbild</span>
              )}
            </div>
          ))}
          
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="thumbnail-grid-item upload-thumbnail-btn"
            title="Bilder hinzufügen"
          >
            <Plus size={20} />
            <span style={{ fontSize: '0.65rem', fontWeight: '600' }}>Neu</span>
          </div>
        </div>
      </div>
    );
  };

  // Edits made on the platform itself (see onlineChanges): offered once in a
  // sheet on opening; closed without a choice, a banner above the form keeps it.
  const pendingOnline = onlineChanges(draft, { title, description, price })[0] || null;

  // Take over everything that was changed online, in one save.
  const applyOnlineChanges = async (change) => {
    const { changes } = change;
    const patch = {
      title: changes.title ?? title,
      description: changes.description ?? description,
      condition,
      price: changes.price ?? (parseFloat(price) || 0),
    };
    if (changes.price != null && change.type && change.type !== priceType) patch.price_type = change.type;
    try {
      const updated = await updateDraft(draft.id, patch);
      setTitle(patch.title);
      setDescription(patch.description);
      setPrice(patch.price);
      if (patch.price_type) setPriceType(patch.price_type);
      onUpdateSuccess(updated);
      setOnlineChange(null);
    } catch (err) {
      console.error(err);
      showError('Die Änderungen konnten nicht übernommen werden.', () => applyOnlineChanges(change));
    }
  };

  // Per-platform publish control. The old standalone "Status" section is gone:
  // each platform is now ONE button that doubles as its status. Not yet published
  // → the normal publish button. Already published → a grayed-out "published"
  // state showing the live status plus the inline actions that used to live in
  // the status section (open listing, re-list, and — KA only — mark as sold).
  const PLATFORM_INFO = {
    vinted: { name: 'Vinted', cls: 'btn-vinted' },
    kleinanzeigen: { name: 'Kleinanzeigen', cls: 'btn-kleinanzeigen' },
  };

  const renderPublishControl = (key, onPublish, { btnLabel, btnIcon, btnExtraCls = '' }) => {
    const info = PLATFORM_INFO[key];
    const p = listingPlatforms(draft).find((x) => x.key === key);

    if (!p) {
      return (
        <button className={`btn ${info.cls} ${btnExtraCls}`.trim()} onClick={onPublish}>
          {btnIcon}
          <span>{btnLabel}</span>
        </button>
      );
    }

    const meta = statusMeta(p.status);
    const canMarkSold = key === 'kleinanzeigen' && !TERMINAL.has(p.status);
    return (
      <div className="publish-control published">
        <div className="publish-control-head">
          <span className="publish-control-name">{info.name}</span>
          <span
            className="listing-status-badge"
            style={{ color: meta.color, background: meta.bg, borderColor: meta.color }}
          >
            <span className="listing-status-dot" style={{ background: meta.color }} />
            {meta.label}
          </span>
          <button
            className="publish-control-refresh"
            onClick={handleRefreshStatus}
            disabled={refreshingStatus}
            title="Status aktualisieren"
            aria-label="Status aktualisieren"
          >
            <RefreshCw size={14} className={refreshingStatus ? 'spin' : ''} />
          </button>
        </div>
        <div className="publish-control-actions">
          {p.url && (
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="btn-text-link">
              Anzeige öffnen <ExternalLink size={12} />
            </a>
          )}
          <button
            className="btn-text-link"
            onClick={() => setRelist({ platform: key, resumed: false })}
          >
            Neu einstellen
          </button>
          {canMarkSold && (
            <button
              className="btn-text-link mark-sold-link"
              disabled={settingStatus}
              onClick={() => handleSetStatus('kleinanzeigen', 'verkauft')}
            >
              <Coins size={13} /> Als verkauft markieren
            </button>
          )}
        </div>
      </div>
    );
  };

  // Desktop-only publishing helper. In the app, publishing happens via the
  // bottom sticky bar (handlePostInApp); on desktop the autofill runs through
  // the Chrome extension on the platform page, so we offer "open platform" +
  // a manual copy panel as a no-extension fallback.
  const renderPublishingAssist = () => {
    return (
      <div className="detail-section-unboxed">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', marginBottom: '1.25rem', width: '100%' }}>
          <h3 className="detail-section-title" style={{ borderBottom: 'none', margin: 0, paddingBottom: 0 }}>
            <Share2 size={18} style={{ color: 'var(--primary)' }} />
            <span>Veröffentlichen</span>
          </h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>
            {/* Extension Guidance Info */}
            <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.825rem', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
              <Monitor size={16} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '0.15rem' }} />
              <div>
                <strong>Tipp:</strong> Nutze die Velosia Desktop-Extension, um alle Daten automatisch mit einem Klick auszufüllen.
              </div>
            </div>

            {/* Quick Copy Panel */}
            <div className="copy-list">
              <div className="copy-item">
                <div className="copy-label">Titel</div>
                <div className="copy-value">{title || '-'}</div>
                <button 
                  className={`copy-btn ${copiedField === 'title' ? 'success' : ''}`}
                  onClick={() => copyToClipboard(title, 'title')}
                  title="Titel kopieren"
                >
                  {copiedField === 'title' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>

              <div className="copy-item">
                <div className="copy-label">Preis</div>
                <div className="copy-value price">{price} €{priceType === 'NEGOTIABLE' ? ' VB' : ''}</div>
                <button 
                  className={`copy-btn ${copiedField === 'price' ? 'success' : ''}`}
                  onClick={() => copyToClipboard(price.toString(), 'price')}
                  title="Preis kopieren"
                >
                  {copiedField === 'price' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>

              <div className="copy-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="copy-label">Beschreibung</div>
                  <button 
                    className={`copy-btn ${copiedField === 'desc' ? 'success' : ''}`}
                    onClick={() => copyToClipboard(description, 'desc')}
                    title="Beschreibung kopieren"
                    style={{ padding: '0.2rem' }}
                  >
                    {copiedField === 'desc' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                <div className="copy-value textarea-val">
                  {description || 'Keine Beschreibung'}
                </div>
              </div>
            </div>

            {/* Platform actions: a publish button per platform, or — once that
                platform is published — a grayed status control with inline actions. */}
            <div className="platform-links-container">
              {renderPublishControl('vinted', () => openPlatformPage('vinted'), {
                btnLabel: 'Vinted öffnen',
                btnIcon: <ExternalLink size={12} style={{ marginRight: '0.25rem' }} />,
                btnExtraCls: 'platform-link-btn',
              })}
              {renderPublishControl('kleinanzeigen', () => openPlatformPage('kleinanzeigen'), {
                btnLabel: 'Kleinanzeigen',
                btnIcon: <ExternalLink size={12} style={{ marginRight: '0.25rem' }} />,
                btnExtraCls: 'platform-link-btn',
              })}
            </div>
          </div>
      </div>
    );
  };

  const renderPriceComparison = () => {
    if (!draft.sources) return null;

    let parsedSources = [];
    try {
      parsedSources = JSON.parse(draft.sources);
    } catch (e) {
      console.error(e);
      return (
        <div className="detail-section-unboxed">
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Vergleichsdaten beschädigt.</p>
        </div>
      );
    }

    if (!parsedSources || parsedSources.length === 0) {
      return (
        <div className="detail-section-unboxed">
          <h3 className="detail-section-title">
            <TrendingUp size={18} style={{ color: 'var(--primary)' }} />
            <span>Marktpreis-Vergleich</span>
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Keine Vergleichsangebote auf Kleinanzeigen gefunden.</p>
        </div>
      );
    }

    const prices = parsedSources.map(s => parseFloat(s.price)).filter(p => !isNaN(p) && p > 0);
    prices.sort((a, b) => a - b);
    const count = prices.length;
    
    let minPrice = count > 0 ? prices[0] : 0;
    let maxPrice = count > 0 ? prices[count - 1] : 0;
    let medianVal = 0;
    if (count > 0) {
      if (count % 2 === 1) {
        medianVal = prices[Math.floor(count / 2)];
      } else {
        medianVal = (prices[count / 2 - 1] + prices[count / 2]) / 2;
      }
    }

    return (
      <div className="detail-section-unboxed price-comparison-section">
        <h3 className="detail-section-title">
          <TrendingUp size={18} style={{ color: 'var(--primary)' }} />
          <span>Marktpreis-Vergleich</span>
        </h3>

        {count > 0 && (
          <div className="price-summary-card">
            <div className="price-summary-item">
              <span className="price-summary-label">Min</span>
              <span className="price-summary-val">{Math.round(minPrice)} €</span>
            </div>
            <div className="price-summary-item" style={{ borderLeft: '1px solid var(--glass-border)', borderRight: '1px solid var(--glass-border)', padding: '0 1.25rem' }}>
              <span className="price-summary-label">Median</span>
              <span className="price-summary-val highlight">{Math.round(medianVal)} €</span>
            </div>
            <div className="price-summary-item">
              <span className="price-summary-label">Max</span>
              <span className="price-summary-val">{Math.round(maxPrice)} €</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {parsedSources.map((src, idx) => (
            <a 
              key={idx}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="price-comparison-link"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.65rem 0.85rem',
                textDecoration: 'none',
                color: 'var(--text-primary)',
                fontSize: '0.825rem',
                border: '1px solid var(--glass-border)',
                transition: 'all 0.2s ease'
              }}
            >
              <span style={{ 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis', 
                flexGrow: 1, 
                paddingRight: '0.5rem',
                textAlign: 'left',
                minWidth: 0
              }}>
                {src.title}
              </span>
              <span style={{ fontWeight: 'bold', color: 'var(--primary)', flexShrink: 0 }}>
                {src.price} €
              </span>
            </a>
          ))}
        </div>
      </div>
    );
  };

  const renderFormFields = () => {
    return (
      <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {pendingOnline && !onlineChange && (
          <button type="button" className="online-change-banner" onClick={() => setOnlineChange(pendingOnline)}>
            <span>Auf {pendingOnline.name} geändert: {ONLINE_FIELD_LABELS.filter(([f]) => f in pendingOnline.changes).map(([, l]) => l).join(', ')}</span>
            <strong>Ansehen</strong>
          </button>
        )}

        {/* Title */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label htmlFor="edit-title" style={{ marginBottom: 0 }}>Titel</label>
            <button 
              type="button"
              className="ki-regen-btn"
              onClick={() => handleRegenerateField('title')}
              disabled={regeneratingField !== null || allImages.length === 0}
              title={allImages.length === 0 ? "Bilder hinzufügen, um Titel per KI zu generieren" : "Titel per KI neu generieren"}
            >
              {regeneratingField === 'title' ? (
                <RefreshCw size={11} className="spin-animation" />
              ) : (
                <Sparkles size={11} />
              )}
            </button>
          </div>
          <input 
            type="text" 
            id="edit-title" 
            className="form-control" 
            value={title} 
            onChange={(e) => setTitle(e.target.value.substring(0, 65))}
            placeholder={regeneratingField === 'title' ? "Generiere..." : "Titel für die Anzeige..."}
            disabled={regeneratingField === 'title'}
            style={{ opacity: regeneratingField === 'title' ? 0.6 : 1 }}
          />
          <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {title.length}/65
          </div>
        </div>

        {/* Description — placed directly under the title so the two main
            content fields sit together at the top of the form. */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label htmlFor="edit-desc" style={{ marginBottom: 0 }}>Beschreibung</label>
            <button
              type="button"
              className="ki-regen-btn"
              onClick={() => handleRegenerateField('description')}
              disabled={regeneratingField !== null || allImages.length === 0}
              title={allImages.length === 0 ? "Bilder hinzufügen, um Beschreibung per KI zu generieren" : "Beschreibung per KI neu generieren"}
            >
              {regeneratingField === 'description' ? (
                <RefreshCw size={11} className="spin-animation" />
              ) : (
                <Sparkles size={11} />
              )}
            </button>
          </div>
          <textarea
            id="edit-desc"
            className="form-control"
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={regeneratingField === 'description' ? "Generiere..." : "Verkaufsbeschreibung schreiben..."}
            disabled={regeneratingField === 'description'}
            style={{ opacity: regeneratingField === 'description' ? 0.6 : 1, minHeight: '138px' }}
          />
        </div>

        {/* Price */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="edit-price">Preis (in €)</label>
          <input 
            type="number" 
            id="edit-price" 
            className="form-control" 
            value={price} 
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Preis..."
            min="0"
            step="1"
          />
          <div className="segmented-control" role="radiogroup" aria-label="Preisart" style={{ marginTop: '0.5rem' }}>
            {PRICE_TYPES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={priceType === value}
                className={`segmented-control-btn ${priceType === value ? 'active' : ''}`}
                onClick={() => handlePriceTypeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            {draft.price_type ? 'Gilt für Kleinanzeigen.' : 'Vorgabe aus deinen Einstellungen · gilt für Kleinanzeigen.'}
          </div>
        </div>

        {/* Condition */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="edit-condition" style={{ marginBottom: '0.5rem' }}>Zustand</label>
          <select
            id="edit-condition"
            className="form-control"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          >
            {conditions.map((cond) => (
              <option key={cond} value={cond}>{cond}</option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  // Collapsible "Weitere Angaben" panel — read-only category + attributes, plus
  // the editable spec fields for computers (see TECH_FIELDS).
  // Categories stay read-only by design: the AI resolves an exact taxonomy
  // breadcrumb that drives the autofill; a free-text edit would break the path.
  const renderDetectedInfo = () => {
    const rows = [
      { key: 'ka', name: 'Kategorie', sub: 'Kleinanzeigen', value: draft.category },
      { key: 'vinted', name: 'Kategorie', sub: 'Vinted', value: draft.vinted_category },
      ...detectedAttributes
        .filter(([k]) => !(isComputer && techKeys.includes(k.toLowerCase())))
        .map(([k, v]) => ({ key: `attr-${k}`, name: k, value: String(v) })),
    ];
    const filledCount = rows.filter((r) => r.value).length +
      (isComputer ? TECH_FIELDS.filter((f) => (techValues[f.key] || '').trim()).length : 0);

    return (
      <div className={`detected-panel ${showDetected ? 'is-open' : ''}`}>
        <button
          type="button"
          className="detected-toggle"
          onClick={() => setShowDetected((s) => !s)}
          aria-expanded={showDetected}
        >
          <Tag size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <span className="detected-toggle-label">Weitere Angaben</span>
          {filledCount > 0 && <span className="detected-toggle-count">{filledCount}</span>}
          <ChevronDown
            size={18}
            className="detected-toggle-chevron"
            style={{ transform: showDetected ? 'rotate(180deg)' : 'none' }}
          />
        </button>

        {showDetected && (
          <div className="detected-body">
            {rows.map(({ key, name, sub, value }) => (
              <div key={key} className="detected-row">
                <span className="detected-row-label">
                  {name}
                  {sub && <span className="detected-row-sublabel">{sub}</span>}
                </span>
                {value ? (
                  <span className="detected-row-value">{value}</span>
                ) : (
                  <span className="detected-row-empty">wird beim Einstellen manuell gewählt</span>
                )}
              </div>
            ))}
            {isComputer && TECH_FIELDS.map((f) => (
              <div key={`tech-${f.key}`} className="detected-row detected-row-editable">
                <label className="detected-row-label" htmlFor={`tech-${f.key}`}>{f.label}</label>
                <input
                  id={`tech-${f.key}`}
                  className="detected-row-input"
                  list={`tech-list-${f.key}`}
                  value={techValues[f.key] || ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setTechValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  onBlur={() => saveTechValue(f.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <datalist id={`tech-list-${f.key}`}>
                  {f.options.map((o) => <option key={o} value={o} />)}
                </datalist>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const listed = listingPlatforms(draft);
  const summary = detailSummary(draft);
  const openSummary = () => setSheet('status');

  return (
    <div className="fade-in">
      {/* Material-style top app bar: Up arrow (always returns to the list),
          title with the listing status as subtitle (tap → "Deine Anzeigen" or the
          suggested action), one icon per platform that opens the live ad, and
          "Einstellen" for drafts in the app. Save status stays silent when saved. */}
      <div className="detail-sticky-header">
        <div className="detail-header-inner">
          <div className="detail-header-bar has-sub">
            <button
              className="detail-up-btn"
              onClick={onBack}
              aria-label="Zurück zur Angebotsliste"
            >
              <ArrowLeft size={22} />
            </button>
            {summary.action ? (
              <button
                type="button"
                className="detail-header-titles"
                onClick={openSummary}
                aria-label={`${summary.text}. Deine Anzeigen öffnen`}
              >
                <span className="detail-header-title">Angebot bearbeiten</span>
                <span className={`detail-header-sub tone-${summary.tone}`}>
                  <i />
                  <span>{summary.text}</span>
                  <ChevronDown size={14} />
                </span>
              </button>
            ) : (
              <div className="detail-header-titles">
                <h2 className="detail-header-title">Angebot bearbeiten</h2>
                <span className={`detail-header-sub tone-${summary.tone}`}><i /><span>{summary.text}</span></span>
              </div>
            )}
            <div className="detail-header-status">
              {saveStatus === 'saving' && (
                <RefreshCw size={16} className="spin" aria-label="Speichern" />
              )}
              {saveStatus === 'error' && (
                <button
                  className="detail-save-error"
                  onClick={saveDraft}
                  title="Erneut versuchen"
                >
                  <AlertCircle size={13} />
                  <span>Fehler</span>
                </button>
              )}
            </div>
            {listed.map((p) => (p.url ? (
              <a
                key={p.key}
                className={`detail-platform-link${opening === p.key ? ' opening' : ''}`}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => openListing(p)}
                aria-label={`Anzeige auf ${p.name} öffnen (${statusMeta(p.status).label})`}
                title={`Anzeige auf ${p.name} öffnen`}
              >
                <PlatformMark platform={p.key} status={p.status} />
                <span className="detail-platform-link-arrow" style={{ color: statusMeta(p.status).color, borderColor: statusMeta(p.status).color }}>
                  <ArrowUpRight size={10} strokeWidth={3} />
                </span>
              </a>
            ) : (
              <button
                key={p.key}
                className="detail-platform-link"
                onClick={() => setSheet('status')}
                aria-label={`${p.name}: ${statusMeta(p.status).label}`}
              >
                <PlatformMark platform={p.key} status={p.status} />
              </button>
            )))}
            {isAndroidApp && listed.length === 0 && (
              <button className="detail-publish-btn" onClick={() => setSheet('publish')}>
                <ArrowUp size={16} strokeWidth={2.5} />
                Einstellen
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content Container — single scroll surface, no tabs. The status section
          renders only once the item is published; the desktop publishing assist
          (copy panel + extension tip) replaces the in-app sticky bar below. */}
      <div className="detail-content-container">
        <div className="draft-detail-grid fade-in">
          {renderFormFields()}
          {renderImageBox()}
          {renderPriceComparison()}
          {renderDetectedInfo()}
          {!isAndroidApp && renderPublishingAssist()}
          {onDelete && (
            <button type="button" className="detail-delete-btn" onClick={() => setConfirmDeleteDraft(true)}>
              <Trash2 size={16} /> Angebot löschen
            </button>
          )}
        </div>
      </div>

      {/* In-app primary action: publish straight to a platform. Sits as a flex
          sibling at the bottom of the column; hidden while the keyboard is open
          (.keyboard-open on app-shell) so it never covers a focused field. */}
      {/* In-app primary actions bottom bar removed to use Bottom Sheet */}

      {/* Image Detail Popup Modal */}
      {selectedModalImage && (
        <div 
          className="image-detail-modal"
          onClick={() => setSelectedModalImage(null)}
        >
          <div 
            className="image-detail-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={getImageUrl(selectedModalImage)} 
              alt="Anzeige-Foto Großansicht" 
              className="image-detail-modal-img"
            />
          </div>
          {shownImages.length > 1 && (() => {
            const pos = shownImages.indexOf(selectedModalImage);
            const busy = imageOrder !== null;
            return (
              <div className="image-detail-modal-position" onClick={(e) => e.stopPropagation()}>
                <button
                  className="image-move-btn"
                  onClick={() => moveImage(selectedModalImage, pos - 1)}
                  disabled={busy || pos <= 0}
                  aria-label="Bild nach vorne verschieben"
                  title="Nach vorne"
                >
                  <ChevronLeft size={20} />
                </button>
                {pos === 0 ? (
                  <span className="image-cover-label"><Star size={14} /> Titelbild</span>
                ) : (
                  <button
                    className="image-cover-btn"
                    onClick={() => moveImage(selectedModalImage, 0)}
                    disabled={busy}
                  >
                    <Star size={14} /> Als Titelbild
                  </button>
                )}
                <span>{pos + 1} / {shownImages.length}</span>
                <button
                  className="image-move-btn"
                  onClick={() => moveImage(selectedModalImage, pos + 1)}
                  disabled={busy || pos >= shownImages.length - 1}
                  aria-label="Bild nach hinten verschieben"
                  title="Nach hinten"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            );
          })()}
          <div 
            className="image-detail-modal-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="btn btn-secondary"
              onClick={() => setSelectedModalImage(null)}
              style={{ minHeight: '40px', padding: '0.5rem 1.25rem' }}
            >
              Schließen
            </button>
            <button
              className="btn"
              onClick={() => handleDeleteImage(selectedModalImage)}
              style={{
                background: 'var(--danger)',
                color: '#fff',
                minHeight: '40px',
                padding: '0.5rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <Trash2 size={16} />
              Löschen
            </button>
          </div>
        </div>
      )}
      <CustomConfirmModal 
        isOpen={confirmDeleteDraft}
        onClose={() => setConfirmDeleteDraft(false)}
        onConfirm={() => { setConfirmDeleteDraft(false); onDelete(); }}
        title="Angebot löschen?"
        message={listed.some((p) => !TERMINAL.has(p.status))
          ? `Noch online auf ${listed.filter((p) => !TERMINAL.has(p.status)).map((p) => p.name).join(' und ')}. Die Anzeige dort bleibt bestehen.`
          : 'Das lässt sich nicht rückgängig machen.'}
      />
      <CustomConfirmModal
        isOpen={showDeleteConfirm}
        onClose={handleCancelDeleteImage}
        onConfirm={handleConfirmDeleteImage}
        title="Bild löschen?"
        message="Möchtest du dieses Bild wirklich aus dem Angebot löschen?"
      />

      {onlineChange && (
        <OnlineChangesSheet
          draft={draft}
          change={onlineChange}
          onApply={() => applyOnlineChanges(onlineChange)}
          onUpdate={onUpdateSuccess}
          onClose={() => setOnlineChange(null)}
        />
      )}

      {relist && (
        <RelistSheet
          draft={draft}
          platform={relist.platform}
          resumed={relist.resumed}
          initialPrice={relist.price}
          onPublish={(newPrice) => publishRelist(relist.platform, newPrice)}
          onUpdate={onUpdateSuccess}
          onClose={() => setRelist(null)}
        />
      )}

      {sheet === 'status' && (
        <StatusSheet
          draft={draft}
          priceType={priceType}
          refreshing={refreshingStatus}
          settingStatus={settingStatus}
          onRefresh={handleRefreshStatus}
          onRelist={(key) => { setSheet(null); setRelist({ platform: key, resumed: false }); }}
          onPublish={publishTo}
          onMarkSold={async (key) => { await handleSetStatus(key, 'verkauft'); setSheet(null); }}
          onDelete={deleteOnPlatform}
          onOpen={openListing}
          opening={opening}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === 'publish' && (
        <PublishSheet draft={draft} onPublish={publishTo} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

// Custom Confirmation Modal Portal
function CustomConfirmModal({ isOpen, onClose, onConfirm, title, message }) {
  if (!isOpen) return null;
  return createPortal(
    <div className="confirm-modal-overlay" onClick={onClose}>
      <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-modal-buttons">
          <button className="confirm-btn-cancel" onClick={onClose}>Abbrechen</button>
          <button className="confirm-btn-delete" onClick={onConfirm}>Löschen</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
