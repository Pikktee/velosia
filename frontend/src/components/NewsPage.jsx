import { ArrowLeft, Check, Wrench } from 'lucide-react';
import changelog from '../changelog.json';
import { compareVersions } from '../utils/whatsNew';

// #/neuigkeiten — what changed for users, newest first, from changelog.json. One
// block per release day (several deploys a day are common): the day's newest
// version, its date and every item of that day. Days with fixes only are left out
// (a fix is no news); a day with news and fixes keeps one quiet "Bugfixes" line.
// Linked from the "Neu in Velosia" sheet and the settings footer; reachable logged
// in and out. deploy.py stamps each entry's "date".
export function groupReleases(entries) {
  const days = [];
  for (const e of [...entries].sort((a, b) => compareVersions(b.version, a.version))) {
    const key = e.date || `v${e.version}`;
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, date: e.date || null, version: e.version, items: [], fixes: false };
      days.push(day);
    }
    for (const it of e.items || []) day.items.push(typeof it === 'string' ? it : it.text);
    if (e.fixes) day.fixes = true;
  }
  return days.filter((d) => d.items.length > 0);
}

const formatDay = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
};

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
          <li key={r.key} className="news-release">
            <div className="news-release-head">
              {r.date ? <time dateTime={r.date}>{formatDay(r.date)}</time> : <span />}
              <span className="news-version">Version {r.version}</span>
            </div>
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
