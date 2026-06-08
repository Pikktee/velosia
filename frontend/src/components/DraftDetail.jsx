import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Copy, Check, ExternalLink, Smartphone, Monitor, RefreshCw, AlertCircle, Trash2, Plus, Sparkles, Upload } from 'lucide-react';
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

  const copyToClipboard = (text, fieldName) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePostInApp = (platform) => {
    if (isAndroidApp) {
      // Call Android JavascriptInterface with JWT Token
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

  return (
    <div className="fade-in">
      {/* Top Navigation Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <button 
          className="btn btn-secondary" 
          onClick={onBack}
          style={{ padding: '0.5rem 1rem', minHeight: 'auto', gap: '0.25rem' }}
        >
          <ArrowLeft size={16} />
          Zurück
        </button>

        {/* Auto-Save Status Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: '500' }}>
          {saveStatus === 'saved' && (
            <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Check size={16} />
              <span>Entwurf gesichert</span>
            </span>
          )}
          {saveStatus === 'saving' && (
            <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <RefreshCw size={14} style={{ animation: 'spin 1.5s linear infinite' }} />
              <span>Sichert...</span>
            </span>
          )}
          {saveStatus === 'error' && (
            <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <AlertCircle size={16} />
              <span>Fehler beim Speichern</span>
            </span>
          )}
        </div>
        
        <button 
          className="btn btn-primary" 
          onClick={onBack}
          style={{ padding: '0.5rem 1.25rem', minHeight: 'auto' }}
        >
          Fertig
        </button>
      </div>

      {/* Persistence Banner */}
      <div style={{ 
        padding: '0.75rem 1rem', 
        borderRadius: 'var(--radius-sm)', 
        marginBottom: '1.5rem',
        fontSize: '0.825rem',
        background: 'rgba(9, 176, 183, 0.1)',
        color: '#a5f3fc',
        border: '1px solid rgba(9, 176, 183, 0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        lineHeight: '1.4'
      }}>
        <span style={{ fontSize: '1rem' }}>✨</span>
        <span>Dieser Entwurf wurde bereits automatisch gespeichert. Deine Änderungen werden in Echtzeit synchronisiert.</span>
      </div>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
        
        {/* Left Section: Image and Publishing Helper */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Image Box */}
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
                  style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: 'var(--radius-sm)' }}
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
                  height: '200px', 
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
                <Upload size={32} />
                <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>Keine Bilder. Klicken zum Hinzufügen.</span>
              </div>
            )}

            {/* Thumbnails + Add Button */}
            <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', width: '100%', padding: '0.25rem 0', alignItems: 'center' }}>
              {allImages.map((imgUrl, idx) => (
                <div 
                  key={idx}
                  onClick={() => setActiveImage(imgUrl)}
                  style={{ 
                    width: '60px', 
                    height: '60px', 
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
              
              {/* Styled Plus Thumbnail for adding new images */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '60px',
                  height: '60px',
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
                <Plus size={20} />
              </div>
            </div>
          </div>

          {/* Publishing Assist Panel */}
          <div className="glass-panel detail-panel">
            <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', fontFamily: 'var(--font-title)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Veröffentlichen Assistent
            </h3>
            
            {isAndroidApp ? (
              // Android App View (WebView Shell Integration)
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(9, 176, 183, 0.05)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', border: '1px solid rgba(9, 176, 183, 0.1)' }}>
                  <Smartphone size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  <span>Vintamie-App erkannt. Tippe auf eine Plattform, um den WebView-Autofill zu starten.</span>
                </div>
                
                <button 
                  className="btn btn-primary" 
                  onClick={() => handlePostInApp('vinted')}
                  style={{ width: '100%', background: '#09b0b7', color: '#000' }}
                >
                  Auf Vinted einstellen
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => handlePostInApp('kleinanzeigen')}
                  style={{ width: '100%' }}
                >
                  Auf Kleinanzeigen einstellen
                </button>
              </div>
            ) : (
              // Browser View (Extension Autofill + Manual Copy Fallback)
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* Extension Guidance Info */}
                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
                  <Monitor size={16} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '0.15rem' }} />
                  <div>
                    <strong>Tipp:</strong> Nutze die Vintamie Chrome/Firefox-Extension am PC, um diese Details mit einem Klick auszufüllen.
                  </div>
                </div>

                {/* Quick Copy fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid var(--glass-border)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', width: '60px' }}>Titel</div>
                    <div style={{ fontSize: '0.9rem', flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{title}</div>
                    <button 
                      className="btn" 
                      onClick={() => copyToClipboard(title, 'title')}
                      style={{ padding: '0.25rem', minHeight: 'auto', background: 'transparent', color: copiedField === 'title' ? 'var(--success)' : 'var(--text-secondary)' }}
                    >
                      {copiedField === 'title' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid var(--glass-border)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', width: '60px' }}>Preis</div>
                    <div style={{ fontSize: '0.9rem', flexGrow: 1, fontWeight: '700', minWidth: 0 }}>{price} €</div>
                    <button 
                      className="btn" 
                      onClick={() => copyToClipboard(price.toString(), 'price')}
                      style={{ padding: '0.25rem', minHeight: 'auto', background: 'transparent', color: copiedField === 'price' ? 'var(--success)' : 'var(--text-secondary)' }}
                    >
                      {copiedField === 'price' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Beschreibung</span>
                      <button 
                        className="btn" 
                        onClick={() => copyToClipboard(description, 'desc')}
                        style={{ padding: '0.25rem', minHeight: 'auto', background: 'transparent', color: copiedField === 'desc' ? 'var(--success)' : 'var(--text-secondary)' }}
                      >
                        {copiedField === 'desc' ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', maxHeight: '60px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                      {description}
                    </div>
                  </div>
                </div>

                {/* External links */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={() => openPlatformPage('vinted')}
                    style={{ flexGrow: 1, flexBasis: '130px', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                  >
                    Vinted öffnen
                    <ExternalLink size={12} />
                  </button>
                  
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => openPlatformPage('kleinanzeigen')}
                    style={{ flexGrow: 1, flexBasis: '130px', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                  >
                    Kleinanzeigen
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Price Comparison Sources Panel */}
          {draft.sources && (
            <div className="glass-panel detail-panel">
              <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', fontFamily: 'var(--font-title)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Vergleichsangebote (Quellen)
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(() => {
                  try {
                    const parsedSources = JSON.parse(draft.sources);
                    if (!parsedSources || parsedSources.length === 0) {
                      return <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Keine Vergleichsdaten gefunden.</p>;
                    }
                    return parsedSources.map((src, idx) => (
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
                          padding: '0.75rem 1rem',
                          textDecoration: 'none',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                          border: '1px solid var(--glass-border)'
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
                    ));
                  } catch (e) {
                    return <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Vergleichsdaten beschädigt.</p>;
                  }
                })()}
              </div>
            </div>
          )}

        </div>

        {/* Right Section: Form Inputs */}
        <div className="glass-panel detail-panel">
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label htmlFor="edit-title" style={{ marginBottom: 0 }}>Titel (max. 80 Zeichen)</label>
              <button 
                type="button"
                onClick={() => handleRegenerateField('title')}
                disabled={regeneratingField !== null || allImages.length === 0}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: regeneratingField === 'title' ? 'var(--primary)' : 'var(--text-secondary)',
                  cursor: allImages.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  opacity: allImages.length === 0 ? 0.35 : 1,
                  padding: '0.25rem',
                  borderRadius: '4px',
                  transition: 'all 0.2s ease',
                  outline: 'none'
                }}
                title={allImages.length === 0 ? "Bilder hinzufügen, um Titel per KI zu generieren" : "Titel per KI neu generieren"}
              >
                <RefreshCw size={13} style={{ animation: regeneratingField === 'title' ? 'spin 1.5s linear infinite' : 'none' }} />
                <span>KI-Regen</span>
              </button>
            </div>
            <input 
              type="text" 
              id="edit-title" 
              className="form-control" 
              value={title} 
              onChange={(e) => setTitle(e.target.value.substring(0, 80))}
              placeholder={regeneratingField === 'title' ? "Titel wird per KI generiert..." : "Titel für die Anzeige..."}
              disabled={regeneratingField === 'title'}
              style={{ opacity: regeneratingField === 'title' ? 0.6 : 1 }}
            />
            <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {title.length}/80
            </div>
          </div>

          <div className="form-group">
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

          <div className="form-grid-2col form-group">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label htmlFor="edit-category" style={{ marginBottom: 0 }}>Kategorie</label>
                <button 
                  type="button"
                  onClick={() => handleRegenerateField('category')}
                  disabled={regeneratingField !== null || allImages.length === 0}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: regeneratingField === 'category' ? 'var(--primary)' : 'var(--text-secondary)',
                    cursor: allImages.length === 0 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    opacity: allImages.length === 0 ? 0.35 : 1,
                    padding: '0.25rem',
                    borderRadius: '4px',
                    transition: 'all 0.2s ease',
                    outline: 'none'
                  }}
                  title={allImages.length === 0 ? "Bilder hinzufügen, um Kategorie per KI zu bestimmen" : "Kategorie per KI neu bestimmen"}
                >
                  <RefreshCw size={11} style={{ animation: regeneratingField === 'category' ? 'spin 1.5s linear infinite' : 'none' }} />
                  <span>KI-Regen</span>
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
              <label htmlFor="edit-condition">Zustand</label>
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

          <div className="form-group" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label htmlFor="edit-desc" style={{ marginBottom: 0 }}>Verkaufsbeschreibung</label>
              <button 
                type="button"
                onClick={() => handleRegenerateField('description')}
                disabled={regeneratingField !== null || allImages.length === 0}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: regeneratingField === 'description' ? 'var(--primary)' : 'var(--text-secondary)',
                  cursor: allImages.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  opacity: allImages.length === 0 ? 0.35 : 1,
                  padding: '0.25rem',
                  borderRadius: '4px',
                  transition: 'all 0.2s ease',
                  outline: 'none'
                }}
                title={allImages.length === 0 ? "Bilder hinzufügen, um Beschreibung per KI zu generieren" : "Beschreibung per KI neu generieren"}
              >
                <RefreshCw size={13} style={{ animation: regeneratingField === 'description' ? 'spin 1.5s linear infinite' : 'none' }} />
                <span>KI-Regen</span>
              </button>
            </div>
            <textarea 
              id="edit-desc" 
              className="form-control" 
              value={description} 
              onChange={(e) => setDescription(e.target.value)}
              placeholder={regeneratingField === 'description' ? "Beschreibung wird per KI generiert..." : "Verkaufsbeschreibung schreiben..."}
              disabled={regeneratingField === 'description'}
              style={{ opacity: regeneratingField === 'description' ? 0.6 : 1 }}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
