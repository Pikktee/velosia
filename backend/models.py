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
    ai_custom_tone = Column(String, nullable=True)
    ai_custom_footer = Column(String, nullable=True)
    pricing_offset = Column(Float, default=0.0, nullable=True)
    default_zip = Column(String, nullable=True)
    default_city = Column(String, nullable=True)
    default_category = Column(String, nullable=True)
    default_shipping = Column(String, nullable=True)
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
    # True if this draft was auto-created in "Turbo" batch mode (multiple offers from one photo session)
    is_turbo = Column(Boolean, default=False, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="drafts")

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


