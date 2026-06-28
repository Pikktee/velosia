import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Image as ImageIcon, Images, Sparkles, X, RotateCw, AlertCircle, Rocket, Trash2, Wand2, Layers, ChevronLeft, ChevronRight } from 'lucide-react';

const CameraCapture = ({
  selectedImages = [],
  setSelectedImages,
  turbo = false,
  onAnalysisStart,
  onTurboFinish,
  analysisError,
  onClearError,
  onClose
}) => {
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' or 'user'
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(
    () => turbo && !localStorage.getItem('velosia_turbo_onboarded')
  );

  const dismissOnboarding = () => {
    try { localStorage.setItem('velosia_turbo_onboarded', '1'); } catch (e) { /* ignore */ }
    setShowOnboarding(false);
  };

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const startCamera = async () => {
    stopCamera(); // Make sure previous stream is stopped
    setError(null);
    try {
      const constraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Kamera-Zugriffsfehler:", err);
      setError("Kamera konnte nicht gestartet werden. Bitte erteile die Berechtigung.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };



  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Start stream on mount or when facingMode changes
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [facingMode]);

  const toggleFacingMode = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  const handleFiles = (filesList) => {
    setError(null);
    const newImages = [];
    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      if (file.type.startsWith('image/')) {
        newImages.push({
          id: `${Date.now()}-${Math.random()}`,
          file,
          previewUrl: URL.createObjectURL(file)
        });
      }
    }
    if (newImages.length > 0) {
      setSelectedImages(prev => [...prev, ...newImages]);
    } else {
      setError('Bitte wähle gültige Bilddateien aus.');
    }
  };

  const handleInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    if (navigator.vibrate) {
      try { navigator.vibrate([15]); } catch (e) { /* ignore */ }
    }

    // Trigger flash animation
    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    try {
      const canvas = document.createElement('canvas');
      // Use actual video source dimensions
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      
      const ctx = canvas.getContext('2d');
      // If user camera is used, mirror the image back
      if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Generate a fast, lightweight preview synchronously
      let previewUrl = '';
      try {
        const thumbCanvas = document.createElement('canvas');
        const maxThumbDim = 120;
        let thumbW = canvas.width;
        let thumbH = canvas.height;
        if (thumbW > thumbH) {
          if (thumbW > maxThumbDim) {
            thumbH = Math.round((thumbH * maxThumbDim) / thumbW);
            thumbW = maxThumbDim;
          }
        } else {
          if (thumbH > maxThumbDim) {
            thumbW = Math.round((thumbW * maxThumbDim) / thumbH);
            thumbH = maxThumbDim;
          }
        }
        thumbCanvas.width = thumbW;
        thumbCanvas.height = thumbH;
        const thumbCtx = thumbCanvas.getContext('2d');
        thumbCtx.drawImage(canvas, 0, 0, thumbW, thumbH);
        previewUrl = thumbCanvas.toDataURL('image/jpeg', 0.65);
      } catch (thumbErr) {
        console.error("Failed to generate fast preview:", thumbErr);
      }

      const tempId = `${Date.now()}-${Math.random()}`;

      // Insert thumbnail placeholder instantly
      setSelectedImages(prev => [
        ...prev,
        {
          id: tempId,
          file: null,
          previewUrl: previewUrl,
          isCompressing: true
        }
      ]);

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
          setSelectedImages(prev => 
            prev.map(img => img.id === tempId ? { ...img, file, isCompressing: false } : img)
          );
        } else {
          // Remove the image if compression failed
          setSelectedImages(prev => prev.filter(img => img.id !== tempId));
          setError("Foto konnte nicht komprimiert werden.");
        }
      }, 'image/jpeg', 0.85);
    } catch (err) {
      console.error("Fehler beim Fotografieren:", err);
      setError("Foto konnte nicht aufgenommen werden.");
    }
  };

  const removeImage = (idToRemove) => {
    setSelectedImages(prev => {
      const target = prev.find(img => img.id === idToRemove);
      if (target && target.previewUrl && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter(img => img.id !== idToRemove);
    });
  };



  return (
    <div className="camera-container">
      {/* Analysis Error Banner */}
      {analysisError && (
        <div style={{
          position: 'absolute',
          top: 'calc(12px + env(safe-area-inset-top, 0px))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 2.5rem)',
          maxWidth: '360px',
          background: 'rgba(239, 68, 68, 0.2)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          color: '#fca5a5',
          fontSize: '0.85rem',
          zIndex: 140,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)'
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0, color: '#f87171' }} />
          <span style={{ flexGrow: 1, lineHeight: '1.3' }}>{analysisError}</span>
          <button 
            onClick={onClearError}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fca5a5',
              cursor: 'pointer',
              padding: '0.2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Permanent small TURBO indicator */}
      {turbo && !error && (
        <div className="camera-turbo-pill">
          <Rocket size={13} strokeWidth={2.5} />
          <span>TURBO</span>
        </div>
      )}

      {/* Hidden inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />

      {/* Live Video Feed or Fallback */}
      {error ? (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          background: '#0e121a',
          zIndex: 2
        }}>
          <Upload size={48} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>Kamera nicht aktiv</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem', maxWidth: '300px' }}>
            {error}
          </p>
          <button
            className="btn btn-primary"
            onClick={triggerFileInput}
            style={{ padding: '0.5rem 1.5rem' }}
          >
            Fotos auswählen
          </button>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            background: '#000',
            transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
            zIndex: 1
          }}
        />
      )}

      {/* Flash Overlay */}
      {flash && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: '#fff',
          opacity: 0.8,
          zIndex: 10,
          pointerEvents: 'none'
        }} />
      )}

      {/* Floating Camera Actions Overlay (Flip, Close) */}
      <div className="camera-overlay-top">
        {!error && (
          <button
            className="btn btn-secondary"
            onClick={toggleFacingMode}
            style={{ 
              minHeight: 'auto', 
              width: '40px',
              height: '40px',
              padding: 0, 
              borderRadius: '50%', 
              background: 'rgba(15, 18, 27, 0.65)', 
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid var(--glass-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Kamera wechseln"
          >
            <RotateCw size={18} style={{ color: '#fff' }} />
          </button>
        )}
        
        <button
          className="btn btn-secondary"
          onClick={onClose}
          style={{ 
            minHeight: 'auto', 
            width: '40px',
            height: '40px',
            padding: 0, 
            borderRadius: '50%', 
            background: 'rgba(15, 18, 27, 0.65)', 
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Kamera schließen"
        >
          <X size={18} style={{ color: '#fff' }} />
        </button>
      </div>

      {/* Gradient scrim behind the controls (bottom in portrait, right strip in landscape) */}
      <div className="camera-scrim" aria-hidden="true" />

      {/* Captured photos cluster: review chip + thumbnail strip */}
      {selectedImages.length > 0 && (
        <div className="camera-captured">
          <button className="camera-review-chip" onClick={() => setShowReview(true)}>
            <Images size={15} />
            <span>{selectedImages.length} {selectedImages.length === 1 ? 'Foto' : 'Fotos'}</span>
          </button>

          <div className="camera-thumbnails-container">
            {selectedImages.map((img) => (
              <div key={img.id} style={{
                position: 'relative',
                width: '48px',
                height: '48px',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                flexShrink: 0,
                border: '2px solid var(--primary)',
                boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                opacity: img.isCompressing ? 0.7 : 1
              }}>
                <img src={img.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {img.isCompressing && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <div className="status-dot online" style={{ width: '8px', height: '8px' }} />
                  </div>
                )}
                <button
                  onClick={() => removeImage(img.id)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    background: 'rgba(239, 68, 68, 0.95)',
                    border: 'none',
                    borderRadius: '0 0 0 6px',
                    width: '16px',
                    height: '16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <X size={10} style={{ color: '#fff' }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Primary controls: gallery / shutter / done.
          The grid in CSS keeps the shutter locked dead-centre. */}
      <div className="camera-controls">
        {/* Gallery */}
        <button
          className="btn btn-secondary camera-ctrl camera-ctrl-gallery"
          onClick={triggerFileInput}
          style={{
            minHeight: 'auto',
            width: '48px',
            height: '48px',
            padding: 0,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Aus Galerie wählen"
        >
          <ImageIcon size={20} style={{ color: '#fff' }} />
        </button>

        {/* Shutter */}
        {!error && (
          <button
            className="camera-shutter-btn"
            onClick={capturePhoto}
            title="Foto aufnehmen"
          >
            <div className="camera-shutter-btn-inner" />
          </button>
        )}

        {/* Done / Analyze */}
        {selectedImages.length > 0 && (
          <button
            className="btn btn-primary camera-ctrl camera-ctrl-done"
            onClick={turbo ? onTurboFinish : onAnalysisStart}
            disabled={selectedImages.some(img => img.isCompressing)}
            style={{
              minHeight: 'auto',
              padding: '0.65rem 1rem',
              borderRadius: '99px',
              fontSize: '0.85rem',
              background: 'linear-gradient(135deg, var(--secondary) 0%, #d53f8c 100%)',
              color: '#fff',
              border: 'none',
              fontWeight: 'bold',
              boxShadow: '0 4px 12px var(--secondary-glow)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              whiteSpace: 'nowrap',
              opacity: selectedImages.some(img => img.isCompressing) ? 0.6 : 1,
              cursor: selectedImages.some(img => img.isCompressing) ? 'not-allowed' : 'pointer'
            }}
          >
            {turbo ? (
              <>
                <Rocket size={14} />
                <span>Fertig</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>Los!</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Full-screen review: see all captured photos and remove any of them */}
      {showReview && (
        <PhotoReview
          images={selectedImages}
          onRemove={removeImage}
          onClose={() => setShowReview(false)}
        />
      )}

      {/* One-time turbo onboarding */}
      {turbo && showOnboarding && (
        <div className="turbo-onboarding-overlay">
          <div className="turbo-onboarding-card">
            <div className="turbo-onboarding-rocket">
              <Rocket size={30} strokeWidth={2} />
            </div>
            <h2>Turbo-Modus</h2>
            <p>Erfasse viele Artikel in einem Rutsch – Velosia erledigt den Rest.</p>

            <div className="turbo-onboarding-steps">
              <div className="turbo-onboarding-step">
                <div className="turbo-onboarding-step-icon"><Camera size={18} /></div>
                <span>Fotografiere nacheinander <strong>alle Artikel</strong> – so viele Fotos du möchtest.</span>
              </div>
              <div className="turbo-onboarding-step">
                <div className="turbo-onboarding-step-icon"><Wand2 size={18} /></div>
                <span>Die <strong>KI erkennt automatisch</strong>, welche Fotos zum selben Artikel gehören.</span>
              </div>
              <div className="turbo-onboarding-step">
                <div className="turbo-onboarding-step-icon"><Layers size={18} /></div>
                <span>Daraus entstehen <strong>mehrere fertige Angebote</strong> auf einmal.</span>
              </div>
            </div>

            <button className="turbo-onboarding-cta" onClick={dismissOnboarding}>
              <Rocket size={16} /> Los geht's!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Full-screen photo review. Portrait: 2-column grid. Landscape: swipeable carousel
// (centered main photo, dimmed neighbors on each side).
const PhotoReview = ({ images, onRemove, onClose }) => {
  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches
  );
  const [active, setActive] = useState(0);
  const trackRef = useRef(null);
  const slideRefs = useRef([]);
  const rafRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e) => setIsLandscape(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Keep active index valid as photos get removed
  useEffect(() => {
    if (active > images.length - 1) {
      setActive(Math.max(0, images.length - 1));
    }
  }, [images.length, active]);

  const count = images.length;

  const scrollToIndex = (i, smooth = true) => {
    const node = slideRefs.current[i];
    if (node) {
      node.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
    }
  };

  const goPrev = () => scrollToIndex(Math.max(0, active - 1));
  const goNext = () => scrollToIndex(Math.min(count - 1, active + 1));

  // Derive the active (centered) slide from the native scroll position.
  const handleScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = trackRef.current;
      if (!el) return;
      const center = el.scrollLeft + el.clientWidth / 2;
      let nearest = 0;
      let nearestDist = Infinity;
      slideRefs.current.forEach((node, i) => {
        if (!node) return;
        const nodeCenter = node.offsetLeft + node.offsetWidth / 2;
        const dist = Math.abs(nodeCenter - center);
        if (dist < nearestDist) { nearestDist = dist; nearest = i; }
      });
      setActive(nearest);
    });
  };

  // Centre the active photo when the carousel first appears (landscape entry).
  useEffect(() => {
    if (isLandscape && count > 0) {
      scrollToIndex(active, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLandscape]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <div className="camera-review-overlay">
      <div className="camera-review-header">
        <h3>
          <Images size={18} />
          {count} {count === 1 ? 'Foto' : 'Fotos'}
          {isLandscape && count > 0 && (
            <span className="camera-review-counter">{active + 1} / {count}</span>
          )}
        </h3>
        <button className="camera-review-close" onClick={onClose} title="Zurück zur Kamera">
          <X size={20} />
        </button>
      </div>

      {count === 0 ? (
        <div className="camera-review-empty">
          <ImageIcon size={40} style={{ opacity: 0.5 }} />
          <p>Keine Fotos mehr vorhanden.<br />Nimm neue Fotos auf.</p>
        </div>
      ) : isLandscape ? (
        <div className="camera-review-carousel-wrap">
          <div className="camera-review-track" ref={trackRef} onScroll={handleScroll}>
            {images.map((img, idx) => {
              const isCurrent = idx === active;
              return (
                <div
                  key={img.id}
                  ref={(el) => { slideRefs.current[idx] = el; }}
                  className={`camera-review-slide ${isCurrent ? 'is-current' : ''}`}
                  onClick={() => { if (!isCurrent) scrollToIndex(idx); }}
                >
                  <div className="camera-review-slide-inner">
                    <img src={img.previewUrl} alt={`Foto ${idx + 1}`} />
                    {isCurrent && (
                      <button
                        className="camera-review-cell-delete"
                        onClick={(e) => { e.stopPropagation(); onRemove(img.id); }}
                        title="Foto entfernen"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {active > 0 && (
            <button className="camera-review-nav prev" onClick={goPrev} title="Vorheriges Foto">
              <ChevronLeft size={24} />
            </button>
          )}
          {active < count - 1 && (
            <button className="camera-review-nav next" onClick={goNext} title="Nächstes Foto">
              <ChevronRight size={24} />
            </button>
          )}
        </div>
      ) : (
        <div className="camera-review-grid">
          {images.map((img, idx) => (
            <div
              key={img.id}
              className="camera-review-cell"
              style={{ opacity: img.isCompressing ? 0.6 : 1 }}
            >
              <img src={img.previewUrl} alt={`Foto ${idx + 1}`} />
              <span className="camera-review-cell-index">{idx + 1}</span>
              <button
                className="camera-review-cell-delete"
                onClick={() => onRemove(img.id)}
                title="Foto entfernen"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CameraCapture;
