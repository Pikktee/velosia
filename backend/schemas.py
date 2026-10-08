from pydantic import BaseModel, EmailStr, Field, field_serializer
from datetime import datetime
from typing import Optional, List, Any, Literal
import json as _json

import signed_urls
from services import listing_urls

# Upper bounds for free-text input. They keep requests (and the AI prompts some
# of these texts end up in) to a sane size.
_SHORT = 200
_SETTING_TEXT = 1000
_DESCRIPTION = 5000
Platform = Literal["vinted", "kleinanzeigen"]

# Auth Token Schemas
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class GoogleLogin(BaseModel):
    credential: str = Field(max_length=8192)

# User Schemas
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str = Field(max_length=256)

PASSWORD_MIN_LENGTH = 6

class UserRegister(UserCreate):
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=256)

class PasswordSet(BaseModel):
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=256)

class UserResponse(UserBase):
    id: int
    created_at: datetime
    ai_tone: Optional[str] = "locker"
    ai_intro: Optional[str] = None
    ai_custom_tone: Optional[str] = None
    ai_custom_footer: Optional[str] = None
    pricing_offset: Optional[float] = 0.0
    default_zip: Optional[str] = None
    default_city: Optional[str] = None
    default_shipping: Optional[str] = None
    auto_submit: Optional[bool] = False
    is_admin: Optional[bool] = False

    class Config:
        from_attributes = True

class PlatformProfileResponse(BaseModel):
    """What a draft-scoped platform token may read from /api/auth/me."""
    default_zip: Optional[str] = None
    auto_submit: Optional[bool] = False

    class Config:
        from_attributes = True


class PlatformTokenResponse(BaseModel):
    token: str
    expires_in: int  # seconds


class UserUpdate(BaseModel):
    ai_tone: Optional[str] = Field(None, max_length=50)
    ai_intro: Optional[str] = Field(None, max_length=_SETTING_TEXT)
    ai_custom_tone: Optional[str] = Field(None, max_length=_SETTING_TEXT)
    ai_custom_footer: Optional[str] = Field(None, max_length=_SETTING_TEXT)
    pricing_offset: Optional[float] = Field(None, ge=-95, le=500)
    default_zip: Optional[str] = Field(None, max_length=20)
    default_city: Optional[str] = Field(None, max_length=100)
    default_shipping: Optional[str] = Field(None, max_length=_SHORT)
    auto_submit: Optional[bool] = None

# Draft Schemas
class DraftBase(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    condition: Optional[str] = None
    price: Optional[float] = None
    sources: Optional[str] = None # JSON string: [{"title": "...", "price": 12.0, "url": "..."}]
    attributes: Optional[str] = None # JSON string: {"Größe": "M", "Marke": "Nike", ...}
    vinted_category: Optional[str] = None # Vinted breadcrumb: "Damen > Kleidung > Jeans > Boyfriend Jeans"
    image_paths: Optional[str] = None
    is_turbo: Optional[bool] = False

class DraftCreate(DraftBase):
    pass

class DraftUpdate(DraftBase):
    # Input bounds (responses are not limited: they return what is stored).
    title: Optional[str] = Field(None, max_length=_SHORT)
    description: Optional[str] = Field(None, max_length=_DESCRIPTION)
    category: Optional[str] = Field(None, max_length=300)
    condition: Optional[str] = Field(None, max_length=50)
    price: Optional[float] = Field(None, ge=0, le=10_000_000)
    sources: Optional[str] = Field(None, max_length=20_000)
    attributes: Optional[str] = Field(None, max_length=4000)
    vinted_category: Optional[str] = Field(None, max_length=300)
    image_paths: Optional[str] = Field(None, max_length=10_000)

class DraftResponse(DraftBase):
    id: int
    user_id: int
    image_path: Optional[str] = None
    # Kleinanzeigen category tree path (e.g. "161/176"), derived from the chosen
    # category. Used by the autofill engine to auto-select the category.
    category_path: Optional[str] = None
    # Vinted catalog path (e.g. "1904/4/183/1839"), derived from vinted_category.
    vinted_path: Optional[str] = None
    # Published-listing tracking (filled once a listing goes live).
    ka_listing_id: Optional[str] = None
    ka_listing_url: Optional[str] = None
    ka_status: Optional[str] = None
    ka_status_at: Optional[datetime] = None
    vinted_listing_id: Optional[str] = None
    vinted_listing_url: Optional[str] = None
    vinted_status: Optional[str] = None
    vinted_status_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True

    # Photo paths leave the API signed (see signed_urls.py). Signing here rather
    # than in each endpoint means every client — frontend <img>, Android okhttp,
    # autofill engine — keeps working untouched. The database keeps the raw path.
    @field_serializer("image_path")
    def _sign_image_path(self, value: Optional[str]) -> Optional[str]:
        return signed_urls.sign_path(value)

    @field_serializer("image_paths")
    def _sign_image_paths(self, value: Optional[str]) -> Optional[str]:
        """`image_paths` is a JSON list stored as a string — sign each entry and
        hand back the same string shape the clients already parse."""
        if not value:
            return value
        try:
            paths = _json.loads(value)
        except Exception:
            # Legacy rows may hold a Python list repr with single quotes.
            try:
                paths = _json.loads(value.replace("'", '"'))
            except Exception:
                return value
        if not isinstance(paths, list):
            return value
        return _json.dumps([signed_urls.sign_path(p) for p in paths])

    # Listing links are shown and opened by the clients; rows stored before the
    # URL validation are passed through the same check on the way out.
    @field_serializer("ka_listing_url")
    def _safe_ka_url(self, value: Optional[str]) -> Optional[str]:
        return listing_urls.safe_listing_url(listing_urls.KLEINANZEIGEN, self.ka_listing_id, value)

    @field_serializer("vinted_listing_url")
    def _safe_vinted_url(self, value: Optional[str]) -> Optional[str]:
        return listing_urls.safe_listing_url(listing_urls.VINTED, self.vinted_listing_id, value)


# Listing capture — the engine reports the public id + URL after publishing.
class ListingPublishedCreate(BaseModel):
    draft_id: int
    platform: str = Field(max_length=20)   # "vinted" | "kleinanzeigen"
    listing_id: Optional[str] = Field(None, max_length=64)
    listing_url: Optional[str] = Field(None, max_length=2048)


class ListingStatusSet(BaseModel):
    platform: str = Field(max_length=20)   # "vinted" | "kleinanzeigen"
    status: str = Field(max_length=20)     # "online" | "reserviert" | "verkauft" | "geloescht"

class AnalysisResponse(BaseModel):
    title: str
    description: str
    category: str
    condition: str
    price: float

class DraftRegenerateRequest(BaseModel):
    field: str = Field(max_length=20)


# Autofill telemetry (anonymous structural outcome — NO listing content).
# Values match what every engine version sends: platform from the page host,
# phase "category" (KA step 1) or "form"; unknown extra keys are ignored.
class AutofillEventCreate(BaseModel):
    platform: Optional[Platform] = None
    phase: Optional[Literal["form", "category"]] = None
    engine_version: Optional[str] = Field(None, max_length=20, pattern=r"^[0-9A-Za-z._+-]+$")
    title_found: Optional[bool] = None
    description_found: Optional[bool] = None
    price_found: Optional[bool] = None
    category_ok: Optional[bool] = None
    condition_ok: Optional[bool] = None
    size_ok: Optional[bool] = None
    color_ok: Optional[bool] = None
    material_ok: Optional[bool] = None
    brand_ok: Optional[bool] = None
    photos: Optional[int] = Field(None, ge=0, le=100)
    attributes_count: Optional[int] = Field(None, ge=0, le=500)


# Bug Report Schemas
# Base64 adds a third; this admits a screenshot of up to ~12 MB.
MAX_SCREENSHOT_BASE64 = 16 * 1024 * 1024

class BugReportCreate(BaseModel):
    title: str = Field(max_length=_SHORT)
    description: str = Field(max_length=_DESCRIPTION)
    device_info: Optional[str] = Field(None, max_length=2000)
    screenshot_base64: Optional[str] = Field(None, max_length=MAX_SCREENSHOT_BASE64)

class BugReportResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    title: str
    description: str
    device_info: Optional[str] = None
    screenshot_path: Optional[str] = None
    created_at: datetime
    user_email: Optional[str] = None

    class Config:
        from_attributes = True

    # Bug screenshots are the most sensitive thing on the volume — they show
    # whatever was on a user's screen. Same signed-URL treatment as draft photos.
    @field_serializer("screenshot_path")
    def _sign_screenshot_path(self, value: Optional[str]) -> Optional[str]:
        return signed_urls.sign_path(value)


# Tester waitlist (public landing-page sign-up)
class WaitlistCreate(BaseModel):
    email: EmailStr
    note: Optional[str] = Field(None, max_length=500)

class WaitlistAck(BaseModel):
    ok: bool = True
    email: str

class WaitlistResponse(BaseModel):
    id: int
    email: str
    note: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Admin user management
class AdminUserResponse(BaseModel):
    id: int
    email: str
    created_at: datetime
    is_admin: bool
    is_blocked: bool
    draft_count: int
    image_count: int
    est_cost_eur: float

class UserBlockRequest(BaseModel):
    blocked: bool


