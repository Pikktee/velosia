from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base
from typing import Optional


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    google_id = Column(String, unique=True, index=True, nullable=True)
    ai_tone = Column(String, default="locker", nullable=True)
    # Fixed Einleitung (intro) placed verbatim above every generated description.
    ai_intro = Column(String, nullable=True)
    # Active style/tone instruction for the AI-written middle section ("KI-Text").
    # Stores the preset text or the user's edited version; used verbatim.
    ai_custom_tone = Column(String, nullable=True)
    # Fixed Abschluss (footer) placed verbatim below every generated description.
    ai_custom_footer = Column(String, nullable=True)
    pricing_offset = Column(Float, default=0.0, nullable=True)
    default_zip = Column(String, nullable=True)
    default_city = Column(String, nullable=True)
    default_shipping = Column(String, nullable=True)
    # When True, autofill on Vinted/Kleinanzeigen also clicks "publish" itself.
    # Default False so the user reviews the prefilled listing and publishes manually.
    auto_submit = Column(Boolean, default=False, nullable=True)
    # When True the account is suspended: login + all authenticated requests are
    # rejected. Set/cleared by an admin via /api/admin/users/{id}/block.
    is_blocked = Column(Boolean, default=False, nullable=True)
    # Rolling 24h Gemini quota (cost control): images charged since
    # `ai_quota_reset_at`, which is when the counter next falls back to zero.
    # Both maintained exclusively by consume_ai_quota() in main.py.
    ai_images_used = Column(Integer, default=0, nullable=True)
    ai_quota_reset_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    drafts = relationship("Draft", back_populates="user", cascade="all, delete-orphan")

    @property
    def is_admin(self) -> bool:
        import os
        admin_emails_str = os.getenv("ADMIN_EMAILS", "henrik.heil@gmail.com")
        admin_emails = [email.strip().lower() for email in admin_emails_str.split(",")]
        return self.email.lower() in admin_emails

class Draft(Base):
    __tablename__ = "drafts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=True)
    description = Column(String, nullable=True)
    category = Column(String, nullable=True)
    condition = Column(String, nullable=True)
    price = Column(Float, nullable=True)
    image_path = Column(String, nullable=True)
    image_paths = Column(String, nullable=True)
    # JSON string to store price comparison source links: [{"title": "...", "price": 12.0, "url": "..."}]
    sources = Column(String, nullable=True)
    # JSON string of Kleinanzeigen attribute fields: {"Größe": "M", "Marke": "Nike", ...}
    attributes = Column(String, nullable=True)
    # Vinted category as a unique breadcrumb ("Damen > Kleidung > Jeans > Boyfriend Jeans").
    # Vinted has its own taxonomy, separate from Kleinanzeigen's `category`.
    vinted_category = Column(String, nullable=True)
    # True if this draft was auto-created in "Turbo" batch mode (multiple offers from one photo session)
    is_turbo = Column(Boolean, default=False, nullable=True)

    # --- Published-listing tracking (set after the listing goes live) ---------
    # The engine captures the public listing id + URL right after publishing (no
    # login); the backend then polls the public page to keep the status current.
    # Status vocabulary: online | reserviert | verkauft | geloescht | unbekannt.
    ka_listing_id = Column(String, nullable=True)
    ka_listing_url = Column(String, nullable=True)
    ka_status = Column(String, nullable=True)
    ka_status_at = Column(DateTime, nullable=True)
    vinted_listing_id = Column(String, nullable=True)
    vinted_listing_url = Column(String, nullable=True)
    vinted_status = Column(String, nullable=True)
    vinted_status_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="drafts")

    @property
    def category_path(self) -> Optional[str]:
        """Kleinanzeigen category tree path (e.g. "161/176/staubsauger") derived
        from the stored category. New drafts store the unique full breadcrumb
        ("Elektronik > Haushaltsgeräte > Staubsauger") which maps losslessly to a
        path; legacy drafts with a plain name fall back to a fuzzy/curated lookup.
        Lets the autofill engine jump straight to the category."""
        if not self.category:
            return None
        try:
            from data import kleinanzeigen_taxonomy as tax
            path = tax.path_for_breadcrumb(self.category) or tax.resolve_to_path(self.category)
            if path:
                return path
        except Exception:
            pass
        try:
            from data.kleinanzeigen_categories import find_category
            cat = find_category(self.category)
            return cat.get("path") if cat else None
        except Exception:
            return None

    @property
    def vinted_path(self) -> Optional[str]:
        """Vinted catalog path (chain of catalog IDs, e.g. "1904/4/183/1839")
        derived from the unique `vinted_category` breadcrumb. Drives the engine's
        category picker (which drills level by level via catalog id / name)."""
        if not self.vinted_category:
            return None
        try:
            from data import vinted_taxonomy as vtax
            return vtax.path_for_breadcrumb(self.vinted_category) or vtax.resolve_to_path(self.vinted_category)
        except Exception:
            return None

class AutofillEvent(Base):
    """Anonymous structural outcome of one autofill run (NO listing content).
    Powers automatic detection of Vinted/Kleinanzeigen form changes."""
    __tablename__ = "autofill_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    platform = Column(String, nullable=True, index=True)   # "vinted" | "kleinanzeigen"
    phase = Column(String, nullable=True)                  # "form" | "category"
    engine_version = Column(String, nullable=True)
    # Per-field "selector resolved?" flags (None = not applicable for this phase).
    title_found = Column(Boolean, nullable=True)
    description_found = Column(Boolean, nullable=True)
    price_found = Column(Boolean, nullable=True)
    category_ok = Column(Boolean, nullable=True)
    # Per-attribute picker outcomes (the fragile React dropdowns/modals). None =
    # not attempted this run (the AI had no value for it, so a miss isn't a
    # structural break); True/False = the picker was driven and (in)succeeded.
    condition_ok = Column(Boolean, nullable=True)
    size_ok = Column(Boolean, nullable=True)
    color_ok = Column(Boolean, nullable=True)
    material_ok = Column(Boolean, nullable=True)
    brand_ok = Column(Boolean, nullable=True)
    photos = Column(Integer, nullable=True)
    attributes_count = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class AlertLog(Base):
    """Records each fired anomaly alert so we can enforce a per-signal cooldown."""
    __tablename__ = "alert_logs"

    id = Column(Integer, primary_key=True, index=True)
    signal = Column(String, nullable=False, index=True)    # e.g. "vinted:title"
    detail = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class BugReport(Base):
    __tablename__ = "bug_reports"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=False)
    device_info = Column(String, nullable=True)
    screenshot_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User")

    @property
    def user_email(self) -> Optional[str]:
        return self.user.email if self.user else None


class WaitlistEntry(Base):
    """Public sign-ups from the landing page wanting to become Play Store testers.
    No auth required to create one; the maintainer turns these into Play Console
    internal-test testers manually."""
    __tablename__ = "waitlist_entries"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, unique=True, index=True)
    note = Column(String, nullable=True)
    source = Column(String, nullable=True)          # e.g. "landing"
    created_at = Column(DateTime, default=datetime.utcnow)


