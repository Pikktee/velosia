import React, { useState, useEffect } from 'react';
import { Camera, FolderHeart, Sparkles, LogOut, User, Settings as SettingsIcon } from 'lucide-react';
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
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      minHeight: '100vh', 
      paddingBottom: '100px',
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)'
    }}>
      
      {/* Main Content Area */}
      <main className="container" style={{ flexGrow: 1 }}>
        {view === 'capture' && (
          <CameraCapture
            onAnalysisStart={handleAnalysisStart}
            onAnalysisSuccess={handleAnalysisSuccess}
            onAnalysisError={handleAnalysisError}
            initialError={analysisError}
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
      </main>

      {/* Responsive Sticky Footer Navigation (App-like feel) */}
      {!isInputFocused && (
        <nav className="glass-panel" style={{
          position: 'fixed',
          bottom: '1rem',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 2rem)',
          maxWidth: '500px',
          height: '70px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: '99px',
          padding: '0 1.5rem',
          border: '1px solid var(--glass-border)',
          zIndex: 100,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          background: 'rgba(11, 15, 23, 0.85)'
        }}>
        {/* Left: Entwürfe */}
        <button
          onClick={() => {
            fetchDrafts();
            setView('list');
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: view === 'list' || view === 'detail' ? 'var(--primary)' : 'var(--text-secondary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.2rem',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: '600',
            transition: 'all 0.2s ease',
            flex: '1',
            textAlign: 'center'
          }}
        >
          <FolderHeart size={20} />
          <span>Entwürfe</span>
        </button>

        {/* Center: Kreisrundes Kamera-Symbol (Floating Action Button) */}
        <div style={{
          position: 'relative',
          top: '-15px',
          width: '70px',
          height: '70px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 101
        }}>
          <button
            onClick={() => setView('capture')}
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--primary) 0%, #068085 100%)',
              border: '4px solid #080b11',
              color: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 20px rgba(9, 176, 183, 0.4)',
              cursor: 'pointer',
              transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease',
              transform: view === 'capture' || view === 'analyzing' ? 'scale(1.1)' : 'scale(1)'
            }}
            title="Neue Aufnahme"
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.15)';
              e.currentTarget.style.boxShadow = '0 10px 25px rgba(9, 176, 183, 0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = view === 'capture' || view === 'analyzing' ? 'scale(1.1)' : 'scale(1)';
              e.currentTarget.style.boxShadow = '0 8px 20px rgba(9, 176, 183, 0.4)';
            }}
          >
            <Camera size={24} />
          </button>
        </div>

        {/* Right: Einstellungen */}
        <button
          onClick={() => setView('settings')}
          style={{
            background: 'transparent',
            border: 'none',
            color: view === 'settings' ? 'var(--primary)' : 'var(--text-secondary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.2rem',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: '600',
            transition: 'all 0.2s ease',
            flex: '1',
            textAlign: 'center'
          }}
        >
          <SettingsIcon size={20} />
          <span>Einstellungen</span>
        </button>
      </nav>
      )}
    </div>
  );
}
