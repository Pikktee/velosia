import React, { useState, useEffect } from 'react';
import { ArrowLeft, Trash2, Calendar, Monitor, Mail, ExternalLink, ShieldAlert, Check, X } from 'lucide-react';
import { getBugReports, deleteBugReport, getImageUrl } from '../utils/api';

export default function IssueManagement({ user, onBack }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeScreenshot, setActiveScreenshot] = useState(null);

  useEffect(() => {
    if (user && !user.is_admin) {
      setError('Keine Berechtigung. Dieser Bereich ist nur für Administratoren zugänglich.');
      setLoading(false);
      return;
    }
    fetchIssues();
  }, [user]);

  const fetchIssues = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBugReports();
      setIssues(data);
    } catch (err) {
      setError(err.message || 'Fehler beim Laden der Bug Reports.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Möchtest du diesen Bug Report wirklich löschen?')) return;
    try {
      await deleteBugReport(id);
      setIssues(prev => prev.filter(issue => issue.id !== id));
    } catch (err) {
      alert(err.message || 'Fehler beim Löschen.');
    }
  };

  const formatDate = (dateStr) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  };

  const parseDeviceInfo = (infoStr) => {
    try {
      return JSON.parse(infoStr);
    } catch (e) {
      return null;
    }
  };

  if (loading) {
    return (
      <div className="glass-panel issue-mgmt-container" style={{ padding: '3rem', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 1.5rem auto', width: '32px', height: '32px', border: '3px solid rgba(9, 176, 183, 0.1)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p>Lade Bug Reports...</p>
      </div>
    );
  }

  if (error && (!user || !user.is_admin)) {
    return (
      <div className="glass-panel issue-mgmt-container" style={{ padding: '3rem', textAlign: 'center' }}>
        <ShieldAlert size={48} style={{ color: 'var(--danger)', marginBottom: '1rem' }} />
        <h2>Zugriff verweigert</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{error}</p>
        <button className="btn btn-primary" onClick={onBack}>
          <ArrowLeft size={16} /> Zurück zur App
        </button>
      </div>
    );
  }

  return (
    <div className="issue-mgmt-container">
      <div className="issue-mgmt-header">
        <button className="back-btn" onClick={onBack}>
          <ArrowLeft size={20} />
          <span>Zurück</span>
        </button>
        <h2 className="page-title" style={{ flexGrow: 1 }}>Issue Management</h2>
        <div className="issue-count-badge">{issues.length} {issues.length === 1 ? 'Report' : 'Reports'}</div>
      </div>

      {error && (
        <div className="bug-error-message" style={{ marginBottom: '1.5rem' }}>
          <span>{error}</span>
        </div>
      )}

      {issues.length === 0 ? (
        <div className="glass-panel empty-issues" style={{ padding: '4rem 2rem', textAlign: 'center', borderRadius: 'var(--radius-md)' }}>
          <div className="empty-icon-container" style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
            <Check size={28} style={{ color: 'var(--success)' }} />
          </div>
          <h3>Keine Probleme gemeldet</h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0.5rem auto 0 auto' }}>Gute Arbeit! Es liegen aktuell keine unbearbeiteten Bug Reports vor.</p>
        </div>
      ) : (
        <div className="issues-list">
          {issues.map((issue) => {
            const devInfo = parseDeviceInfo(issue.device_info);
            return (
              <div key={issue.id} className="glass-panel issue-card fade-in">
                <div className="issue-card-header">
                  <div className="issue-card-meta">
                    <span className="issue-user">
                      <Mail size={12} />
                      {issue.user_email || `User #${issue.user_id}`}
                    </span>
                    <span className="issue-date">
                      <Calendar size={12} />
                      {formatDate(issue.created_at)}
                    </span>
                  </div>
                  <button 
                    className="delete-issue-btn" 
                    onClick={() => handleDelete(issue.id)}
                    title="Löschen"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="issue-card-body">
                  <h3 className="issue-subject">{issue.title}</h3>
                  <p className="issue-description">{issue.description}</p>

                  <div className="issue-details-grid">
                    {/* Device info */}
                    {devInfo && (
                      <div className="issue-dev-info">
                        <h4>Device / App Infos</h4>
                        <div className="dev-info-tags">
                          <span>View: <strong>{devInfo.currentView}</strong></span>
                          <span>Hash: <strong>{devInfo.urlHash}</strong></span>
                          <span>Screen: {devInfo.screenWidth}x{devInfo.screenHeight} (@{devInfo.devicePixelRatio}x)</span>
                          <span className="user-agent" title={devInfo.userAgent}>
                            <Monitor size={10} /> {devInfo.userAgent.substring(0, 60)}...
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Screenshot thumbnail */}
                    {issue.screenshot_path && (
                      <div className="issue-screenshot-thumb">
                        <h4>Screenshot</h4>
                        <div 
                          className="screenshot-thumb-wrapper" 
                          onClick={() => setActiveScreenshot(getImageUrl(issue.screenshot_path))}
                        >
                          <img src={getImageUrl(issue.screenshot_path)} alt="Bug Screenshot" />
                          <div className="screenshot-thumb-overlay">
                            <ExternalLink size={16} />
                            <span>Vergrößern</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox Modal */}
      {activeScreenshot && (
        <div className="lightbox-overlay" onClick={() => setActiveScreenshot(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={activeScreenshot} alt="Bug Screenshot Full" />
            <button className="lightbox-close" onClick={() => setActiveScreenshot(null)}>
              <X size={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
