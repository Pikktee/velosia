"""
Complete Vinted category taxonomy (the full live catalog tree).

The data in ``vinted_taxonomy.json`` was harvested once from the live Vinted
"items/new" page — Vinted embeds its whole catalog tree in an RSC payload
(`self.__next_f`). Each node is ``{"id": 1839, "title": "Boyfriend Jeans",
"path": "1904/4/183/1839", "leaf": bool}`` where ``path`` is the chain of
numeric catalog IDs from the root and the leaf ``id`` is exactly the
``catalog_id`` Vinted stores on a listing.

This mirrors ``kleinanzeigen_taxonomy`` but for Vinted: full coverage so the AI
can pick any real Vinted category and we can resolve its choice to the exact
catalog path the autofill engine drills through the category picker.

Vinted and Kleinanzeigen taxonomies are completely separate, so a draft carries
two independent category paths (``category_path`` for KA, the Vinted path here).
"""

import json
import os
import re
from typing import Dict, List, Optional

_DIR = os.path.dirname(__file__)
_DATA_PATH = os.path.join(_DIR, "vinted_taxonomy.json")

with open(_DATA_PATH, encoding="utf-8") as _f:
    NODES: List[Dict] = json.load(_f)

BY_PATH: Dict[str, Dict] = {n["path"]: n for n in NODES}
BY_ID: Dict[int, Dict] = {n["id"]: n for n in NODES}


def breadcrumb(path: str) -> str:
    """"1904/4/183/1839" -> "Damen > Kleidung > Jeans > Boyfriend Jeans"."""
    parts = []
    segs = path.split("/")
    for i in range(len(segs)):
        prefix = "/".join(segs[: i + 1])
        node = BY_PATH.get(prefix)
        parts.append(node["title"] if node else segs[i])
    return " > ".join(parts)


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


for _n in LEAVES:
    _n["_leaf_tokens"] = set(_tokens(_n["title"]))
    _n["_crumb_tokens"] = set(_tokens(_n["breadcrumb"]))


def search_candidates(query: str, limit: int = 40) -> List[Dict]:
    """Most plausible leaf categories for a free-text query (token overlap on the
    breadcrumb, leaf-name matches weighted higher)."""
    q = set(_tokens(query))
    if not q:
        return []
    scored = []
    for n in LEAVES:
        crumb_hit = len(q & n["_crumb_tokens"])
        if crumb_hit == 0:
            continue
        leaf_hit = len(q & n["_leaf_tokens"])
        scored.append((leaf_hit * 3 + crumb_hit, n))
    scored.sort(key=lambda x: (-x[0], len(x[1]["breadcrumb"])))
    return [n for _, n in scored[:limit]]


def find_by_path(path: Optional[str]) -> Optional[Dict]:
    return BY_PATH.get(path) if path else None


def path_for_breadcrumb(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    return _PATH_BY_BREADCRUMB_LOWER.get(text.strip().lower())


def resolve_to_path(ai_category: Optional[str], candidates: Optional[List[Dict]] = None) -> Optional[str]:
    """Resolve an AI category pick (ideally a breadcrumb) to a canonical path."""
    if not ai_category:
        return None
    exact = path_for_breadcrumb(ai_category)
    if exact:
        return exact
    aic = _norm(ai_category)
    if not aic:
        return None
    pool = candidates or LEAVES
    for n in pool:
        if _norm(n["title"]) == aic:
            return n["path"]
    for n in pool:
        nc = _norm(n["breadcrumb"])
        if nc.endswith(aic) or aic in nc:
            return n["path"]
    best = search_candidates(ai_category, limit=1)
    return best[0]["path"] if best else None


def resolve(ai_category: Optional[str], candidates: Optional[List[Dict]] = None) -> Optional[Dict]:
    p = resolve_to_path(ai_category, candidates)
    return BY_PATH.get(p) if p else None


# ---------------------------------------------------------------------------
# AI selection — two stages. Offering all 2498 leaf breadcrumbs in one prompt
# cost ~50k input tokens per draft (84% of a whole analysis). Instead the AI
# first picks one of the 73 level-2 groups ("Damen > Kleidung", ~700 tokens),
# then a leaf among that group's leaves only (median 23, max 227 lines).
# ---------------------------------------------------------------------------
GROUP_DEPTH = 2


def _group_path(path: str) -> str:
    return "/".join(path.split("/")[:GROUP_DEPTH])


GROUP_LEAVES: Dict[str, List[Dict]] = {}
for _n in LEAVES:
    GROUP_LEAVES.setdefault(_group_path(_n["path"]), []).append(_n)

GROUPS: List[Dict] = [BY_PATH[p] for p in GROUP_LEAVES]
_GROUP_BY_BREADCRUMB_LOWER: Dict[str, str] = {g["breadcrumb"].lower(): g["path"] for g in GROUPS}


def group_prompt() -> str:
    return "\n".join(g["breadcrumb"] for g in GROUPS)


def resolve_group(text: Optional[str]) -> Optional[str]:
    """Map the stage-1 pick to a group path. Tolerates the AI answering with a
    deeper breadcrumb (or a leaf) by falling back to that node's group."""
    if not text:
        return None
    t = text.strip().lower()
    if t in _GROUP_BY_BREADCRUMB_LOWER:
        return _GROUP_BY_BREADCRUMB_LOWER[t]
    p = path_for_breadcrumb(text)
    if p and _group_path(p) in GROUP_LEAVES:
        return _group_path(p)
    return None


def leaves_prompt(group_path: str) -> str:
    return "\n".join(n["breadcrumb"] for n in GROUP_LEAVES.get(group_path, []))
