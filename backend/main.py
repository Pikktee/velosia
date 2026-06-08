from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import os
import shutil
import uuid
from typing import List

import models
import schemas
from database import engine, get_db
from services.gemini_service import analyze_item_image
from auth_utils import verify_password, get_password_hash, create_access_token, decode_access_token
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from sqlalchemy import text

# Create tables
models.Base.metadata.create_all(bind=engine)

def run_migrations():
    from database import SessionLocal
    db = SessionLocal()
    try:
        db.execute(text("ALTER TABLE users ADD COLUMN google_id VARCHAR(255)"))
        db.commit()
        print("Successfully ran migrations: added google_id column.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"Migration note: google_id column might already exist. ({e})", flush=True)
        
    try:
        db.execute(text("ALTER TABLE drafts ADD COLUMN image_paths VARCHAR(1000)"))
        db.commit()
        print("Successfully ran migrations: added image_paths column to drafts.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"Migration note: image_paths column might already exist. ({e})", flush=True)
    finally:
        db.close()

run_migrations()

app = FastAPI(title="Vintamie API", version="2.2.5")

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# CORS Middleware config
# Allow all origins for local testing, browser extension, and Android WebView
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static uploads directory
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Auth token extractor
security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> models.User:
    token = credentials.credentials
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ungültige oder abgelaufene Sitzung. Bitte erneut anmelden.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sitzungsdaten ungültig.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Benutzerkonto wurde nicht gefunden.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

# --- AUTH ENDPOINTS ---

@app.post("/api/auth/register", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    # Check if user already exists
    existing_user = db.query(models.User).filter(models.User.email == user_in.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Diese E-Mail-Adresse wird bereits verwendet."
        )
    
    hashed_pwd = get_password_hash(user_in.password)
    db_user = models.User(
        email=user_in.email,
        hashed_password=hashed_pwd
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.post("/api/auth/login", response_model=schemas.Token)
def login(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user_in.email).first()
    if not db_user or not verify_password(user_in.password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ungültige E-Mail-Adresse oder Passwort."
        )
    
    access_token = create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user

@app.get("/api/auth/config")
def get_auth_config():
    return {
        "google_client_id": os.getenv("GOOGLE_CLIENT_ID", "")
    }

@app.post("/api/auth/google", response_model=schemas.Token)
def login_google(login_in: schemas.GoogleLogin, db: Session = Depends(get_db)):
    credential = login_in.credential
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google Client ID ist auf dem Server nicht konfiguriert."
        )
    
    try:
        idinfo = id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
        
        google_id = idinfo.get("sub")
        email = idinfo.get("email")
        
        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google-Konto stellt keine E-Mail-Adresse zur Verfügung."
            )
            
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ungültiges Google-Token: {str(e)}"
        )
        
    db_user = db.query(models.User).filter(
        (models.User.google_id == google_id) | (models.User.email == email)
    ).first()
    
    if not db_user:
        random_password = str(uuid.uuid4())
        hashed_pwd = get_password_hash(random_password)
        db_user = models.User(
            email=email,
            hashed_password=hashed_pwd,
            google_id=google_id
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
    else:
        if not db_user.google_id:
            db_user.google_id = google_id
            db.commit()
            db.refresh(db_user)
            
    access_token = create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer"}

# --- DRAFT ENDPOINTS (SECURED) ---

from typing import Optional, List
import json

@app.post("/api/upload", response_model=schemas.DraftResponse, status_code=status.HTTP_201_CREATED)
def upload_and_analyze(
    file: Optional[UploadFile] = File(None), 
    files: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    uploaded_files = []
    if files:
        uploaded_files = files
    elif file:
        uploaded_files = [file]

    if not uploaded_files:
        raise HTTPException(status_code=400, detail="Es wurden keine Bilder hochgeladen.")

    saved_paths = []
    local_paths = []
    for f in uploaded_files:
        if not f.content_type.startswith("image/"):
            # Cleanup already saved files
            for p in local_paths:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
            raise HTTPException(status_code=400, detail="Alle Dateien müssen Bilder sein.")

        file_extension = os.path.splitext(f.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        file_path = os.path.join(UPLOAD_DIR, unique_filename)

        try:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(f.file, buffer)
            saved_paths.append(f"/uploads/{unique_filename}")
            local_paths.append(file_path)
        except Exception as e:
            # Cleanup already saved files
            for p in local_paths:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
            raise HTTPException(status_code=500, detail=f"Bild konnte nicht gespeichert werden: {e}")

    # Step-by-step AI + Live Scraper analysis
    try:
        analysis = analyze_item_image(local_paths)
    except Exception as e:
        for p in local_paths:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"KI-Analyse fehlgeschlagen: {str(e)}"
        )

    # Save to SQLite database linked to the current user
    db_draft = models.Draft(
        user_id=current_user.id,
        title=analysis["title"],
        description=analysis["description"],
        category=analysis["category"],
        condition=analysis["condition"],
        price=analysis["price"],
        sources=analysis.get("sources"), # Store JSON string of comparison listings
        image_path=saved_paths[0], # Primary image for backward compatibility
        image_paths=json.dumps(saved_paths) # Store all images as a JSON list
    )
    
    try:
        db.add(db_draft)
        db.commit()
        db.refresh(db_draft)
    except Exception as e:
        for p in local_paths:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
        raise HTTPException(status_code=500, detail=f"Datenbankfehler: {e}")

    return db_draft

@app.get("/api/drafts", response_model=List[schemas.DraftResponse])
def get_all_drafts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Retrieve drafts belonging only to the authenticated user
    return db.query(models.Draft).filter(models.Draft.user_id == current_user.id).order_by(models.Draft.created_at.desc()).all()

@app.get("/api/drafts/{draft_id}", response_model=schemas.DraftResponse)
def get_draft(
    draft_id: int, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id, 
        models.Draft.user_id == current_user.id
    ).first()
    if not db_draft:
        raise HTTPException(status_code=404, detail="Entwurf wurde nicht gefunden.")
    return db_draft

@app.put("/api/drafts/{draft_id}", response_model=schemas.DraftResponse)
def update_draft(
    draft_id: int, 
    updated_draft: schemas.DraftUpdate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id, 
        models.Draft.user_id == current_user.id
    ).first()
    if not db_draft:
        raise HTTPException(status_code=404, detail="Entwurf wurde nicht gefunden.")
    
    update_data = updated_draft.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_draft, key, value)

    db.commit()
    db.refresh(db_draft)
    return db_draft

@app.delete("/api/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    draft_id: int, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id, 
        models.Draft.user_id == current_user.id
    ).first()
    if not db_draft:
        raise HTTPException(status_code=404, detail="Entwurf wurde nicht gefunden.")
    
    # Delete all associated images
    if db_draft.image_paths:
        try:
            paths = json.loads(db_draft.image_paths)
            for path in paths:
                relative_path = path.lstrip("/")
                if os.path.exists(relative_path):
                    os.remove(relative_path)
        except Exception as e:
            print(f"Error removing image files: {e}")
    elif db_draft.image_path:
        relative_path = db_draft.image_path.lstrip("/")
        if os.path.exists(relative_path):
            try:
                os.remove(relative_path)
            except Exception as e:
                print(f"Error removing image file {relative_path}: {e}")

    db.delete(db_draft)
    db.commit()
    return {"detail": "Entwurf gelöscht"}
