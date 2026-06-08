import React, { useState, useEffect } from 'react';
import { Mail, Lock, Sparkles, AlertCircle, CheckCircle } from 'lucide-react';
import { loginUser, registerUser, getAuthConfig, loginWithGoogle } from '../utils/api';

export default function Login({ onLoginSuccess }) {
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

  // Render Google Button when client ID and script are ready
  useEffect(() => {
    if (!googleClientId) return;

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
  }, [googleClientId, isRegister]);

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
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '80vh', justifyContent: 'center', alignItems: 'center' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem 2rem' }}>
        
        {/* Brand Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', textAlign: 'center' }}>
          <img 
            src="/favicon.svg" 
            alt="Vintamie Logo" 
            style={{ 
              width: '48px', 
              height: '48px', 
              borderRadius: '10px',
              border: '1px solid var(--glass-border)'
            }} 
          />
          <div>
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-title)', fontWeight: '800' }}>
              Vintamie
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
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
            {loading ? 'Bitte warten...' : isRegister ? 'Registrieren' : 'Einloggen'}
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
            
            <div 
              id="google-signin-button" 
              style={{ 
                width: '100%', 
                display: 'flex', 
                justifyContent: 'center',
                minHeight: '40px',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden'
              }}
            ></div>
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
