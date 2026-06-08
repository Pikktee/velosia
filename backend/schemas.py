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

    class Config:
        from_attributes = True

# Draft Schemas
class DraftBase(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    condition: Optional[str] = None
    price: Optional[float] = None
    sources: Optional[str] = None # JSON string: [{"title": "...", "price": 12.0, "url": "..."}]
    image_paths: Optional[str] = None

class DraftCreate(DraftBase):
    pass

class DraftUpdate(DraftBase):
    pass

class DraftResponse(DraftBase):
    id: int
    user_id: int
    image_path: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class AnalysisResponse(BaseModel):
    title: str
    description: str
    category: str
    condition: str
    price: float
