import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Copy, Check, ExternalLink, Smartphone, Monitor, RefreshCw, AlertCircle, Trash2, Plus, Sparkles, Upload, FileText, Share2 } from 'lucide-react';
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

  const [activeImage, setActiveImage] = useState('');

  // Reset active image if draft or parsed list changes
  useEffect(() => {
    setActiveImage(allImages[0] || '');
  }, [allImages]);

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
    'Zufriedenstellend'
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
      
      const parsed = JSON.parse(updated.image_paths || '[]');
      if (parsed.length > 0) {
        if (!activeImage || !allImages.includes(activeImage)) {
          setActiveImage(parsed[parsed.length - 1]);
        }
      }
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

  const handleDeleteImage = async (imgUrl) => {
    if (!imgUrl) return;
    if (!confirm('Möchtest du dieses Bild wirklich aus dem Entwurf löschen?')) return;
    
    try {
      const updated = await deleteDraftImage(draft.id, imgUrl);
      onUpdateSuccess(updated);
      
      const parsed = JSON.parse(updated.image_paths || '[]');
      if (activeImage === imgUrl) {
        setActiveImage(parsed[0] || '');
      }
    } catch (err) {
      console.error(err);
      alert(`Fehler beim Löschen des Bildes: ${err.message}`);
    }
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
      } else if (field === 'category') {
        setCategory(updated.category || 'Sonstiges');
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
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', position: 'relative' }}>
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

        {allImages.length > 0 ? (
          <div style={{ position: 'relative', width: '100%' }}>
            <img 
              src={getImageUrl(activeImage)} 
              alt={title}
              style={{ width: '100%', maxHeight: '240px', objectFit: 'contain', borderRadius: 'var(--radius-sm)' }}
            />
            <button
              type="button"
              onClick={() => handleDeleteImage(activeImage)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: 'rgba(239, 68, 68, 0.85)',
                border: 'none',
                color: '#fff',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease',
                zIndex: 2
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              title="Dieses Bild löschen"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ) : (
          <div 
            onClick={() => fileInputRef.current?.click()}
            style={{ 
              width: '100%', 
              height: '180px', 
              border: '2px dashed var(--glass-border)', 
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--primary)';
              e.currentTarget.style.color = 'var(--primary)';
              e.currentTarget.style.background = 'rgba(9, 176, 183, 0.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--glass-border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Upload size={28} />
            <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>Keine Bilder. Klicken zum Hinzufügen.</span>
          </div>
        )}

        {/* Thumbnails + Add Button */}
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', width: '100%', padding: '0.25rem 0', alignItems: 'center', overscrollBehaviorX: 'contain' }}>
          {allImages.map((imgUrl, idx) => (
            <div 
              key={idx}
              onClick={() => setActiveImage(imgUrl)}
              style={{ 
                width: '56px', 
                height: '56px', 
                borderRadius: 'var(--radius-sm)', 
                overflow: 'hidden', 
                cursor: 'pointer', 
                flexShrink: 0,
                border: activeImage === imgUrl ? '2px solid var(--primary)' : '1px solid var(--glass-border)',
                opacity: activeImage === imgUrl ? 1 : 0.6,
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => {
                if (activeImage !== imgUrl) e.currentTarget.style.opacity = '0.6';
              }}
            >
              <img src={getImageUrl(imgUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ))}
          
          <div 
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: 'var(--radius-sm)',
              border: '2px dashed var(--glass-border)',
              background: 'rgba(255,255,255,0.02)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              color: 'var(--text-secondary)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--primary)';
              e.currentTarget.style.color = 'var(--primary)';
              e.currentTarget.style.background = 'rgba(9, 176, 183, 0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--glass-border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
            }}
            title="Bilder hinzufügen"
          >
            <Plus size={18} />
          </div>
        </div>
      </div>
    );
  };

  const renderPublishingAssist = () => {
    return (
      <div className="glass-panel detail-panel">
        <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', fontFamily: 'var(--font-title)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Veröffentlichen Assistent
        </h3>
        
        {isAndroidApp ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(9, 176, 183, 0.05)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.825rem', border: '1px solid rgba(9, 176, 183, 0.1)', color: '#a5f3fc' }}>
              <Smartphone size={16} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '0.1rem' }} />
              <span>Vintamie-App erkannt. Autofill-Prozess startet direkt in der Plattform-WebView.</span>
            </div>
            
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
              <button 
                className="btn btn-vinted" 
                onClick={() => openPlatformPage('vinted')}
                style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.85rem', minHeight: '44px' }}
              >
                Vinted öffnen
                <ExternalLink size={12} style={{ marginLeft: '0.25rem' }} />
              </button>
              
              <button 
                className="btn btn-kleinanzeigen" 
                onClick={() => openPlatformPage('kleinanzeigen')}
                style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.85rem', minHeight: '44px' }}
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
        <div className="glass-panel detail-panel">
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Vergleichsdaten beschädigt.</p>
        </div>
      );
    }

    if (!parsedSources || parsedSources.length === 0) {
      return (
        <div className="glass-panel detail-panel">
          <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
            Marktpreis-Vergleich
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
      <div className="glass-panel detail-panel">
        <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', fontFamily: 'var(--font-title)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Marktpreis-Vergleich
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
              className="glass-card"
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
      <div className="glass-panel detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        
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
              <RefreshCw size={11} style={{ animation: regeneratingField === 'title' ? 'spin 1.5s linear infinite' : 'none', marginRight: '0.15rem' }} />
              <Sparkles size={11} style={{ display: regeneratingField === 'title' ? 'none' : 'inline' }} />
              <span>KI</span>
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
              <button 
                type="button"
                className="ki-regen-btn"
                onClick={() => handleRegenerateField('category')}
                disabled={regeneratingField !== null || allImages.length === 0}
                title={allImages.length === 0 ? "Bilder hinzufügen, um Kategorie per KI zu bestimmen" : "Kategorie per KI neu bestimmen"}
              >
                <RefreshCw size={11} style={{ animation: regeneratingField === 'category' ? 'spin 1.5s linear infinite' : 'none', marginRight: '0.15rem' }} />
                <Sparkles size={11} style={{ display: regeneratingField === 'category' ? 'none' : 'inline' }} />
                <span>KI</span>
              </button>
            </div>
            <select 
              id="edit-category" 
              className="form-control" 
              value={category} 
              onChange={(e) => setCategory(e.target.value)}
              disabled={regeneratingField === 'category'}
              style={{ opacity: regeneratingField === 'category' ? 0.6 : 1 }}
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
              <RefreshCw size={11} style={{ animation: regeneratingField === 'description' ? 'spin 1.5s linear infinite' : 'none', marginRight: '0.15rem' }} />
              <Sparkles size={11} style={{ display: regeneratingField === 'description' ? 'none' : 'inline' }} />
              <span>KI</span>
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
      {/* Top Navigation Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <button 
          className="btn btn-secondary" 
          onClick={onBack}
          style={{ padding: '0.5rem 0.85rem', minHeight: '38px', gap: '0.25rem', fontSize: '0.85rem' }}
        >
          <ArrowLeft size={15} />
          Zurück
        </button>

        {/* Auto-Save Status Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: '600' }}>
          {saveStatus === 'saved' && (
            <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Check size={15} />
              <span style={{ fontSize: '0.8rem' }}>Gesichert</span>
            </span>
          )}
          {saveStatus === 'saving' && (
            <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <RefreshCw size={12} style={{ animation: 'spin 1.5s linear infinite' }} />
              <span style={{ fontSize: '0.8rem' }}>Sichert...</span>
            </span>
          )}
          {saveStatus === 'error' && (
            <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <AlertCircle size={15} />
              <span style={{ fontSize: '0.8rem' }}>Speicherfehler</span>
            </span>
          )}
        </div>
        
        <button 
          className="btn btn-primary" 
          onClick={onBack}
          style={{ padding: '0.5rem 1.15rem', minHeight: '38px', fontSize: '0.85rem' }}
        >
          Fertig
        </button>
      </div>

      {/* Mobile Tab Navigation */}
      {isMobile && (
        <div className="detail-tabs-header">
          <div className="segmented-control">
            <button 
              className={`segmented-control-btn ${activeTab === 'edit' ? 'active' : ''}`}
              onClick={() => setActiveTab('edit')}
            >
              <FileText size={15} />
              <span>Details & Fotos</span>
            </button>
            <button 
              className={`segmented-control-btn ${activeTab === 'publish' ? 'active' : ''}`}
              onClick={() => setActiveTab('publish')}
            >
              <Share2 size={15} />
              <span>Veröffentlichen</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Grid */}
      {isMobile ? (
        <div className="draft-detail-grid fade-in">
          {activeTab === 'edit' ? (
            <>
              {renderImageBox()}
              {renderFormFields()}
            </>
          ) : (
            <>
              {renderPublishingAssist()}
              {renderPriceComparison()}
            </>
          )}
        </div>
      ) : (
        <div className="draft-detail-grid">
          {/* Left Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {renderImageBox()}
            {renderPublishingAssist()}
            {renderPriceComparison()}
          </div>
          {/* Right Column */}
          {renderFormFields()}
        </div>
      )}
    </div>
  );
}
