import google.generativeai as genai
from PIL import Image
import os
import json
from dotenv import load_dotenv
from services.price_comparison import search_marketplace_prices
from data import kleinanzeigen_categories as kacat

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

from typing import List

def get_tone_instruction(user) -> str:
    if not user:
        return "Eine freundliche, ehrliche und ansprechende Verkaufsbeschreibung."
    
    tone = getattr(user, "ai_tone", "locker")
    if tone == "locker":
        return "Eine freundliche, ehrliche, ansprechende und lockere Verkaufsbeschreibung (gerne mit passenden, dezenten Emojis)."
    elif tone == "professionell":
        return "Eine sachliche, präzise und professionelle Verkaufsbeschreibung."
    elif tone == "direkt":
        return "Eine sehr direkte, kurze und schnörkellose Verkaufsbeschreibung ohne unnötige Floskeln."
    elif tone == "custom":
        custom_prompt = getattr(user, "ai_custom_tone", "") or ""
        if custom_prompt:
            return f"Eine Verkaufsbeschreibung, die genau folgenden Stil-/Tonfall-Vorgaben entspricht: {custom_prompt}"
        return "Eine freundliche, ehrliche und ansprechende Verkaufsbeschreibung."
    return "Eine freundliche, ehrliche und ansprechende Verkaufsbeschreibung."

def strip_hashtags(text: str) -> str:
    import re
    # Remove any hashtags (lines starting with or ending with hashtags) at the end of the text
    return re.sub(r'(\s*#[a-zA-Z0-9_-]+\s*)+$', '', text).rstrip()

def apply_custom_footer(description: str, user) -> str:
    description = strip_hashtags(description)
    if not user:
        return description
    footer = getattr(user, "ai_custom_footer", "") or ""
    if not footer:
        return description
    if footer.strip() in description:
        return description
    return f"{description}\n\n{footer}"

def analyze_item_image(image_paths: List[str], user = None, user_condition: str = None, user_details: str = None) -> dict:
    """
    Step 1: Identifies search keywords from the images.
    Step 2: Searches Kleinanzeigen for active listings and price ranges.
    Step 3: Feeds the images + comparison data back to Gemini to get final details.
    """
    if not GEMINI_API_KEY:
        print("WARNING: GEMINI_API_KEY is not set. Returning mock data.")
        mock = get_mock_analysis()
        if user_condition and user_condition.strip() and user_condition.lower() != "automatisch":
            mock["condition"] = user_condition
        if user_details:
            mock["description"] += f"\n\nZusatzdetails: {user_details}"
        return mock

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
        if user_details and user_details.strip():
            identify_prompt += f"\nZusätzliche Angaben des Benutzers zum Artikel: '{user_details}'"

        models_to_try = []
        if GEMINI_MODEL:
            models_to_try.append(GEMINI_MODEL)
        for m in ["gemini-2.5-flash", "gemini-2.0-flash"]:
            if m not in models_to_try:
                models_to_try.append(m)

        working_model_name = None
        id_response = None
        last_error = None

        for model_name in models_to_try:
            try:
                print(f"Vintamie: Calling Gemini with model '{model_name}'...")
                model = genai.GenerativeModel(model_name)
                id_response = model.generate_content([*imgs, identify_prompt])
                working_model_name = model_name
                break
            except Exception as e:
                print(f"Vintamie: Model '{model_name}' failed: {e}")
                last_error = e

        if not id_response:
            err_msg = str(last_error)
            if "quota" in err_msg.lower() or "429" in err_msg or "resource_exhausted" in err_msg.lower():
                raise Exception("Das tägliche Kontingent für die kostenlose KI-Analyse ist aufgebraucht (Quota Exceeded 429). Bitte versuche es später erneut.")
            raise Exception(f"Alle Gemini-Modelle zur Analyse fehlgeschlagen. Letzter Fehler: {err_msg}")

        search_query = id_response.text.strip().replace('"', '')
        print(f"Vintamie: Identifizierter Suchbegriff -> '{search_query}' (via {working_model_name})")

        # --- STEP 2: Live Price Comparison ---
        comparison = search_marketplace_prices(search_query)
        print(f"Vintamie: Preisvergleich abgeschlossen. Medianpreis: {comparison['median_price']} EUR, {len(comparison['listings'])} Angebote gefunden.")

        # --- STEP 3: Final Listing Generation ---
        sources_str = json.dumps(comparison["listings"])
        
        tone_instruction = get_tone_instruction(user)
        category_pref = getattr(user, "default_category", "") or ""
        category_instruction = ""
        if category_pref and category_pref != "Keine Präferenz":
            category_instruction = f" Bevorzuge dabei die Kategorie '{category_pref}', falls diese zum Artikel passt."

        catalog_prompt = kacat.build_catalog_prompt()
        condition_prompt = "- 'condition': Eine Einschätzung des Zustands. Wähle exakt einen dieser Werte: 'Neu', 'Sehr gut', 'Gut', 'In Ordnung'."
        if user_condition and user_condition.strip() and user_condition.lower() != "automatisch":
            condition_prompt = f"- 'condition': Setze den Zustand exakt auf den Wert '{user_condition}'."

        details_instruction = ""
        if user_details and user_details.strip():
            details_instruction = f"\nBerücksichtige unbedingt diese zusätzlichen Benutzer-Details beim Verfassen des Titels und der Beschreibung (wie Material, Schnitt, Mängel, Besonderheiten): '{user_details}'"

        final_prompt = (
            "Du bist Vintamie, eine visionäre Verkaufs-Assistentin für Second-Hand-Plattformen wie Vinted und Kleinanzeigen.\n"
            "Analysiere die Fotos dieses Artikels und erstelle eine Verkaufsanzeige. Nutze als zusätzlichen Kontext "
            "diese echten Markt-Vergleichsdaten aus einer aktuellen Suche:\n"
            f"- Gefundener Medianpreis für ähnliche Artikel: {comparison['median_price']} EUR\n"
            f"- Preisspanne aktiver Angebote: {comparison['min_price']} EUR - {comparison['max_price']} EUR\n"
            f"- Vergleichsangebote: {sources_str}\n\n"
            "Wähle die passende Kategorie AUSSCHLIESSLICH aus dieser Kleinanzeigen-Liste. Hinter jeder Kategorie "
            "stehen ihre Zusatzfelder mit den erlaubten Werten (Freitext-Felder kannst du frei befüllen):\n"
            f"{catalog_prompt}\n\n"
            "Erstelle eine strukturierte JSON-Antwort mit folgenden Feldern auf Deutsch:\n"
            "- 'title': Ein aussagekräftiger Titel (max. 80 Zeichen), optimiert für Vinted/Kleinanzeigen.\n"
            f"- 'description': {tone_instruction} Nenne wichtige Details (wie Schnitt, Muster). Füge KEINE Hashtags hinzu.{details_instruction}\n"
            f"- 'category': Exakt einer der Kategorienamen aus der obigen Liste (z.B. 'Damenbekleidung').{category_instruction}\n"
            "- 'attributes': Ein JSON-Objekt mit den Zusatzfeldern der gewählten Kategorie. Schlüssel = exakte "
            "Feldbezeichnung aus der Liste, Wert = einer der erlaubten Werten (bzw. Freitext). Lass Felder weg, "
            "die du nicht sicher bestimmen kannst. Beispiel: {\"Größe\": \"M\", \"Marke\": \"Nike\", \"Farbe\": \"Schwarz\", \"Versand\": \"Versand möglich\"}.\n"
            f"{condition_prompt}\n"
            "- 'price': Ein realistischer, geschätzter Verkaufspreis in Euro als ganze Zahl (Integer), orientiere dich eng an dem Medianpreis der Vergleichsangebote.\n\n"
            "Gib ausschließlich das JSON-Objekt zurück. Verwende kein Markdown-Formatting wie ```json."
        )

        generation_config = {
            "response_mime_type": "application/json",
        }

        # Use the model that worked for Step 1
        try:
            model = genai.GenerativeModel(working_model_name)
            response = model.generate_content(
                [*imgs, final_prompt],
                generation_config=generation_config
            )
        except Exception as e:
            err_msg = str(e)
            if "quota" in err_msg.lower() or "429" in err_msg or "resource_exhausted" in err_msg.lower():
                raise Exception("Das tägliche Kontingent für die kostenlose KI-Analyse ist aufgebraucht (Quota Exceeded 429). Bitte versuche es später erneut.")
            raise Exception(f"Fehler bei der finalen KI-Erstellung: {err_msg}")

        # Parse the JSON response
        data = json.loads(response.text)
        
        # Apply pricing offset if specified
        raw_price = float(data.get("price", comparison["median_price"]))
        if user and getattr(user, "pricing_offset", 0.0) is not None:
            offset = getattr(user, "pricing_offset", 0.0)
            if offset != 0.0:
                raw_price = max(1.0, round(raw_price * (1.0 + offset / 100.0)))

        # Apply custom footer to description
        raw_description = str(data.get("description", "Keine Beschreibung verfügbar."))
        raw_description = apply_custom_footer(raw_description, user)

        # Resolve category against the static catalog and validate its attributes
        chosen_category = str(data.get("category", "Sonstiges"))
        matched = kacat.find_category(chosen_category)
        if matched:
            chosen_category = matched["name"]
        condition_value = str(data.get("condition", "Gut"))
        clean_attributes = kacat.validate_attributes(
            chosen_category, data.get("attributes", {}), condition=condition_value
        )

        # Validate keys and types, injecting comparison sources
        validated_data = {
            "title": str(data.get("title", f"Vintage {search_query}")),
            "description": raw_description,
            "category": chosen_category,
            "condition": condition_value,
            "price": float(raw_price),
            "sources": sources_str,
            "attributes": json.dumps(clean_attributes, ensure_ascii=False),
        }

        return validated_data

    except Exception as e:
        print(f"CRITICAL: Error calling Gemini API: {e}")
        raise e

def regenerate_draft_field(image_paths: List[str], field: str, user = None) -> str:
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
            tone_instruction = get_tone_instruction(user)
            prompt = (
                "Analysiere diese Fotos eines Artikels. Erzeuge eine neue Verkaufsbeschreibung auf Deutsch. "
                f"Beachte dabei folgende Stilvorgabe: {tone_instruction} "
                "Erwähne wichtige Details wie Zustand, Farbe und Besonderheiten. Füge KEINE Hashtags hinzu. "
                "Gib AUSSCHLIESSLICH die Beschreibung zurück, ohne Einleitung, ohne zusätzliche Kommentare, ohne Markdown."
            )
        else:
            raise ValueError(f"Ungültiges Feld zur Regeneration: {field}")

        models_to_try = []
        if GEMINI_MODEL:
            models_to_try.append(GEMINI_MODEL)
        for m in ["gemini-2.5-flash", "gemini-2.0-flash"]:
            if m not in models_to_try:
                models_to_try.append(m)

        response = None
        last_error = None
        for model_name in models_to_try:
            try:
                print(f"Vintamie: Regenerating field '{field}' with model '{model_name}'...")
                model = genai.GenerativeModel(model_name)
                response = model.generate_content([*imgs, prompt])
                break
            except Exception as e:
                print(f"Vintamie: Model '{model_name}' failed during regeneration: {e}")
                last_error = e

        if not response:
            err_msg = str(last_error)
            if "quota" in err_msg.lower() or "429" in err_msg or "resource_exhausted" in err_msg.lower():
                raise Exception("Das tägliche Kontingent für die kostenlose KI-Analyse ist aufgebraucht (Quota Exceeded 429). Bitte versuche es später erneut.")
            raise Exception(f"Alle Gemini-Modelle zur Regeneration fehlgeschlagen. Letzter Fehler: {err_msg}")

        result = response.text.strip()
        # Clean any surrounding quotes
        if result.startswith('"') and result.endswith('"'):
            result = result[1:-1]
        elif result.startswith("'") and result.endswith("'"):
            result = result[1:-1]
        
        if field == "description":
            result = apply_custom_footer(result, user)
            
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
        "description": "Schöne Nike Air Max 90 Sneaker in weiß. Guter getragener Zustand, leichte Gebrauchsspuren, aber voll funktionsfähig und bereit für die zweite Runde!",
        "category": "Damenschuhe",
        "condition": "Gut",
        "price": 30.0,
        "sources": json.dumps(fallback_sources),
        "attributes": json.dumps({
            "Art": "Sneaker", "Größe": "40", "Marke": "Nike",
            "Farbe": "Weiß", "Versand": "Versand möglich"
        }, ensure_ascii=False),
    }
