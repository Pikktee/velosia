/*
 * Kleinanzeigen-Taxonomie-Harvester (Entwickler-Werkzeug, läuft NICHT im Backend)
 * =============================================================================
 *
 * Erzeugt die Datengrundlage für `kleinanzeigen_taxonomy.json` — die komplette
 * Kleinanzeigen-Kategorie-Hierarchie (Pfade + Namen). Einmalig nötig; nur erneut
 * ausführen, wenn Kleinanzeigen seinen Kategoriebaum umbaut.
 *
 * WARUM SO: Der Kategoriebaum ist clientseitig im Seiten-JS eingebettet. Das
 * Aufklappen via URL-Hash (#?path=...) rendert nur aus dem Speicher neu — KEINE
 * Netzwerk-Requests pro Knoten. Deshalb ist ein vollständiger Baum-Walk schnell,
 * unbedenklich (kein Bot-/Fraud-Schutz wird ausgelöst) und liefert die EXAKTEN
 * Pfade direkt aus den href-Attributen.
 *
 * ANWENDUNG:
 *   1. Eingeloggt auf https://www.kleinanzeigen.de/p-anzeige-aufgeben.html gehen.
 *   2. Schritt A (dieses Snippet) in der DevTools-Konsole ausführen — läuft den
 *      ganzen Baum ab (~30–60 s, Fortschritt in der Konsole) und legt das
 *      Ergebnis in window.__kaTaxJSON + localStorage ab.
 *   3. Schritt B (unten) als ZWEITEN, separaten Befehl ausführen (frische
 *      Nutzergeste => Chrome erlaubt den Download) -> lädt ka_taxonomy.json.
 *   4. Datei kompakt ins Backend übernehmen:
 *        python -c "import json; d=json.load(open('ka_taxonomy.json')); \
 *          json.dump([{'path':x['path'],'name':x['name'],'leaf':bool(x.get('leaf'))} for x in d], \
 *          open('backend/data/kleinanzeigen_taxonomy.json','w',encoding='utf-8'), \
 *          ensure_ascii=False, separators=(',',':'))"
 */

// ===== Schritt A: Baum-Walk =====
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = new Map();
  const queue = [];
  const queued = new Set();

  const harvestDOM = () => {
    document.querySelectorAll('a.category-selection-list-item-link, a[href*="path="]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/path=([^&]+)/);
      if (!m) return;
      const path = decodeURIComponent(m[1]).replace(/\/+$/, '');
      if (!path) return;
      const li = a.closest('li');
      const cls = li ? li.className : '';
      const leaf = /is-leaf/.test(cls);
      const parent = /is-parent/.test(cls);
      const name = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!seen.has(path)) seen.set(path, { path, name, leaf });
      if (parent && !leaf && !queued.has(path)) { queued.add(path); queue.push(path); }
    });
  };

  harvestDOM();
  console.log('Harvest gestartet:', queue.length, 'Hauptkategorien');
  let steps = 0;
  while (queue.length && steps < 6000) {
    const p = queue.shift();
    steps++;
    try { window.location.hash = '?path=' + p + '&isParent=true'; } catch (e) {}
    await sleep(220);
    harvestDOM();
    if (steps % 25 === 0) console.log('…', steps, 'Knoten,', seen.size, 'Kategorien,', queue.length, 'offen');
  }
  const data = [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
  window.__kaTaxJSON = JSON.stringify(data, null, 0);
  window.__kaTax = data;
  try { localStorage.setItem('velosia_ka_tax', window.__kaTaxJSON); } catch (e) {}
  try { copy(window.__kaTaxJSON); } catch (e) {}
  try { window.location.hash = ''; } catch (e) {}
  console.log('Fertig:', data.length, 'Kategorien,', data.filter((d) => d.leaf).length, 'Blätter. Jetzt Schritt B ausführen.');
  return `Harvest fertig: ${data.length} Kategorien.`;
})();

// ===== Schritt B: synchroner Download (als SEPARATEN Befehl ausführen) =====
/*
(() => {
  const json = window.__kaTaxJSON || localStorage.getItem('velosia_ka_tax');
  if (!json) return 'Erst Schritt A ausführen.';
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ka_taxonomy.json';
  document.body.appendChild(a); a.click(); a.remove();
  return 'Download: ka_taxonomy.json';
})();
*/
