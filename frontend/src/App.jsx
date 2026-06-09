import React, { useState, useEffect, useRef } from 'react';
import { Camera, FolderHeart, Sparkles, User, Cloud, HelpCircle } from 'lucide-react';
import CameraCapture from './components/CameraCapture';
import DraftList from './components/DraftList';
import DraftDetail from './components/DraftDetail';
import AnalysisLoader from './components/AnalysisLoader';
import AnalysisSpecs from './components/AnalysisSpecs';
import Login from './components/Login';
import Settings from './components/Settings';
import LandingPage from './components/LandingPage';
import BugReportModal from './components/BugReportModal';
import IssueManagement from './components/IssueManagement';
import { getDrafts, deleteDraft, isAuthenticated, setAuthToken, getMe, uploadAndAnalyze } from './utils/api';


export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [view, setView] = useState('list'); // 'capture', 'list', 'detail', 'analyzing'
  const [drafts, setDrafts] = useState([]);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [route, setRoute] = useState(window.location.hash || '#/');
  const [capturedImages, setCapturedImages] = useState([]);
  const [abortController, setAbortController] = useState(null);
  const [isAnalysisFinished, setIsAnalysisFinished] = useState(false);
  const [tempAnalysisResult, setTempAnalysisResult] = useState(null);
  const [prevView, setPrevView] = useState('list');
  const [showBugReportModal, setShowBugReportModal] = useState(false);


  // Track previous view for closing camera/getting back
  useEffect(() => {
    if (view !== 'capture' && view !== 'analyzing') {
      setPrevView(view);
    }
  }, [view]);

  // Sync hash routing
  useEffect(() => {
    const handleHashChange = () => {
      setRoute(window.location.hash || '#/');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Handle Android physical back gesture
  useEffect(() => {
    window.onAndroidBack = () => {
      if (view === 'specs') {
        setView('capture');
        return true;
      } else if (view === 'capture') {
        capturedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
        setCapturedImages([]);
        setAnalysisError(null);
        setView(prevView || 'list');
        return true;
      } else if (view === 'detail') {
        setView('list');
        setSelectedDraft(null);
        fetchDrafts();
        return true;
      } else if (view === 'settings') {
        setView('list');
        return true;
      }
      return false;
    };

    return () => {
      delete window.onAndroidBack;
    };
  }, [view, prevView, capturedImages]);

  // Check auth state on mount and manage redirects
  useEffect(() => {
    const isAuth = isAuthenticated();
    if (isAuth) {
      setToken(localStorage.getItem('vintamie_token'));
      fetchCurrentUser();
      fetchDrafts();
      if (window.location.hash === '#/' || window.location.hash === '#/login' || !window.location.hash) {
        window.location.hash = '#/app';
      }
    } else {
      const isAndroidApp = typeof window.VintamieBridge !== 'undefined';
      if (window.location.hash === '#/app') {
        window.location.hash = isAndroidApp ? '#/login' : '#/';
      } else if (!window.location.hash || window.location.hash === '#/') {
        if (isAndroidApp) {
          window.location.hash = '#/login';
        }
      }
    }
  }, []);

  // Enforce auth / guest redirects on route changes
  useEffect(() => {
    const isAuth = isAuthenticated();
    if (isAuth) {
      if (route === '#/' || route === '#/login') {
        window.location.hash = '#/app';
      } else if (route === '#/admin/issues') {
        setView('issues');
      }
    } else {
      const isAndroidApp = typeof window.VintamieBridge !== 'undefined';
      if (isAndroidApp) {
        if (route !== '#/login') {
          window.location.hash = '#/login';
        }
      } else {
        if (route !== '#/' && route !== '#/login') {
          window.location.hash = '#/';
        }
      }
    }
  }, [route, token]);

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
    setView('list');
    window.location.hash = '#/app';
  };

  const handleLogout = () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setDrafts([]);
    setSelectedDraft(null);
    localStorage.removeItem('vintamie_user_email');
    setView('list');
    window.location.hash = '#/';
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
      alert('Das Angebot konnte nicht gelöscht werden.');
    }
  };

  const handleUploadAndAnalyze = async (condition, details) => {
    if (capturedImages.length === 0) return;

    setAnalysisError(null);
    setIsAnalysisFinished(false);
    setTempAnalysisResult(null);
    setView('analyzing');

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const filesToSend = capturedImages.map(img => img.file);
      const result = await uploadAndAnalyze(filesToSend, condition, details, controller.signal);

      setTempAnalysisResult(result);
      setIsAnalysisFinished(true);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log("Analysis cancelled by user.");
        setView('capture');
      } else {
        console.error("Analysis failed:", err);
        const errMsg = err.message || 'Die Analyse ist fehlgeschlagen. Versuche es erneut.';
        setAnalysisError(errMsg);
        setView('capture');
      }
      setAbortController(null);
    }
  };

  const handleAnalysisLoaderComplete = () => {
    if (!tempAnalysisResult) return;

    // Revoke preview URLs on success
    capturedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
    setCapturedImages([]);
    setAbortController(null);

    // Add to drafts list and show details
    setDrafts((prev) => [tempAnalysisResult, ...prev]);
    setSelectedDraft(tempAnalysisResult);
    setIsAnalysisFinished(false);
    setTempAnalysisResult(null);
    setView('detail');
  };

  const handleCancelAnalysis = () => {
    if (abortController) {
      abortController.abort();
    } else {
      setView('capture');
    }
  };

  const handleUpdateSuccess = (updatedDraft) => {
    setDrafts((prev) => prev.map((d) => (d.id === updatedDraft.id ? updatedDraft : d)));
    setSelectedDraft(updatedDraft);
  };

  // If not authenticated, render Landing Page or Login page
  if (!token) {
    const isAndroid = typeof window.VintamieBridge !== 'undefined';
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg-gradient)', position: 'relative', overflowX: 'hidden' }}>
        {/* Landing Page Header */}
        {!isAndroid && (
          <header className="app-header" style={{
            position: 'sticky',
            top: 0,
            zIndex: 110,
            boxShadow: '0 4px 30px rgba(0, 0, 0, 0.2)'
          }}>
            <div className="header-brand" style={{ cursor: 'pointer' }} onClick={() => window.location.hash = '#/'}>
              <img src="/favicon.svg" alt="Vintamie Logo" className="header-logo" />
              <h1 className="header-title">vintamie</h1>
            </div>
            <div className="header-actions">
              {route === '#/login' ? (
                <button 
                  className="btn" 
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontWeight: '600',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    minHeight: '32px',
                    height: '32px',
                    padding: '0 1rem'
                  }}
                  onClick={() => window.location.hash = '#/'}
                >
                  Startseite
                </button>
              ) : (
                <button 
                  className="btn btn-primary" 
                  style={{
                    minHeight: '32px',
                    height: '32px',
                    padding: '0 1.2rem',
                    fontSize: '0.8rem',
                    fontWeight: '700',
                    boxShadow: '0 4px 15px rgba(9, 176, 183, 0.25)'
                  }}
                  onClick={() => window.location.hash = '#/login'}
                >
                  Login
                </button>
              )}
            </div>
          </header>
        )}

        {/* Content container */}
        <div className="container" style={{ padding: isAndroid ? '0' : '2rem 1.25rem' }}>
          {route === '#/login' ? (
            <Login onLoginSuccess={handleLoginSuccess} />
          ) : (
            isAndroid ? <Login onLoginSuccess={handleLoginSuccess} /> : <LandingPage />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${view === 'capture' ? 'camera-mode' : ''} ${view === 'detail' ? 'detail-mode' : ''} ${isInputFocused ? 'keyboard-open' : ''}`}>
      {/* Top Header Brand Bar */}
      <header className="app-header">
        <div className="header-brand">
          <img src="/favicon.svg" alt="Vintamie Logo" className="header-logo" />
          <h1 className="header-title">vintamie</h1>
        </div>
        <div className="header-actions">
          {view === 'capture' && (
            <div className="status-badge">
              <Camera size={12} style={{ color: 'var(--primary)' }} />
              <span>Fotos hinzufügen</span>
            </div>
          )}

          
          <button 
            className="help-icon-btn" 
            onClick={() => setShowBugReportModal(true)} 
            title="Problem melden"
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main">
        <div 
          className={`${view === 'detail' ? '' : 'container'} ${view === 'list' && drafts.length === 0 ? 'empty-state-container' : ''}`}
          style={{ 
            paddingTop: view === 'detail' ? '0' : '1rem', 
            paddingBottom: view === 'list' && drafts.length === 0 ? 'calc(75px + env(safe-area-inset-bottom, 0px))' : 'calc(80px + env(safe-area-inset-bottom, 0px))'
          }}
        >
          {view === 'capture' && (
            <CameraCapture
              selectedImages={capturedImages}
              setSelectedImages={setCapturedImages}
              onAnalysisStart={() => setView('specs')}
              analysisError={analysisError}
              onClearError={() => setAnalysisError(null)}
              onClose={() => {
                capturedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
                setCapturedImages([]);
                setAnalysisError(null);
                setView(prevView || 'list');
              }}
            />
          )}

          {view === 'specs' && (
            <AnalysisSpecs
              images={capturedImages}
              onBack={() => setView('capture')}
              onStartAnalysis={(condition, details) => handleUploadAndAnalyze(condition, details)}
            />
          )}

          {view === 'analyzing' && (
            <AnalysisLoader 
              isFinished={isAnalysisFinished}
              onComplete={handleAnalysisLoaderComplete}
              onCancel={handleCancelAnalysis} 
            />
          )}

          {view === 'list' && (
            <DraftList
              drafts={drafts}
              isLoading={loading}
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
              onUpdateUser={(updatedUser) => setUser(updatedUser)}
            />
          )}

          {view === 'issues' && (
            <IssueManagement
              user={user}
              onBack={() => {
                setView('settings');
                window.location.hash = '#/app';
              }}
            />
          )}
        </div>
      </main>

      {/* Responsive Sticky Footer Navigation (Tinder style flat bottom bar) */}
      {!isInputFocused && view !== 'analyzing' && view !== 'specs' && view !== 'issues' && (
        <nav className="app-nav">
          {/* Left: Angebote */}
          <button
            onClick={() => {
              fetchDrafts();
              setView('list');
            }}
            className={`nav-tab-btn ${view === 'list' || view === 'detail' ? 'active' : ''}`}
          >
            <FolderHeart size={20} />
            <span>Angebote</span>
          </button>

          {/* Center: Floating round Camera button (FAB) */}
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
            <button
              onClick={() => {
                setAnalysisError(null);
                setView('capture');
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
          </div>

          {/* Right: Profil */}
          <button
            onClick={() => setView('settings')}
            className={`nav-tab-btn ${view === 'settings' ? 'active' : ''}`}
          >
            <User size={20} />
            <span>Profil</span>
          </button>
        </nav>
      )}

      {showBugReportModal && (
        <BugReportModal 
          currentView={view} 
          onClose={() => setShowBugReportModal(false)} 
        />
      )}
    </div>
  );
}
