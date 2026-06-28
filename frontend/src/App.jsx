import React, { useState, useEffect, useRef } from 'react';
import { Camera, FolderHeart, Sparkles, User, Cloud, HelpCircle, Rocket } from 'lucide-react';
import CameraCapture from './components/CameraCapture';
import DraftList from './components/DraftList';
import DraftDetail from './components/DraftDetail';
import AnalysisLoader from './components/AnalysisLoader';
import AnalysisSpecs from './components/AnalysisSpecs';
import Login from './components/Login';
import Settings from './components/Settings';
import LandingPage from './components/LandingPage';
import TesterPage from './components/TesterPage';
import LegalPage from './components/LegalPage';
import BugReportModal from './components/BugReportModal';
import IssueManagement from './components/IssueManagement';
import { getDrafts, deleteDraft, isAuthenticated, setAuthToken, getMe, uploadAndAnalyze, uploadTurbo, refreshAllListings } from './utils/api';
import { version } from '../package.json';


export default function App() {
  const isAndroidApp = typeof window.VelosiaBridge !== 'undefined';
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [view, setView] = useState('list'); // 'capture', 'list', 'detail', 'analyzing'
  const [adminTab, setAdminTab] = useState('users');
  const [drafts, setDrafts] = useState([]);
  const [selectedDraft, setSelectedDraft] = useState(null);
  // Start in loading state so the very first paint shows the skeleton list,
  // not a flash of the empty-state onboarding screen before drafts arrive.
  const [loading, setLoading] = useState(isAuthenticated());
  const [analysisError, setAnalysisError] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [route, setRoute] = useState(window.location.hash || '#/');
  const [capturedImages, setCapturedImages] = useState([]);
  const [abortController, setAbortController] = useState(null);
  const [isAnalysisFinished, setIsAnalysisFinished] = useState(false);
  const [tempAnalysisResult, setTempAnalysisResult] = useState(null);
  const [prevView, setPrevView] = useState('list');
  const [showBugReportModal, setShowBugReportModal] = useState(false);
  const [turboMode, setTurboMode] = useState(false);
  const [rocketLaunch, setRocketLaunch] = useState(false);
  const [tempTurboResults, setTempTurboResults] = useState(null);
  // Persisted backup of turbo photos so an accidental exit doesn't lose them
  const [turboImages, setTurboImages] = useState([]);
  // IDs of drafts just created by a turbo batch — they flash once in the list so
  // the user sees which offers were generated, then the marking clears itself.
  const [flashDraftIds, setFlashDraftIds] = useState([]);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [latestVersion, setLatestVersion] = useState(version);
  const longPressTimer = useRef(null);
  // When the user publishes via the platform WebView, DraftDetail stores the draft
  // id here. On returning to the dashboard (the WebView reloads fresh), we restore
  // that draft's detail view instead of dropping the user on the list. Read once at
  // mount and cleared immediately so it doesn't re-trigger on later renders.
  const [pendingReturnDraftId, setPendingReturnDraftId] = useState(() => {
    try {
      const v = localStorage.getItem('velosia_return_draft');
      if (v) localStorage.removeItem('velosia_return_draft');
      return v ? parseInt(v, 10) : null;
    } catch (e) {
      return null;
    }
  });


  // Track previous view for closing camera/getting back
  useEffect(() => {
    if (view !== 'capture' && view !== 'analyzing' && view !== 'specs') {
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
        if (turboMode) {
          setTurboImages(capturedImages); // keep turbo photos for restore
          setCapturedImages([]);
          setTurboMode(false);
        } else {
          capturedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
          setCapturedImages([]);
        }
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
  }, [view, prevView, capturedImages, turboMode]);

  // Handle server app update detection from API headers
  useEffect(() => {
    const handleVersionReceived = (e) => {
      const serverVersion = e.detail;
      if (serverVersion && serverVersion !== version) {
        setLatestVersion(serverVersion);
        setShowUpdateBanner(true);
      }
    };
    window.addEventListener('velosia-version-received', handleVersionReceived);
    return () => window.removeEventListener('velosia-version-received', handleVersionReceived);
  }, []);

  // After returning from a platform publish WebView, the dashboard reloads fresh.
  // Once the drafts are loaded, restore the detail view of the draft we were
  // publishing (set via the velosia_return_draft marker) instead of the list.
  useEffect(() => {
    if (pendingReturnDraftId == null || loading) return;
    const d = drafts.find((x) => x.id === pendingReturnDraftId);
    if (d) {
      setSelectedDraft(d);
      setView('detail');
    }
    setPendingReturnDraftId(null);
  }, [pendingReturnDraftId, loading, drafts]);

  // Check auth state on mount and manage redirects
  useEffect(() => {
    const isAuth = isAuthenticated();
    if (isAuth) {
      setToken(localStorage.getItem('velosia_token'));
      fetchCurrentUser();
      fetchDrafts();
      if (window.location.hash === '#/' || window.location.hash === '#/login' || !window.location.hash) {
        window.location.hash = '#/app';
      }
    } else {
      const isAndroidApp = typeof window.VelosiaBridge !== 'undefined';
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
      } else if (route.startsWith('#/admin/')) {
        const adminRouteMap = { '#/admin/users': 'users', '#/admin/waitlist': 'waitlist', '#/admin/bugs': 'bugs', '#/admin/issues': 'users' };
        setAdminTab(adminRouteMap[route] || 'users');
        setView('issues');
      }
    } else {
      const isAndroidApp = typeof window.VelosiaBridge !== 'undefined';
      if (isAndroidApp) {
        if (route !== '#/login') {
          window.location.hash = '#/login';
        }
      } else {
        const guestRoutes = ['#/', '#/login', '#/testen', '#/datenschutz', '#/impressum', '#/konto-loeschen'];
        if (!guestRoutes.includes(route)) {
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
      localStorage.setItem('velosia_user_email', u.email);
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

  // Re-poll all published listings (Kleinanzeigen / Vinted) and refresh statuses.
  const handleRefreshStatuses = async () => {
    const data = await refreshAllListings();
    setDrafts(data);
    return data;
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
    localStorage.removeItem('velosia_user_email');
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

  // --- Camera button: short tap = normal capture, long press = Turbo mode ---
  const LONG_PRESS_MS = 1000;

  const openNormalCapture = () => {
    setAnalysisError(null);
    setTurboMode(false);
    setCapturedImages([]); // normal capture always starts fresh
    setView('capture');
  };

  const triggerTurboLaunch = () => {
    if (navigator.vibrate) {
      try { navigator.vibrate([30, 40, 60]); } catch (e) { /* ignore */ }
    }
    setAnalysisError(null);
    setTurboMode(true);
    setCapturedImages(turboImages); // restore any photos from a previously aborted turbo session
    setView('capture');             // mount the camera immediately, behind the launch overlay
    setRocketLaunch(true);
    // Backdrop fades by ~1.5s revealing the camera; keep the overlay a bit longer so the
    // celebratory fireworks finish bursting over the now-visible camera (pointer-events: none).
    setTimeout(() => setRocketLaunch(false), 2200);
  };

  // Close the camera. In turbo mode the captured photos are preserved (not revoked)
  // so an accidental exit can be undone by simply reopening turbo.
  const closeCamera = () => {
    if (turboMode) {
      setTurboImages(capturedImages);
      setCapturedImages([]);
      setTurboMode(false);
    } else {
      capturedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
      setCapturedImages([]);
    }
    setAnalysisError(null);
    setView(prevView || 'list');
  };

  const startCameraPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      triggerTurboLaunch();
    }, LONG_PRESS_MS);
  };

  const endCameraPress = () => {
    if (longPressTimer.current) {
      // Released before the long-press threshold -> normal capture
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      openNormalCapture();
    }
  };

  const cancelCameraPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTurboUpload = async () => {
    if (capturedImages.length === 0) return;

    setAnalysisError(null);
    setIsAnalysisFinished(false);
    setTempAnalysisResult(null);
    setTempTurboResults(null);
    setView('analyzing');

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const filesToSend = capturedImages.map(img => img.file);
      const results = await uploadTurbo(filesToSend, controller.signal);

      setTempTurboResults(results);
      setIsAnalysisFinished(true);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log("Turbo analysis cancelled by user.");
        setView('capture');
      } else {
        console.error("Turbo analysis failed:", err);
        setAnalysisError(err.message || 'Die Turbo-Analyse ist fehlgeschlagen. Versuche es erneut.');
        setView('capture');
      }
      setAbortController(null);
    }
  };

  const handleUploadAndAnalyze = async (condition, details) => {
    if (capturedImages.length === 0) return;

    setAnalysisError(null);
    setIsAnalysisFinished(false);
    setTempAnalysisResult(null);
    setTempTurboResults(null);
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
    // Turbo batch: multiple drafts created at once -> land back in the list
    if (tempTurboResults) {
      capturedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
      setCapturedImages([]);
      setTurboImages([]); // turbo finished successfully -> drop the backup
      setAbortController(null);

      const newIds = tempTurboResults.map((d) => d.id);
      setDrafts((prev) => [...tempTurboResults, ...prev]);
      setTempTurboResults(null);
      setIsAnalysisFinished(false);
      setTurboMode(false);
      setSelectedDraft(null);
      setView('list');
      // One-shot highlight of the freshly created drafts; clears after the flash.
      setFlashDraftIds(newIds);
      setTimeout(() => setFlashDraftIds([]), 3200);
      return;
    }

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
    const isAndroid = typeof window.VelosiaBridge !== 'undefined';
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
              <img src="/favicon.svg" alt="Velosia Logo" className="header-logo" />
              <h1 className="header-title">velosia</h1>
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
          ) : route === '#/testen' ? (
            <TesterPage />
          ) : route === '#/datenschutz' ? (
            <LegalPage doc="datenschutz" />
          ) : route === '#/impressum' ? (
            <LegalPage doc="impressum" />
          ) : route === '#/konto-loeschen' ? (
            <LegalPage doc="konto-loeschen" />
          ) : (
            isAndroid ? <Login onLoginSuccess={handleLoginSuccess} /> : <LandingPage />
          )}
        </div>
      </div>
    );
  }

  const useStickyHeaderLayout = 
    view === 'detail' || 
    (view === 'list' && (drafts.length > 0 || loading)) || 
    view === 'settings' || 
    view === 'specs';

  return (
    <div className={`app-shell ${isAndroidApp ? 'android-app' : ''} ${view === 'capture' ? 'camera-mode' : ''} ${view === 'detail' ? 'detail-mode' : ''} ${view === 'list' && (drafts.length > 0 || loading) ? 'list-mode' : ''} ${view === 'settings' ? 'settings-mode' : ''} ${view === 'specs' ? 'specs-mode' : ''} ${isInputFocused ? 'keyboard-open' : ''}`}>
      {/* Top Header Brand Bar */}
      {!useStickyHeaderLayout && !isAndroidApp && (
        <header className="app-header">
          <div className="header-brand">
            <img src="/favicon.svg" alt="Velosia Logo" className="header-logo" />
            <h1 className="header-title">velosia</h1>
          </div>
          <div className="header-actions">
            {view === 'capture' && (
              <div className="status-badge">
                {turboMode ? (
                  <>
                    <Rocket size={12} style={{ color: 'var(--secondary)' }} />
                    <span>Turbo: alle Artikel fotografieren</span>
                  </>
                ) : (
                  <>
                    <Camera size={12} style={{ color: 'var(--primary)' }} />
                    <span>Fotos hinzufügen</span>
                  </>
                )}
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
      )}

      {/* Main Content Area */}
      <main className="app-main">
        <div 
          className={`${useStickyHeaderLayout ? '' : 'container'} ${view === 'list' && drafts.length === 0 && !loading ? 'empty-state-container' : ''}`}
          style={{ 
            paddingTop: useStickyHeaderLayout ? '0' : '1rem', 
            paddingBottom: view === 'list' && drafts.length === 0 && !loading ? 'calc(75px + env(safe-area-inset-bottom, 0px))' : 'calc(80px + env(safe-area-inset-bottom, 0px))'
          }}
        >
          {view === 'capture' && (
            <CameraCapture
              selectedImages={capturedImages}
              setSelectedImages={setCapturedImages}
              turbo={turboMode}
              onAnalysisStart={() => setView('specs')}
              onTurboFinish={handleTurboUpload}
              analysisError={analysisError}
              onClearError={() => setAnalysisError(null)}
              onClose={closeCamera}
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
              turbo={turboMode}
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
              onRefreshStatuses={handleRefreshStatuses}
              flashIds={flashDraftIds}
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
              onShowBugReport={() => setShowBugReportModal(true)}
            />
          )}

          {view === 'issues' && (
            <IssueManagement
              user={user}
              initialTab={adminTab}
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
              onMouseDown={startCameraPress}
              onMouseUp={endCameraPress}
              onTouchStart={startCameraPress}
              onTouchEnd={(e) => { e.preventDefault(); endCameraPress(); }}
              onTouchCancel={cancelCameraPress}
              onContextMenu={(e) => e.preventDefault()}
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
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                touchAction: 'manipulation',
                transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease',
                transform: view === 'capture' || view === 'analyzing' ? 'scale(1.15)' : 'scale(1)'
              }}
              title="Tippen für neue Aufnahme · Gedrückt halten für Turbo-Modus"
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.2)';
                e.currentTarget.style.boxShadow = '0 10px 25px rgba(9, 176, 183, 0.6)';
              }}
              onMouseLeave={(e) => {
                cancelCameraPress();
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

      {/* Turbo rocket launch animation: backdrop fades out as the rocket flies up, revealing the camera */}
      {rocketLaunch && (
        <div className="rocket-launch-overlay" aria-hidden="true">
          <div className="rocket-launch-backdrop" />
          <div className="rocket-vehicle">
            <div className="rocket-trail" />
            <svg className="rocket-svg" width="56" height="94" viewBox="0 0 56 94" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="rk-body" x1="28" y1="4" x2="28" y2="62" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#ffffff" />
                  <stop offset="1" stopColor="#c5cfdd" />
                </linearGradient>
                <linearGradient id="rk-flame" x1="28" y1="60" x2="28" y2="94" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#fde68a" />
                  <stop offset="0.5" stopColor="#fb923c" />
                  <stop offset="1" stopColor="#ec4899" />
                </linearGradient>
              </defs>
              <path className="rk-flame" d="M20 60 H36 C36 75 31 85 28 94 C25 85 20 75 20 60 Z" fill="url(#rk-flame)" />
              <path d="M18 46 L7 63 L18 58 Z" fill="#ec4899" />
              <path d="M38 46 L49 63 L38 58 Z" fill="#ec4899" />
              <path d="M28 4 C40 18 42 40 38 60 H18 C14 40 16 18 28 4 Z" fill="url(#rk-body)" stroke="#94a3b8" strokeWidth="1.5" />
              <circle cx="28" cy="30" r="8" fill="#09b0b7" stroke="#0e7490" strokeWidth="2.5" />
              <circle cx="30.5" cy="27.5" r="2.4" fill="#fff" fillOpacity="0.85" />
            </svg>
          </div>
          <div className="firework fw-1" />
          <div className="firework fw-2" />
          <div className="firework fw-3" />
          <div className="firework fw-4" />
          <div className="firework fw-5" />
          <div className="firework fw-6" />
          <div className="spark sp-1" />
          <div className="spark sp-2" />
          <div className="spark sp-3" />
        </div>
      )}

      {showUpdateBanner && (
        <div className="update-toast-banner">
          <div className="update-toast-content">
            <Sparkles size={16} style={{ color: 'var(--primary)' }} />
            <span>Update verfügbar (v{latestVersion})</span>
          </div>
          <button 
            className="btn btn-primary update-toast-btn"
            onClick={() => window.location.reload(true)}
          >
            Aktualisieren
          </button>
        </div>
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
