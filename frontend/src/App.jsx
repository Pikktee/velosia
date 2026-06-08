import React, { useState, useEffect, useRef } from 'react';
import { Camera, FolderHeart, Sparkles, LogOut, User, Settings as SettingsIcon, Cloud } from 'lucide-react';
import CameraCapture from './components/CameraCapture';
import DraftList from './components/DraftList';
import DraftDetail from './components/DraftDetail';
import AnalysisLoader from './components/AnalysisLoader';
import Login from './components/Login';
import Settings from './components/Settings';
import { getDrafts, deleteDraft, isAuthenticated, setAuthToken, getMe } from './utils/api';

export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [view, setView] = useState('capture'); // 'capture', 'list', 'detail', 'analyzing'
  const [drafts, setDrafts] = useState([]);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(true);
  const cameraCaptureRef = useRef(null);

  // Automatically start camera when navigating to capture view
  useEffect(() => {
    if (view === 'capture') {
      setIsCameraActive(true);
    }
  }, [view]);

  // Check auth state on mount
  useEffect(() => {
    const isAuth = isAuthenticated();
    if (isAuth) {
      setToken(localStorage.getItem('vintamie_token'));
      fetchCurrentUser();
      fetchDrafts();
    }
  }, []);

  // Detect input/textarea focus globally to hide navigation on mobile when keyboard is open
  useEffect(() => {
    const handleFocusIn = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        setIsInputFocused(true);
      }
    };
    const handleFocusOut = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        setTimeout(() => {
          if (
            document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA'
          ) {
            setIsInputFocused(false);
          }
        }, 100);
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const u = await getMe();
      setUser(u);
      localStorage.setItem('vintamie_user_email', u.email);
    } catch (err) {
      console.error(err);
      handleLogout();
    }
  };

  const fetchDrafts = async () => {
    setLoading(true);
    try {
      const data = await getDrafts();
      setDrafts(data);
    } catch (err) {
      console.error("Error fetching drafts:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSuccess = (newToken) => {
    setAuthToken(newToken);
    setToken(newToken);
    fetchCurrentUser();
    fetchDrafts();
    setView('capture');
  };

  const handleLogout = () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setDrafts([]);
    setSelectedDraft(null);
    localStorage.removeItem('vintamie_user_email');
    setView('capture');
  };

  const handleDeleteDraft = async (id) => {
    try {
      await deleteDraft(id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      if (selectedDraft && selectedDraft.id === id) {
        setSelectedDraft(null);
        setView('list');
      }
    } catch (err) {
      console.error(err);
      alert('Der Entwurf konnte nicht gelöscht werden.');
    }
  };

  const handleAnalysisStart = () => {
    setAnalysisError(null);
    setView('analyzing');
  };

  const handleAnalysisSuccess = (newDraft) => {
    setAnalysisError(null);
    setDrafts((prev) => [newDraft, ...prev]);
    setSelectedDraft(newDraft);
    setView('detail');
  };

  const handleAnalysisError = (errMsg) => {
    setAnalysisError(errMsg);
    setView('capture');
  };

  const handleUpdateSuccess = (updatedDraft) => {
    setDrafts((prev) => prev.map((d) => (d.id === updatedDraft.id ? updatedDraft : d)));
    setSelectedDraft(updatedDraft);
  };

  // If not authenticated, render Login/Register
  if (!token) {
    return (
      <div className="container" style={{ padding: '2rem 1rem' }}>
        <Login onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Top Header Brand Bar */}
      <header className="app-header">
        <div className="header-brand">
          <img src="/favicon.svg" alt="Vintamie Logo" className="header-logo" />
          <h1 className="header-title">vintamie</h1>
        </div>
        <div className="header-actions">
          {view === 'list' && (
            <span className="drafts-badge">
              {drafts.length} {drafts.length === 1 ? 'Entwurf' : 'Entwürfe'}
            </span>
          )}
          {view === 'capture' && (
            <div className="status-badge">
              <span className="status-dot online" />
              <span>Live-Vorschau</span>
            </div>
          )}
          {view === 'detail' && (
            <div className="status-badge">
              <Cloud size={12} style={{ color: 'var(--primary)' }} />
              <span>Entwurf-Modus</span>
            </div>
          )}
          {view === 'settings' && (
            <button 
              className="logout-icon-btn" 
              onClick={handleLogout} 
              title="Abmelden"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main">
        <div className="container" style={{ 
          paddingTop: '1rem', 
          paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' 
        }}>
          {view === 'capture' && (
            <CameraCapture
              ref={cameraCaptureRef}
              onAnalysisStart={handleAnalysisStart}
              onAnalysisSuccess={handleAnalysisSuccess}
              onAnalysisError={handleAnalysisError}
              initialError={analysisError}
              isCameraActive={isCameraActive}
              setIsCameraActive={setIsCameraActive}
            />
          )}

          {view === 'analyzing' && (
            <div className="glass-panel" style={{ borderRadius: 'var(--radius-md)' }}>
              <AnalysisLoader />
            </div>
          )}

          {view === 'list' && (
            <DraftList
              drafts={drafts}
              onSelectDraft={(draft) => {
                setSelectedDraft(draft);
                setView('detail');
              }}
              onDeleteDraft={handleDeleteDraft}
            />
          )}

          {view === 'detail' && selectedDraft && (
            <DraftDetail
              draft={selectedDraft}
              onBack={() => {
                setView('list');
                setSelectedDraft(null);
                fetchDrafts(); // Sync changes
              }}
              onUpdateSuccess={handleUpdateSuccess}
            />
          )}

          {view === 'settings' && (
            <Settings
              user={user}
              onLogout={handleLogout}
            />
          )}
        </div>
      </main>

      {/* Responsive Sticky Footer Navigation (Tinder style flat bottom bar) */}
      {!isInputFocused && (
        <nav className="app-nav">
          {/* Left: Entwürfe */}
          <button
            onClick={() => {
              fetchDrafts();
              setView('list');
            }}
            className={`nav-tab-btn ${view === 'list' || view === 'detail' ? 'active' : ''}`}
          >
            <FolderHeart size={20} />
            <span>Entwürfe</span>
          </button>

          {/* Center: Floating round Camera button (FAB) / Shutter Button */}
          <div style={{
            position: 'relative',
            top: '-15px',
            width: '70px',
            height: '70px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 101,
            flexShrink: 0
          }}>
            {view === 'capture' && isCameraActive ? (
              /* Shutter Button Mode */
              <button
                onClick={() => {
                  if (cameraCaptureRef.current) {
                    cameraCaptureRef.current.capture();
                  }
                }}
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: '#fff',
                  border: '5px solid var(--primary)',
                  cursor: 'pointer',
                  boxShadow: '0 0 20px rgba(9, 176, 183, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'transform 0.1s ease',
                  padding: 0
                }}
                onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.88)'}
                onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.88)'}
                onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
                title="Foto aufnehmen"
              >
                <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#fff', border: '2px solid rgba(0,0,0,0.05)' }} />
              </button>
            ) : (
              /* Navigation FAB Mode */
              <button
                onClick={() => {
                  setView('capture');
                  setIsCameraActive(true);
                }}
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--primary) 0%, #068085 100%)',
                  border: '4px solid #0e121a',
                  color: '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 8px 20px rgba(9, 176, 183, 0.4)',
                  cursor: 'pointer',
                  transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease',
                  transform: view === 'capture' || view === 'analyzing' ? 'scale(1.15)' : 'scale(1)'
                }}
                title="Neue Aufnahme"
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.2)';
                  e.currentTarget.style.boxShadow = '0 10px 25px rgba(9, 176, 183, 0.6)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = view === 'capture' || view === 'analyzing' ? 'scale(1.15)' : 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(9, 176, 183, 0.4)';
                }}
              >
                <Camera size={24} />
              </button>
            )}
          </div>

          {/* Right: Einstellungen */}
          <button
            onClick={() => setView('settings')}
            className={`nav-tab-btn ${view === 'settings' ? 'active' : ''}`}
          >
            <SettingsIcon size={20} />
            <span>Optionen</span>
          </button>
        </nav>
      )}
    </div>
  );
}
