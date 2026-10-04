// Minimal app-wide toast bus — replaces window.alert(), which in the Android
// WebView pops a bare system dialog that blocks the UI and breaks the design.
// Any component calls showToast(); the single <Toaster/> in App renders it.

const listeners = new Set();
let nextId = 1;

/**
 * @param {string} message
 * @param {{ type?: 'error'|'success'|'info', action?: { label: string, onClick: () => void }, duration?: number }} [opts]
 */
export function showToast(message, opts = {}) {
  const toast = {
    id: nextId++,
    message,
    type: opts.type || 'info',
    action: opts.action || null,
    // Give the user time to hit "Erneut versuchen" before the toast disappears.
    duration: opts.duration ?? (opts.action ? 7000 : 4500),
  };
  listeners.forEach((fn) => fn(toast));
}

export const showError = (message, retry) =>
  showToast(message, {
    type: 'error',
    action: retry ? { label: 'Erneut versuchen', onClick: retry } : undefined,
  });

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
