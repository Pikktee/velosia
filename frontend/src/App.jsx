import React, { useState, useEffect } from 'react';
import { Camera, FolderHeart, Sparkles, LogOut, User } from 'lucide-react';
import CameraCapture from './components/CameraCapture';
import DraftList from './components/DraftList';
import DraftDetail from './components/DraftDetail';
import AnalysisLoader from './components/AnalysisLoader';
import Login from './components/Login';
import { getDrafts, deleteDraft, isAuthenticated, setAuthToken, getMe } from './utils/api';

export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [view, setView] = useState('capture'); // 'capture', 'list', 'detail', 'analyzing'
  const [drafts, setDrafts] = useState([]);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [loading, setLoading] = useState(false);

  // Check auth state on mount
  useEffect(() => {
    const isAuth = isAuthenticated();
    if (isAuth) {
      setToken(localStorage.getItem('vintamie_token'));
      fetchCurrentUser();
      fetchDrafts();
    }
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
    setView('analyzing');
  };

  const handleAnalysisSuccess = (newDraft) => {
    setDrafts((prev) => [newDraft, ...prev]);
    setSelectedDraft(newDraft);
    setView('detail');
  };

  const handleAnalysisError = () => {
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingBottom: '70px' }}>
      
      {/* Premium Header */}
      <header className="glass-panel" style={{
        margin: '1rem',
        padding: '1rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-md)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <img 
            src="/favicon.svg" 
            alt="Vintamie Logo" 
            style={{ 
              width: '36px', 
              height: '36px', 
              borderRadius: '8px',
              border: '1px solid var(--glass-border)'
            }} 
          />
          <div>
            <h1 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-title)', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Vintamie
            </h1>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Vision Listing Mate
            </span>
          </div>
        </div>

        {/* User profile & Logout */}
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ 
              fontSize: '0.75rem', 
              background: 'rgba(255,255,255,0.03)', 
              padding: '0.4rem 0.8rem', 
              borderRadius: '99px', 
              border: '1px solid var(--glass-border)', 
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}>
              <User size={12} />
              {user.email}
            </span>
            <button 
              onClick={handleLogout}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.75rem',
                fontWeight: '600'
              }}
              title="Abmelden"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="container" style={{ flexGrow: 1 }}>
        {view === 'capture' && (
          <CameraCapture
            onAnalysisStart={handleAnalysisStart}
            onAnalysisSuccess={handleAnalysisSuccess}
            onAnalysisError={handleAnalysisError}
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
      </main>

      {/* Responsive Sticky Footer Navigation (App-like feel) */}
      <nav className="glass-panel" style={{
        position: 'fixed',
        bottom: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 2rem)',
        maxWidth: '500px',
        height: '60px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        borderRadius: '99px',
        padding: '0 1rem',
        border: '1px solid var(--glass-border)',
        zIndex: 100,
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
      }}>
        <button
          onClick={() => setView('capture')}
          style={{
            background: 'transparent',
            border: 'none',
            color: view === 'capture' || view === 'analyzing' ? 'var(--primary)' : 'var(--text-secondary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.2rem',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: '600',
            transition: 'color 0.2s ease'
          }}
        >
          <Camera size={18} />
          <span>Aufnahme</span>
        </button>

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
            transition: 'color 0.2s ease'
          }}
        >
          <FolderHeart size={18} />
          <span>Entwürfe</span>
        </button>
      </nav>
    </div>
  );
}
