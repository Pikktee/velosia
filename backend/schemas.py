from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional, List, Any

# Auth Token Schemas
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class GoogleLogin(BaseModel):
    credential: str

# User Schemas
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    created_at: datetime
    ai_tone: Optional[str] = "locker"
    ai_custom_tone: Optional[str] = None
    ai_custom_footer: Optional[str] = None
    pricing_offset: Optional[float] = 0.0
    default_zip: Optional[str] = None
    default_city: Optional[str] = None
    default_category: Optional[str] = None
    default_shipping: Optional[str] = None
    auto_submit: Optional[bool] = False
    is_admin: Optional[bool] = False

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    ai_tone: Optional[str] = None
    ai_custom_tone: Optional[str] = None
    ai_custom_footer: Optional[str] = None
    pricing_offset: Optional[float] = None
    default_zip: Optional[str] = None
    default_city: Optional[str] = None
    default_category: Optional[str] = None
    default_shipping: Optional[str] = None
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
    pass

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


# Listing capture — the engine reports the public id + URL after publishing.
class ListingPublishedCreate(BaseModel):
    draft_id: int
    platform: str                 # "vinted" | "kleinanzeigen"
    listing_id: Optional[str] = None
    listing_url: Optional[str] = None

class AnalysisResponse(BaseModel):
    title: str
    description: str
    category: str
    condition: str
    price: float

class DraftRegenerateRequest(BaseModel):
    field: str


# Autofill telemetry (anonymous structural outcome — NO listing content)
class AutofillEventCreate(BaseModel):
    platform: Optional[str] = None
    phase: Optional[str] = None
    engine_version: Optional[str] = None
    title_found: Optional[bool] = None
    description_found: Optional[bool] = None
    price_found: Optional[bool] = None
    category_ok: Optional[bool] = None
    photos: Optional[int] = None
    attributes_count: Optional[int] = None


# Bug Report Schemas
class BugReportCreate(BaseModel):
    title: str
    description: str
    device_info: Optional[str] = None
    screenshot_base64: Optional[str] = None

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


