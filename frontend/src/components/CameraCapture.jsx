import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Image as ImageIcon, Sparkles, X, RotateCw, AlertCircle } from 'lucide-react';

const CameraCapture = ({ 
  selectedImages = [], 
  setSelectedImages, 
  onAnalysisStart, 
  analysisError, 
  onClearError, 
  onClose 
}) => {
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' or 'user'
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);

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
      
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
          setSelectedImages(prev => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random()}`,
              file,
              previewUrl: URL.createObjectURL(file)
            }
          ]);
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
      if (target) {
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

      {/* Camera Controls Overlay (Gallery, Shutter, Analyze) */}
      <div className="camera-overlay-bottom">
        
        {/* Captured Thumbnails in Camera view */}
        {selectedImages.length > 0 && (
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
                boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
              }}>
                <img src={img.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
        )}

        {/* Action Buttons Row */}
        <div className="camera-actions-row">
          {/* Left: Gallery Button Wrapper */}
          <div style={{ width: '110px', display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
            <button
              className="btn btn-secondary"
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
          </div>

          {/* Center: Shutter Button */}
          <div style={{ width: '72px', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {!error && (
              <button
                className="camera-shutter-btn"
                onClick={capturePhoto}
                title="Foto aufnehmen"
              >
                <div className="camera-shutter-btn-inner" />
              </button>
            )}
          </div>

          {/* Right: Done/Analyze Button Wrapper */}
          <div style={{ width: '110px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            {selectedImages.length > 0 && (
              <button
                className="btn btn-primary"
                onClick={onAnalysisStart}
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
                  whiteSpace: 'nowrap'
                }}
              >
                <Sparkles size={14} />
                <span>Analysieren</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CameraCapture;
