import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { createExportLink } from '../utils/api';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const formatSize = (bytes) => {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return 'unter 1 MB';
  return `ca. ${mb.toLocaleString('de-DE', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
};

// "Meine Daten exportieren" (GDPR access / portability). Two taps on purpose: the
// first prepares a short-lived download link and says how big the ZIP is (all
// photos are in it), the second opens that link. In the Android app only a link
// the user taps leaves the WebView for the system browser, which saves the file.
export default function DataExportSection() {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null); // { url, expires_in, draft_count, photo_count, size_bytes }
  const [error, setError] = useState('');
  const isAndroidApp = typeof window.VelosiaBridge !== 'undefined';

  // The server rejects the link once it has expired; stop offering it shortly before.
  useEffect(() => {
    if (!link) return undefined;
    const timer = setTimeout(() => setLink(null), Math.max(0, link.expires_in - 30) * 1000);
    return () => clearTimeout(timer);
  }, [link]);

  const prepare = async () => {
    setError('');
    setBusy(true);
    try {
      setLink(await createExportLink());
    } catch (err) {
      setError(err.message || 'Der Export konnte nicht vorbereitet werden.');
    } finally {
      setBusy(false);
    }
  };

  const buttonStyle = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', minHeight: '44px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {link ? (
        <>
          <p role="status" style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-primary)' }}>
            Export bereit: {plural(link.draft_count, 'Angebot', 'Angebote')},{' '}
            {plural(link.photo_count, 'Foto', 'Fotos')}, {formatSize(link.size_bytes)}.
          </p>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={buttonStyle}
          >
            <Download size={18} />
            Herunterladen
          </a>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
            Link gilt {Math.round(link.expires_in / 60)} Minuten{isAndroidApp ? ', öffnet im Browser' : ''}.
          </p>
        </>
      ) : (
        <button type="button" onClick={prepare} disabled={busy} className="settings-row">
          <Download size={18} style={{ color: 'var(--primary)' }} />
          <span>{busy ? 'Wird vorbereitet …' : 'Daten exportieren (ZIP)'}</span>
        </button>
      )}
      {error && (
        <p role="alert" style={{ fontSize: '0.85rem', margin: 0, color: '#fca5a5' }}>{error}</p>
      )}
    </div>
  );
}
