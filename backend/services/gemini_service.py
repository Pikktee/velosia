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

def analyze_item_image(image_path: str) -> dict:
    """
    Step 1: Identifies search keywords from the image.
    Step 2: Searches Kleinanzeigen for active listings and price ranges.
    Step 3: Feeds the image + comparison data back to Gemini to get final details.
    """
    if not GEMINI_API_KEY:
        print("WARNING: GEMINI_API_KEY is not set. Returning mock data.")
        return get_mock_analysis()

    try:
        # Load image
        img = Image.open(image_path)
        model = genai.GenerativeModel("gemini-2.5-flash")

        # --- STEP 1: Identify search keywords ---
        identify_prompt = (
            "Analysiere dieses Foto eines Artikels. Identifiziere den Gegenstand, die Marke (falls sichtbar) und "
            "den genauen Typ. Gib mir eine kurze Suchanfrage (3-6 Wörter auf Deutsch), die ich auf einem Marktplatz eingeben kann, "
            "um vergleichbare Angebote zu finden. Antworte AUSSCHLIESSLICH mit der Suchanfrage."
        )
        
        id_response = model.generate_content([img, identify_prompt])
        search_query = id_response.text.strip().replace('"', '')
        print(f"Vintamie: Identifizierter Suchbegriff -> '{search_query}'")

        # --- STEP 2: Live Price Comparison ---
        comparison = search_marketplace_prices(search_query)
        print(f"Vintamie: Preisvergleich abgeschlossen. Medianpreis: {comparison['median_price']} EUR, {len(comparison['listings'])} Angebote gefunden.")

        # --- STEP 3: Final Listing Generation ---
        sources_str = json.dumps(comparison["listings"])
        
        final_prompt = (
            "Du bist Vintamie, eine visionäre Verkaufs-Assistentin für Second-Hand-Plattformen wie Vinted und Kleinanzeigen.\n"
            "Analysiere das Foto dieses Artikels und erstelle eine Verkaufsanzeige. Nutze als zusätzlichen Kontext "
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

        response = model.generate_content(
            [img, final_prompt],
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
        print(f"Error calling Gemini API: {e}. Returning mock fallback data.")
        return get_mock_analysis()

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
