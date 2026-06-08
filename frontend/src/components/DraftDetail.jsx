import React, { useState, useEffect } from 'react';
import { ArrowLeft, Copy, Check, ExternalLink, Smartphone, Monitor, RefreshCw, AlertCircle } from 'lucide-react';
import { updateDraft, getImageUrl, getAuthToken } from '../utils/api';

export default function DraftDetail({ draft, onBack, onUpdateSuccess }) {
  const [title, setTitle] = useState(draft.title || '');
  const [description, setDescription] = useState(draft.description || '');
  const [category, setCategory] = useState(draft.category || 'Sonstiges');
  const [condition, setCondition] = useState(draft.condition || 'Gut');
  const [price, setPrice] = useState(draft.price || 0);
  
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved', 'saving', 'error'
  const [hasChanges, setHasChanges] = useState(false);
  const [copiedField, setCopiedField] = useState(null);

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
          <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
            <img 
              src={getImageUrl(activeImage)} 
              alt={title}
              style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: 'var(--radius-sm)' }}
            />
            {allImages.length > 1 && (
              <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', width: '100%', padding: '0.25rem 0' }}>
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
                  >
                    <img src={getImageUrl(imgUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            )}
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
            <label htmlFor="edit-title">Titel (max. 80 Zeichen)</label>
            <input 
              type="text" 
              id="edit-title" 
              className="form-control" 
              value={title} 
              onChange={(e) => setTitle(e.target.value.substring(0, 80))}
              placeholder="Titel für die Anzeige..."
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
              <label htmlFor="edit-category">Kategorie</label>
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
            <label htmlFor="edit-desc">Verkaufsbeschreibung</label>
            <textarea 
              id="edit-desc" 
              className="form-control" 
              value={description} 
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Verkaufsbeschreibung schreiben..."
            />
          </div>
        </div>

      </div>
    </div>
  );
}
