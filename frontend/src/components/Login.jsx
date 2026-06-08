import React, { useState, useEffect } from 'react';
import { Mail, Lock, Sparkles, AlertCircle, CheckCircle } from 'lucide-react';
import { loginUser, registerUser, getAuthConfig, loginWithGoogle } from '../utils/api';

export default function Login({ onLoginSuccess }) {
  const isAndroidApp = typeof window.VintamieBridge !== 'undefined';
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [googleClientId, setGoogleClientId] = useState('');

  // Load backend configuration
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const config = await getAuthConfig();
        if (config.google_client_id) {
          setGoogleClientId(config.google_client_id);
        }
      } catch (err) {
        console.error("Fehler beim Laden der Auth-Konfiguration:", err);
      }
    };
    fetchConfig();
  }, []);

  // Handle Google Sign-In response
  const handleGoogleCredentialResponse = async (response) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await loginWithGoogle(response.credential);
      onLoginSuccess(data.access_token);
    } catch (err) {
      console.error("Google Login Fehler:", err);
      setError(err.message || 'Google-Login fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setLoading(false);
    }
  };

  // Render Google Button when client ID and script are ready (only in standard web browsers)
  useEffect(() => {
    if (!googleClientId || isAndroidApp) return;

    const checkGoogle = setInterval(() => {
      if (typeof google !== 'undefined') {
        clearInterval(checkGoogle);
        try {
          google.accounts.id.initialize({
            client_id: googleClientId,
            callback: handleGoogleCredentialResponse,
          });
          google.accounts.id.renderButton(
            document.getElementById("google-signin-button"),
            { 
              theme: "filled_black", 
              size: "large", 
              width: 336,
              text: isRegister ? "signup_with" : "signin_with",
              shape: "rectangular",
              logo_alignment: "center"
            }
          );
        } catch (initErr) {
          console.error("Fehler bei der Google Sign-In Initialisierung:", initErr);
        }
      }
    }, 100);

    return () => clearInterval(checkGoogle);
  }, [googleClientId, isRegister, isAndroidApp]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (isRegister) {
        await registerUser(email, password);
        setSuccess('Konto erfolgreich erstellt! Du kannst dich jetzt anmelden.');
        setIsRegister(false);
        setPassword('');
      } else {
        const data = await loginUser(email, password);
        onLoginSuccess(data.access_token);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Etwas ist schiefgelaufen. Bitte versuche es erneut.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '80vh', justifyContent: 'center', alignItems: 'center', padding: '0 1rem' }}>
      <div className="auth-container">
        
        {/* Brand Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', marginBottom: '2.5rem', textAlign: 'center' }}>
          <div className="onboarding-logo-glow" style={{ margin: '0 auto' }}>
            <img 
              src="/favicon.svg" 
              alt="Vintamie Logo" 
              className="onboarding-logo-img"
            />
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <h2 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-title)', fontWeight: '800', background: 'linear-gradient(135deg, var(--text-primary) 30%, var(--primary) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>
              Vintamie
            </h2>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {isRegister ? 'Erstelle dein Verkäufer-Konto' : 'Melde dich an, um zu starten'}
            </span>
          </div>
        </div>

        {/* Form Alerts */}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fca5a5', background: 'rgba(239, 68, 68, 0.1)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', marginBottom: '1.25rem', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#a7f3d0', background: 'rgba(16, 185, 129, 0.1)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', marginBottom: '1.25rem', border: '1px solid rgba(16,185,129,0.2)' }}>
            <CheckCircle size={16} style={{ flexShrink: 0 }} />
            <span>{success}</span>
          </div>
        )}

        {/* Input Fields */}
        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ position: 'relative' }}>
            <label htmlFor="auth-email">E-Mail-Adresse</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="email"
                id="auth-email"
                className="form-control"
                style={{ paddingLeft: '2.75rem' }}
                placeholder="name@beispiel.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="auth-password">Passwort</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="password"
                id="auth-password"
                className="form-control"
                style={{ paddingLeft: '2.75rem' }}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '1rem', marginTop: '1.5rem' }}
            disabled={loading}
          >
            {loading ? 'Bitte warten...' : isRegister ? 'Mit E-Mail registrieren' : 'Mit E-Mail anmelden'}
          </button>
        </form>

        {/* Google OAuth Login Button */}
        {googleClientId && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', margin: '1.5rem 0', gap: '0.75rem' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }}></div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>oder</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }}></div>
            </div>
            
            <div style={{ position: 'relative', width: '100%', height: '40px', marginTop: '0.5rem' }}>
              {isAndroidApp ? (
                /* Native App Google Button */
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setError(null);
                    window.VintamieBridge.loginWithGoogle(googleClientId);
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.75rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-title)',
                    fontWeight: '600',
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    boxSizing: 'border-box'
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4" />
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
                    <path d="M3.964 10.707a5.416 5.416 0 01-.282-1.707c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05" />
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.896 11.426 0 9 0 5.044 0 1.636 2.278.957 5.58l3.007 2.332C4.672 5.164 6.656 3.58 9 3.58z" fill="#EA4335" />
                  </svg>
                  <span>{isRegister ? 'Über Google registrieren' : 'Über Google anmelden'}</span>
                </button>
              ) : (
                /* Web Browser Google Button */
                <>
                  {/* Custom styled glassmorphic button beneath */}
                  <div 
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.75rem',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-title)',
                      fontWeight: '600',
                      fontSize: '0.9rem',
                      pointerEvents: 'none',
                      boxSizing: 'border-box'
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
                      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4" />
                      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
                      <path d="M3.964 10.707a5.416 5.416 0 01-.282-1.707c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05" />
                      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.896 11.426 0 9 0 5.044 0 1.636 2.278.957 5.58l3.007 2.332C4.672 5.164 6.656 3.58 9 3.58z" fill="#EA4335" />
                    </svg>
                    <span>{isRegister ? 'Über Google registrieren' : 'Über Google anmelden'}</span>
                  </div>
                  
                  {/* Invisible official Google button iframe on top to capture clicks securely */}
                  <div 
                    id="google-signin-button" 
                    style={{ 
                      position: 'absolute',
                      top: 0,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '336px',
                      height: '100%',
                      opacity: 0.01,
                      cursor: 'pointer',
                      overflow: 'hidden'
                    }}
                  ></div>
                </>
              )}
            </div>
          </>
        )}

        {/* Form Toggle Switch */}
        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.875rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            {isRegister ? 'Bereits ein Konto?' : 'Neu bei Vintamie?'}
          </span>{' '}
          <button
            className="btn"
            style={{ display: 'inline', background: 'transparent', border: 'none', color: 'var(--primary)', padding: 0, minHeight: 'auto', fontWeight: 'bold', textDecoration: 'underline', cursor: 'pointer' }}
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
              setSuccess(null);
            }}
          >
            {isRegister ? 'Jetzt einloggen' : 'Konto erstellen'}
          </button>
        </div>

      </div>
    </div>
  );
}
