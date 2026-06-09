import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Copy, Check, ExternalLink, Smartphone, Monitor, RefreshCw, AlertCircle, Trash2, Plus, Sparkles, Upload, FileText, Share2, Camera, TrendingUp } from 'lucide-react';
import { updateDraft, getImageUrl, getAuthToken, uploadDraftImages, deleteDraftImage, regenerateDraftField } from '../utils/api';

export default function DraftDetail({ draft, onBack, onUpdateSuccess }) {
  const [title, setTitle] = useState(draft.title || '');
  const [description, setDescription] = useState(draft.description || '');
  const [category, setCategory] = useState(draft.category || 'Sonstiges');
  const [condition, setCondition] = useState(draft.condition || 'Gut');
  const [price, setPrice] = useState(draft.price || 0);
  
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved', 'saving', 'error'
  const [hasChanges, setHasChanges] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  const [selectedModalImage, setSelectedModalImage] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imageToDelete, setImageToDelete] = useState(null);
  
  const [regeneratingField, setRegeneratingField] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef(null);

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

  // Detect Android Webview container
  const isAndroidApp = typeof window.VintamieBridge !== 'undefined';

  const categories = [
    'Damenbekleidung',
    'Herrenbekleidung',
    'Kinder',
    'Haus & Garten',
    'Elektronik',
    'Bücher & Medien',
    'Sonstiges'
  ];

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
      category !== (draft.category || 'Sonstiges') ||
      condition !== (draft.condition || 'Gut') ||
      (parseFloat(price) || 0) !== (parseFloat(draft.price) || 0);
    
    setHasChanges(hasDiff);
  }, [title, description, category, condition, price, draft]);

  // Debounced auto-save effect
  useEffect(() => {
    if (!hasChanges) return;

    setSaveStatus('saving');
    const delayDebounceFn = setTimeout(async () => {
      try {
        const updated = await updateDraft(draft.id, {
          title,
          description,
          category,
          condition,
          price: parseFloat(price) || 0
        });
        setSaveStatus('saved');
        onUpdateSuccess(updated);
      } catch (err) {
        console.error(err);
        setSaveStatus('error');
      }
    }, 1200); // 1.2s delay for a snappy but typing-friendly feel

    return () => clearTimeout(delayDebounceFn);
  }, [title, description, category, condition, price, hasChanges]);

  // Responsive Layout detection hook
  const [activeTab, setActiveTab] = useState('edit'); // 'edit', 'publish'
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768 && window.innerHeight > window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const copyToClipboard = (text, fieldName) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePostInApp = (platform) => {
    if (isAndroidApp) {
      window.VintamieBridge.postToPlatform(draft.id, platform, getAuthToken());
    }
  };

  const openPlatformPage = (platform) => {
    const urls = {
      vinted: 'https://www.vinted.de/items/new',
      kleinanzeigen: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben.html'
    };
    window.open(urls[platform], '_blank');
  };

  const handleAddImages = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    setUploadingImage(true);
    try {
      const updated = await uploadDraftImages(draft.id, files);
      onUpdateSuccess(updated);
    } catch (err) {
      console.error(err);
      alert(`Fehler beim Hochladen der Bilder: ${err.message}`);
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
    try {
      const updated = await deleteDraftImage(draft.id, imgUrl);
      onUpdateSuccess(updated);
      
      if (selectedModalImage === imgUrl) {
        setSelectedModalImage(null);
      }
    } catch (err) {
      console.error(err);
      alert(`Fehler beim Löschen des Bildes: ${err.message}`);
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
      alert(`KI-Regenerierung fehlgeschlagen: ${err.message}`);
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
          {allImages.map((imgUrl, idx) => (
            <div 
              key={idx}
              onClick={() => setSelectedModalImage(imgUrl)}
              className="thumbnail-grid-item"
            >
              <img src={getImageUrl(imgUrl)} alt="" />
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

  const renderPublishingAssist = () => {
    return (
      <div className="detail-section-unboxed">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', marginBottom: '1.25rem', width: '100%' }}>
          <h3 className="detail-section-title" style={{ borderBottom: 'none', margin: 0, paddingBottom: 0 }}>
            <Share2 size={18} style={{ color: 'var(--primary)' }} />
            <span>Veröffentlichen</span>
          </h3>
        </div>
        
        {isAndroidApp ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
            <button 
              className="btn btn-vinted" 
              onClick={() => handlePostInApp('vinted')}
              style={{ width: '100%', minHeight: '44px', fontWeight: '700' }}
            >
              Auf Vinted einstellen
            </button>
            <button 
              className="btn btn-kleinanzeigen" 
              onClick={() => handlePostInApp('kleinanzeigen')}
              style={{ width: '100%', minHeight: '44px', fontWeight: '700' }}
            >
              Auf Kleinanzeigen einstellen
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>
            {/* Extension Guidance Info */}
            <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.825rem', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
              <Monitor size={16} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '0.15rem' }} />
              <div>
                <strong>Tipp:</strong> Nutze die Vintamie Desktop-Extension, um alle Daten automatisch mit einem Klick auszufüllen.
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
                <div className="copy-value price">{price} €</div>
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

            {/* External Platform Links */}
            <div className="platform-links-container">
              <button 
                className="btn btn-vinted platform-link-btn" 
                onClick={() => openPlatformPage('vinted')}
              >
                Vinted öffnen
                <ExternalLink size={12} style={{ marginLeft: '0.25rem' }} />
              </button>
              
              <button 
                className="btn btn-kleinanzeigen platform-link-btn" 
                onClick={() => openPlatformPage('kleinanzeigen')}
              >
                Kleinanzeigen
                <ExternalLink size={12} style={{ marginLeft: '0.25rem' }} />
              </button>
            </div>
          </div>
        )}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', marginBottom: '0.25rem' }}>
          <h3 className="detail-section-title" style={{ borderBottom: 'none', margin: 0, paddingBottom: 0 }}>
            <FileText size={18} style={{ color: 'var(--primary)' }} />
            <span>Details</span>
          </h3>
        </div>
        
        {/* Title */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label htmlFor="edit-title" style={{ marginBottom: 0 }}>Titel (max. 80 Zeichen)</label>
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
            onChange={(e) => setTitle(e.target.value.substring(0, 80))}
            placeholder={regeneratingField === 'title' ? "Generiere..." : "Titel für die Anzeige..."}
            disabled={regeneratingField === 'title'}
            style={{ opacity: regeneratingField === 'title' ? 0.6 : 1 }}
          />
          <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {title.length}/80
          </div>
        </div>

        {/* Price */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="edit-price">Preis (€)</label>
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
        </div>

        {/* Category & Condition Grid */}
        <div className="form-grid-2col form-group" style={{ marginBottom: 0 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <label htmlFor="edit-category" style={{ marginBottom: 0 }}>Kategorie</label>
            </div>
            <select 
              id="edit-category" 
              className="form-control" 
              value={category} 
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          
          <div>
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

        {/* Description */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label htmlFor="edit-desc" style={{ marginBottom: 0 }}>Verkaufsbeschreibung</label>
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
            value={description} 
            onChange={(e) => setDescription(e.target.value)}
            placeholder={regeneratingField === 'description' ? "Generiere..." : "Verkaufsbeschreibung schreiben..."}
            disabled={regeneratingField === 'description'}
            style={{ opacity: regeneratingField === 'description' ? 0.6 : 1, minHeight: '140px' }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="fade-in">
      {/* Sticky Tinder-style Header */}
      <div className="detail-sticky-header">
        <div className="detail-header-inner">
          <div className="detail-header-title-row">
            <div className="detail-header-title-container">
              <h2 className="detail-header-title">Angebot bearbeiten</h2>
            </div>
            <button className="detail-done-btn" onClick={onBack}>
              Fertig
            </button>
          </div>
          <div className="detail-tabs-row">
            <button 
              className={`detail-tab ${activeTab === 'edit' ? 'active' : ''}`}
              onClick={() => setActiveTab('edit')}
            >
              <FileText size={16} />
              <span>Übersicht</span>
            </button>
            <button 
              className={`detail-tab ${activeTab === 'publish' ? 'active' : ''}`}
              onClick={() => setActiveTab('publish')}
            >
              <Share2 size={16} />
              <span>Veröffentlichen</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content Container */}
      <div className="detail-content-container">
        {activeTab === 'edit' ? (
          <div className="draft-detail-grid fade-in">
            {renderImageBox()}
            {renderFormFields()}
            {renderPriceComparison()}
          </div>
        ) : (
          <div className="fade-in" style={{ width: '100%' }}>
            {renderPublishingAssist()}
          </div>
        )}
      </div>

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
        isOpen={showDeleteConfirm}
        onClose={handleCancelDeleteImage}
        onConfirm={handleConfirmDeleteImage}
        title="Bild löschen?"
        message="Möchtest du dieses Bild wirklich aus dem Angebot löschen?"
      />
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
