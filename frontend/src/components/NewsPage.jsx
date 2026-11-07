import { ArrowLeft, Check, Wrench } from 'lucide-react';
import changelog from '../changelog.json';
import { compareVersions } from '../utils/whatsNew';

// #/neuigkeiten — every release with something new for users, newest first, from
// changelog.json. Linked from the "Neu in Velosia" sheet and the settings footer;
// reachable logged in and out. Releases with fixes only are left out (a fix is no
// news); a release with news and fixes keeps one quiet "Bugfixes" line.
export function groupReleases(entries) {
  return [...entries]
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((e) => ({
      version: e.version,
      items: (e.items || []).map((it) => (typeof it === 'string' ? it : it.text)),
      fixes: !!e.fixes,
    }))
    .filter((r) => r.items.length > 0);
}

export function leaveNewsPage() {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = '#/';
}

export default function NewsPage() {
  const releases = groupReleases(changelog);
  return (
    <div className="news-page fade-in">
      <button className="news-back" onClick={leaveNewsPage}>
        <ArrowLeft size={16} /> Zurück
      </button>
      <h1>Neuigkeiten</h1>
      <ol className="news-list">
        {releases.map((r) => (
          <li key={r.version} className="news-release">
            <span className="news-version">{r.version}</span>
            <ul>
              {r.items.map((text) => (
                <li key={text}><Check size={15} /><span>{text}</span></li>
              ))}
              {r.fixes && <li className="news-fixes"><Wrench size={14} /><span>Bugfixes und kleine Verbesserungen</span></li>}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
