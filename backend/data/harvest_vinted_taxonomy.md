# Vinted-Taxonomie-Harvester (Entwickler-Werkzeug)

Erzeugt `vinted_taxonomy.json` — die komplette Vinted-Kategorie-Hierarchie
(2917 Knoten / 2498 Blätter, mit numerischen catalog-IDs). Einmalig nötig; nur
erneut ausführen, wenn Vinted seinen Katalog umbaut.

**Warum so:** Vinted (Next.js) bettet den kompletten Katalogbaum als JSON in einen
RSC-Chunk ein (`self.__next_f`). Es gibt KEINE öffentliche Catalog-API (alle
`/api/v2/catalog*`-Endpunkte liefern 404). Also: den eingebetteten Chunk
herunterladen und lokal parsen.

## Schritt 1 — Katalog-Script herunterladen (Browser-Konsole)

Eingeloggt auf `https://www.vinted.de/items/new`, in der DevTools-Konsole:

```js
(() => {
  let best = null;
  document.querySelectorAll('script').forEach((s) => {
    const c = s.textContent || '';
    if (c.indexOf('WOMEN_ROOT') === -1) return;           // Marker des Katalogbaums
    if (!best || c.length > best.length) best = c;
  });
  if (!best) return 'Kein Katalog-Script (WOMEN_ROOT) gefunden';
  const blob = new Blob([best], { type: 'text/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vinted_catalog2.js';
  document.body.appendChild(a); a.click(); a.remove();
  return `Download: vinted_catalog2.js (${(best.length / 1024).toFixed(0)} KB)`;
})();
```

## Schritt 2 — lokal parsen (Python)

Der RSC-Chunk ist `self.__next_f.push([1,"<escaptes JSON>"])`; der Baum hängt unter
`catalogTree`, Kinder unter `catalogs`, jeder Knoten hat `id`/`title`/`url`.

```python
import json

raw = open('vinted_catalog2.js', encoding='utf-8').read()
start = raw.index('"', len('self.__next_f.push([1,'))
decoded = json.loads(raw[start:raw.rindex('"]') + 1])   # JS-String entschärfen

def balanced(s, i):
    depth = 0; j = i; instr = False; esc = False
    while j < len(s):
        c = s[j]
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c in '[{': depth += 1
            elif c in ']}':
                depth -= 1
                if depth == 0: return s[i:j + 1]
        j += 1

k = decoded.index('"catalogTree":')
tree = json.loads(balanced(decoded, decoded.index('[', k)))

flat = []
def walk(nodes, trail):
    for n in nodes:
        path = trail + [str(n['id'])]
        kids = n.get('catalogs') or []
        flat.append({'id': n['id'], 'title': n.get('title') or '', 'path': '/'.join(path), 'leaf': len(kids) == 0})
        if kids: walk(kids, path)
walk(tree, [])

json.dump(flat, open('vinted_taxonomy.json', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print(len(flat), 'Knoten,', sum(f['leaf'] for f in flat), 'Blätter')
```

Ergebnis nach `backend/data/vinted_taxonomy.json` kopieren.
