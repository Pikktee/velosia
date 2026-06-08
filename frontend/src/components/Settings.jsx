import React, { useState } from 'react';
import { User, LogOut, Trash2, Cpu, ShieldCheck, Globe, AlertTriangle } from 'lucide-react';
import { deleteUserAccount } from '../utils/api';

export default function Settings({ user, onLogout }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // If user metadata hasn't loaded yet
  if (!user) return null;

  const loginMethod = user.google_id ? 'Google-Konto' : 'E-Mail & Passwort';

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
      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.75rem', marginBottom: '1.5rem', fontFamily: 'var(--font-title)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Einstellungen
        </h2>

        {/* User Account Info Card */}
        <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{
            background: 'rgba(9, 176, 183, 0.15)',
            border: '1px solid var(--primary-glow)',
            color: 'var(--primary)',
            padding: '0.75rem',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <User size={24} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Eingeloggt als</span>
            <span style={{ fontSize: '1.05rem', fontWeight: '600', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{user.email}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Methode: {loginMethod}</span>
          </div>
        </div>

        {/* AI & System Section */}
        <div style={{ marginBottom: '1.75rem' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', color: 'var(--text-primary)', fontFamily: 'var(--font-title)', fontWeight: '600', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
            Künstliche Intelligenz
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Model Card */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', padding: '0.25rem 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                <Cpu size={16} />
                <span>Modell</span>
              </div>
              <span style={{
                background: 'rgba(9, 176, 183, 0.15)',
                color: 'var(--primary)',
                padding: '0.2rem 0.5rem',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: '600',
                border: '1px solid var(--primary-glow)'
              }}>
                gemini-3.5-flash
              </span>
            </div>

            {/* API Status Card */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', padding: '0.25rem 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                <ShieldCheck size={16} />
                <span>API Status</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--success)' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: '600' }}>Aktiv</span>
              </div>
            </div>
          </div>
        </div>

        {/* WebExtension Sync */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', color: 'var(--text-primary)', fontFamily: 'var(--font-title)', fontWeight: '600', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
            Erweiterung Sync
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
            <Globe size={18} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '2px' }} />
            <p>
              Deine Sitzung wird automatisch mit der Vintamie Browser-Extension synchronisiert. Kein separater Login in der Erweiterung nötig.
            </p>
          </div>
        </div>

        {/* Danger Zone */}
        <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button
            onClick={onLogout}
            className="btn btn-secondary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderColor: 'var(--glass-border)' }}
          >
            <LogOut size={18} />
            Abmelden (Logout)
          </button>

          {showConfirm ? (
            <div className="glass-card fade-in" style={{ padding: '1rem', border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: '#fca5a5', fontSize: '0.9rem', fontWeight: '600' }}>
                <AlertTriangle size={18} />
                <span>Account wirklich löschen?</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4' }}>
                Diese Aktion löscht unwiderruflich deinen Account, alle gespeicherten Entwürfe auf dem Server und deine Google-Verknüpfung.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="btn btn-danger"
                  style={{ flex: 1, padding: '0.4rem 0.8rem', minHeight: '38px', fontSize: '0.85rem' }}
                >
                  {deleting ? 'Löscht...' : 'Ja, löschen'}
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={deleting}
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '0.4rem 0.8rem', minHeight: '38px', fontSize: '0.85rem' }}
                >
                  Abbrechen
                </button>
              </div>
              {error && (
                <span style={{ fontSize: '0.75rem', color: '#fca5a5', textAlign: 'center' }}>{error}</span>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowConfirm(true)}
              className="btn btn-danger"
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <Trash2 size={18} />
              Account löschen
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
