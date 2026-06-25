from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, status, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import os
import shutil
import uuid
import json
import time
import asyncio
from datetime import datetime, timedelta
from typing import List
from concurrent.futures import ThreadPoolExecutor, as_completed

import models
import schemas
from database import engine, get_db
from services.gemini_service import analyze_item_image, group_images_by_offer
from services.notifications import send_email
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

    try:
        db.execute(text("ALTER TABLE drafts ADD COLUMN attributes VARCHAR(2000)"))
        db.commit()
        print("Successfully ran migrations: added attributes column to drafts.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"Migration note: attributes column might already exist. ({e})", flush=True)

    try:
        db.execute(text("ALTER TABLE drafts ADD COLUMN is_turbo BOOLEAN DEFAULT 0"))
        db.commit()
        print("Successfully ran migrations: added is_turbo column to drafts.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"Migration note: is_turbo column might already exist. ({e})", flush=True)

    try:
        db.execute(text("ALTER TABLE drafts ADD COLUMN vinted_category VARCHAR(300)"))
        db.commit()
        print("Successfully ran migrations: added vinted_category column to drafts.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"Migration note: vinted_category column might already exist. ({e})", flush=True)

    # Published-listing tracking columns
    for col_name, col_type in [
        ("ka_listing_id", "VARCHAR(50)"),
        ("ka_listing_url", "VARCHAR(500)"),
        ("ka_status", "VARCHAR(20)"),
        ("ka_status_at", "DATETIME"),
        ("vinted_listing_id", "VARCHAR(50)"),
        ("vinted_listing_url", "VARCHAR(500)"),
        ("vinted_status", "VARCHAR(20)"),
        ("vinted_status_at", "DATETIME"),
    ]:
        try:
            db.execute(text(f"ALTER TABLE drafts ADD COLUMN {col_name} {col_type}"))
            db.commit()
            print(f"Successfully ran migrations: added {col_name} column to drafts.", flush=True)
        except Exception as e:
            db.rollback()
            print(f"Migration note: {col_name} column might already exist. ({e})", flush=True)

    # User settings migrations
    for col_name, col_type in [
        ("ai_tone", "VARCHAR(50) DEFAULT 'locker'"),
        ("ai_intro", "VARCHAR(500)"),
        ("ai_custom_tone", "VARCHAR(500)"),
        ("ai_custom_footer", "VARCHAR(500)"),
        ("pricing_offset", "FLOAT DEFAULT 0.0"),
        ("default_zip", "VARCHAR(20)"),
        ("default_city", "VARCHAR(100)"),
        # default_category was dropped (categories are AI-resolved); any existing
        # physical column in older DBs is left in place, inert and unreferenced.
        ("default_shipping", "VARCHAR(200)"),
        ("auto_submit", "BOOLEAN DEFAULT 0"),
        ("is_blocked", "BOOLEAN DEFAULT 0")
    ]:
        try:
            db.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
            db.commit()
            print(f"Successfully ran migrations: added {col_name} column.", flush=True)
        except Exception as e:
            db.rollback()
            print(f"Migration note: {col_name} column might already exist. ({e})", flush=True)
            
    db.close()

run_migrations()

app = FastAPI(title="Velosia API", version="2.6.21")

UPLOAD_DIR = "/data/uploads" if os.path.isdir("/data") else "uploads"
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
    if getattr(user, "is_blocked", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dieses Konto wurde gesperrt.",
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
    if getattr(db_user, "is_blocked", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Dieses Konto wurde gesperrt.")

    access_token = create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user

@app.put("/api/auth/me", response_model=schemas.UserResponse)
def update_me(
    user_update: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    update_data = user_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(current_user, key, value)
    db.commit()
    db.refresh(current_user)
    return current_user

@app.delete("/api/auth/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_account(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # 1. Delete all images on disk associated with user's drafts
    user_drafts = db.query(models.Draft).filter(models.Draft.user_id == current_user.id).all()
    for draft in user_drafts:
        if draft.image_paths:
            try:
                paths = json.loads(draft.image_paths)
                for path in paths:
                    relative_path = os.path.join(UPLOAD_DIR, os.path.basename(path))
                    if os.path.exists(relative_path):
                        os.remove(relative_path)
            except Exception as e:
                print(f"Error removing image files for draft {draft.id}: {e}", flush=True)
        elif draft.image_path:
            relative_path = os.path.join(UPLOAD_DIR, os.path.basename(draft.image_path))
            if os.path.exists(relative_path):
                try:
                    os.remove(relative_path)
                except Exception as e:
                    print(f"Error removing image file {relative_path} for draft {draft.id}: {e}", flush=True)
    
    # 2. Delete the user (cascade delete handles database drafts)
    db.delete(current_user)
    db.commit()
    return {"detail": "Account erfolgreich gelöscht"}

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

    if getattr(db_user, "is_blocked", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Dieses Konto wurde gesperrt.")

    access_token = create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer"}

# --- DRAFT ENDPOINTS (SECURED) ---

from typing import Optional, List
import json

@app.post("/api/upload", response_model=schemas.DraftResponse, status_code=status.HTTP_201_CREATED)
def upload_and_analyze(
    file: Optional[UploadFile] = File(None), 
    files: Optional[List[UploadFile]] = File(None),
    condition: Optional[str] = Form(None),
    details: Optional[str] = Form(None),
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
        analysis = analyze_item_image(local_paths, user=current_user, user_condition=condition, user_details=details)
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
        attributes=analysis.get("attributes"), # Store JSON string of Kleinanzeigen attribute fields
        vinted_category=analysis.get("vinted_category"), # Vinted breadcrumb (separate taxonomy)
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

@app.post("/api/upload/turbo", response_model=List[schemas.DraftResponse], status_code=status.HTTP_201_CREATED)
def upload_turbo(
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Turbo mode: accepts many photos of several different items in one go,
    lets the AI group the photos by item, then auto-creates one finished
    draft per group (title, description, category, price) without any further
    user input. Returns the list of created drafts (newest first).
    """
    if not files:
        raise HTTPException(status_code=400, detail="Es wurden keine Bilder hochgeladen.")

    def _cleanup(paths):
        for p in paths:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass

    # 1. Save all uploaded images
    saved_paths = []
    local_paths = []
    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            _cleanup(local_paths)
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
            _cleanup(local_paths)
            raise HTTPException(status_code=500, detail=f"Bild konnte nicht gespeichert werden: {e}")

    # 2. Let the AI group photos into separate offers (robust, never raises)
    try:
        groups = group_images_by_offer(local_paths)
    except Exception:
        groups = [list(range(len(local_paths)))]
    if not groups:
        groups = [list(range(len(local_paths)))]

    # 3. Analyze each group in parallel (analyze_item_image is sync + network-bound)
    def analyze_group(group):
        group_local = [local_paths[i] for i in group]
        return analyze_item_image(group_local, user=current_user, user_condition=None, user_details=None)

    results = [None] * len(groups)
    errors = []
    max_workers = min(len(groups), 4)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_idx = {executor.submit(analyze_group, groups[i]): i for i in range(len(groups))}
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                print(f"Velosia Turbo: Analyse von Gruppe {idx} fehlgeschlagen: {e}", flush=True)
                errors.append(str(e))

    # 4. Persist one draft per successfully analyzed group
    created_drafts = []
    used_indices = set()
    for i, group in enumerate(groups):
        analysis = results[i]
        if analysis is None:
            continue
        group_saved = [saved_paths[j] for j in group]
        used_indices.update(group)
        created_drafts.append(models.Draft(
            user_id=current_user.id,
            title=analysis["title"],
            description=analysis["description"],
            category=analysis["category"],
            condition=analysis["condition"],
            price=analysis["price"],
            sources=analysis.get("sources"),
            attributes=analysis.get("attributes"),
            vinted_category=analysis.get("vinted_category"),
            image_path=group_saved[0],
            image_paths=json.dumps(group_saved),
            is_turbo=True
        ))

    if not created_drafts:
        _cleanup(local_paths)
        detail = f"Turbo-Analyse fehlgeschlagen: {errors[0]}" if errors else "KI-Analyse fehlgeschlagen."
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)

    # Remove images that belong to failed groups (no draft references them)
    _cleanup([p for j, p in enumerate(local_paths) if j not in used_indices])

    try:
        for d in created_drafts:
            db.add(d)
        db.commit()
        for d in created_drafts:
            db.refresh(d)
    except Exception as e:
        _cleanup([p for j, p in enumerate(local_paths) if j in used_indices])
        raise HTTPException(status_code=500, detail=f"Datenbankfehler: {e}")

    # Return newest first, consistent with the drafts list ordering
    created_drafts.reverse()
    return created_drafts

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
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
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
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
    
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
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
    
    # Delete all associated images
    if db_draft.image_paths:
        try:
            paths = json.loads(db_draft.image_paths)
            for path in paths:
                relative_path = os.path.join(UPLOAD_DIR, os.path.basename(path))
                if os.path.exists(relative_path):
                    os.remove(relative_path)
        except Exception as e:
            print(f"Error removing image files: {e}")
    elif db_draft.image_path:
        relative_path = os.path.join(UPLOAD_DIR, os.path.basename(db_draft.image_path))
        if os.path.exists(relative_path):
            try:
                os.remove(relative_path)
            except Exception as e:
                print(f"Error removing image file {relative_path}: {e}")

    db.delete(db_draft)
    db.commit()
    return {"detail": "Angebot gelöscht"}

@app.post("/api/drafts/{draft_id}/images", response_model=schemas.DraftResponse)
def add_draft_images(
    draft_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id,
        models.Draft.user_id == current_user.id
    ).first()
    if not db_draft:
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")

    existing_paths = []
    if db_draft.image_paths:
        try:
            existing_paths = json.loads(db_draft.image_paths)
        except Exception:
            if db_draft.image_path:
                existing_paths = [db_draft.image_path]

    saved_paths = []
    local_paths = []
    for f in files:
        if not f.content_type.startswith("image/"):
            # Cleanup
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
            # Cleanup
            for p in local_paths:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
            raise HTTPException(status_code=500, detail=f"Bild konnte nicht gespeichert werden: {e}")

    new_paths = existing_paths + saved_paths
    db_draft.image_paths = json.dumps(new_paths)
    if not db_draft.image_path and new_paths:
        db_draft.image_path = new_paths[0]

    db.commit()
    db.refresh(db_draft)
    return db_draft

@app.delete("/api/drafts/{draft_id}/images", response_model=schemas.DraftResponse)
def delete_draft_image(
    draft_id: int,
    image_path: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id,
        models.Draft.user_id == current_user.id
    ).first()
    if not db_draft:
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")

    existing_paths = []
    if db_draft.image_paths:
        try:
            existing_paths = json.loads(db_draft.image_paths)
        except Exception:
            if db_draft.image_path:
                existing_paths = [db_draft.image_path]

    if image_path not in existing_paths:
        raise HTTPException(status_code=400, detail="Bild gehört nicht zu diesem Angebot.")

    existing_paths.remove(image_path)
    
    local_path = os.path.join(UPLOAD_DIR, os.path.basename(image_path))
    if os.path.exists(local_path):
        try:
            os.remove(local_path)
        except Exception as e:
            print(f"Error removing image file {local_path}: {e}", flush=True)

    db_draft.image_paths = json.dumps(existing_paths)
    if db_draft.image_path == image_path:
        db_draft.image_path = existing_paths[0] if existing_paths else None

    db.commit()
    db.refresh(db_draft)
    return db_draft

@app.post("/api/drafts/{draft_id}/regenerate", response_model=schemas.DraftResponse)
def regenerate_draft_field_endpoint(
    draft_id: int,
    req: schemas.DraftRegenerateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if req.field not in ["title", "description"]:
        raise HTTPException(status_code=400, detail="Ungültiges Feld zur Regeneration.")

    db_draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id,
        models.Draft.user_id == current_user.id
    ).first()
    if not db_draft:
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")

    image_paths = []
    if db_draft.image_paths:
        try:
            paths = json.loads(db_draft.image_paths)
            image_paths = [os.path.join(UPLOAD_DIR, os.path.basename(p)) for p in paths]
        except Exception:
            if db_draft.image_path:
                image_paths = [os.path.join(UPLOAD_DIR, os.path.basename(db_draft.image_path))]
    elif db_draft.image_path:
        image_paths = [os.path.join(UPLOAD_DIR, os.path.basename(db_draft.image_path))]

    if not image_paths:
        raise HTTPException(status_code=400, detail="Keine Bilder im Angebot vorhanden, um KI-Generierung auszuführen.")

    from services.gemini_service import regenerate_draft_field
    try:
        new_val = regenerate_draft_field(image_paths, req.field, user=current_user)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"KI-Regeneration fehlgeschlagen: {str(e)}")

    if req.field == "title":
        db_draft.title = new_val
    elif req.field == "description":
        db_draft.description = new_val

    db.commit()
    db.refresh(db_draft)
    return db_draft

# --- APP OTA UPDATE ENDPOINTS ---
from fastapi.responses import FileResponse
from typing import Optional
from fastapi import Header

# Use persistent volume for APK storage in production (survives container redeploys)
APK_DIR = "/data" if os.path.isdir("/data") else UPLOAD_DIR
APK_FILENAME = "velosia-latest.apk"

@app.get("/api/app/latest-apk")
def download_latest_apk():
    apk_path = os.path.join(APK_DIR, APK_FILENAME)
    if not os.path.exists(apk_path):
        raise HTTPException(status_code=404, detail="APK-Datei wurde noch nicht generiert. Bitte starte ein Build.")
    return FileResponse(
        apk_path, 
        media_type="application/vnd.android.package-archive", 
        filename="velosia-latest.apk"
    )

@app.post("/api/app/upload-apk")
async def upload_apk(
    file: UploadFile = File(...),
    version: Optional[str] = None,
    x_upload_secret: Optional[str] = Header(None)
):
    secret = os.getenv("APP_UPLOAD_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="Upload-Secret ist auf dem Server nicht konfiguriert.")
    if x_upload_secret != secret:
        raise HTTPException(status_code=401, detail="Ungültiger Upload-Secret-Schlüssel.")
        
    apk_path = os.path.join(APK_DIR, APK_FILENAME)
    with open(apk_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    if version:
        try:
            version_path = os.path.join(APK_DIR, "apk-version.txt")
            with open(version_path, "w") as f:
                f.write(version)
        except Exception:
            pass
            
    return {"status": "success", "message": f"APK-Datei erfolgreich aktualisiert (gespeichert unter {APK_DIR})."}

# --- AUTOFILL TELEMETRY & AUTOMATIC HEALTH MONITORING ---

# Tuning for the anomaly detector. A signal fires when a normally-reliable field
# fails in too large a fraction of the most recent autofill runs on a platform.
_TELEMETRY_WINDOW = 15       # most recent events per platform to look at
_TELEMETRY_MIN_EVENTS = 6    # need at least this many relevant data points
_TELEMETRY_COOLDOWN_H = 24   # don't re-alert the same signal within 24h
# (field label, AutofillEvent attribute, miss-rate threshold to alert)
_TELEMETRY_SIGNALS = [
    ("Titel", "title_found", 0.6),
    ("Beschreibung", "description_found", 0.6),
    ("Preis", "price_found", 0.6),
    ("Kategorie", "category_ok", 0.9),  # category can legitimately fall to manual -> only alert on near-total failure
]


def check_autofill_anomaly(platform: str):
    """Runs in the background after a telemetry event. Detects when a field starts
    failing en masse (site likely changed) and e-mails the maintainer, once per
    signal per cooldown window. Never raises into the request."""
    if not platform:
        return
    from database import SessionLocal
    db = SessionLocal()
    try:
        recent = (
            db.query(models.AutofillEvent)
            .filter(models.AutofillEvent.platform == platform)
            .order_by(models.AutofillEvent.created_at.desc())
            .limit(_TELEMETRY_WINDOW)
            .all()
        )
        for label, attr, threshold in _TELEMETRY_SIGNALS:
            vals = [getattr(e, attr) for e in recent if getattr(e, attr) is not None]
            if len(vals) < _TELEMETRY_MIN_EVENTS:
                continue
            miss_rate = sum(1 for v in vals if v is False) / len(vals)
            if miss_rate < threshold:
                continue
            signal = f"{platform}:{attr}"
            last = (
                db.query(models.AlertLog)
                .filter(models.AlertLog.signal == signal)
                .order_by(models.AlertLog.created_at.desc())
                .first()
            )
            if last and (datetime.utcnow() - last.created_at) < timedelta(hours=_TELEMETRY_COOLDOWN_H):
                continue
            db.add(models.AlertLog(signal=signal, detail=f"miss={miss_rate:.0%} n={len(vals)}"))
            db.commit()
            versions = ", ".join(sorted({e.engine_version or "?" for e in recent}))
            send_email(
                f"⚠️ Velosia Autofill: '{label}' bricht auf {platform}",
                (
                    f"Das Feld/die Aktion '{label}' ist in {miss_rate:.0%} der letzten {len(vals)} "
                    f"Autofill-Versuche auf {platform} fehlgeschlagen.\n\n"
                    f"Sehr wahrscheinlich hat {platform} sein Formular bzw. seine Selektoren geändert.\n"
                    f"Bitte die Engine-Selektoren in shared/autofill-engine.js prüfen "
                    f"(FIELD_MAP bzw. die Kategorie-Navigation) und ggf. neu ernten/anpassen.\n\n"
                    f"Engine-Versionen im Zeitfenster: {versions}\n"
                    f"Diese Warnung wird frühestens in {_TELEMETRY_COOLDOWN_H}h erneut gesendet."
                ),
            )
    except Exception as e:
        print(f"[telemetry] Anomalie-Check fehlgeschlagen: {e}", flush=True)
    finally:
        db.close()


@app.post("/api/telemetry/autofill", status_code=status.HTTP_202_ACCEPTED)
def telemetry_autofill(
    event: schemas.AutofillEventCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Records one anonymous autofill outcome (no listing content) and triggers a
    background anomaly check. Best-effort: telemetry never blocks the user."""
    try:
        ev = models.AutofillEvent(user_id=current_user.id, **event.dict())
        db.add(ev)
        db.commit()
        background_tasks.add_task(check_autofill_anomaly, event.platform)
    except Exception as e:
        db.rollback()
        print(f"[telemetry] Speichern fehlgeschlagen: {e}", flush=True)
    return {"ok": True}


# --- PUBLISHED-LISTING TRACKING (SECURED) ----------------------------------
# The engine captures the public listing id + URL right after publishing (no
# login). The backend then polls those public pages — via curl-cffi, low volume,
# only the user's own active listings — to keep an online/reserviert/verkauft/
# geloescht status in the dashboard. We deliberately read only the public listing
# page, never the listing form (that crawl once got the IP banned).

from services import listing_status

# How often the background poller sweeps all active listings, and how long it
# spaces individual requests apart, so a sweep never looks like a burst.
_STATUS_POLL_INTERVAL_MIN = int(os.getenv("STATUS_POLL_INTERVAL_MIN", "360"))
_STATUS_POLL_SPACING_S = float(os.getenv("STATUS_POLL_SPACING_S", "4"))


def _apply_listing_capture(draft, platform, listing_id, listing_url):
    """Store a freshly captured listing id/url and mark it online."""
    now = datetime.utcnow()
    if platform == "kleinanzeigen":
        draft.ka_listing_id = listing_id or draft.ka_listing_id
        draft.ka_listing_url = listing_url or draft.ka_listing_url
        draft.ka_status = listing_status.ONLINE
        draft.ka_status_at = now
    elif platform == "vinted":
        draft.vinted_listing_id = listing_id or draft.vinted_listing_id
        draft.vinted_listing_url = listing_url or draft.vinted_listing_url
        draft.vinted_status = listing_status.ONLINE
        draft.vinted_status_at = now


def _apply_status_updates(draft, updates):
    for key, value in updates.items():
        setattr(draft, key, value)


@app.post("/api/listings/published", response_model=schemas.DraftResponse)
def capture_published_listing(
    payload: schemas.ListingPublishedCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Called by the engine once a listing is live: records its public id/URL so
    the dashboard can show & track it."""
    draft = db.query(models.Draft).filter(
        models.Draft.id == payload.draft_id,
        models.Draft.user_id == current_user.id,
    ).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
    if payload.platform not in ("kleinanzeigen", "vinted"):
        raise HTTPException(status_code=400, detail="Unbekannte Plattform.")

    _apply_listing_capture(draft, payload.platform, payload.listing_id, payload.listing_url)
    db.commit()
    db.refresh(draft)
    return draft


@app.post("/api/listings/{draft_id}/refresh-status", response_model=schemas.DraftResponse)
def refresh_listing_status(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Re-poll one draft's published listings on demand."""
    draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id,
        models.Draft.user_id == current_user.id,
    ).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")

    updates = listing_status.refresh_draft_status(draft, datetime.utcnow())
    if updates:
        _apply_status_updates(draft, updates)
        db.commit()
        db.refresh(draft)
    return draft


@app.post("/api/listings/refresh-all", response_model=List[schemas.DraftResponse])
def refresh_all_listings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Re-poll all of the user's active (non-terminal) published listings. Drives
    the dashboard's 'Status aktualisieren' button."""
    drafts = db.query(models.Draft).filter(
        models.Draft.user_id == current_user.id,
    ).order_by(models.Draft.created_at.desc()).all()

    for draft in drafts:
        has_listing = draft.ka_listing_url or draft.vinted_listing_url
        if not has_listing:
            continue
        updates = listing_status.refresh_draft_status(draft, datetime.utcnow())
        if updates:
            _apply_status_updates(draft, updates)
            db.commit()
    return drafts


def poll_all_active_listings():
    """Background sweep: refresh every active listing across all users, spacing
    requests out. Runs in a worker thread (curl-cffi is blocking)."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        drafts = db.query(models.Draft).filter(
            (models.Draft.ka_listing_url.isnot(None)) | (models.Draft.vinted_listing_url.isnot(None))
        ).all()
        checked = 0
        for draft in drafts:
            updates = listing_status.refresh_draft_status(draft, datetime.utcnow())
            if updates:
                _apply_status_updates(draft, updates)
                db.commit()
                checked += 1
            time.sleep(_STATUS_POLL_SPACING_S)
        if checked:
            print(f"[status-poll] aktualisierte {checked} Angebote.", flush=True)
    except Exception as e:
        print(f"[status-poll] Sweep fehlgeschlagen: {e}", flush=True)
    finally:
        db.close()


async def _status_poll_loop():
    # Small initial delay so startup/migrations settle first.
    await asyncio.sleep(90)
    interval = max(30, _STATUS_POLL_INTERVAL_MIN) * 60
    while True:
        try:
            await asyncio.to_thread(poll_all_active_listings)
        except Exception as e:
            print(f"[status-poll] Loop-Fehler: {e}", flush=True)
        await asyncio.sleep(interval)


@app.on_event("startup")
async def _start_status_poller():
    asyncio.create_task(_status_poll_loop())


# --- BUG REPORT ENDPOINTS (SECURED) ---

@app.post("/api/bugs", response_model=schemas.BugReportResponse, status_code=status.HTTP_201_CREATED)
def create_bug_report(
    bug_in: schemas.BugReportCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    screenshot_path = None
    if bug_in.screenshot_base64 and "," in bug_in.screenshot_base64:
        try:
            header, encoded = bug_in.screenshot_base64.split(",", 1)
            file_extension = ".png"
            if "image/jpeg" in header or "image/jpg" in header:
                file_extension = ".jpg"
            elif "image/webp" in header:
                file_extension = ".webp"
            
            import base64
            data = base64.b64decode(encoded)
            unique_filename = f"bug_{uuid.uuid4()}{file_extension}"
            file_path = os.path.join(UPLOAD_DIR, unique_filename)
            with open(file_path, "wb") as buffer:
                buffer.write(data)
            screenshot_path = f"/uploads/{unique_filename}"
        except Exception as e:
            print(f"Error saving bug screenshot: {e}", flush=True)

    db_bug = models.BugReport(
        user_id=current_user.id,
        title=bug_in.title,
        description=bug_in.description,
        device_info=bug_in.device_info,
        screenshot_path=screenshot_path
    )
    db.add(db_bug)
    db.commit()
    db.refresh(db_bug)
    return db_bug


# --- Tester waitlist (public sign-up from the landing page) -------------------
@app.post("/api/waitlist", response_model=schemas.WaitlistResponse, status_code=status.HTTP_201_CREATED)
def join_waitlist(entry_in: schemas.WaitlistCreate, db: Session = Depends(get_db)):
    """Public endpoint — anyone can sign up to be considered as a Play Store
    tester. Idempotent: re-submitting the same e-mail returns the existing entry
    instead of erroring. Notifies the maintainer by e-mail when configured."""
    email = entry_in.email.strip().lower()
    existing = db.query(models.WaitlistEntry).filter(models.WaitlistEntry.email == email).first()
    if existing:
        return existing

    db_entry = models.WaitlistEntry(
        email=email,
        note=(entry_in.note or None),
        source="landing",
    )
    db.add(db_entry)
    try:
        db.commit()
        db.refresh(db_entry)
    except Exception as e:
        # Race on the unique index: fetch and return the now-existing row.
        db.rollback()
        existing = db.query(models.WaitlistEntry).filter(models.WaitlistEntry.email == email).first()
        if existing:
            return existing
        raise HTTPException(status_code=500, detail="Could not save waitlist entry.")

    try:
        count = db.query(models.WaitlistEntry).count()
        send_email(
            subject=f"Velosia: neue Tester-Anmeldung ({email})",
            body=(
                f"Neue Eintragung in die Tester-Warteliste:\n\n"
                f"E-Mail: {email}\n"
                f"Notiz: {entry_in.note or '-'}\n\n"
                f"Warteliste umfasst jetzt {count} Eintrag/Einträge.\n"
                f"Trage die E-Mail in der Play Console (Interner Test → Tester) ein, "
                f"damit die Person den Opt-in-Link nutzen kann."
            ),
        )
    except Exception as e:
        print(f"Waitlist notification e-mail failed (non-fatal): {e}", flush=True)

    return db_entry


@app.get("/api/waitlist", response_model=List[schemas.WaitlistResponse])
def list_waitlist(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Admin-only: view all tester sign-ups."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    return db.query(models.WaitlistEntry).order_by(models.WaitlistEntry.created_at.desc()).all()


# --- Admin user management ---------------------------------------------------
# Per-image estimate (EUR) for the admin cost overview. There is no real token
# accounting yet, so cost is ESTIMATED from the number of analysed images
# (Gemini Vision dominates the bill). Tunable via env without a redeploy.
EST_COST_PER_IMAGE_EUR = float(os.getenv("EST_COST_PER_IMAGE_EUR", "0.0025"))


def _count_draft_images(draft: models.Draft) -> int:
    """Number of images attached to a draft (CSV image_paths, else single)."""
    if getattr(draft, "image_paths", None):
        return len([p for p in draft.image_paths.split(",") if p.strip()])
    if getattr(draft, "image_path", None):
        return 1
    return 0


@app.get("/api/admin/users", response_model=List[schemas.AdminUserResponse])
def admin_list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Admin-only: all users with usage stats + estimated AI cost."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")

    users = db.query(models.User).order_by(models.User.created_at.desc()).all()
    out = []
    for u in users:
        drafts = u.drafts  # relationship; small user base, N+1 is fine here
        image_count = sum(_count_draft_images(d) for d in drafts)
        out.append(schemas.AdminUserResponse(
            id=u.id,
            email=u.email,
            created_at=u.created_at,
            is_admin=u.is_admin,
            is_blocked=bool(getattr(u, "is_blocked", False)),
            draft_count=len(drafts),
            image_count=image_count,
            est_cost_eur=round(image_count * EST_COST_PER_IMAGE_EUR, 4),
        ))
    return out


@app.post("/api/admin/users/{user_id}/block", response_model=schemas.AdminUserResponse)
def admin_block_user(
    user_id: int,
    req: schemas.UserBlockRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Admin-only: suspend or re-activate a user account."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Du kannst dein eigenes Konto nicht sperren.")
    if target.is_admin and req.blocked:
        raise HTTPException(status_code=400, detail="Admin-Konten können nicht gesperrt werden.")

    target.is_blocked = req.blocked
    db.commit()
    db.refresh(target)

    drafts = target.drafts
    image_count = sum(_count_draft_images(d) for d in drafts)
    return schemas.AdminUserResponse(
        id=target.id, email=target.email, created_at=target.created_at,
        is_admin=target.is_admin, is_blocked=bool(target.is_blocked),
        draft_count=len(drafts), image_count=image_count,
        est_cost_eur=round(image_count * EST_COST_PER_IMAGE_EUR, 4),
    )


@app.delete("/api/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Admin-only: permanently delete a user and all their drafts (cascade)."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Du kannst dein eigenes Konto nicht löschen.")
    if target.is_admin:
        raise HTTPException(status_code=400, detail="Admin-Konten können nicht gelöscht werden.")

    db.delete(target)   # User.drafts cascade="all, delete-orphan" removes drafts
    db.commit()
    return None


@app.get("/api/bugs", response_model=List[schemas.BugReportResponse])
def get_bug_reports(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Keine Berechtigung für diese Ressource."
        )
    return db.query(models.BugReport).order_by(models.BugReport.created_at.desc()).all()

@app.delete("/api/bugs/{bug_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bug_report(
    bug_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Keine Berechtigung für diese Ressource."
        )
    db_bug = db.query(models.BugReport).filter(models.BugReport.id == bug_id).first()
    if not db_bug:
        raise HTTPException(status_code=404, detail="Bug Report wurde nicht gefunden.")
    
    if db_bug.screenshot_path:
        local_path = os.path.join(UPLOAD_DIR, os.path.basename(db_bug.screenshot_path))
        if os.path.exists(local_path):
            try:
                os.remove(local_path)
            except Exception as e:
                print(f"Error removing bug screenshot {local_path}: {e}", flush=True)

    db.delete(db_bug)
    db.commit()
    return {"detail": "Bug Report gelöscht"}

