import React, { useState, useEffect, useRef } from 'react';
import { User, LogOut, Trash2, AlertTriangle, Save, HelpCircle, Check, Shield, Sparkles, Euro, MapPin, Sliders, Zap, Users, ClipboardList, Bug, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';
import { deleteUserAccount, updateMe } from '../utils/api';
import { version } from '../../package.json';

// Default style instructions per tone preset. MUST stay in sync with TONE_PRESETS
// in backend/services/gemini_service.py — the backend uses the same texts as its
// fallback. The "KI-Text" box below seeds its editable textarea from these; once
// the user edits the text it is stored verbatim and the preset label flips to
// "Individuell".
const TONE_PRESETS = {
  locker: 'Schreibe eine freundliche, ehrliche, ansprechende und lockere Verkaufsbeschreibung (gerne mit passenden, dezenten Emojis).',
  professionell: 'Schreibe eine sachliche, präzise und professionelle Verkaufsbeschreibung.',
  direkt: 'Schreibe eine sehr direkte, kurze und schnörkellose Verkaufsbeschreibung ohne unnötige Floskeln.',
};

const TONE_OPTIONS = [
  { value: 'locker', label: 'Locker' },
  { value: 'professionell', label: 'Professionell' },
  { value: 'direkt', label: 'Direkt' },
  { value: 'custom', label: 'Individuell' },
];

// Map a tone-prompt text back to its preset key (or "custom" if it matches none).
const presetKeyForText = (text) => {
  const t = (text || '').trim();
  for (const [key, value] of Object.entries(TONE_PRESETS)) {
    if (value.trim() === t) return key;
  }
  return 'custom';
};

export default function Settings({ user, onLogout, onUpdateUser, onShowBugReport }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  
  // Local state for settings form
  const [aiTone, setAiTone] = useState('locker');
  const [aiIntro, setAiIntro] = useState('');
  const [aiCustomTone, setAiCustomTone] = useState(TONE_PRESETS.locker);
  const [aiCustomFooter, setAiCustomFooter] = useState('');
  const [pricingOffset, setPricingOffset] = useState(0);
  const [defaultZip, setDefaultZip] = useState('');
  const [defaultShipping, setDefaultShipping] = useState('');
  const [autoSubmit, setAutoSubmit] = useState(false);

  // Synchronize local state when user prop changes
  useEffect(() => {
    if (user) {
      // The KI-Text box always shows an instruction. Prefer the user's stored
      // text; if empty (e.g. a user who picked a preset before the editable box
      // existed), seed it from the preset matching their tone label.
      const storedTone = user.ai_custom_tone || '';
      const seededTone = storedTone || TONE_PRESETS[user.ai_tone] || TONE_PRESETS.locker;
      setAiCustomTone(seededTone);
      // Derive the dropdown label from the actual text so it stays truthful.
      setAiTone(presetKeyForText(seededTone));
      setAiIntro(user.ai_intro || '');
      setAiCustomFooter(user.ai_custom_footer || '');
      setPricingOffset(user.pricing_offset || 0);
      setDefaultZip(user.default_zip || '');
      setDefaultShipping(user.default_shipping || '');
      setAutoSubmit(user.auto_submit || false);
    }
  }, [user]);

  if (!user) return null;

  // Picking a template fills the box with its prompt text; picking "Individuell"
  // keeps the current text so the user can edit from there.
  const handleToneSelect = (value) => {
    setAiTone(value);
    if (value !== 'custom' && TONE_PRESETS[value]) {
      setAiCustomTone(TONE_PRESETS[value]);
    }
  };

  // Editing the prompt flips the dropdown to "Individuell" unless the text still
  // exactly matches a preset.
  const handleTonePromptChange = (text) => {
    setAiCustomTone(text);
    setAiTone(presetKeyForText(text));
  };

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const updatedUser = await updateMe({
        ai_tone: aiTone,
        ai_intro: aiIntro,
        ai_custom_tone: aiCustomTone,
        ai_custom_footer: aiCustomFooter,
        pricing_offset: Number(pricingOffset),
        default_zip: defaultZip,
        default_city: '', // Ort ist überflüssig, PLZ reicht
        default_shipping: defaultShipping,
        auto_submit: autoSubmit
      });
      
      setSuccess(true);
      if (onUpdateUser) {
        onUpdateUser(updatedUser);
      }
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      console.error(err);
      setError('Fehler beim Speichern der Einstellungen.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = (e) => {
    if (e) e.preventDefault();
    if (hasChanges) {
      saveSettings();
    }
  };

  // Track hasChanges by comparing current values to user values
  useEffect(() => {
    if (!user) return;
    const hasDiff = 
      aiTone !== (user.ai_tone || 'locker') ||
      aiIntro !== (user.ai_intro || '') ||
      aiCustomTone !== (user.ai_custom_tone || '') ||
      aiCustomFooter !== (user.ai_custom_footer || '') ||
      Number(pricingOffset) !== (user.pricing_offset || 0) ||
      defaultZip !== (user.default_zip || '') ||
      defaultShipping !== (user.default_shipping || '') ||
      autoSubmit !== (user.auto_submit || false);
    
    setHasChanges(hasDiff);
  }, [aiTone, aiIntro, aiCustomTone, aiCustomFooter, pricingOffset, defaultZip, defaultShipping, autoSubmit, user]);

  // Debounced auto-save effect
  useEffect(() => {
    if (!hasChanges) return;
    setSaving(true);
    const delayDebounceFn = setTimeout(saveSettings, 1000); // save 1 second after last change
    return () => clearTimeout(delayDebounceFn);
  }, [aiTone, aiIntro, aiCustomTone, aiCustomFooter, pricingOffset, defaultZip, defaultShipping, autoSubmit, hasChanges]);

  // Latest settings values, reachable from the unmount cleanup below.
  const latestRef = useRef({});
  latestRef.current = { aiTone, aiIntro, aiCustomTone, aiCustomFooter, pricingOffset, defaultZip, defaultShipping, autoSubmit, hasChanges };

  // Flush a still-pending debounced save on unmount — e.g. the user leaves Settings
  // within the 1s debounce window, which clears the timer and loses the last change.
  // Fire-and-forget: the request outlives the component, so no state is touched after.
  useEffect(() => {
    return () => {
      const l = latestRef.current;
      if (l.hasChanges) {
        updateMe({
          ai_tone: l.aiTone,
          ai_intro: l.aiIntro,
          ai_custom_tone: l.aiCustomTone,
          ai_custom_footer: l.aiCustomFooter,
          pricing_offset: Number(l.pricingOffset),
          default_zip: l.defaultZip,
          default_city: '',
          default_shipping: l.defaultShipping,
          auto_submit: l.autoSubmit,
        }).catch(() => {});
      }
    };
  }, []);

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
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
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

      <div className="app-sticky-header">
        <div className="app-header-inner">
          <div className="app-header-bar" style={{ justifyContent: 'space-between' }}>
            <h2 className="app-header-title">Profil &amp; Einstellungen</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '500' }}>
              {saving && (
                <>
                  <RefreshCw size={14} className="spin" style={{ color: 'var(--primary)' }} />
                  <span>Speichert...</span>
                </>
              )}
              {success && (
                <>
                  <Check size={14} style={{ color: 'var(--primary)' }} />
                  <span style={{ color: 'var(--primary)' }}>Gespeichert</span>
                </>
              )}
              {error && (
                <>
                  <AlertCircle size={14} style={{ color: 'var(--danger)' }} />
                  <span style={{ color: 'var(--danger)' }}>Fehler</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="app-content-container" style={{ paddingBottom: 'calc(85px + env(safe-area-inset-bottom, 0px))' }}>
        <div className="profile-container" style={{ padding: 0 }}>
          {/* Settings Form wrapped around a 2-column grid */}
          <form onSubmit={handleSave}>
          <div className="draft-detail-grid">
            
            {/* Left Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* Section: Profil & Sitzung */}
              <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 className="detail-section-title" style={{ margin: 0 }}>
                  <User size={18} style={{ color: 'var(--primary)' }} />
                  <span>Konto &amp; Sitzung</span>
                </h3>
                
                <div className="profile-header-info" style={{ marginBottom: '0.25rem' }}>
                  <div className="profile-avatar-wrapper">
                    <User size={26} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 'bold' }}>Eingeloggt als</span>
                    <span style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-primary)', wordBreak: 'break-all', fontFamily: 'var(--font-title)' }}>{user.email}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onShowBugReport}
                  className="btn btn-secondary"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderColor: 'var(--glass-border)', minHeight: '44px', marginBottom: '0.75rem', background: 'rgba(255, 255, 255, 0.03)' }}
                >
                  <HelpCircle size={18} style={{ color: 'var(--primary)' }} />
                  Problem melden
                </button>

                <button
                  type="button"
                  onClick={onLogout}
                  className="btn btn-secondary"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderColor: 'var(--glass-border)', minHeight: '44px' }}
                >
                  <LogOut size={18} />
                  Abmelden
                </button>
              </div>
 
              {/* Section: Anzeigentext — the final description is assembled top to
                  bottom as Einleitung + KI-Text + Abschluss (intro and footer are
                  fixed verbatim text; only the KI-Text middle is AI-written). */}
              <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 className="detail-section-title" style={{ margin: 0 }}>
                  <Sparkles size={18} style={{ color: 'var(--primary)' }} />
                  <span>Anzeigentext</span>
                </h3>

                {/* 1. Einleitung */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center' }}>
                    Einleitung
                    <span className="tooltip-container">
                      <HelpCircle size={14} />
                      <span className="tooltip-text">Fester Text, der unverändert über jeder Beschreibung steht. Die KI weiß davon und vermeidet Dopplungen. Leer lassen = die KI beginnt selbst passend.</span>
                    </span>
                  </label>
                  <textarea
                    className="form-control"
                    style={{ minHeight: '64px' }}
                    placeholder="z.B. Hallo und willkommen bei meinen Anzeigen! 👋"
                    value={aiIntro}
                    onChange={(e) => setAiIntro(e.target.value)}
                  />
                </div>

                {/* 2. KI-Text — tone/style instruction, always shown, with a template dropdown */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', marginBottom: 0 }}>
                      KI-Text
                      <span className="tooltip-container">
                        <HelpCircle size={14} />
                        <span className="tooltip-text">Stil-/Tonfall-Anweisung für den von der KI geschriebenen Mittelteil. Wähle eine Vorlage oder formuliere frei — sobald du den Text änderst, springt die Vorlage auf „Individuell". Feste Regeln (keine Hashtags, Struktur) ergänzt Velosia automatisch.</span>
                      </span>
                    </label>
                    <select
                      className="form-control"
                      style={{ width: 'auto', minWidth: '150px', padding: '0.45rem 0.6rem', fontSize: '0.85rem', flexShrink: 0 }}
                      value={aiTone}
                      onChange={(e) => handleToneSelect(e.target.value)}
                      aria-label="Tonfall-Vorlage"
                    >
                      {TONE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    className="form-control"
                    style={{ minHeight: '110px' }}
                    placeholder="Stil-/Tonfall-Anweisung an die KI..."
                    value={aiCustomTone}
                    onChange={(e) => handleTonePromptChange(e.target.value)}
                  />
                </div>

                {/* 3. Abschluss */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center' }}>
                    Abschluss
                    <span className="tooltip-container">
                      <HelpCircle size={14} />
                      <span className="tooltip-text">Fester Text, der unverändert unter jeder Beschreibung steht (z.B. Versand- oder Haftungshinweise). Die KI weiß davon und vermeidet Dopplungen. Leer lassen = die KI schließt selbst passend ab.</span>
                    </span>
                  </label>
                  <textarea
                    className="form-control"
                    style={{ minHeight: '64px' }}
                    placeholder="z.B. Privatverkauf, keine Garantie."
                    value={aiCustomFooter}
                    onChange={(e) => setAiCustomFooter(e.target.value)}
                  />
                </div>
              </div>

            </div>

            {/* Right Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* Section: Verkaufsvorgaben */}
              <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 className="detail-section-title" style={{ margin: 0 }}>
                  <Sliders size={18} style={{ color: 'var(--primary)' }} />
                  <span>Verkaufsvorgaben</span>
                </h3>
                
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

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center' }}>
                    Automatisch veröffentlichen
                    <span className="tooltip-container">
                      <HelpCircle size={14} />
                      <span className="tooltip-text">Wenn aktiv, klickt Velosia nach dem Ausfüllen selbst auf „Veröffentlichen". Standardmäßig prüfst du das Angebot zuerst und stellst es selbst online.</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setAutoSubmit(!autoSubmit)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '0.75rem', width: '100%', padding: '0.75rem 0.9rem',
                      background: autoSubmit ? 'var(--primary-glow)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${autoSubmit ? 'var(--primary)' : 'var(--glass-border)'}`,
                      borderRadius: '10px', cursor: 'pointer', transition: 'all 0.2s ease'
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'left', lineHeight: 1.3 }}>
                      <Zap size={16} style={{ color: autoSubmit ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }} />
                      {autoSubmit ? 'Angebote werden sofort online gestellt' : 'Du prüfst & veröffentlichst selbst'}
                    </span>
                    <span style={{
                      flexShrink: 0, width: '44px', height: '26px', borderRadius: '99px',
                      background: autoSubmit ? 'var(--primary)' : 'rgba(255,255,255,0.15)',
                      position: 'relative', transition: 'all 0.2s ease'
                    }}>
                      <span style={{
                        position: 'absolute', top: '3px', left: autoSubmit ? '21px' : '3px',
                        width: '20px', height: '20px', borderRadius: '50%', background: '#fff',
                        transition: 'all 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                      }} />
                    </span>
                  </button>
                </div>
              </div>

              {/* Error display */}
              {error && (
                <div style={{ marginTop: '0.5rem' }}>
                  <p style={{ color: '#fca5a5', fontSize: '0.85rem', textAlign: 'center' }}>{error}</p>
                </div>
              )}

              {/* Admin Section */}
              {user.is_admin && (
                <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
                  <h3 className="detail-section-title" style={{ margin: 0 }}>
                    <Shield size={18} style={{ color: 'var(--primary)' }} />
                    <span>Admin-Werkzeuge</span>
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                    {[
                      { icon: Users, label: 'Benutzerverwaltung', hash: '#/admin/users' },
                      { icon: ClipboardList, label: 'Warteliste', hash: '#/admin/waitlist' },
                      { icon: Bug, label: 'Bug-Reports', hash: '#/admin/bugs' },
                    ].map(({ icon: Icon, label, hash }, i, arr) => (
                      <button
                        key={hash}
                        type="button"
                        onClick={() => { window.location.hash = hash; }}
                        className="btn-ghost"
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                          padding: '0.85rem 1rem', background: 'transparent', border: 'none',
                          borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                          color: 'var(--text)', cursor: 'pointer', fontSize: '0.95rem', minHeight: '48px',
                        }}
                      >
                        <Icon size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                        <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                        <ChevronRight size={16} style={{ opacity: 0.4, flexShrink: 0 }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Danger Zone */}
              <div className="detail-section-unboxed" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
                <h3 className="detail-section-title" style={{ margin: 0 }}>
                  <AlertTriangle size={18} style={{ color: 'var(--primary)' }} />
                  <span>Gefahrenbereich</span>
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
          Velosia App v{version}
        </div>
      </div>
    </div>
  </div>
  );
}

