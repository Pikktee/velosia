"""
Curated static catalog of the most common Kleinanzeigen categories and their
attribute fields ("Zusatzfelder").

This is a hand-maintained subset of the most relevant second-hand / fashion
categories, NOT the complete Kleinanzeigen taxonomy. The backend cannot reach
Kleinanzeigen to scrape the live taxonomy, so this catalog serves two purposes:

  1. It constrains the AI to pick a real, valid leaf category and to propose
     attribute values that fit that category's fields.
  2. It tells the Android client which attributes to expect, which the client
     then matches onto the live form *generically* (by visible field label),
     so exact internal Kleinanzeigen field IDs are not required.

To extend coverage, simply add more entries to CATEGORIES. Each attribute has:
  - label:   the human-readable field label as shown on Kleinanzeigen (used
             for both the AI and the client-side label matching)
  - type:    "select" (pick one of options) or "text" (free text)
  - options: allowed values for select fields (guides the AI)

Optional per category:
  - path:    the Kleinanzeigen category tree path (e.g. "161/176" for
             Elektronik > Haushaltsgeräte). The category page is a hash-routed
             tree (#?path=161/176&isParent=...), so when this path is known the
             autofill engine jumps straight to the category and clicks "Weiter"
             — fully automatic. When omitted, the engine falls back to matching
             the visible link text, and ultimately to a single manual tap.
             Harvest new paths from the `href` of `.category-selection-list-item-link`
             elements on p-anzeige-aufgeben.html.
"""

from typing import Dict, List, Optional

# --- Reusable attribute building blocks ---------------------------------------

VERSAND = {"label": "Versand", "type": "select",
           "options": ["Versand möglich", "Nur Abholung"]}
ZUSTAND = {"label": "Zustand", "type": "select",
           "options": ["Neu", "Sehr Gut", "Gut", "In Ordnung", "Defekt"]}

LETTER_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"]
WOMEN_SIZES = ["32", "34", "36", "38", "40", "42", "44", "46", "48", "50"]
MEN_SIZES = ["44", "46", "48", "50", "52", "54", "56", "58"]
SHOE_SIZES = [str(n) for n in range(35, 48)]
KIDS_SIZES = ["50", "56", "62", "68", "74", "80", "86", "92", "98", "104",
              "110", "116", "122", "128", "134", "140", "146", "152", "158", "164"]
COLORS = ["Schwarz", "Weiß", "Grau", "Blau", "Rot", "Grün", "Gelb", "Braun",
          "Beige", "Rosa", "Lila", "Orange", "Gold", "Silber", "Bunt"]


def _color():
    return {"label": "Farbe", "type": "select", "options": COLORS}


def _marke():
    return {"label": "Marke", "type": "text"}


# --- Category catalog ----------------------------------------------------------

CATEGORIES: List[Dict] = [
    {
        "name": "Damenbekleidung",
        "keyword": "Damenbekleidung",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Kleider", "Hosen", "Jeans", "Röcke", "Blusen & Tuniken",
                "Tops & T-Shirts", "Pullover & Sweatshirts", "Jacken & Mäntel",
                "Anzüge & Kostüme", "Unterwäsche & Dessous", "Sonstiges"]},
            {"label": "Größe", "type": "select", "options": LETTER_SIZES + WOMEN_SIZES},
            _marke(), _color(), VERSAND,
        ],
    },
    {
        "name": "Herrenbekleidung",
        "keyword": "Herrenbekleidung",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Hosen", "Jeans", "T-Shirts", "Hemden", "Pullover & Sweatshirts",
                "Jacken & Mäntel", "Anzüge & Sakkos", "Sonstiges"]},
            {"label": "Größe", "type": "select", "options": LETTER_SIZES + MEN_SIZES},
            _marke(), _color(), VERSAND,
        ],
    },
    {
        "name": "Damenschuhe",
        "keyword": "Damenschuhe",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Sneaker", "Stiefel & Stiefeletten", "Sandalen", "Pumps & High Heels",
                "Halbschuhe & Ballerinas", "Sonstiges"]},
            {"label": "Größe", "type": "select", "options": SHOE_SIZES},
            _marke(), _color(), VERSAND,
        ],
    },
    {
        "name": "Herrenschuhe",
        "keyword": "Herrenschuhe",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Sneaker", "Stiefel & Boots", "Business-Schuhe", "Sandalen",
                "Halbschuhe", "Sonstiges"]},
            {"label": "Größe", "type": "select", "options": SHOE_SIZES},
            _marke(), _color(), VERSAND,
        ],
    },
    {
        "name": "Taschen & Accessoires",
        "keyword": "Taschen & Accessoires",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Handtaschen", "Rucksäcke", "Geldbörsen", "Gürtel", "Schals & Tücher",
                "Mützen & Hüte", "Sonnenbrillen", "Schmuck", "Uhren", "Sonstiges"]},
            _marke(), _color(), VERSAND,
        ],
    },
    {
        "name": "Kinderbekleidung",
        "keyword": "Kinderbekleidung",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Oberteile", "Hosen", "Kleider & Röcke", "Jacken & Mäntel",
                "Schuhe", "Bodys & Strampler", "Sets", "Sonstiges"]},
            {"label": "Größe", "type": "select", "options": KIDS_SIZES},
            _marke(), _color(), VERSAND,
        ],
    },
    {
        "name": "Handys & Telefone",
        "keyword": "Handy Smartphone",
        "path": "161/173",
        "attributes": [
            {"label": "Gerät", "type": "select", "options": [
                "Apple iPhone", "Samsung", "Google", "Xiaomi", "Huawei",
                "OnePlus", "Sonstige"]},
            {"label": "Farbe", "type": "select", "options": COLORS},
            ZUSTAND, VERSAND,
        ],
    },
    {
        "name": "Tablets & Reader",
        "keyword": "Tablet",
        "path": "161/285",
        "attributes": [
            {"label": "Marke", "type": "select", "options": [
                "Apple iPad", "Samsung", "Amazon", "Lenovo", "Huawei", "Sonstige"]},
            ZUSTAND, VERSAND,
        ],
    },
    {
        "name": "Notebooks & Laptops",
        "keyword": "Notebook Laptop",
        "path": "161/278",
        "attributes": [
            {"label": "Marke", "type": "select", "options": [
                "Apple", "Lenovo", "HP", "Dell", "Asus", "Acer", "Microsoft", "Sonstige"]},
            ZUSTAND, VERSAND,
        ],
    },
    {
        "name": "Konsolen & Spiele",
        "keyword": "Konsole Spiele",
        "path": "161/279",
        "attributes": [
            {"label": "Plattform", "type": "select", "options": [
                "PlayStation", "Xbox", "Nintendo Switch", "Nintendo", "PC", "Sonstige"]},
            ZUSTAND, VERSAND,
        ],
    },
    {
        "name": "Bücher & Zeitschriften",
        "keyword": "Bücher",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Romane", "Sachbücher", "Kinderbücher", "Comics", "Fachbücher",
                "Zeitschriften", "Sonstiges"]},
            VERSAND,
        ],
    },
    {
        "name": "Filme & DVDs",
        "keyword": "DVD Blu-ray Filme",
        "attributes": [
            {"label": "Format", "type": "select", "options": ["DVD", "Blu-ray", "VHS", "Sonstiges"]},
            VERSAND,
        ],
    },
    {
        "name": "Musik & CDs",
        "keyword": "CD Schallplatte Musik",
        "attributes": [
            {"label": "Format", "type": "select", "options": ["CD", "Schallplatte / Vinyl", "Kassette", "Sonstiges"]},
            VERSAND,
        ],
    },
    {
        "name": "Haushaltsgeräte",
        "keyword": "Haushaltsgeräte",
        "path": "161/176",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Küchengeräte", "Waschmaschinen & Trockner", "Staubsauger",
                "Kaffeemaschinen", "Kleingeräte", "Sonstiges"]},
            ZUSTAND, VERSAND,
        ],
    },
    {
        "name": "Möbel",
        "keyword": "Möbel",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Sofas & Sessel", "Tische", "Stühle", "Schränke", "Betten",
                "Regale", "Kommoden", "Sonstiges"]},
            _color(), VERSAND,
        ],
    },
    {
        "name": "Dekoration",
        "keyword": "Dekoration",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Bilder & Poster", "Vasen", "Kerzen & Kerzenständer", "Spiegel",
                "Lampen", "Sonstiges"]},
            _color(), VERSAND,
        ],
    },
    {
        "name": "Spielzeug",
        "keyword": "Spielzeug",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Lego & Bausteine", "Brettspiele", "Kuscheltiere", "Puppen",
                "Modellbau", "Outdoor-Spielzeug", "Sonstiges"]},
            ZUSTAND, VERSAND,
        ],
    },
    {
        "name": "Fahrräder",
        "keyword": "Fahrrad",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Mountainbikes", "Rennräder", "Citybikes", "E-Bikes",
                "Kinderfahrräder", "Sonstiges"]},
            {"label": "Rahmengröße", "type": "text"},
            ZUSTAND, VERSAND,
        ],
    },
    {
        "name": "Sport & Camping",
        "keyword": "Sport Camping",
        "attributes": [
            {"label": "Art", "type": "select", "options": [
                "Fitness", "Ballsport", "Wintersport", "Camping", "Wassersport",
                "Sonstiges"]},
            _marke(), ZUSTAND, VERSAND,
        ],
    },
    {
        "name": "Sonstiges",
        "keyword": "Sonstiges",
        "attributes": [
            ZUSTAND, VERSAND,
        ],
    },
]


# Maps the existing free-text `condition` value to Kleinanzeigen's "Zustand" options
CONDITION_TO_ZUSTAND = {
    "neu": "Neu",
    "sehr gut": "Sehr Gut",
    "gut": "Gut",
    "zufriedenstellend": "In Ordnung",
    "in ordnung": "In Ordnung",
    "defekt": "Defekt",
}


# --- Helper API ----------------------------------------------------------------

def category_names() -> List[str]:
    return [c["name"] for c in CATEGORIES]


def find_category(name: Optional[str]) -> Optional[Dict]:
    """Look up a category by name (case-insensitive, tolerant of partial matches)."""
    if not name:
        return None
    target = name.strip().lower()
    for c in CATEGORIES:
        if c["name"].lower() == target:
            return c
    # Tolerant fallback: substring match in either direction
    for c in CATEGORIES:
        cl = c["name"].lower()
        if target in cl or cl in target:
            return c
    return None


def get_keyword(name: Optional[str]) -> Optional[str]:
    cat = find_category(name)
    return cat["keyword"] if cat else (name or None)


def build_catalog_prompt() -> str:
    """Compact, AI-readable description of the catalog and its attribute fields."""
    lines = []
    for c in CATEGORIES:
        parts = []
        for attr in c["attributes"]:
            if attr["type"] == "select":
                opts = " | ".join(attr["options"])
                parts.append(f"{attr['label']} [{opts}]")
            else:
                parts.append(f"{attr['label']} (Freitext)")
        lines.append(f"- \"{c['name']}\": " + "; ".join(parts))
    return "\n".join(lines)


def validate_attributes(category_name: Optional[str], raw: Dict, condition: Optional[str] = None) -> Dict[str, str]:
    """
    Keep only attributes defined for the chosen category, normalise select
    values to the catalog's casing when an exact (case-insensitive) match exists,
    and backfill "Zustand" from the draft's condition when applicable.
    """
    cat = find_category(category_name)
    if not cat:
        return {}

    raw = raw or {}
    # Normalise incoming keys for case-insensitive lookup
    raw_lower = {str(k).strip().lower(): v for k, v in raw.items() if v is not None}

    result: Dict[str, str] = {}
    for attr in cat["attributes"]:
        label = attr["label"]
        value = raw_lower.get(label.lower())

        # Backfill Zustand from the existing condition field if the AI omitted it
        if value in (None, "") and label.lower() == "zustand" and condition:
            value = CONDITION_TO_ZUSTAND.get(condition.strip().lower())

        if value in (None, ""):
            continue

        value = str(value).strip()
        if attr["type"] == "select":
            # Snap to the catalog option whose text matches case-insensitively
            for opt in attr["options"]:
                if opt.lower() == value.lower():
                    value = opt
                    break
        result[label] = value

    return result
