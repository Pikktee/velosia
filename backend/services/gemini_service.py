import google.generativeai as genai
from PIL import Image
import os
import json
from dotenv import load_dotenv
from services.price_comparison import search_marketplace_prices

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

from typing import List

def analyze_item_image(image_paths: List[str]) -> dict:
    """
    Step 1: Identifies search keywords from the images.
    Step 2: Searches Kleinanzeigen for active listings and price ranges.
    Step 3: Feeds the images + comparison data back to Gemini to get final details.
    """
    if not GEMINI_API_KEY:
        print("WARNING: GEMINI_API_KEY is not set. Returning mock data.")
        return get_mock_analysis()

    try:
        # Load, resize, and compress all images immediately to save memory and optimize performance
        imgs = []
        for path in image_paths:
            img = Image.open(path)
            if img.width > 1024 or img.height > 1024:
                img.thumbnail((1024, 1024))
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.save(path, format="JPEG", quality=85)
                # Reopen the resized image
                img = Image.open(path)
            imgs.append(img)

        # --- STEP 1: Identify search keywords ---
        identify_prompt = (
            "Analysiere diese Fotos eines Artikels. Identifiziere den Gegenstand, die Marke (falls sichtbar) und "
            "den genauen Typ. Gib mir eine kurze Suchanfrage (3-6 Wörter auf Deutsch), die ich auf einem Marktplatz eingeben kann, "
            "um vergleichbare Angebote zu finden. Antworte AUSSCHLIESSLICH mit der Suchanfrage."
        )

        working_model_name = GEMINI_MODEL
        id_response = None

        # Try user-configured model first, fallback to 2.5-flash then 1.5-flash
        try:
            print(f"Vintamie: Calling Gemini with model '{working_model_name}'...")
            model = genai.GenerativeModel(working_model_name)
            id_response = model.generate_content([*imgs, identify_prompt])
        except Exception as e:
            print(f"Vintamie: Model '{working_model_name}' failed: {e}. Trying fallback 'gemini-2.5-flash'...")
            working_model_name = "gemini-2.5-flash"
            try:
                model = genai.GenerativeModel(working_model_name)
                id_response = model.generate_content([*imgs, identify_prompt])
            except Exception as e2:
                print(f"Vintamie: Fallback model '{working_model_name}' failed: {e2}. Trying fallback 'gemini-1.5-flash'...")
                working_model_name = "gemini-1.5-flash"
                model = genai.GenerativeModel(working_model_name)
                id_response = model.generate_content([*imgs, identify_prompt])

        search_query = id_response.text.strip().replace('"', '')
        print(f"Vintamie: Identifizierter Suchbegriff -> '{search_query}' (via {working_model_name})")

        # --- STEP 2: Live Price Comparison ---
        comparison = search_marketplace_prices(search_query)
        print(f"Vintamie: Preisvergleich abgeschlossen. Medianpreis: {comparison['median_price']} EUR, {len(comparison['listings'])} Angebote gefunden.")

        # --- STEP 3: Final Listing Generation ---
        sources_str = json.dumps(comparison["listings"])
        
        final_prompt = (
            "Du bist Vintamie, eine visionäre Verkaufs-Assistentin für Second-Hand-Plattformen wie Vinted und Kleinanzeigen.\n"
            "Analysiere die Fotos dieses Artikels und erstelle eine Verkaufsanzeige. Nutze als zusätzlichen Kontext "
            "diese echten Markt-Vergleichsdaten aus einer aktuellen Suche:\n"
            f"- Gefundener Medianpreis für ähnliche Artikel: {comparison['median_price']} EUR\n"
            f"- Preisspanne aktiver Angebote: {comparison['min_price']} EUR - {comparison['max_price']} EUR\n"
            f"- Vergleichsangebote: {sources_str}\n\n"
            "Erstelle eine strukturierte JSON-Antwort mit folgenden Feldern auf Deutsch:\n"
            "- 'title': Ein aussagekräftiger Titel (max. 80 Zeichen), optimiert für Vinted/Kleinanzeigen.\n"
            "- 'description': Eine freundliche, ehrliche und ansprechende Verkaufsbeschreibung. Nenne wichtige Details (wie Schnitt, Muster) und füge am Ende 3-4 relevante Hashtags hinzu.\n"
            "- 'category': Eine passende Hauptkategorie auf Deutsch (z.B. 'Damenbekleidung', 'Herrenbekleidung', 'Kinder', 'Haus & Garten', 'Elektronik', 'Bücher & Medien', 'Sonstiges').\n"
            "- 'condition': Eine Einschätzung des Zustands. Wähle exakt einen dieser Werte: 'Neu', 'Sehr gut', 'Gut', 'Zufriedenstellend'.\n"
            "- 'price': Ein realistischer, geschätzter Verkaufspreis in Euro als ganze Zahl (Integer), orientiere dich eng an dem Medianpreis der Vergleichsangebote.\n\n"
            "Gib ausschließlich das JSON-Objekt zurück. Verwende kein Markdown-Formatting wie ```json."
        )

        generation_config = {
            "response_mime_type": "application/json",
        }

        # Use the model that worked for Step 1
        model = genai.GenerativeModel(working_model_name)
        response = model.generate_content(
            [*imgs, final_prompt],
            generation_config=generation_config
        )

        # Parse the JSON response
        data = json.loads(response.text)
        
        # Validate keys and types, injecting comparison sources
        validated_data = {
            "title": str(data.get("title", f"Vintage {search_query}")),
            "description": str(data.get("description", "Keine Beschreibung verfügbar.")),
            "category": str(data.get("category", "Sonstiges")),
            "condition": str(data.get("condition", "Gut")),
            "price": float(data.get("price", comparison["median_price"])),
            "sources": sources_str # Attach sources list as JSON string
        }
        
        return validated_data

    except Exception as e:
        print(f"CRITICAL: Error calling Gemini API: {e}")
        raise e

def regenerate_draft_field(image_paths: List[str], field: str) -> str:
    """
    Regenerate a single draft field (title, description, or category) based on the draft's images.
    """
    if not GEMINI_API_KEY:
        print("WARNING: GEMINI_API_KEY is not set. Returning mock field.")
        mock = get_mock_analysis()
        return mock.get(field, "")

    try:
        # Load, resize, and compress all images immediately to save memory and optimize performance
        imgs = []
        for path in image_paths:
            if not os.path.exists(path):
                continue
            img = Image.open(path)
            if img.width > 1024 or img.height > 1024:
                img.thumbnail((1024, 1024))
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.save(path, format="JPEG", quality=85)
                # Reopen the resized image
                img = Image.open(path)
            imgs.append(img)

        if not imgs:
            raise ValueError("Keine gültigen Bilder für die Regeneration gefunden.")

        if field == "title":
            prompt = (
                "Analysiere diese Fotos eines Artikels. Erzeuge einen neuen, kreativen, verkaufsfördernden und keyword-reichen Titel "
                "(max. 80 Zeichen) für eine Verkaufsanzeige auf Vinted/Kleinanzeigen auf Deutsch. "
                "Gib AUSSCHLIESSLICH den Titel zurück, ohne Anführungszeichen, ohne Einleitung, ohne Markdown."
            )
        elif field == "description":
            prompt = (
                "Analysiere diese Fotos eines Artikels. Erzeuge eine neue, ansprechende, ehrliche und detaillierte Verkaufsbeschreibung "
                "auf Deutsch. Erwähne wichtige Details wie Zustand, Farbe, Besonderheiten und füge am Ende 3-4 relevante Hashtags hinzu. "
                "Gib AUSSCHLIESSLICH die Beschreibung zurück, ohne Einleitung, ohne zusätzliche Kommentare, ohne Markdown."
            )
        elif field == "category":
            prompt = (
                "Analysiere diese Fotos eines Artikels. Wähle die passendste Hauptkategorie auf Deutsch aus. "
                "Wähle exakt einen dieser Werte: 'Damenbekleidung', 'Herrenbekleidung', 'Kinder', 'Haus & Garten', 'Elektronik', "
                "'Bücher & Medien', 'Sonstiges'. "
                "Gib AUSSCHLIESSLICH den genauen Kategorienamen als Text zurück, ohne Anführungszeichen, ohne Einleitung."
            )
        else:
            raise ValueError(f"Ungültiges Feld zur Regeneration: {field}")

        working_model_name = GEMINI_MODEL
        model = genai.GenerativeModel(working_model_name)
        
        try:
            response = model.generate_content([*imgs, prompt])
        except Exception as e:
            print(f"Model '{working_model_name}' failed: {e}. Trying fallback 'gemini-2.5-flash'...")
            working_model_name = "gemini-2.5-flash"
            try:
                model = genai.GenerativeModel(working_model_name)
                response = model.generate_content([*imgs, prompt])
            except Exception as e2:
                print(f"Fallback model '{working_model_name}' failed: {e2}. Trying fallback 'gemini-1.5-flash'...")
                working_model_name = "gemini-1.5-flash"
                model = genai.GenerativeModel(working_model_name)
                response = model.generate_content([*imgs, prompt])

        result = response.text.strip()
        # Clean any surrounding quotes
        if result.startswith('"') and result.endswith('"'):
            result = result[1:-1]
        elif result.startswith("'") and result.endswith("'"):
            result = result[1:-1]
        
        return result

    except Exception as e:
        print(f"Error in regenerate_draft_field: {e}")
        raise e

def get_mock_analysis() -> dict:
    """
    Fallback mock data with sources if the API key is missing or calls fail.
    """
    fallback_sources = [
        {
            "title": "Nike Air Max 90 weiß 40",
            "price": 35.0,
            "url": "https://www.kleinanzeigen.de/s-nike-air-max-90/k0"
        },
        {
            "title": "Nike Air Max 90 weiss guter Zustand",
            "price": 29.0,
            "url": "https://www.kleinanzeigen.de/s-nike-air-max-90/k0"
        }
    ]
    return {
        "title": "Nike Air Max 90 Weiß (Gr. 40)",
        "description": "Schöne Nike Air Max 90 Sneaker in weiß. Guter getragener Zustand, leichte Gebrauchsspuren, aber voll funktionsfähig und bereit für die zweite Runde!\n\n#nike #airmax90 #sneaker #weiss",
        "category": "Damenbekleidung",
        "condition": "Gut",
        "price": 30.0,
        "sources": json.dumps(fallback_sources)
    }
