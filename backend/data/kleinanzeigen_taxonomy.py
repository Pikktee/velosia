"""
Complete Kleinanzeigen category taxonomy (the full live category tree).

The data in ``kleinanzeigen_taxonomy.json`` was harvested once from the live
Kleinanzeigen "Anzeige aufgeben" category tree (3168 nodes, 3018 leaf
categories). Each node is ``{"path": "161/176/staubsauger", "name": "...",
"leaf": bool}``; the ``path`` is exactly what the autofill engine feeds into the
category page's hash route (``#?path=...``) to jump straight to that category.

Unlike the small hand-curated ``kleinanzeigen_categories`` (which still provides
attribute hints for common categories), this module gives FULL category
coverage: the AI can be offered any real leaf category and we can resolve its
choice back to an exact tree path.

Two jobs:
  1. ``search_candidates(query)`` — pre-filter the 3018 leaves down to the
     handful that plausibly match a Step-1 search query, so the final AI prompt
     only ever sees a small, targeted candidate list (full coverage, tiny prompt).
  2. ``resolve_to_path`` / ``path_for_breadcrumb`` — turn the AI's category pick
     (a breadcrumb like "Elektronik > Haushaltsgeräte > Staubsauger") back into
     the canonical tree path. Breadcrumbs are globally unique, so this is lossless.
"""

import json
import os
import re
from typing import Dict, List, Optional

_DIR = os.path.dirname(__file__)
_DATA_PATH = os.path.join(_DIR, "kleinanzeigen_taxonomy.json")

with open(_DATA_PATH, encoding="utf-8") as _f:
    NODES: List[Dict] = json.load(_f)

BY_PATH: Dict[str, Dict] = {n["path"]: n for n in NODES}

# Top-level branches that are not second-hand *goods* (a seller never lists an
# item under these). We keep them in the data for completeness but never offer
# them to the AI as candidates.
EXCLUDED_TOP = {
    "102",  # Jobs
    "195",  # Immobilien
    "297",  # Dienstleistungen
    "235",  # Unterricht & Kurse
    "400",  # Nachbarschaftshilfe
}


def breadcrumb(path: str) -> str:
    """"161/176/staubsauger" -> "Elektronik > Haushaltsgeräte > Staubsauger"."""
    parts = []
    segs = path.split("/")
    for i in range(len(segs)):
        prefix = "/".join(segs[: i + 1])
        node = BY_PATH.get(prefix)
        parts.append(node["name"] if node else segs[i])
    return " > ".join(parts)


# Precompute breadcrumbs and lookup indices.
for _n in NODES:
    _n["breadcrumb"] = breadcrumb(_n["path"])

PATH_BY_BREADCRUMB: Dict[str, str] = {n["breadcrumb"]: n["path"] for n in NODES}
_PATH_BY_BREADCRUMB_LOWER: Dict[str, str] = {k.lower(): v for k, v in PATH_BY_BREADCRUMB.items()}

LEAVES: List[Dict] = [n for n in NODES if n.get("leaf")]


def _norm(s: Optional[str]) -> str:
    s = (s or "").lower()
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _tokens(s: Optional[str]) -> List[str]:
    return [t for t in _norm(s).split() if len(t) > 1]


# Sellable leaves only (exclude Jobs/Immobilien/... from AI candidate matching),
# with precomputed token sets for fast scoring.
SELLABLE_LEAVES: List[Dict] = [n for n in LEAVES if n["path"].split("/")[0] not in EXCLUDED_TOP]
for _n in SELLABLE_LEAVES:
    _n["_leaf_tokens"] = set(_tokens(_n["name"]))
    _n["_crumb_tokens"] = set(_tokens(_n["breadcrumb"]))


def search_candidates(query: str, limit: int = 40) -> List[Dict]:
    """Return the most plausible leaf categories for a free-text query.

    Scores every sellable leaf by token overlap against its breadcrumb, weighting
    matches on the leaf name itself higher than matches on ancestor names. Returns
    the top ``limit`` nodes (each with ``path`` / ``name`` / ``breadcrumb``).
    """
    q = set(_tokens(query))
    if not q:
        return []
    scored = []
    for n in SELLABLE_LEAVES:
        crumb_hit = len(q & n["_crumb_tokens"])
        if crumb_hit == 0:
            continue
        leaf_hit = len(q & n["_leaf_tokens"])
        score = leaf_hit * 3 + crumb_hit
        scored.append((score, n))
    scored.sort(key=lambda x: (-x[0], len(x[1]["breadcrumb"])))
    return [n for _, n in scored[:limit]]


def find_by_path(path: Optional[str]) -> Optional[Dict]:
    return BY_PATH.get(path) if path else None


def path_for_breadcrumb(text: Optional[str]) -> Optional[str]:
    """Exact (case-insensitive) breadcrumb -> path. Lossless, breadcrumbs unique."""
    if not text:
        return None
    return _PATH_BY_BREADCRUMB_LOWER.get(text.strip().lower())


def resolve_to_path(ai_category: Optional[str], candidates: Optional[List[Dict]] = None) -> Optional[str]:
    """Best-effort resolution of an AI category pick to a canonical tree path.

    Tries, in order: exact breadcrumb match; exact leaf-name match within the
    candidate pool; breadcrumb substring match; finally a fresh token search.
    Returns None only when nothing plausibly matches.
    """
    if not ai_category:
        return None

    exact = path_for_breadcrumb(ai_category)
    if exact:
        return exact

    aic = _norm(ai_category)
    if not aic:
        return None
    pool = candidates or SELLABLE_LEAVES

    for n in pool:
        if _norm(n["name"]) == aic:
            return n["path"]
    for n in pool:
        nc = _norm(n["breadcrumb"])
        if nc.endswith(aic) or aic in nc:
            return n["path"]

    best = search_candidates(ai_category, limit=1)
    return best[0]["path"] if best else None


def resolve(ai_category: Optional[str], candidates: Optional[List[Dict]] = None) -> Optional[Dict]:
    """Like ``resolve_to_path`` but returns the full node ({path,name,breadcrumb})."""
    p = resolve_to_path(ai_category, candidates)
    return BY_PATH.get(p) if p else None


def candidates_prompt(candidates: List[Dict]) -> str:
    """Compact, AI-readable bullet list of candidate breadcrumbs."""
    return "\n".join(f"- {c['breadcrumb']}" for c in candidates)


# ---------------------------------------------------------------------------
# AI selection list — the set of categories we let the AI pick from directly.
# ---------------------------------------------------------------------------
# Strategy: offer every sellable LEAF category so the AI can pick the precise
# category in one shot, EXCEPT the huge "Auto, Rad & Boot" car brand/model tree
# (2500+ leaves), which we collapse to its 2nd level to keep the prompt small.
# Navigating to a 3rd-level leaf (e.g. ".../staubsauger") auto-selects both the
# category AND its "Art" on the form; navigating to a 2nd-level node selects the
# category and leaves "Art" to the attribute filler.

_AUTO_TOP = "210"


def _is_selection_node(n: Dict) -> bool:
    top = n["path"].split("/")[0]
    if top in EXCLUDED_TOP:
        return False
    depth = n["path"].count("/")
    if top == _AUTO_TOP:
        return depth == 1            # collapse cars to their 2nd level
    return bool(n.get("leaf"))


SELECTION_NODES: List[Dict] = [n for n in NODES if _is_selection_node(n)]


def selection_prompt() -> str:
    """The exact-breadcrumb list the AI must choose its category from."""
    return "\n".join(n["breadcrumb"] for n in SELECTION_NODES)


def children_of(parent_path: str) -> List[Dict]:
    depth = parent_path.count("/") + 1
    return [n for n in NODES if n["path"].startswith(parent_path + "/") and n["path"].count("/") == depth]


def leaf_under(parent_path: str, name: Optional[str]) -> Optional[Dict]:
    """Find the direct child of ``parent_path`` whose name matches ``name``
    (used to descend a 2nd-level category into its "Art" leaf, e.g.
    Haushaltsgeräte + Art="Staubsauger" -> 161/176/staubsauger)."""
    if not name:
        return None
    nn = _norm(name)
    if not nn:
        return None
    kids = children_of(parent_path)
    for n in kids:
        if _norm(n["name"]) == nn:
            return n
    for n in kids:
        cn = _norm(n["name"])
        if nn in cn or cn in nn:
            return n
    return None
