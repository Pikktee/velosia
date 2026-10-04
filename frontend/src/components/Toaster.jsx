import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { subscribeToasts } from '../utils/toast';

const ICONS = { error: AlertCircle, success: CheckCircle2, info: Info };

// Renders the toasts raised via utils/toast. Newest at the bottom; at most three
// stay on screen so a burst of failures (e.g. going offline) can't fill it.
export default function Toaster() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => subscribeToasts((t) => {
    setToasts((prev) => [...prev.slice(-2), t]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), t.duration);
  }), []);

  const dismiss = (id) => setToasts((prev) => prev.filter((x) => x.id !== id));

  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.type] || Info;
        return (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <Icon size={18} className="toast-icon" />
            <span className="toast-message">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => { dismiss(t.id); t.action.onClick(); }}
              >
                {t.action.label}
              </button>
            )}
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Schließen">
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
