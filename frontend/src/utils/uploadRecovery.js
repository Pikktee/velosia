// Erstellen eines Angebots, das den Weg in den Hintergrund übersteht (V2.8.22).
//
// Eine Erstellung ist eine lange Anfrage (Fotos hochladen + KI, oft 20–40 s).
// Legt man die App währenddessen weg, kappt Android gern die Verbindung oder
// friert die App ein: früher kam dann „Keine Verbindung“ und die Kamera, obwohl
// der Server das Angebot meist fertig angelegt hatte. Jetzt trägt jede Erstellung
// eine Kennung (client_ref). Reißt die Verbindung ab oder kommt die App zurück,
// fragt das Frontend den Stand beim Server ab (GET /api/upload/status/{ref}) und
// übernimmt das fertige Angebot. Wird die App ganz beendet, hält der Marker in
// localStorage die Kennung, und der nächste Start holt das Ergebnis ab.

import { getUploadStatus } from './api';

const KEY = 'velosia_pending_upload';
const MAX_AGE_MS = 15 * 60 * 1000;
const POLL_MS = 2500;
const MAX_WAIT_MS = 5 * 60 * 1000;

export const NOT_ARRIVED = 'Die Fotos sind nicht beim Server angekommen. Bitte versuche es noch einmal.';

export function newUploadRef() {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch { /* fall through */ }
  return `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function rememberPendingUpload(ref, turbo) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ref, turbo: !!turbo, at: Date.now() }));
  } catch { /* ignore */ }
}

export function clearPendingUpload() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// The marker of an earlier run, if it is recent enough to still be waited for.
export function readPendingUpload() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.ref || Date.now() - (p.at || 0) > MAX_AGE_MS) {
      clearPendingUpload();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(t);
    reject(new DOMException('Aborted', 'AbortError'));
  }, { once: true });
});

const abortError = () => new DOMException('Aborted', 'AbortError');

// Ask the server until the creation `ref` is done. `stillSending()` tells whether
// the original request may still be on its way (then "unknown" just means the
// photos have not fully arrived yet).
export async function waitForUpload(ref, { turbo = false, signal, stillSending = () => false } = {}) {
  const started = Date.now();
  let unknown = 0;
  let unknownSince = 0;
  while (Date.now() - started < MAX_WAIT_MS) {
    if (signal?.aborted) throw abortError();
    let s = null;
    try {
      s = await getUploadStatus(ref, signal);
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      if (e?.status === 401 || e?.status === 403) throw e;
      // Still offline right after returning: try again shortly.
    }
    if (s) {
      if (s.state === 'done' && s.drafts?.length) return turbo ? s.drafts : s.drafts[0];
      if (s.state === 'failed') throw new Error(s.detail || 'Das Angebot konnte nicht erstellt werden.');
      if (s.state === 'cancelled') throw abortError();
      if (s.state === 'unknown') {
        unknownSince = unknownSince || Date.now();
        if (!stillSending()) {
          unknown += 1;
          if (unknown >= 3) throw new Error(NOT_ARRIVED);
        } else if (Date.now() - unknownSince > 60000) {
          // The request still "sends" but nothing has arrived for a minute: its
          // connection died while the app was away.
          throw new Error(NOT_ARRIVED);
        }
      } else {
        unknownSince = 0;
      }
    }
    await sleep(POLL_MS, signal);
  }
  throw new Error('Das hat zu lange gedauert. Bitte versuche es noch einmal.');
}

// No answer from the server itself: no HTTP status, or the edge's 502/504 while
// the server may still be working (its own failures show up in the status).
const isLost = (err) => !err?.status || err.status === 502 || err.status === 504;

// Run `send()` (the upload request). If its connection is lost, or the app comes
// back from the background while it is still waiting, the result is fetched by
// `ref` instead — whichever answers first wins. When this gives up, the caller
// cancels `ref` so a late arrival creates nothing (see App.jsx).
export async function uploadWithRecovery(send, ref, { turbo = false, signal } = {}) {
  let sending = true;
  const direct = send().then(
    (value) => { sending = false; return { value }; },
    (error) => { sending = false; return { error }; },
  );

  let wasHidden = document.visibilityState === 'hidden';
  let wake;
  const woke = new Promise((resolve) => { wake = resolve; });
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') wasHidden = true;
    else if (wasHidden) wake('woke');
  };
  document.addEventListener('visibilitychange', onVisibility);
  const poll = new AbortController();
  const stopPoll = () => poll.abort();
  signal?.addEventListener('abort', stopPoll, { once: true });

  try {
    const first = await Promise.race([direct, woke]);
    if (first !== 'woke') {
      if ('value' in first) return first.value;
      const err = first.error;
      // A real answer from the server (quota, analysis failed …) or a cancel
      // stands; only a request without any answer is looked up.
      if (err?.name === 'AbortError' || !isLost(err)) throw err;
    }
    return await Promise.race([
      // A late direct answer still counts; a real server error too (e.g. 413/422,
      // which never reach the status), a lost connection is left to the polling.
      direct.then((r) => {
        if ('value' in r) return r.value;
        if (r.error?.name !== 'AbortError' && !isLost(r.error)) throw r.error;
        return new Promise(() => {});
      }),
      waitForUpload(ref, { turbo, signal: poll.signal, stillSending: () => sending }),
    ]);
  } finally {
    document.removeEventListener('visibilitychange', onVisibility);
    signal?.removeEventListener('abort', stopPoll);
    poll.abort();
  }
}
