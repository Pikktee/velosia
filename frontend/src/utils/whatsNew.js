// "Neu in Velosia": after the first start of a new version, show once what changed
// since the version this device last saw. Skipped versions are summed up; changes
// nobody notices directly only show as one "Bugfixes" line, and a release that brings
// nothing but those shows no sheet at all.
//
// Two versions are tracked, because the frontend and the Android shell update apart:
// a web deploy reaches everyone at once, a new app build only when Play rolls it out
// (days later). Changelog items marked `"app": true` need the new app build, so they
// count against the installed app version and only show inside the app.
//
// The source is changelog.json (version → short German items for users). deploy.py
// refuses a release without an entry for the new version.
import changelog from '../changelog.json';
import { version as webVersion } from '../../package.json';

const SEEN_KEY = 'velosia_seen_version';
const SEEN_APP_KEY = 'velosia_seen_app_version';

// Keys that only exist after Velosia was used on this device. They survive a logout,
// so a user whose session ran out still counts as returning, not as a fresh install.
const USED_BEFORE_KEYS = ['velosia_token', 'velosia_turbo_onboarded', 'velosia_detail_onboarding_shown'];

// A returning user without a stored version last used Velosia before this sheet
// existed (2.7.58). Pretend they saw 2.7.56: 2.7.57 (Festpreis/VB, staying logged in)
// went out one day before the sheet, so hardly anyone has noticed it yet.
const SEEN_BEFORE_TRACKING = '2.7.56';

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

const inRange = (v, seen, current) => compareVersions(v, current) <= 0 && compareVersions(v, seen) > 0;

/**
 * What changed for this device, newest first. Pure, so the rules stay readable.
 *
 * `appVersion` null = not in the app (or an app too old to report its version):
 * app-only items are left out.
 *
 * @returns {{ items: string[], fixes: boolean, versions: string[] }}
 */
export function collectNews(entries, { webSeen, webCurrent, appSeen, appVersion }) {
  const items = [];
  const versions = [];
  let fixes = false;
  const sorted = [...entries].sort((a, b) => compareVersions(b.version, a.version));
  for (const entry of sorted) {
    const webHit = inRange(entry.version, webSeen, webCurrent);
    const appHit = appVersion != null && inRange(entry.version, appSeen, appVersion);
    let used = false;
    for (const item of entry.items || []) {
      const text = typeof item === 'string' ? item : item.text;
      const appOnly = typeof item === 'object' && item.app;
      if (appOnly ? appHit : webHit) {
        items.push(text);
        used = true;
      }
    }
    if (entry.fixes && (webHit || appHit)) {
      fixes = true;
      used = true;
    }
    if (used) versions.push(entry.version);
  }
  return { items, fixes, versions };
}

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: show again next time */ }
}

function installedAppVersion() {
  try {
    const bridge = window.VelosiaBridge;
    const v = bridge && typeof bridge.getAppVersion === 'function' ? bridge.getAppVersion() : '';
    return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

const later = (a, b) => (a && compareVersions(a, b) > 0 ? a : b);

/**
 * Call once at app start, before any login. A fresh install (nothing stored, no sign
 * of earlier use) only records the current versions: the user just met the whole app,
 * the history would be noise. Must run before the first login, which would otherwise
 * leave a token behind and make the new device look like a returning user.
 */
export function seedWhatsNewIfFresh() {
  if (read(SEEN_KEY) != null || USED_BEFORE_KEYS.some((k) => read(k) != null)) return;
  write(SEEN_KEY, webVersion);
  const appVersion = installedAppVersion();
  if (appVersion) write(SEEN_APP_KEY, appVersion);
}

/**
 * Read what to show and mark it as seen right away: once means once, even if the app
 * is closed while the sheet is open. Returns null when there is nothing to show.
 */
export function takeWhatsNew() {
  const appVersion = installedAppVersion();
  const storedWeb = read(SEEN_KEY);
  const storedApp = read(SEEN_APP_KEY);

  const news = collectNews(changelog, {
    webSeen: storedWeb ?? SEEN_BEFORE_TRACKING,
    webCurrent: webVersion,
    // No app version stored yet: this is the app that was installed all along,
    // nothing native is new to it.
    appSeen: storedApp ?? appVersion,
    appVersion,
  });

  // Never step back (a rollback would otherwise show the same items again later).
  write(SEEN_KEY, later(storedWeb, webVersion));
  if (appVersion) write(SEEN_APP_KEY, later(storedApp, appVersion));

  return news.items.length > 0 ? news : null;
}
