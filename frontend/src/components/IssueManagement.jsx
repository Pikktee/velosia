import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Trash2, Calendar, Monitor, Mail, ExternalLink, ShieldAlert, Check, X,
  Users, Bug, ClipboardList, Ban, ShieldCheck, Copy, Package, Euro
} from 'lucide-react';
import {
  getBugReports, deleteBugReport, getImageUrl,
  getWaitlist, getAdminUsers, setUserBlocked, deleteUser
} from '../utils/api';

const formatDate = (dateStr) => {
  try {
    return new Date(dateStr).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    return dateStr;
  }
};

const parseDeviceInfo = (infoStr) => {
  try { return JSON.parse(infoStr); } catch (e) { return null; }
};

export default function IssueManagement({ user, onBack, initialTab = 'users' }) {
  const isAdmin = !!(user && user.is_admin);

  const [tab, setTab] = useState(initialTab); // 'bugs' | 'waitlist' | 'users'

  const [issues, setIssues] = useState([]);
  const [bugsLoaded, setBugsLoaded] = useState(false);
  const [waitlist, setWaitlist] = useState([]);
  const [waitlistLoaded, setWaitlistLoaded] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersLoaded, setUsersLoaded] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeScreenshot, setActiveScreenshot] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, onConfirm }
  const [copied, setCopied] = useState(false);

  const loadBugs = async () => {
    setLoading(true); setError(null);
    try { setIssues(await getBugReports()); setBugsLoaded(true); }
    catch (err) { setError(err.message || 'Fehler beim Laden der Bug Reports.'); }
    finally { setLoading(false); }
  };

  const loadWaitlist = async () => {
    setLoading(true); setError(null);
    try { setWaitlist(await getWaitlist()); setWaitlistLoaded(true); }
    catch (err) { setError(err.message || 'Fehler beim Laden der Warteliste.'); }
    finally { setLoading(false); }
  };

  const loadUsers = async () => {
    setLoading(true); setError(null);
    try { setUsers(await getAdminUsers()); setUsersLoaded(true); }
    catch (err) { setError(err.message || 'Fehler beim Laden der Benutzer.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === 'bugs' && !bugsLoaded) loadBugs();
    else if (tab === 'waitlist' && !waitlistLoaded) loadWaitlist();
    else if (tab === 'users' && !usersLoaded) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isAdmin]);

  const confirmDeleteBug = (id) => setConfirm({
    title: 'Bug Report löschen?',
    message: 'Möchtest du diesen Bug Report wirklich dauerhaft löschen?',
    onConfirm: async () => {
      try { await deleteBugReport(id); setIssues(prev => prev.filter(i => i.id !== id)); }
      catch (err) { alert(err.message || 'Fehler beim Löschen.'); }
    }
  });

  const toggleBlock = async (u) => {
    try {
      const updated = await setUserBlocked(u.id, !u.is_blocked);
      setUsers(prev => prev.map(x => x.id === u.id ? updated : x));
    } catch (err) {
      alert(err.message || 'Aktion fehlgeschlagen.');
    }
  };

  const confirmDeleteUser = (u) => setConfirm({
    title: 'Benutzer löschen?',
    message: `„${u.email}" und alle ${u.draft_count} zugehörigen Entwürfe werden unwiderruflich gelöscht.`,
    onConfirm: async () => {
      try { await deleteUser(u.id); setUsers(prev => prev.filter(x => x.id !== u.id)); }
      catch (err) { alert(err.message || 'Löschen fehlgeschlagen.'); }
    }
  });

  const copyWaitlistEmails = async () => {
    const emails = waitlist.map(w => w.email).join(', ');
    try {
      await navigator.clipboard.writeText(emails);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) { /* clipboard may be blocked; ignore */ }
  };

  // Access guard
  if (user && !isAdmin) {
    return (
      <div className="glass-panel issue-mgmt-container" style={{ padding: '3rem', textAlign: 'center' }}>
        <ShieldAlert size={48} style={{ color: 'var(--danger)', marginBottom: '1rem' }} />
        <h2>Zugriff verweigert</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Dieser Bereich ist nur für Administratoren zugänglich.
        </p>
        <button className="btn btn-primary" onClick={onBack}>
          <ArrowLeft size={16} /> Zurück zur App
        </button>
      </div>
    );
  }

  const TABS = [
    { key: 'bugs', label: 'Bug-Reports', icon: <Bug size={15} />, count: bugsLoaded ? issues.length : null },
    { key: 'waitlist', label: 'Warteliste', icon: <ClipboardList size={15} />, count: waitlistLoaded ? waitlist.length : null },
    { key: 'users', label: 'Benutzer', icon: <Users size={15} />, count: usersLoaded ? users.length : null },
  ];

  return (
    <div className="issue-mgmt-container">
      <div className="issue-mgmt-header">
        <button className="back-btn" onClick={onBack}>
          <ArrowLeft size={20} />
          <span>Zurück</span>
        </button>
        <h2 className="page-title" style={{ flexGrow: 1 }}>Admin</h2>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
              padding: '0.5rem 0.9rem', borderRadius: '999px', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: '600',
              border: tab === t.key ? '1px solid rgba(9,176,183,0.4)' : '1px solid var(--glass-border)',
              background: tab === t.key ? 'rgba(9,176,183,0.12)' : 'rgba(255,255,255,0.02)',
              color: tab === t.key ? 'var(--primary)' : 'var(--text-secondary)',
              transition: 'all 0.15s ease'
            }}
          >
            {t.icon} {t.label}
            {t.count !== null && (
              <span style={{
                fontSize: '0.72rem', fontWeight: '700', padding: '0.05rem 0.4rem',
                borderRadius: '999px', background: 'rgba(255,255,255,0.08)'
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="bug-error-message" style={{ marginBottom: '1.5rem' }}>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', borderRadius: 'var(--radius-md)' }}>
          <div className="spinner" style={{ margin: '0 auto 1.5rem auto', width: '32px', height: '32px', border: '3px solid rgba(9, 176, 183, 0.1)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <p>Lade Daten…</p>
        </div>
      ) : (
        <>
          {tab === 'bugs' && <BugsTab issues={issues} onDelete={confirmDeleteBug} onZoom={setActiveScreenshot} />}
          {tab === 'waitlist' && <WaitlistTab entries={waitlist} onCopy={copyWaitlistEmails} copied={copied} />}
          {tab === 'users' && <UsersTab users={users} onToggleBlock={toggleBlock} onDelete={confirmDeleteUser} />}
        </>
      )}

      {/* Lightbox */}
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

      <CustomConfirmModal
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); c && c.onConfirm(); }}
        title={confirm?.title}
        message={confirm?.message}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Bug reports
function BugsTab({ issues, onDelete, onZoom }) {
  if (issues.length === 0) {
    return (
      <div className="glass-panel empty-issues" style={{ padding: '4rem 2rem', textAlign: 'center', borderRadius: 'var(--radius-md)' }}>
        <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
          <Check size={28} style={{ color: 'var(--success)' }} />
        </div>
        <h3>Keine Probleme gemeldet</h3>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0.5rem auto 0 auto' }}>Aktuell liegen keine unbearbeiteten Bug Reports vor.</p>
      </div>
    );
  }
  return (
    <div className="issues-list">
      {issues.map((issue) => {
        const devInfo = parseDeviceInfo(issue.device_info);
        return (
          <div key={issue.id} className="glass-panel issue-card fade-in">
            <div className="issue-card-header">
              <div className="issue-card-meta">
                <span className="issue-user"><Mail size={12} />{issue.user_email || `User #${issue.user_id}`}</span>
                <span className="issue-date"><Calendar size={12} />{formatDate(issue.created_at)}</span>
              </div>
              <button className="delete-issue-btn" onClick={() => onDelete(issue.id)} title="Löschen">
                <Trash2 size={16} />
              </button>
            </div>
            <div className="issue-card-body">
              <h3 className="issue-subject">{issue.title}</h3>
              <p className="issue-description">{issue.description}</p>
              <div className="issue-details-grid">
                {devInfo && (
                  <div className="issue-dev-info">
                    <h4>Device / App Infos</h4>
                    <div className="dev-info-tags">
                      <span>View: <strong>{devInfo.currentView}</strong></span>
                      <span>Hash: <strong>{devInfo.urlHash}</strong></span>
                      <span>Screen: {devInfo.screenWidth}x{devInfo.screenHeight} (@{devInfo.devicePixelRatio}x)</span>
                      <span className="user-agent" title={devInfo.userAgent}>
                        <Monitor size={10} /> {devInfo.userAgent?.substring(0, 60)}...
                      </span>
                    </div>
                  </div>
                )}
                {issue.screenshot_path && (
                  <div className="issue-screenshot-thumb">
                    <h4>Screenshot</h4>
                    <div className="screenshot-thumb-wrapper" onClick={() => onZoom(getImageUrl(issue.screenshot_path))}>
                      <img src={getImageUrl(issue.screenshot_path)} alt="Bug Screenshot" />
                      <div className="screenshot-thumb-overlay"><ExternalLink size={16} /><span>Vergrößern</span></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Waitlist
function WaitlistTab({ entries, onCopy, copied }) {
  if (entries.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center', borderRadius: 'var(--radius-md)' }}>
        <ClipboardList size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h3>Noch keine Anmeldungen</h3>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0.5rem auto 0 auto' }}>
          Sobald sich jemand über die Landing Page einträgt, erscheint die E-Mail hier.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn" onClick={onCopy} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 0.9rem',
          fontSize: '0.83rem', fontWeight: '600', background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--glass-border)', color: 'var(--text-primary)', cursor: 'pointer'
        }}>
          {copied ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Copy size={14} />}
          {copied ? 'Kopiert!' : 'Alle E-Mails kopieren'}
        </button>
      </div>
      <div className="glass-panel" style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {entries.map((e, idx) => (
          <div key={e.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
            padding: '0.85rem 1.1rem',
            borderTop: idx === 0 ? 'none' : '1px solid var(--glass-border)'
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', wordBreak: 'break-all' }}>
              <Mail size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} /> {e.email}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {formatDate(e.created_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- Users
function UsersTab({ users, onToggleBlock, onDelete }) {
  if (users.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center', borderRadius: 'var(--radius-md)' }}>
        <Users size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h3>Keine Benutzer</h3>
      </div>
    );
  }

  const totalCost = users.reduce((s, u) => s + (u.est_cost_eur || 0), 0);
  const totalDrafts = users.reduce((s, u) => s + (u.draft_count || 0), 0);

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <Stat icon={<Users size={15} />} label="Benutzer" value={users.length} />
        <Stat icon={<Package size={15} />} label="Entwürfe gesamt" value={totalDrafts} />
        <Stat icon={<Euro size={15} />} label="Kosten gesamt (geschätzt)" value={`€ ${totalCost.toFixed(2)}`} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {users.map((u) => (
          <div key={u.id} className="glass-panel" style={{
            padding: '1rem 1.1rem', borderRadius: 'var(--radius-md)',
            opacity: u.is_blocked ? 0.65 : 1,
            border: u.is_blocked ? '1px solid rgba(239,68,68,0.3)' : undefined
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Mail size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  <span style={{ fontWeight: '600', fontSize: '0.92rem', wordBreak: 'break-all' }}>{u.email}</span>
                  {u.is_admin && <Badge color="var(--primary)">Admin</Badge>}
                  {u.is_blocked && <Badge color="var(--danger, #ef4444)">Gesperrt</Badge>}
                </div>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span><Package size={11} style={{ verticalAlign: '-1px' }} /> {u.draft_count} Entwürfe</span>
                  <span>{u.image_count} Bilder</span>
                  <span><Euro size={11} style={{ verticalAlign: '-1px' }} /> ~ € {Number(u.est_cost_eur).toFixed(2)}</span>
                  <span style={{ color: 'var(--text-muted)' }}><Calendar size={11} style={{ verticalAlign: '-1px' }} /> {formatDate(u.created_at)}</span>
                </div>
              </div>

              {!u.is_admin && (
                <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                  <button
                    onClick={() => onToggleBlock(u)}
                    title={u.is_blocked ? 'Entsperren' : 'Sperren'}
                    style={iconBtn(u.is_blocked ? 'var(--success)' : 'var(--warning, #f59e0b)')}
                  >
                    {u.is_blocked ? <ShieldCheck size={16} /> : <Ban size={16} />}
                  </button>
                  <button onClick={() => onDelete(u)} title="Löschen" style={iconBtn('var(--danger, #ef4444)')}>
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '1rem', lineHeight: '1.5' }}>
        Kosten sind eine <strong>Schätzung</strong> auf Basis der analysierten Bilder (Gemini Vision),
        kein exaktes Abrechnungsdatum.
      </p>
    </div>
  );
}

const iconBtn = (color) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: '34px', height: '34px', borderRadius: '8px', cursor: 'pointer',
  background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', color
});

function Stat({ icon, label, value }) {
  return (
    <div className="glass-panel" style={{ flex: '1 1 140px', padding: '0.8rem 1rem', borderRadius: 'var(--radius-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: '1.25rem', fontWeight: '800', fontFamily: 'var(--font-title)' }}>{value}</div>
    </div>
  );
}

function Badge({ children, color }) {
  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: '700', padding: '0.1rem 0.45rem', borderRadius: '999px',
      color, background: 'rgba(255,255,255,0.06)', border: `1px solid ${color}`, opacity: 0.9
    }}>{children}</span>
  );
}

// Custom Confirmation Modal Portal
function CustomConfirmModal({ isOpen, onClose, onConfirm, title, message }) {
  if (!isOpen) return null;
  return createPortal(
    <div className="confirm-modal-overlay" onClick={onClose}>
      <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-modal-buttons">
          <button className="confirm-btn-cancel" onClick={onClose}>Abbrechen</button>
          <button className="confirm-btn-delete" onClick={onConfirm}>Löschen</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
