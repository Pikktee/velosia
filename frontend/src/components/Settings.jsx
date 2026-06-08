import React, { useState, useEffect } from 'react';
import { User, LogOut, Trash2, AlertTriangle, Save, HelpCircle, Check, Shield, Sparkles, Euro, MapPin, Sliders, Smile, Briefcase, Zap, PenTool } from 'lucide-react';
import { deleteUserAccount, updateMe } from '../utils/api';
import { version } from '../../package.json';

export default function Settings({ user, onLogout, onUpdateUser }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  
  // Local state for settings form
  const [aiTone, setAiTone] = useState('locker');
  const [aiCustomTone, setAiCustomTone] = useState('');
  const [aiCustomFooter, setAiCustomFooter] = useState('');
  const [pricingOffset, setPricingOffset] = useState(0);
  const [defaultZip, setDefaultZip] = useState('');
  const [defaultCity, setDefaultCity] = useState('');
  const [defaultCategory, setDefaultCategory] = useState('Keine Präferenz');
  const [defaultShipping, setDefaultShipping] = useState('');

  // Synchronize local state when user prop changes
  useEffect(() => {
    if (user) {
      setAiTone(user.ai_tone || 'locker');
      setAiCustomTone(user.ai_custom_tone || '');
      setAiCustomFooter(user.ai_custom_footer || '');
      setPricingOffset(user.pricing_offset || 0);
      setDefaultZip(user.default_zip || '');
      setDefaultCity(user.default_city || '');
      setDefaultCategory(user.default_category || 'Keine Präferenz');
      setDefaultShipping(user.default_shipping || '');
    }
  }, [user]);

  if (!user) return null;

  const loginMethod = user.google_id ? 'Google-Konto' : 'E-Mail & Passwort';

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const updatedUser = await updateMe({
        ai_tone: aiTone,
        ai_custom_tone: aiCustomTone,
        ai_custom_footer: aiCustomFooter,
        pricing_offset: Number(pricingOffset),
        default_zip: defaultZip,
        default_city: defaultCity,
        default_category: defaultCategory,
        default_shipping: defaultShipping
      });
      
      setSuccess(true);
      if (onUpdateUser) {
        onUpdateUser(updatedUser);
      }
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      setError('Fehler beim Speichern der Einstellungen.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setError('');
    try {
      await deleteUserAccount();
      onLogout(); // Logs out and redirects to login/register view
    } catch (err) {
      console.error(err);
      setError('Fehler beim Löschen des Accounts.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fade-in" style={{ paddingBottom: '2rem' }}>
      {/* Inject custom tooltip styling */}
      <style>{`
        .tooltip-container {
          position: relative;
          display: inline-flex;
          align-items: center;
          margin-left: 0.35rem;
          color: var(--text-muted);
          cursor: pointer;
          vertical-align: middle;
        }
        .tooltip-text {
          visibility: hidden;
          width: 200px;
          background-color: #161b26;
          color: #f8fafc;
          text-align: center;
          border-radius: 8px;
          padding: 0.6rem;
          position: absolute;
          z-index: 999;
          bottom: 125%;
          left: 50%;
          transform: translateX(-50%);
          opacity: 0;
          transition: opacity 0.2s, visibility 0.2s;
          font-size: 0.75rem;
          font-family: var(--font-body);
          font-weight: normal;
          line-height: 1.3;
          box-shadow: 0 4px 16px rgba(0,0,0,0.6);
          border: 1px solid var(--glass-border);
          pointer-events: none;
        }
        .tooltip-container:hover .tooltip-text {
          visibility: visible;
          opacity: 1;
        }
      `}</style>
      <div className="profile-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <h2 className="page-title">Profil</h2>
        </div>

        {/* Settings Form wrapped around a 2-column grid */}
        <form onSubmit={handleSave}>
          <div className="draft-detail-grid">
            
            {/* Left Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* Section: User Account Info */}
              <div className="detail-section-unboxed">
                <h3 className="detail-section-title">
                  <User size={18} style={{ color: 'var(--primary)' }} />
                  <span>Konto</span>
                </h3>
                
                <div className="profile-header-info" style={{ marginBottom: 0 }}>
                  <div className="profile-avatar-wrapper">
                    <User size={26} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 'bold' }}>Eingeloggt als</span>
                    <span style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-primary)', wordBreak: 'break-all', fontFamily: 'var(--font-title)' }}>{user.email}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Anmeldemethode: {loginMethod}</span>
                  </div>
                </div>
              </div>
 
              {/* Section: AI Writing Style */}
              <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 className="detail-section-title" style={{ margin: 0 }}>
                  <Sparkles size={18} style={{ color: 'var(--primary)' }} />
                  <span>KI-Schreibstil</span>
                </h3>
                
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                    Tonfall
                    <span className="tooltip-container">
                      <HelpCircle size={14} />
                      <span className="tooltip-text">Bestimmt, in welchem Sprachstil die KI deine Verkaufsbeschreibung formuliert.</span>
                    </span>
                  </label>
                  
                  {/* Premium visual tone options card grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginTop: '0.25rem' }}>
                    {[
                      { value: 'locker', label: 'Locker', desc: 'Mit Emojis & lockerem Ton', icon: <Smile size={18} /> },
                      { value: 'professionell', label: 'Professionell', desc: 'Sachlich & kompetent', icon: <Briefcase size={18} /> },
                      { value: 'direkt', label: 'Direkt', desc: 'Kurz & auf den Punkt', icon: <Zap size={18} /> },
                      { value: 'custom', label: 'Individuell', desc: 'Eigene Stil-Anweisungen', icon: <PenTool size={18} /> }
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`tone-card-btn ${aiTone === opt.value ? 'active' : ''}`}
                        onClick={() => setAiTone(opt.value)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '700', fontSize: '0.875rem', color: aiTone === opt.value ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {opt.icon}
                          <span>{opt.label}</span>
                        </div>
                        <span style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', lineHeight: '1.2' }}>{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {aiTone === 'custom' && (
                  <div className="form-group fade-in" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'flex', alignItems: 'center' }}>
                      Individuelle Stil-Anweisung
                      <span className="tooltip-container">
                        <HelpCircle size={14} />
                        <span className="tooltip-text">Gib der KI Anweisungen für den Tonfall. Z.B. "Schreibe wie ein motivierter Sportler".</span>
                      </span>
                    </label>
                    <textarea
                      className="form-control"
                      style={{ minHeight: '80px' }}
                      placeholder="Schreibe die Beschreibung in folgendem Stil..."
                      value={aiCustomTone}
                      onChange={(e) => setAiCustomTone(e.target.value)}
                    />
                  </div>
                )}

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center' }}>
                    Standard-Textbaustein (Footer)
                    <span className="tooltip-container">
                      <HelpCircle size={14} />
                      <span className="tooltip-text">Dieser Text wird automatisch an jede Beschreibung (vor den Hashtags) angehängt.</span>
                    </span>
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="z.B. Aus tierfreiem Nichtraucherhaushalt."
                    value={aiCustomFooter}
                    onChange={(e) => setAiCustomFooter(e.target.value)}
                  />
                </div>
              </div>

            </div>

            {/* Right Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* Section: Pricing Strategy */}
              <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 className="detail-section-title" style={{ margin: 0 }}>
                  <Euro size={18} style={{ color: 'var(--primary)' }} />
                  <span>Preisgestaltung</span>
                </h3>
                
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center' }}>
                    Preis-Offset (%)
                    <span className="tooltip-container">
                      <HelpCircle size={14} />
                      <span className="tooltip-text">Passt den vorgeschlagenen Preis der KI prozentual an. Z. B. -10% für schnelleren Verkauf oder +5% für Verhandlungsbasis.</span>
                    </span>
                  </label>
                  <input
                    type="number"
                    className="form-control"
                    placeholder="z.B. -10"
                    value={pricingOffset}
                    onChange={(e) => setPricingOffset(e.target.value)}
                  />
                </div>
              </div>

              {/* Section: Default Location */}
              <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 className="detail-section-title" style={{ margin: 0 }}>
                  <MapPin size={18} style={{ color: 'var(--primary)' }} />
                  <span>Standard-Standort</span>
                </h3>
                
                <div className="form-grid-2col" style={{ gap: '1rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'flex', alignItems: 'center' }}>
                      Postleitzahl (PLZ)
                      <span className="tooltip-container">
                        <HelpCircle size={14} />
                        <span className="tooltip-text">Wird beim Autofill auf Verkaufsplattformen automatisch eingetragen.</span>
                      </span>
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="z.B. 10115"
                      value={defaultZip}
                      onChange={(e) => setDefaultZip(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Ort</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="z.B. Berlin"
                      value={defaultCity}
                      onChange={(e) => setDefaultCity(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Section: Listing Preferences */}
              <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 className="detail-section-title" style={{ margin: 0 }}>
                  <Sliders size={18} style={{ color: 'var(--primary)' }} />
                  <span>Listing-Präferenzen</span>
                </h3>
                
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center' }}>
                    Standard-Kategorie
                    <span className="tooltip-container">
                      <HelpCircle size={14} />
                      <span className="tooltip-text">Bevorzugte Kategorie für deine Angebote bei der KI-Klassifizierung.</span>
                    </span>
                  </label>
                  <select
                    className="form-control"
                    value={defaultCategory}
                    onChange={(e) => setDefaultCategory(e.target.value)}
                  >
                    <option value="Keine Präferenz">Keine Präferenz</option>
                    <option value="Damenbekleidung">Damenbekleidung</option>
                    <option value="Herrenbekleidung">Herrenbekleidung</option>
                    <option value="Kinder">Kinder</option>
                    <option value="Haus &amp; Garten">Haus &amp; Garten</option>
                    <option value="Elektronik">Elektronik</option>
                    <option value="Bücher &amp; Medien">Bücher &amp; Medien</option>
                    <option value="Sonstiges">Sonstiges</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center' }}>
                    Standard-Versandart
                    <span className="tooltip-container">
                      <HelpCircle size={14} />
                      <span className="tooltip-text">Deine bevorzugte Versandart zur Dokumentation im Angebot.</span>
                    </span>
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="z.B. DHL Paket versichert"
                    value={defaultShipping}
                    onChange={(e) => setDefaultShipping(e.target.value)}
                  />
                </div>
              </div>

              {/* Save Button */}
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', minHeight: '48px' }}
                >
                  {success ? (
                    <>
                      <Check size={18} style={{ color: '#000' }} />
                      Gespeichert!
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      {saving ? 'Speichert...' : 'Einstellungen speichern'}
                    </>
                  )}
                </button>
                {error && (
                  <p style={{ color: '#fca5a5', fontSize: '0.85rem', marginTop: '0.5rem', textAlign: 'center' }}>{error}</p>
                )}
              </div>

              {/* Admin Section */}
              {user.is_admin && (
                <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
                  <h3 className="detail-section-title" style={{ margin: 0 }}>
                    <Shield size={18} style={{ color: 'var(--primary)' }} />
                    <span>Admin-Werkzeuge</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.hash = '#/admin/issues';
                    }}
                    className="btn btn-secondary"
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderColor: 'var(--primary-glow)', color: 'var(--primary)', minHeight: '44px' }}
                  >
                    <Shield size={18} />
                    Issue Management öffnen
                  </button>
                </div>
              )}

              {/* Danger Zone */}
              <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
                <h3 className="detail-section-title" style={{ margin: 0 }}>
                  <AlertTriangle size={18} style={{ color: 'var(--primary)' }} />
                  <span>Konto verwalten</span>
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <button
                    type="button"
                    onClick={onLogout}
                    className="btn btn-secondary"
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderColor: 'var(--glass-border)', minHeight: '44px' }}
                  >
                    <LogOut size={18} />
                    Abmelden
                  </button>

                  {showConfirm ? (
                    <div className="danger-alert-box fade-in" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', margin: 0 }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: '#fca5a5', fontSize: '0.9rem', fontWeight: '600' }}>
                        <AlertTriangle size={18} />
                        <span>Account wirklich löschen?</span>
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4' }}>
                        Diese Aktion löscht unwiderruflich deinen Account, alle gespeicherten Angebote auf dem Server und deine Google-Verknüpfung.
                      </p>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <button
                          type="button"
                          onClick={handleDeleteAccount}
                          disabled={deleting}
                          className="btn btn-danger"
                          style={{ flex: 1, padding: '0.4rem 0.8rem', minHeight: '38px', fontSize: '0.85rem' }}
                        >
                          {deleting ? 'Löscht...' : 'Ja, löschen'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowConfirm(false)}
                          disabled={deleting}
                          className="btn btn-secondary"
                          style={{ flex: 1, padding: '0.4rem 0.8rem', minHeight: '38px', fontSize: '0.85rem' }}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowConfirm(true)}
                      className="btn btn-danger"
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', minHeight: '44px' }}
                    >
                      <Trash2 size={18} />
                      Account löschen
                    </button>
                  )}
                </div>
              </div>

            </div>

          </div>
        </form>

        <div style={{ marginTop: '2.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '0.05em', fontFamily: 'var(--font-body)' }}>
          Vintamie App v{version}
        </div>
      </div>
    </div>
  );
}

