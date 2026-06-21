from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, status, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import os
import shutil
import uuid
import json
from typing import List
from concurrent.futures import ThreadPoolExecutor, as_completed

import models
import schemas
from database import engine, get_db
from services.gemini_service import analyze_item_image, group_images_by_offer
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

    # User settings migrations
    for col_name, col_type in [
        ("ai_tone", "VARCHAR(50) DEFAULT 'locker'"),
        ("ai_custom_tone", "VARCHAR(500)"),
        ("ai_custom_footer", "VARCHAR(500)"),
        ("pricing_offset", "FLOAT DEFAULT 0.0"),
        ("default_zip", "VARCHAR(20)"),
        ("default_city", "VARCHAR(100)"),
        ("default_category", "VARCHAR(100)"),
        ("default_shipping", "VARCHAR(200)"),
        ("auto_submit", "BOOLEAN DEFAULT 0")
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

app = FastAPI(title="Vintamie API", version="2.4.4")

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
                print(f"Vintamie Turbo: Analyse von Gruppe {idx} fehlgeschlagen: {e}", flush=True)
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
APK_FILENAME = "vintamie-latest.apk"

@app.get("/api/app/version")
def get_app_version():
    version_path = os.path.join(APK_DIR, "apk-version.txt")
    if os.path.exists(version_path):
        try:
            with open(version_path, "r") as f:
                stored_version = f.read().strip()
                if stored_version:
                    return {"version": stored_version}
        except Exception:
            pass
    return {"version": app.version}

@app.get("/api/app/latest-apk")
def download_latest_apk():
    apk_path = os.path.join(APK_DIR, APK_FILENAME)
    if not os.path.exists(apk_path):
        raise HTTPException(status_code=404, detail="APK-Datei wurde noch nicht generiert. Bitte starte ein Build.")
    return FileResponse(
        apk_path, 
        media_type="application/vnd.android.package-archive", 
        filename="vintamie-latest.apk"
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

