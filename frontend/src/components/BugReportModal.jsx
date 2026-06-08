import React, { useState, useEffect } from 'react';
import { X, Send, AlertTriangle, CheckCircle, Camera, Loader } from 'lucide-react';
import html2canvas from 'html2canvas';
import { submitBugReport } from '../utils/api';

export default function BugReportModal({ onClose, currentView }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [screenshotBase64, setScreenshotBase64] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Auto-capture screenshot on mount
  useEffect(() => {
    if (includeScreenshot) {
      captureScreen();
    } else {
      setScreenshotBase64(null);
    }
  }, [includeScreenshot]);

  const captureScreen = async () => {
    setIsCapturing(true);
    setError(null);
    try {
      // We temporarily mark the modal overlay to be ignored by html2canvas
      const modalOverlay = document.querySelector('.bug-modal-overlay');
      if (modalOverlay) {
        modalOverlay.setAttribute('data-html2canvas-ignore', 'true');
      }
      
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: 0.8, // reduce scale for faster capture and smaller payload
        logging: false,
      });
      const base64 = canvas.toDataURL('image/jpeg', 0.7); // compress to jpeg for efficiency
      setScreenshotBase64(base64);
    } catch (err) {
      console.error('Failed to capture screenshot:', err);
      setError('Screenshot konnte nicht automatisch erstellt werden. Du kannst den Bericht trotzdem senden.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError('Bitte fülle alle Pflichtfelder aus.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Gather device info
    const deviceInfo = {
      userAgent: navigator.userAgent,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      currentView: currentView || 'unknown',
      urlHash: window.location.hash || '#/',
      platform: navigator.platform,
      language: navigator.language,
      timestamp: new Date().toISOString()
    };

    try {
      await submitBugReport({
        title,
        description,
        device_info: JSON.stringify(deviceInfo),
        screenshot_base64: includeScreenshot ? screenshotBase64 : null
      });
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      setError(err.message || 'Fehler beim Senden des Bug Reports.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bug-modal-overlay">
      <div className="glass-panel bug-modal-content fade-in">
        <div className="bug-modal-header">
          <h2>Problem melden</h2>
          <button className="bug-modal-close-btn" onClick={onClose} disabled={isSubmitting}>
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="bug-modal-success">
            <CheckCircle size={48} style={{ color: 'var(--success)' }} />
            <h3>Bug Report gesendet!</h3>
            <p>Vielen Dank für dein Feedback. Wir werden uns das Problem ansehen.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bug-modal-form">
            {error && (
              <div className="bug-error-message">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="bug-title">Kurztitel *</label>
              <input
                id="bug-title"
                type="text"
                className="form-control"
                placeholder="z. B. Kamera stürzt ab beim Foto schießen"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="bug-desc">Beschreibung des Problems *</label>
              <textarea
                id="bug-desc"
                className="form-control"
                placeholder="Bitte beschreibe kurz, was passiert ist und wie man den Fehler reproduzieren kann."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="form-group checkbox-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <input
                id="include-screenshot-cb"
                type="checkbox"
                checked={includeScreenshot}
                onChange={(e) => setIncludeScreenshot(e.target.checked)}
                disabled={isSubmitting || isCapturing}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label htmlFor="include-screenshot-cb" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', cursor: 'pointer', margin: 0, fontWeight: 500 }}>
                Screenshot der aktuellen Ansicht mitsenden
              </label>
            </div>

            {includeScreenshot && (
              <div className="bug-screenshot-preview-container">
                {isCapturing ? (
                  <div className="bug-screenshot-loading">
                    <Loader className="spinner" size={20} />
                    <span>Erstelle Screenshot...</span>
                  </div>
                ) : screenshotBase64 ? (
                  <div className="bug-screenshot-preview">
                    <img src={screenshotBase64} alt="Screenshot Vorschau" />
                    <div className="screenshot-badge">
                      <Camera size={12} />
                      <span>Auto-Screenshot</span>
                    </div>
                  </div>
                ) : (
                  <div className="bug-screenshot-failed">
                    <span>Kein Screenshot erfasst.</span>
                  </div>
                )}
              </div>
            )}

            <div className="bug-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || isCapturing}
              >
                {isSubmitting ? (
                  <>
                    <Loader className="spinner" size={16} />
                    <span>Wird gesendet...</span>
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    <span>Senden</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
