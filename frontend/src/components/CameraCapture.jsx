import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Image as ImageIcon, Sparkles, AlertCircle, X, RotateCw, Trash2 } from 'lucide-react';
import { uploadAndAnalyze } from '../utils/api';

export default function CameraCapture({ onAnalysisStart, onAnalysisSuccess, onAnalysisError, initialError }) {
  const [selectedImages, setSelectedImages] = useState([]); // Array of { id, file, previewUrl }
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' or 'user'
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(initialError);
  const [flash, setFlash] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Watch camera active state to start/stop stream
  useEffect(() => {
    if (isCameraActive) {
      startCamera();
    } else {
      stopCamera();
    }
  }, [isCameraActive, facingMode]);

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
      setIsCameraActive(false);
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

  const handleUploadAndAnalyze = async () => {
    if (selectedImages.length === 0) return;
    
    setUploading(true);
    setError(null);
    onAnalysisStart();

    try {
      // Send array of file objects to api
      const filesToSend = selectedImages.map(img => img.file);
      const result = await uploadAndAnalyze(filesToSend);
      
      // Revoke preview URLs
      selectedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
      setSelectedImages([]);
      
      onAnalysisSuccess(result);
    } catch (err) {
      console.error(err);
      const errMsg = err.message || 'Die Analyse ist fehlgeschlagen. Versuche es erneut.';
      setError(errMsg);
      onAnalysisError(errMsg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center', marginBottom: '2rem', overflow: 'hidden' }}>
        
        {/* Header */}
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
          Neues Angebot erstellen
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Fotografiere deinen Artikel aus verschiedenen Blickwinkeln (z.B. vorne, hinten, Etikett) für die beste KI-Analyse.
        </p>

        {/* Hidden inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />

        {/* CAMERA SCREEN MODE */}
        {isCameraActive ? (
          <div style={{ position: 'relative', width: '100%', marginBottom: '1.5rem', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#000' }}>
            
            {/* Live Video Feed */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                maxHeight: '400px',
                objectFit: 'cover',
                background: '#000',
                transform: facingMode === 'user' ? 'scaleX(-1)' : 'none'
              }}
            />

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

            {/* Floating Camera Actions Overlay */}
            <div style={{
              position: 'absolute',
              top: '0.75rem',
              right: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              zIndex: 5
            }}>
              <button
                className="btn btn-secondary"
                onClick={toggleFacingMode}
                style={{ minHeight: 'auto', padding: '0.5rem', borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none' }}
                title="Kamera wechseln"
              >
                <RotateCw size={18} style={{ color: '#fff' }} />
              </button>
              
              <button
                className="btn btn-secondary"
                onClick={() => setIsCameraActive(false)}
                style={{ minHeight: 'auto', padding: '0.5rem', borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none' }}
                title="Kamera schließen"
              >
                <X size={18} style={{ color: '#fff' }} />
              </button>
            </div>

            {/* Camera Controls Footer (Inside Stream Frame) */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              alignItems: 'center',
              zIndex: 5
            }}>
              
              {/* Captured Thumbnails in Camera view */}
              {selectedImages.length > 0 && (
                <div style={{
                  display: 'flex',
                  gap: '0.5rem',
                  overflowX: 'auto',
                  width: '100%',
                  justifyContent: 'center',
                  padding: '0.25rem 0',
                  maxHeight: '60px'
                }}>
                  {selectedImages.map((img) => (
                    <div key={img.id} style={{ position: 'relative', width: '45px', height: '45px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--primary)' }}>
                      <img src={img.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button
                        onClick={() => removeImage(img.id)}
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          background: 'rgba(239, 68, 68, 0.85)',
                          border: 'none',
                          borderRadius: '0 0 0 4px',
                          padding: '1px',
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
              <div style={{ display: 'flex', width: '100%', justifyContent: 'space-around', alignItems: 'center', maxWidth: '280px' }}>
                {/* Gallery Button */}
                <button
                  className="btn btn-secondary"
                  onClick={triggerFileInput}
                  style={{ minHeight: 'auto', padding: '0.75rem', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}
                  title="Aus Galerie wählen"
                >
                  <ImageIcon size={20} style={{ color: '#fff' }} />
                </button>

                {/* Shutter Button */}
                <button
                  onClick={capturePhoto}
                  style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%',
                    background: '#fff',
                    border: '5px solid var(--primary)',
                    cursor: 'pointer',
                    boxShadow: '0 0 15px rgba(9, 176, 183, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'transform 0.1s ease'
                  }}
                  onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.9)'}
                  onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.9)'}
                  onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  title="Foto aufnehmen"
                >
                  <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#fff' }} />
                </button>

                {/* Done/Close Button */}
                <button
                  className="btn btn-primary"
                  onClick={() => setIsCameraActive(false)}
                  style={{
                    minHeight: 'auto',
                    padding: '0.6rem 1rem',
                    borderRadius: '99px',
                    fontSize: '0.8rem',
                    background: 'var(--primary)',
                    color: '#000',
                    border: 'none',
                    fontWeight: 'bold'
                  }}
                >
                  Fertig
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* STANDARD DASHBOARD VIEW */
          <div>
            {selectedImages.length > 0 ? (
              /* Selected Images Preview Grid */
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                  gap: '0.75rem',
                  marginBottom: '1.5rem',
                  background: 'rgba(0,0,0,0.15)',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--glass-border)'
                }}>
                  {selectedImages.map((img, index) => (
                    <div
                      key={img.id}
                      style={{
                        position: 'relative',
                        aspectRatio: '1',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden',
                        border: '1px solid var(--glass-border)',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
                      }}
                    >
                      <img src={img.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      
                      {/* Image Number Badge */}
                      <span style={{
                        position: 'absolute',
                        bottom: '0.25rem',
                        left: '0.25rem',
                        background: 'rgba(0,0,0,0.7)',
                        color: '#fff',
                        fontSize: '0.65rem',
                        padding: '2px 5px',
                        borderRadius: '4px',
                        fontWeight: 'bold'
                      }}>
                        {index + 1}
                      </span>

                      {/* Remove Button */}
                      <button
                        onClick={() => removeImage(img.id)}
                        style={{
                          position: 'absolute',
                          top: '0.25rem',
                          right: '0.25rem',
                          background: 'rgba(239, 68, 68, 0.9)',
                          border: 'none',
                          borderRadius: '50%',
                          width: '20px',
                          height: '20px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 5px rgba(0,0,0,0.3)'
                        }}
                        title="Bild entfernen"
                      >
                        <Trash2 size={12} style={{ color: '#fff' }} />
                      </button>
                    </div>
                  ))}

                  {/* Add more placeholder */}
                  <div
                    onClick={triggerFileInput}
                    style={{
                      aspectRatio: '1',
                      borderRadius: 'var(--radius-sm)',
                      border: '2px dashed var(--glass-border)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      background: 'rgba(255,255,255,0.01)',
                      color: 'var(--text-secondary)',
                      gap: '0.25rem',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--glass-border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    <Upload size={16} />
                    <span style={{ fontSize: '0.7rem' }}>Mehr laden</span>
                  </div>
                </div>

                {/* Grid Buttons */}
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setIsCameraActive(true)}
                    style={{ flex: 1, minHeight: 'auto', padding: '0.75rem' }}
                  >
                    <Camera size={16} />
                    Foto aufnehmen
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={triggerFileInput}
                    style={{ flex: 1, minHeight: 'auto', padding: '0.75rem' }}
                  >
                    <Upload size={16} />
                    Galerie wählen
                  </button>
                </div>
              </div>
            ) : (
              /* Drag & Drop Area when Empty */
              <div
                onClick={triggerFileInput}
                style={{
                  border: '2px dashed var(--glass-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '3rem 2rem',
                  cursor: 'pointer',
                  background: 'rgba(0, 0, 0, 0.15)',
                  transition: 'all 0.2s ease',
                  marginBottom: '1.5rem',
                }}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--primary)'; }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--glass-border)'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = 'var(--glass-border)';
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFiles(e.dataTransfer.files);
                  }
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '1rem', borderRadius: '50%', border: '1px solid var(--glass-border)' }}>
                    <Upload size={32} style={{ color: 'var(--primary)' }} />
                  </div>
                  <div>
                    <p style={{ fontWeight: '600', marginBottom: '0.25rem' }}>Fotos hierhin ziehen</p>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>oder klicken zum Auswählen</p>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {selectedImages.length > 0 ? (
                <button
                  className="btn btn-primary"
                  onClick={handleUploadAndAnalyze}
                  disabled={uploading}
                  style={{ width: '100%', padding: '1rem' }}
                >
                  <Sparkles size={18} />
                  {uploading ? 'Analysiere Bilder...' : `Mit KI analysieren (${selectedImages.length} Foto${selectedImages.length > 1 ? 's' : ''})`}
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => setIsCameraActive(true)}
                    style={{ width: '100%', padding: '1rem' }}
                  >
                    <Camera size={18} />
                    Kamera öffnen
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={triggerFileInput}
                    style={{ width: '100%', padding: '1rem' }}
                  >
                    <Upload size={18} />
                    Aus Galerie wählen
                  </button>
                </div>
              )}

              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', background: 'rgba(239, 68, 68, 0.1)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', textAlign: 'left', marginTop: '0.5rem' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
