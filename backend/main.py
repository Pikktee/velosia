from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, status, Form, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import os
import re
import json
import time
import asyncio
import base64
import binascii
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

import models
import schemas
import rate_limit
import signed_urls
import image_store
from database import engine, get_db
from services.gemini_service import analyze_item_image, group_images_by_offer
from services.notifications import send_email
from auth_utils import (
    verify_password, get_password_hash, decode_access_token, create_user_token,
    create_platform_token, decode_platform_token, DUMMY_PASSWORD_HASH,
    ACCESS_TOKEN_EXPIRE_MINUTES, PLATFORM_TOKEN_TTL_MIN,
)
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from sqlalchemy import text, func, update, or_
from dataclasses import dataclass

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
        db.execute(text("ALTER TABLE drafts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE"))
        db.commit()
        print("Successfully ran migrations: added user_id column to drafts.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"Migration note: user_id column might already exist. ({e})", flush=True)

    try:
        db.execute(text("ALTER TABLE drafts ADD COLUMN sources VARCHAR"))
        db.commit()
        print("Successfully ran migrations: added sources column to drafts.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"Migration note: sources column might already exist. ({e})", flush=True)

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
        ("is_blocked", "BOOLEAN DEFAULT 0"),
        # Rolling 24h AI image quota (cost control, added V2.7.39)
        ("ai_images_used", "INTEGER DEFAULT 0"),
        ("ai_quota_reset_at", "DATETIME"),
        # Token generation (see models.User.token_version)
        ("token_version", "INTEGER DEFAULT 0"),
    ]:
        try:
            db.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
            db.commit()
            print(f"Successfully ran migrations: added {col_name} column.", flush=True)
        except Exception as e:
            db.rollback()
            print(f"Migration note: {col_name} column might already exist. ({e})", flush=True)

    # Per-attribute telemetry columns (added V2.7.18) — let the anomaly monitor
    # watch the fragile React attribute pickers (Zustand/Größe/Farbe/Material/Marke),
    # not just the core text fields + category.
    for col_name in ("condition_ok", "size_ok", "color_ok", "material_ok", "brand_ok"):
        try:
            db.execute(text(f"ALTER TABLE autofill_events ADD COLUMN {col_name} BOOLEAN"))
            db.commit()
            print(f"Successfully ran migrations: added {col_name} column to autofill_events.", flush=True)
        except Exception as e:
            db.rollback()
            print(f"Migration note: {col_name} column might already exist. ({e})", flush=True)

    # E-mail addresses are compared case-insensitively since 2.7.51. Older rows
    # were stored as typed, so two accounts may differ only in case. They are
    # NOT merged or renamed automatically (that could hand one person's data to
    # another) — just reported here for a manual decision.
    try:
        dupes = db.execute(text(
            "SELECT lower(email) AS e, COUNT(*) AS n, GROUP_CONCAT(id) AS ids "
            "FROM users GROUP BY lower(email) HAVING COUNT(*) > 1"
        )).fetchall()
        for row in dupes:
            print(f"[accounts] WARNUNG: {row.n} Konten mit gleicher E-Mail (Groß/Klein) — IDs {row.ids}", flush=True)
        mixed = db.execute(text("SELECT COUNT(*) FROM users WHERE email != lower(trim(email))")).scalar()
        if mixed:
            print(f"[accounts] Hinweis: {mixed} Konten mit nicht normalisierter E-Mail (Groß/Klein/Leerzeichen).", flush=True)
    except Exception as e:
        db.rollback()
        print(f"[accounts] Duplikat-Prüfung fehlgeschlagen: {e}", flush=True)

    db.close()

run_migrations()

# Interactive API docs only where explicitly enabled (local development).
_API_DOCS = os.getenv("ENABLE_API_DOCS", "").lower() in ("1", "true", "yes")
app = FastAPI(
    title="Velosia API",
    version="2.7.51",
    docs_url="/docs" if _API_DOCS else None,
    redoc_url="/redoc" if _API_DOCS else None,
    openapi_url="/openapi.json" if _API_DOCS else None,
)

UPLOAD_DIR = "/data/uploads" if os.path.isdir("/data") else "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _remove_upload_files(paths) -> None:
    """Delete stored upload files by their /uploads/... path. Best-effort."""
    for path in paths:
        if not path or not isinstance(path, str):
            continue
        local = os.path.join(UPLOAD_DIR, os.path.basename(path.split("?", 1)[0]))
        if os.path.isfile(local):
            try:
                os.remove(local)
            except Exception as e:
                print(f"Error removing upload file {local}: {e}", flush=True)


def _cleanup_orphaned_user_rows():
    """Remove rows still pointing at users that no longer exist.

    SQLite does not enforce the ON DELETE rules declared on these foreign keys
    (PRAGMA foreign_keys is off), so earlier account deletions left bug reports
    and telemetry rows behind. Since ids can be reused, they would otherwise
    attach to a future account. Idempotent; a no-op once clean."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        orphan_bugs = db.execute(text(
            "SELECT id, screenshot_path FROM bug_reports "
            "WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)"
        )).fetchall()
        if orphan_bugs:
            db.execute(text(
                "DELETE FROM bug_reports "
                "WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)"
            ))
        events = db.execute(text(
            "UPDATE autofill_events SET user_id = NULL "
            "WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)"
        )).rowcount
        db.commit()
        _remove_upload_files([row.screenshot_path for row in orphan_bugs])
        if orphan_bugs or events:
            print(f"[cleanup] {len(orphan_bugs)} verwaiste Fehlerberichte entfernt, "
                  f"{events} Telemetrie-Einträge vom gelöschten Konto gelöst.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"[cleanup] Aufräumen verwaister Datensätze fehlgeschlagen: {e}", flush=True)
    finally:
        db.close()


_cleanup_orphaned_user_rows()

# Photos stored before uploads were re-encoded may still carry camera metadata
# (EXIF/GPS). Cleaned once in the background; see image_store.
image_store.start_sanitize_existing_uploads(UPLOAD_DIR)


# --- Request body limits -------------------------------------------------------
# Upper bound per request before anything is parsed. Individual photos are
# additionally limited in image_store (MAX_UPLOAD_BYTES per file).
_MULTIPART_BODY_LIMIT = int(os.getenv("MAX_MULTIPART_BODY_MB", "300")) * 1024 * 1024
_BUG_BODY_LIMIT = 18 * 1024 * 1024        # JSON with a base64 screenshot
_DEFAULT_BODY_LIMIT = 256 * 1024          # every other JSON body
_MULTIPART_PATHS = re.compile(r"^/api/(upload|upload/turbo|drafts/\d+/images)$")


def _body_limit(path: str) -> int:
    if _MULTIPART_PATHS.match(path):
        return _MULTIPART_BODY_LIMIT
    if path == "/api/bugs":
        return _BUG_BODY_LIMIT
    return _DEFAULT_BODY_LIMIT


def _body_too_large() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail="Die Anfrage ist zu groß.",
    )


class BodySizeLimitMiddleware:
    """Rejects bodies over the route's limit: up front via Content-Length, and
    while streaming for chunked requests (the overflowing read raises 413)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        limit = _body_limit(scope.get("path", ""))
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    too_large = int(value) > limit
                except ValueError:
                    too_large = True
                if too_large:
                    response = JSONResponse({"detail": _body_too_large().detail}, status_code=413)
                    return await response(scope, receive, send)
                break

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _body_too_large()
            return message

        return await self.app(scope, limited_receive, send)


# --- Response headers ----------------------------------------------------------
_JSON_CSP = "default-src 'none'; frame-ancestors 'none'"


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                present = {k.lower() for k, _ in headers}

                def add(name: bytes, value: str):
                    if name not in present:
                        headers.append((name, value.encode()))

                add(b"x-app-version", app.version)
                add(b"x-content-type-options", "nosniff")
                add(b"strict-transport-security", "max-age=31536000")
                add(b"referrer-policy", "no-referrer")
                ctype = next((v for k, v in headers if k.lower() == b"content-type"), b"")
                if ctype.startswith(b"application/json"):
                    add(b"content-security-policy", _JSON_CSP)
            await send(message)

        return await self.app(scope, receive, send_with_headers)


# --- CORS ------------------------------------------------------------------------
# Bearer tokens only, no cookies -> allow_credentials stays False.
# Origins that call the API with fetch():
#   * the web frontend (also what the Android app shows), local dev servers and
#     the Android emulator,
#   * the browser extension's own pages (popup, camera frame),
#   * vinted.* / kleinanzeigen.de pages — the extension's content scripts and the
#     autofill engine run there (their requests carry the page's origin). Those
#     origins may only reach the handful of endpoints the autofill flow uses.
_APP_ORIGIN_REGEX = (
    r"https://velosia\.henrikheil\.net"
    r"|http://(?:localhost|127\.0\.0\.1|10\.0\.2\.2|(?:[a-z0-9-]+\.)+localhost)(?::\d{1,5})?"
    r"|chrome-extension://[a-p]{32}"
    r"|moz-extension://[0-9a-fA-F-]{36}"
)
_PLATFORM_ORIGIN_REGEX = r"https://(?:[a-z0-9-]+\.)*(?:vinted\.de|vinted\.fr|kleinanzeigen\.de)"
_PLATFORM_CORS_PATHS = re.compile(
    r"^/(?:api/auth/me|api/drafts(?:/\d+)?|api/listings/published"
    r"|api/telemetry/(?:autofill|debug)|uploads/[^/]+)$"
)
_EXTRA_ORIGINS = [o.strip() for o in os.getenv("CORS_EXTRA_ORIGINS", "").split(",") if o.strip()]
_CORS_COMMON = dict(
    allow_origins=_EXTRA_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Velosia-Client"],
    expose_headers=["X-App-Version"],
    max_age=600,
)


class PlatformAwareCORS:
    def __init__(self, app):
        self.with_platforms = CORSMiddleware(
            app, allow_origin_regex=f"(?:{_APP_ORIGIN_REGEX})|(?:{_PLATFORM_ORIGIN_REGEX})", **_CORS_COMMON
        )
        self.app_only = CORSMiddleware(app, allow_origin_regex=_APP_ORIGIN_REGEX, **_CORS_COMMON)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and _PLATFORM_CORS_PATHS.match(scope.get("path", "")):
            return await self.with_platforms(scope, receive, send)
        return await self.app_only(scope, receive, send)


# Added innermost first: CORS wraps everything, so error responses (413, 429 …)
# are readable by the browser too.
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(PlatformAwareCORS)


# Stored files are served with a fixed type per extension, never guessed from
# the content, and inside a sandbox so a file can't act as a page of this origin.
_UPLOAD_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


# Uploaded photos are served through a signature check rather than a bare
# StaticFiles mount, which handed every image to anyone who had the URL — bug
# report screenshots included. See signed_urls.py for why signed URLs and not an
# Authorization header (none of the three clients can send one for images).
@app.get("/uploads/{filename}")
def serve_upload(
    filename: str,
    e: Optional[str] = None,
    s: Optional[str] = None,
):
    # Never let a crafted name escape the upload directory.
    safe_name = os.path.basename(filename)
    if not safe_name or safe_name != filename:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")

    # Access is granted by the URL signature only. Every client receives signed
    # paths in the API responses, so no other credential is needed here.
    authorized = signed_urls.PUBLIC or signed_urls.verify(safe_name, e, s)
    if not authorized:
        raise HTTPException(status_code=403, detail="Kein Zugriff auf diese Datei.")

    file_path = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")

    # Filenames are UUIDs and their content never changes, so let clients cache
    # aggressively; the day-rounded expiry keeps the URL stable enough to hit.
    headers = {
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
    }
    media_type = _UPLOAD_MEDIA_TYPES.get(os.path.splitext(safe_name)[1].lower())
    if media_type is None:
        # Older files kept the client's extension (or none). Serve them as a photo
        # only if the content is one; anything else is never rendered.
        media_type = _sniff_image_type(file_path)
    if media_type is None:
        media_type = "application/octet-stream"
        headers["Content-Disposition"] = "attachment"
    return FileResponse(file_path, media_type=media_type, headers=headers)


def _sniff_image_type(path: str) -> Optional[str]:
    """Photo type from the file's leading bytes (JPEG/PNG/WebP), else None."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(12)
    except OSError:
        return None
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


# Auth token extractor
security = HTTPBearer()

_SESSION_INVALID = "Ungültige oder abgelaufene Sitzung. Bitte erneut anmelden."


def _auth_error(detail: str = _SESSION_INVALID) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _blocked_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Dieses Konto wurde gesperrt.")


def normalize_email(email: Optional[str]) -> str:
    """Canonical form of an e-mail address for storage and comparison."""
    return (email or "").strip().lower()


def _users_by_email(db: Session, email: Optional[str]) -> list:
    """Accounts whose address equals `email` ignoring case and surrounding
    whitespace — the exact (normalized) match first, then oldest first. Older
    rows were stored as typed, so more than one can exist."""
    norm = normalize_email(email)
    if not norm:
        return []
    users = (
        db.query(models.User)
        .filter(func.lower(func.trim(models.User.email)) == norm)
        .order_by(models.User.id)
        .all()
    )
    users.sort(key=lambda u: 0 if u.email == norm else 1)
    return users


# Tolerance between account creation and token issue time (`iat` is whole seconds).
_ISSUE_SLACK = timedelta(seconds=2)


def _issued_at(payload: dict) -> Optional[datetime]:
    """Token issue time as naive UTC (the convention of the created_at columns)."""
    iat = payload.get("iat")
    if isinstance(iat, (int, float)):
        return datetime.fromtimestamp(iat, timezone.utc).replace(tzinfo=None)
    exp = payload.get("exp")
    if isinstance(exp, (int, float)):
        # Tokens issued before 2.7.51 carry no `iat`; derive it from the fixed lifetime.
        return (datetime.fromtimestamp(exp, timezone.utc).replace(tzinfo=None)
                - timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    return None


def _issued_before_account(payload: dict, user: models.User) -> bool:
    """True if the token predates the account it resolves to — i.e. it was
    issued to an earlier, since deleted account with the same id or e-mail."""
    if not user.created_at:
        return False
    issued = _issued_at(payload)
    return issued is None or issued < user.created_at - _ISSUE_SLACK


def _user_from_access_token(token: str, db: Session) -> models.User:
    payload = decode_access_token(token)
    if not payload:
        raise _auth_error()

    uid = payload.get("uid")
    if uid is not None:
        if not isinstance(uid, int):
            raise _auth_error()
        user = db.get(models.User, uid)
        if (
            not user
            or payload.get("ver") != int(user.token_version or 0)
            or payload.get("sub") != user.email
        ):
            raise _auth_error()
    else:
        # Tokens issued before 2.7.51 only carry the e-mail (`sub`). They stay
        # valid until they expire, unless the account's tokens were revoked since
        # (token_version > 0). Matched exactly as issued, never case-insensitively.
        email = payload.get("sub")
        if not email or not isinstance(email, str):
            raise _auth_error("Sitzungsdaten ungültig.")
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user or int(user.token_version or 0) != 0:
            raise _auth_error()

    if _issued_before_account(payload, user):
        raise _auth_error()
    if getattr(user, "is_blocked", False):
        raise _blocked_error()
    return user


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> models.User:
    return _user_from_access_token(credentials.credentials, db)


@dataclass
class Principal:
    """Caller of an endpoint usable from the platform WebView. `draft_id` is set
    when the caller holds a draft-scoped platform token instead of a session
    token: it may then only touch that one draft."""
    user: models.User
    draft_id: Optional[int] = None

    @property
    def is_platform(self) -> bool:
        return self.draft_id is not None

    def may_access_draft(self, draft_id: int) -> bool:
        return self.draft_id is None or self.draft_id == draft_id


def get_platform_principal(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> Principal:
    """Session token OR platform token (see POST /api/drafts/{id}/platform-token).
    Only for the endpoints the autofill flow on Vinted/Kleinanzeigen calls:
    GET /api/auth/me, GET /api/drafts/{id}, POST /api/listings/published and
    POST /api/telemetry/autofill. Everything else requires a session token."""
    token = credentials.credentials
    claims = decode_platform_token(token)
    if claims:
        user = db.get(models.User, claims["uid"])
        if (
            not user
            or claims.get("ver") != int(user.token_version or 0)
            or _issued_before_account(claims, user)
        ):
            raise _auth_error()
        if getattr(user, "is_blocked", False):
            raise _blocked_error()
        return Principal(user=user, draft_id=claims["did"])
    return Principal(user=_user_from_access_token(token, db))


def _token_response(user: models.User) -> dict:
    return {"access_token": create_user_token(user), "token_type": "bearer"}


def _draft_files(draft: models.Draft) -> list:
    paths = list(_draft_image_paths(draft))
    if draft.image_path and draft.image_path not in paths:
        paths.append(draft.image_path)
    return paths


def purge_user(db: Session, user: models.User) -> None:
    """Delete an account and everything tied to it: drafts and their photos,
    bug reports and their screenshots, the waitlist entry. Telemetry rows are
    kept for the health monitor but detached from the account."""
    files = []
    for draft in user.drafts:
        files.extend(_draft_files(draft))

    bugs = db.query(models.BugReport).filter(models.BugReport.user_id == user.id).all()
    for bug in bugs:
        if bug.screenshot_path:
            files.append(bug.screenshot_path)
        db.delete(bug)

    db.query(models.AutofillEvent).filter(models.AutofillEvent.user_id == user.id).update(
        {models.AutofillEvent.user_id: None}, synchronize_session=False
    )
    email = normalize_email(user.email)
    if email:
        db.query(models.WaitlistEntry).filter(
            func.lower(func.trim(models.WaitlistEntry.email)) == email
        ).delete(synchronize_session=False)

    db.delete(user)  # User.drafts cascade="all, delete-orphan" removes the drafts
    db.commit()

    # Files last: if the commit failed, the account (and its photos) still exist.
    _remove_upload_files(files)


# --- AUTH ENDPOINTS ---

@app.post("/api/auth/register", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
def register(request: Request, user_in: schemas.UserRegister, db: Session = Depends(get_db)):
    # Every registration costs us storage + an AI quota; cap how fast one source
    # can create accounts.
    rate_limit.enforce(
        "register", rate_limit.client_ip(request), rate_limit.REGISTER_IP,
        "Zu viele Registrierungen von dieser Verbindung. Bitte versuche es später erneut.",
    )

    email = normalize_email(user_in.email)
    taken = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Diese E-Mail-Adresse wird bereits verwendet."
    )
    if _users_by_email(db, email):
        raise taken

    hashed_pwd = get_password_hash(user_in.password)
    db_user = models.User(
        email=email,
        hashed_password=hashed_pwd
    )
    db.add(db_user)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise taken
    db.refresh(db_user)
    return db_user

@app.post("/api/auth/login", response_model=schemas.Token)
def login(request: Request, user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    # Brute-force protection. Only FAILED attempts are counted (see rate_limit),
    # so someone logging in repeatedly on purpose is never locked out. Three keys:
    # the IP (one attacker, many accounts), the account from this IP (hard stop)
    # and the account across all IPs (higher, so strangers can't lock it).
    ip = rate_limit.client_ip(request)
    account = normalize_email(user_in.email)
    account_ip = f"{account}|{ip}"
    too_many = "Zu viele fehlgeschlagene Anmeldeversuche. Bitte warte einen Moment."
    rate_limit.check("login_ip", ip, rate_limit.LOGIN_IP, too_many)
    rate_limit.check("login_account_ip", account_ip, rate_limit.LOGIN_ACCOUNT_IP, too_many)
    rate_limit.check("login_account", account, rate_limit.LOGIN_ACCOUNT, too_many)

    # Older rows may differ only in case; try each (exact match first). A miss
    # still runs one bcrypt check so response time doesn't reveal the account.
    candidates = _users_by_email(db, account)[:3]
    db_user = None
    if not candidates:
        verify_password(user_in.password, DUMMY_PASSWORD_HASH)
    for candidate in candidates:
        if verify_password(user_in.password, candidate.hashed_password):
            db_user = candidate
            break
    if not db_user:
        rate_limit.record("login_ip", ip)
        rate_limit.record("login_account_ip", account_ip)
        rate_limit.record("login_account", account)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ungültige E-Mail-Adresse oder Passwort."
        )
    if getattr(db_user, "is_blocked", False):
        raise _blocked_error()

    # Correct credentials: forget this account's failure history so a later typo
    # streak starts from zero.
    rate_limit.reset("login_account_ip", account_ip)
    rate_limit.reset("login_account", account)

    return _token_response(db_user)

@app.get("/api/auth/me", response_model=None)
def get_me(principal: Principal = Depends(get_platform_principal)):
    # A platform token only learns what the autofill needs (postcode prefill and
    # the auto-publish setting), not the profile.
    if principal.is_platform:
        return schemas.PlatformProfileResponse.model_validate(principal.user)
    return schemas.UserResponse.model_validate(principal.user)

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
    purge_user(db, current_user)
    return None

# Setting a password needs a recent sign-in, not just any valid session token.
_FRESH_LOGIN_MAX_AGE = timedelta(minutes=15)


@app.post("/api/auth/set-password", response_model=schemas.Token)
def set_password(
    payload: schemas.PasswordSet,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    """Set (or replace) the account password, e.g. after the account was linked
    to Google, so the e-mail/password login (browser extension) works again.

    Requires a session token issued within the last 15 minutes. All earlier
    tokens are revoked; the response carries a fresh one for this session."""
    current_user = _user_from_access_token(credentials.credentials, db)
    rate_limit.enforce(
        "set_password", str(current_user.id), rate_limit.SET_PASSWORD_USER,
        "Zu viele Versuche. Bitte warte einen Moment.",
    )
    issued = _issued_at(decode_access_token(credentials.credentials) or {})
    if issued is None or datetime.utcnow() - issued > _FRESH_LOGIN_MAX_AGE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bitte melde dich neu an und lege das Passwort direkt danach fest.",
        )
    current_user.hashed_password = get_password_hash(payload.password)
    current_user.token_version = int(current_user.token_version or 0) + 1
    db.commit()
    db.refresh(current_user)
    return _token_response(current_user)


@app.get("/api/auth/config")
def get_auth_config():
    return {
        "google_client_id": os.getenv("GOOGLE_CLIENT_ID", "")
    }

@app.post("/api/auth/google", response_model=schemas.Token)
def login_google(request: Request, login_in: schemas.GoogleLogin, db: Session = Depends(get_db)):
    # Each call verifies a token against Google and may create an account.
    rate_limit.enforce(
        "login_google", rate_limit.client_ip(request), rate_limit.GOOGLE_IP,
        "Zu viele Anmeldeversuche. Bitte warte einen Moment.",
    )

    credential = login_in.credential
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google Client ID ist auf dem Server nicht konfiguriert."
        )

    try:
        idinfo = id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
    except ValueError as e:
        print(f"[auth] Google-Token abgelehnt: {e}", flush=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Die Google-Anmeldung konnte nicht bestätigt werden. Bitte versuche es erneut."
        )

    google_id = idinfo.get("sub")
    email = normalize_email(idinfo.get("email"))
    if not email or not google_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google-Konto stellt keine E-Mail-Adresse zur Verfügung."
        )
    # Only an address Google has verified identifies its owner.
    if idinfo.get("email_verified") not in (True, "true", "True"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Die E-Mail-Adresse dieses Google-Kontos ist nicht bestätigt."
        )
    google_id = str(google_id)

    db_user = db.query(models.User).filter(models.User.google_id == google_id).first()
    if not db_user:
        candidates = _users_by_email(db, email)
        db_user = candidates[0] if candidates else None
        if db_user:
            if getattr(db_user, "is_blocked", False):
                raise _blocked_error()
            # Linking an existing account to this Google identity. The verified
            # owner of the address takes the account over: the password (which
            # anyone could have set when registering the address) is replaced and
            # every token issued so far is revoked.
            db_user.google_id = google_id
            db_user.hashed_password = get_password_hash(secrets.token_urlsafe(32))
            db_user.token_version = int(db_user.token_version or 0) + 1
            db.commit()
            db.refresh(db_user)
        else:
            db_user = models.User(
                email=email,
                hashed_password=get_password_hash(secrets.token_urlsafe(32)),
                google_id=google_id
            )
            db.add(db_user)
            try:
                db.commit()
            except Exception:
                # Concurrent first login with the same Google account.
                db.rollback()
                db_user = db.query(models.User).filter(models.User.google_id == google_id).first()
                if not db_user:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Anmeldung fehlgeschlagen. Bitte erneut versuchen.")
            db.refresh(db_user)

    if getattr(db_user, "is_blocked", False):
        raise _blocked_error()

    return _token_response(db_user)


# --- DRAFT ENDPOINTS (SECURED) ---

from typing import Optional, List
import json

# --- AI usage quota (cost control) -------------------------------------------
# Every image sent to Gemini costs real money and nothing else caps it: one
# account could otherwise loop /api/upload and run up an unbounded bill. The
# quota is a rolling 24h window per user, counted in images (the unit the cost
# estimate in the admin panel already uses). 0 disables it.
DAILY_IMAGE_QUOTA = int(os.getenv("DAILY_IMAGE_QUOTA", "150"))
# Storage guard: /api/drafts/{id}/images runs no AI, so the quota doesn't apply,
# but it would otherwise accept unlimited photos onto the volume.
MAX_IMAGES_PER_DRAFT = int(os.getenv("MAX_IMAGES_PER_DRAFT", "24"))


def _draft_image_paths(draft: models.Draft) -> list:
    """The draft's stored (raw, unsigned) photo paths, in order."""
    if draft.image_paths:
        try:
            paths = json.loads(draft.image_paths)
            if isinstance(paths, list):
                return paths
        except Exception:
            pass
    return [draft.image_path] if draft.image_path else []


def _strip_signatures_in_json_list(raw: str) -> str:
    """Remove URL signatures from a JSON list of upload paths (see signed_urls)."""
    try:
        paths = json.loads(raw)
    except Exception:
        return raw
    if not isinstance(paths, list):
        return raw
    return json.dumps([signed_urls.strip_signature(p) for p in paths])


# Gemini billing/quota failures ("prepayment credits are depleted" comes back as
# 402/429 RESOURCE_EXHAUSTED). Users can't fix these and must not see provider
# internals; the maintainer gets one e-mail per cooldown window instead.
_AI_BILLING_MARKERS = ("credits are depleted", "exhausted", "quota", "billing")
_AI_ALERT_COOLDOWN_H = 6


def ai_failure(db: Session, err: Exception, action: str) -> HTTPException:
    """Log the technical AI error and turn it into a user-facing 502 with a
    plain-language message. Billing/quota problems also alert the maintainer."""
    raw = str(err)
    print(f"Velosia: {action} fehlgeschlagen: {raw}", flush=True)
    if any(m in raw.lower() for m in _AI_BILLING_MARKERS):
        signal = "gemini:billing"
        last = (
            db.query(models.AlertLog)
            .filter(models.AlertLog.signal == signal)
            .order_by(models.AlertLog.created_at.desc())
            .first()
        )
        if not last or (datetime.utcnow() - last.created_at) >= timedelta(hours=_AI_ALERT_COOLDOWN_H):
            db.add(models.AlertLog(signal=signal, detail=raw[:500]))
            db.commit()
            send_email(
                "⚠️ Velosia: KI-Analysen schlagen fehl (Guthaben/Kontingent)",
                f"Gemini lehnt Anfragen ab — vermutlich ist das Prepaid-Guthaben in AI Studio "
                f"aufgebraucht oder ein Kontingent erschöpft.\n\nAktion: {action}\nFehler: {raw}\n\n"
                f"Aufladen: https://ai.studio/projects",
            )
        detail = "Die KI-Analyse ist gerade nicht verfügbar. Wir kümmern uns darum – bitte versuche es später noch einmal."
    else:
        detail = "Deine Fotos konnten gerade nicht analysiert werden. Bitte versuche es gleich noch einmal."
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)


# Most photos a single request may carry. Vinted and Kleinanzeigen accept at
# most 20 photos per listing; Turbo groups a whole batch into several drafts.
MAX_FILES_UPLOAD = int(os.getenv("MAX_FILES_UPLOAD", "20"))
MAX_FILES_TURBO = int(os.getenv("MAX_FILES_TURBO", "40"))
# Optional ceiling on AI images across ALL users per rolling day (0 = off) — a
# last line of defence for the bill if many accounts are abused at once.
GLOBAL_DAILY_IMAGE_CAP = int(os.getenv("GLOBAL_DAILY_IMAGE_CAP", "0"))


def _quota_exceeded(user: models.User, images: int, now: datetime) -> HTTPException:
    used = user.ai_images_used or 0
    reset_at = user.ai_quota_reset_at or (now + timedelta(hours=24))
    hours = max(1, round((reset_at - now).total_seconds() / 3600))
    remaining = max(0, DAILY_IMAGE_QUOTA - used)
    if remaining == 0:
        detail = (
            f"Dein Tageslimit für KI-Analysen ist aufgebraucht "
            f"({DAILY_IMAGE_QUOTA} Bilder). Es wird in ca. {hours} Std. zurückgesetzt."
        )
    else:
        # Enough quota left for *some* images, just not this many — say so,
        # otherwise "0 von N" reads like a bug to someone who has used none.
        detail = (
            f"Heute sind noch {remaining} von {DAILY_IMAGE_QUOTA} KI-Analysen frei, "
            f"diese Anfrage benötigt {images} Bilder. "
            f"Das Limit wird in ca. {hours} Std. zurückgesetzt."
        )
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=detail,
        headers={"Retry-After": str(max(1, int((reset_at - now).total_seconds())))},
    )


def _quota_applies(user: models.User, images: int) -> bool:
    return images > 0 and DAILY_IMAGE_QUOTA > 0 and not user.is_admin


def check_ai_quota(user: models.User, images: int) -> None:
    """Cheap pre-check (no write) so an exhausted quota is reported before the
    photos are processed. consume_ai_quota() is the authoritative step."""
    if not _quota_applies(user, images):
        return
    now = datetime.utcnow()
    reset_at = user.ai_quota_reset_at
    used = 0 if (reset_at is None or reset_at <= now) else (user.ai_images_used or 0)
    if used + images > DAILY_IMAGE_QUOTA:
        raise _quota_exceeded(user, images, now)


def _check_global_cap(db: Session, images: int, now: datetime) -> None:
    if GLOBAL_DAILY_IMAGE_CAP <= 0:
        return
    total = db.query(func.coalesce(func.sum(models.User.ai_images_used), 0)).filter(
        models.User.ai_quota_reset_at > now
    ).scalar() or 0
    if total + images > GLOBAL_DAILY_IMAGE_CAP:
        _alert_once(
            db, "ai:global-cap", 6,
            "⚠️ Velosia: globales KI-Tageslimit erreicht",
            f"In den letzten 24 h wurden {total} Bilder analysiert (Grenze GLOBAL_DAILY_IMAGE_CAP="
            f"{GLOBAL_DAILY_IMAGE_CAP}). Neue KI-Analysen werden abgelehnt, bis das Fenster abläuft.",
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Die KI-Analyse ist gerade stark ausgelastet. Bitte versuche es später noch einmal.",
        )


def consume_ai_quota(db: Session, user: models.User, images: int) -> None:
    """Charge `images` against the user's rolling 24h AI quota, or raise 429.

    Called BEFORE the Gemini request. A failed analysis still consumes the
    quota — by then the API call has usually already been billed, and a cost
    guard that refunds on error is trivially farmable.

    The charge is a single conditional UPDATE, so parallel requests can't each
    pass a stale read and together exceed the quota.
    """
    if not _quota_applies(user, images):
        return

    now = datetime.utcnow()
    _check_global_cap(db, images, now)
    # Open a new window if the previous one has run out.
    db.execute(
        update(models.User)
        .where(
            models.User.id == user.id,
            or_(models.User.ai_quota_reset_at.is_(None), models.User.ai_quota_reset_at <= now),
        )
        .values(ai_images_used=0, ai_quota_reset_at=now + timedelta(hours=24))
        .execution_options(synchronize_session=False)
    )
    used = func.coalesce(models.User.ai_images_used, 0)
    charged = db.execute(
        update(models.User)
        .where(models.User.id == user.id, used + images <= DAILY_IMAGE_QUOTA)
        .values(ai_images_used=used + images)
        .execution_options(synchronize_session=False)
    ).rowcount
    db.commit()
    db.refresh(user)
    if not charged:
        raise _quota_exceeded(user, images, now)


def _alert_once(db: Session, signal: str, cooldown_h: float, subject: str, body: str) -> None:
    """E-mail the maintainer about `signal` at most once per cooldown window."""
    try:
        last = (
            db.query(models.AlertLog)
            .filter(models.AlertLog.signal == signal)
            .order_by(models.AlertLog.created_at.desc())
            .first()
        )
        if last and (datetime.utcnow() - last.created_at) < timedelta(hours=cooldown_h):
            return
        db.add(models.AlertLog(signal=signal, detail=body[:500]))
        db.commit()
        send_email(subject, body)
    except Exception as e:
        db.rollback()
        print(f"[alert] {signal} konnte nicht gemeldet werden: {e}", flush=True)


def _ensure_disk_space(db: Session) -> None:
    """507 instead of filling the volume to the brim (the SQLite DB lives there too)."""
    if image_store.disk_space_ok(UPLOAD_DIR):
        return
    _alert_once(
        db, "disk:low", 6,
        "⚠️ Velosia: Speicherplatz auf dem Volume fast voll",
        f"Auf dem Upload-Volume sind weniger als {image_store.MIN_FREE_BYTES // (1024 * 1024)} MB frei. "
        f"Neue Foto-Uploads werden abgelehnt, bis Platz geschaffen ist.",
    )
    raise HTTPException(
        status_code=507,
        detail="Fotos können gerade nicht gespeichert werden. Bitte versuche es später noch einmal.",
    )


def _remove_local_files(paths) -> None:
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


def _check_file_count(files: list, maximum: int) -> None:
    if not files:
        raise HTTPException(status_code=400, detail="Es wurden keine Bilder hochgeladen.")
    if maximum > 0 and len(files) > maximum:
        raise HTTPException(
            status_code=400,
            detail=f"Bitte höchstens {maximum} Fotos auf einmal hochladen.",
        )


def _store_uploads(files: List[UploadFile]):
    """Validate and store all photos of one request (all or nothing).
    Returns (/uploads/... paths, local paths)."""
    saved_paths, local_paths = [], []
    try:
        for f in files:
            web_path, local_path = image_store.store_upload(f, UPLOAD_DIR)
            saved_paths.append(web_path)
            local_paths.append(local_path)
    except Exception:
        _remove_local_files(local_paths)
        raise
    return saved_paths, local_paths


@app.post("/api/upload", response_model=schemas.DraftResponse, status_code=status.HTTP_201_CREATED)
def upload_and_analyze(
    file: Optional[UploadFile] = File(None), 
    files: Optional[List[UploadFile]] = File(None),
    condition: Optional[str] = Form(None, max_length=50),
    details: Optional[str] = Form(None, max_length=1000),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    uploaded_files = []
    if files:
        uploaded_files = files
    elif file:
        uploaded_files = [file]

    _check_file_count(uploaded_files, MAX_FILES_UPLOAD)
    check_ai_quota(current_user, len(uploaded_files))
    _ensure_disk_space(db)

    saved_paths, local_paths = _store_uploads(uploaded_files)
    try:
        consume_ai_quota(db, current_user, len(uploaded_files))
    except Exception:
        _remove_local_files(local_paths)
        raise

    # Step-by-step AI + Live Scraper analysis
    try:
        analysis = analyze_item_image(local_paths, user=current_user, user_condition=condition, user_details=details)
    except Exception as e:
        _remove_local_files(local_paths)
        raise ai_failure(db, e, "KI-Analyse")

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
        db.rollback()
        _remove_local_files(local_paths)
        print(f"Velosia: Angebot konnte nicht gespeichert werden: {e}", flush=True)
        raise HTTPException(status_code=500, detail="Das Angebot konnte nicht gespeichert werden.")

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
    _check_file_count(files, MAX_FILES_TURBO)
    check_ai_quota(current_user, len(files))
    _ensure_disk_space(db)

    # 1. Save all uploaded images
    saved_paths, local_paths = _store_uploads(files)

    # Turbo sends every photo through grouping AND one analysis per group, so it
    # is the most expensive path per request.
    try:
        consume_ai_quota(db, current_user, len(files))
    except Exception:
        _remove_local_files(local_paths)
        raise

    _cleanup = _remove_local_files

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
                errors.append(e)

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
        raise ai_failure(db, errors[0] if errors else RuntimeError("keine Gruppe analysiert"), "Turbo-Analyse")

    # Remove images that belong to failed groups (no draft references them)
    _cleanup([p for j, p in enumerate(local_paths) if j not in used_indices])

    try:
        for d in created_drafts:
            db.add(d)
        db.commit()
        for d in created_drafts:
            db.refresh(d)
    except Exception as e:
        db.rollback()
        _cleanup([p for j, p in enumerate(local_paths) if j in used_indices])
        print(f"Velosia Turbo: Angebote konnten nicht gespeichert werden: {e}", flush=True)
        raise HTTPException(status_code=500, detail="Die Angebote konnten nicht gespeichert werden.")

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
    principal: Principal = Depends(get_platform_principal)
):
    if not principal.may_access_draft(draft_id):
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
    db_draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id, 
        models.Draft.user_id == principal.user.id
    ).first()
    if not db_draft:
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
    return db_draft

@app.post("/api/drafts/{draft_id}/platform-token", response_model=schemas.PlatformTokenResponse)
def issue_platform_token(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Short-lived token for publishing this draft from the platform WebView.

    The Android shell keeps the token it is handed and the autofill engine runs
    inside vinted.de / kleinanzeigen.de with it. A draft-scoped token limits
    that context to reading this draft, reporting its published listing and
    sending autofill telemetry (see get_platform_principal)."""
    rate_limit.enforce(
        "platform_token", str(current_user.id), rate_limit.PLATFORM_TOKEN_USER,
        "Zu viele Veröffentlichungsversuche in kurzer Zeit. Bitte warte einen Moment.",
    )
    db_draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id,
        models.Draft.user_id == current_user.id
    ).first()
    if not db_draft:
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
    return {
        "token": create_platform_token(current_user, db_draft.id),
        "expires_in": PLATFORM_TOKEN_TTL_MIN * 60,
    }

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
    # Photo paths leave the API signed; if a client ever echoes them back, store
    # the raw path so the signature never gets baked into the database.
    if "image_paths" in update_data:
        update_data["image_paths"] = _strip_signatures_in_json_list(update_data["image_paths"] or "[]")
        # Only a reordering of the draft's own photos is allowed here — adding goes
        # through POST /images, removing through DELETE /images. Otherwise a client
        # could splice in another user's upload and get a signed URL for it.
        try:
            new_paths = json.loads(update_data["image_paths"])
        except Exception:
            raise HTTPException(status_code=400, detail="Ungültige Bildliste.")
        if not isinstance(new_paths, list) or sorted(new_paths) != sorted(_draft_image_paths(db_draft)):
            raise HTTPException(status_code=400, detail="Die Bilder können nur umsortiert werden.")
        # The first photo is the cover — keep the legacy single-path column in sync.
        update_data["image_path"] = new_paths[0] if new_paths else None
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

    # No AI here (photos are only stored), so this is a storage cap, not a quota.
    if not files:
        raise HTTPException(status_code=400, detail="Es wurden keine Bilder hochgeladen.")
    if MAX_IMAGES_PER_DRAFT > 0 and len(existing_paths) + len(files) > MAX_IMAGES_PER_DRAFT:
        raise HTTPException(
            status_code=400,
            detail=f"Ein Angebot kann höchstens {MAX_IMAGES_PER_DRAFT} Bilder enthalten.",
        )
    _ensure_disk_space(db)

    saved_paths, _local_paths = _store_uploads(files)

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

    # The client hands back the path it received, which is signed — compare
    # against the raw path the database stores.
    image_path = signed_urls.strip_signature(image_path)

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

    consume_ai_quota(db, current_user, len(image_paths))

    from services.gemini_service import regenerate_draft_field
    try:
        new_val = regenerate_draft_field(image_paths, req.field, user=current_user)
    except Exception as e:
        raise ai_failure(db, e, "KI-Regeneration")

    if req.field == "title":
        db_draft.title = new_val
    elif req.field == "description":
        db_draft.description = new_val

    db.commit()
    db.refresh(db_draft)
    return db_draft

# --- Former APK download ------------------------------------------------------
# The app is distributed through Google Play only. The old self-hosted APK
# endpoints answer 410 so outdated links fail with a clear pointer.
_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.velosia.app"
_APK_DIR = "/data" if os.path.isdir("/data") else UPLOAD_DIR


def _remove_hosted_apk():
    for name in ("velosia-latest.apk", "apk-version.txt"):
        path = os.path.join(_APK_DIR, name)
        try:
            if os.path.isfile(path):
                os.remove(path)
                print(f"[app] {name} vom Volume entfernt.", flush=True)
        except Exception as e:
            print(f"[app] {name} konnte nicht entfernt werden: {e}", flush=True)


_remove_hosted_apk()


@app.get("/api/app/latest-apk")
@app.post("/api/app/upload-apk")
def apk_gone():
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail=f"Velosia gibt es nur noch über Google Play: {_PLAY_STORE_URL}",
    )

# --- AUTOFILL TELEMETRY & AUTOMATIC HEALTH MONITORING ---

# Tuning for the anomaly detector. A signal fires when a normally-reliable field
# fails in too large a fraction of the most recent autofill runs on a platform.
# Only each user's latest run counts, so one account sending many events can't
# trigger (or mask) an alert on its own.
_TELEMETRY_WINDOW = 15       # most recent users per platform to look at
_TELEMETRY_SCAN = 300        # recent events scanned to find those users
_TELEMETRY_MIN_USERS = 3     # need data points from at least this many users
_TELEMETRY_COOLDOWN_H = 24   # don't re-alert the same signal within 24h
_TELEMETRY_MAX_ALERTS_PER_DAY = 5  # across all signals
# (field label, AutofillEvent attribute, miss-rate threshold to alert)
_TELEMETRY_SIGNALS = [
    ("Titel", "title_found", 0.6),
    ("Beschreibung", "description_found", 0.6),
    ("Preis", "price_found", 0.6),
    ("Kategorie", "category_ok", 0.9),  # category can legitimately fall to manual -> only alert on near-total failure
    # Attribute pickers: only counted when the AI actually had a value (see engine),
    # so a False means "we had a value and the picker couldn't set it" — a likely
    # selector break. Conservative thresholds because a value can also be legitimately
    # absent from the site's option list.
    ("Zustand", "condition_ok", 0.85),
    ("Größe", "size_ok", 0.9),
    ("Farbe", "color_ok", 0.9),
    ("Material", "material_ok", 0.9),
    # Brand is intentionally NOT alerted on: it is exact-match-only ("leer ist besser
    # als halluziniert"), so a high miss rate is normal, not a break. brand_ok is
    # still stored for manual analysis.
]


def _latest_event_per_user(events: list, limit: int) -> list:
    """First (= newest) event of each user, newest users first."""
    seen = set()
    out = []
    for e in events:
        key = e.user_id if e.user_id is not None else f"anon:{e.id}"
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
        if len(out) >= limit:
            break
    return out


def _telemetry_alerts_today(db: Session) -> int:
    since = datetime.utcnow() - timedelta(hours=24)
    return (
        db.query(models.AlertLog)
        .filter(
            models.AlertLog.created_at >= since,
            or_(models.AlertLog.signal.like("vinted:%"), models.AlertLog.signal.like("kleinanzeigen:%")),
        )
        .count()
    )


def check_autofill_anomaly(platform: str):
    """Runs in the background after a telemetry event. Detects when a field starts
    failing en masse (site likely changed) and e-mails the maintainer, once per
    signal per cooldown window and at most a few times a day. Never raises into
    the request."""
    if platform not in ("vinted", "kleinanzeigen"):
        return
    from database import SessionLocal
    db = SessionLocal()
    try:
        scanned = (
            db.query(models.AutofillEvent)
            .filter(models.AutofillEvent.platform == platform)
            .order_by(models.AutofillEvent.created_at.desc(), models.AutofillEvent.id.desc())
            .limit(_TELEMETRY_SCAN)
            .all()
        )
        for label, attr, threshold in _TELEMETRY_SIGNALS:
            # Per signal: each user's newest run that actually reported this field
            # (KA's category step, for example, carries no text-field flags).
            recent = _latest_event_per_user(
                [e for e in scanned if getattr(e, attr) is not None], _TELEMETRY_WINDOW
            )
            vals = [getattr(e, attr) for e in recent]
            if len(vals) < _TELEMETRY_MIN_USERS:
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
            if _telemetry_alerts_today(db) >= _TELEMETRY_MAX_ALERTS_PER_DAY:
                print(f"[telemetry] Tageslimit für Warnmails erreicht, {signal} nur geloggt.", flush=True)
                continue
            db.add(models.AlertLog(signal=signal, detail=f"miss={miss_rate:.0%} n={len(vals)}"))
            db.commit()
            versions = ", ".join(sorted({e.engine_version or "?" for e in recent}))
            send_email(
                f"⚠️ Velosia Autofill: '{label}' bricht auf {platform}",
                (
                    f"Das Feld/die Aktion '{label}' ist bei {miss_rate:.0%} der letzten {len(vals)} "
                    f"Nutzer (jeweils letzter Autofill-Versuch) auf {platform} fehlgeschlagen.\n\n"
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


# Diagnostic beacon of the engine/app (structural info only). Off unless
# DEBUG_BEACON_ENABLED is set while investigating a platform change; when off
# it accepts and discards the request so older clients see no errors.
_DEBUG_BEACON_ENABLED = os.getenv("DEBUG_BEACON_ENABLED", "").lower() in ("1", "true", "yes")
_DEBUG_BEACON_MAX_BYTES = 2048
_DEBUG_BEACON_KEYS = {
    "event", "engine_version", "source", "reason", "field", "detail", "brandLen", "activeTag",
    "opener", "sheet", "sheetText", "cands", "photos", "bridged", "files", "fileInputs",
    "accept", "previewsBefore", "previewsAfter", "url", "method", "keys", "itemKeys", "itemId", "id",
}


def _beacon_value(value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, list):
        return [str(v)[:60] for v in value[:40]]
    return str(value)[:300]


@app.post("/api/telemetry/debug", status_code=status.HTTP_202_ACCEPTED)
async def telemetry_debug(request: Request):
    """Diagnostic sink for the engine's debug beacon (event tag + structural
    field info). Unauthenticated so it reports even when a token is missing —
    hence disabled by default, size-capped, rate-limited and key-filtered."""
    if not _DEBUG_BEACON_ENABLED:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    rate_limit.enforce(
        "debug_beacon", rate_limit.client_ip(request), rate_limit.DEBUG_BEACON_IP,
        "Zu viele Anfragen.",
    )
    body = await request.body()
    if len(body) > _DEBUG_BEACON_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Zu groß.")
    try:
        payload = json.loads(body or b"{}")
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    clean = {k: _beacon_value(v) for k, v in payload.items() if k in _DEBUG_BEACON_KEYS}
    print(f"[debug-beacon] {json.dumps(clean, ensure_ascii=False)}", flush=True)
    return {"ok": True}


@app.post("/api/telemetry/autofill", status_code=status.HTTP_202_ACCEPTED)
def telemetry_autofill(
    event: schemas.AutofillEventCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_platform_principal),
):
    """Records one anonymous autofill outcome (no listing content) and triggers a
    background anomaly check. Best-effort: telemetry never blocks the user."""
    rate_limit.enforce(
        "telemetry", str(principal.user.id), rate_limit.TELEMETRY_USER,
        "Zu viele Telemetrie-Meldungen.",
    )
    try:
        ev = models.AutofillEvent(user_id=principal.user.id, **event.model_dump())
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
from services import listing_urls

# How often the background poller sweeps all active listings, and how long it
# spaces individual requests apart, so a sweep never looks like a burst.
_STATUS_POLL_INTERVAL_MIN = int(os.getenv("STATUS_POLL_INTERVAL_MIN", "360"))
_STATUS_POLL_SPACING_S = float(os.getenv("STATUS_POLL_SPACING_S", "4"))


def _apply_listing_capture(draft, platform, listing_id, listing_url):
    """Store a freshly captured listing id/url and mark it online."""
    now = datetime.utcnow()
    if platform == "kleinanzeigen":
        if listing_id != draft.ka_listing_id:
            draft.ka_listing_url = None  # belonged to the previous listing
        draft.ka_listing_id = listing_id or draft.ka_listing_id
        draft.ka_listing_url = listing_url or draft.ka_listing_url
        draft.ka_status = listing_status.ONLINE
        draft.ka_status_at = now
    elif platform == "vinted":
        if listing_id != draft.vinted_listing_id:
            draft.vinted_listing_url = None
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
    principal: Principal = Depends(get_platform_principal),
):
    """Called by the engine once a listing is live: records its public id/URL so
    the dashboard can show & track it."""
    if not principal.may_access_draft(payload.draft_id):
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
    draft = db.query(models.Draft).filter(
        models.Draft.id == payload.draft_id,
        models.Draft.user_id == principal.user.id,
    ).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
    if payload.platform not in listing_urls.PLATFORMS:
        raise HTTPException(status_code=400, detail="Unbekannte Plattform.")

    # Only a numeric listing id and a public listing page on the platform's own
    # host are stored (the URL is later fetched by the status poller and shown
    # as a link). An unusable URL is rebuilt from the id where possible.
    listing_id, listing_url = listing_urls.canonical_listing(
        payload.platform, payload.listing_id, payload.listing_url
    )
    if not listing_id:
        raise HTTPException(status_code=400, detail="Ungültige Anzeigen-ID.")

    _apply_listing_capture(draft, payload.platform, listing_id, listing_url)
    db.commit()
    db.refresh(draft)
    return draft


_MANUAL_STATUSES = {
    listing_status.ONLINE,
    listing_status.RESERVIERT,
    listing_status.VERKAUFT,
    listing_status.GELOESCHT,
}


@app.post("/api/listings/{draft_id}/set-status", response_model=schemas.DraftResponse)
def set_listing_status(
    draft_id: int,
    payload: schemas.ListingStatusSet,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Manually set a platform's listing status. Needed because Kleinanzeigen
    exposes no public 'verkauft' state — the user marks a KA sale by hand — and to
    record a 'geloescht' after the semi-manual cross-platform take-down."""
    draft = db.query(models.Draft).filter(
        models.Draft.id == draft_id,
        models.Draft.user_id == current_user.id,
    ).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Angebot wurde nicht gefunden.")
    if payload.platform not in listing_urls.PLATFORMS:
        raise HTTPException(status_code=400, detail="Unbekannte Plattform.")
    if payload.status not in _MANUAL_STATUSES:
        raise HTTPException(status_code=400, detail="Unbekannter Status.")

    now = datetime.utcnow()
    if payload.platform == "kleinanzeigen":
        draft.ka_status = payload.status
        draft.ka_status_at = now
    else:
        draft.vinted_status = payload.status
        draft.vinted_status_at = now
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
    # Each report can carry a base64 screenshot straight onto the volume.
    rate_limit.enforce(
        "bugreport", str(current_user.id), rate_limit.BUGREPORT_USER,
        "Zu viele Fehlerberichte in kurzer Zeit. Bitte warte einen Moment.",
    )

    # The screenshot is optional: one that can't be decoded or stored is dropped
    # and the report itself still goes through.
    screenshot_path = None
    if bug_in.screenshot_base64 and "," in bug_in.screenshot_base64:
        try:
            _header, encoded = bug_in.screenshot_base64.split(",", 1)
            data = base64.b64decode(encoded, validate=False)
            if image_store.disk_space_ok(UPLOAD_DIR):
                screenshot_path, _ = image_store.store_bytes(data, UPLOAD_DIR, prefix="bug_")
        except (HTTPException, binascii.Error, ValueError) as e:
            print(f"Bug-Screenshot verworfen: {getattr(e, 'detail', e)}", flush=True)
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
@app.post("/api/waitlist", response_model=schemas.WaitlistAck, status_code=status.HTTP_201_CREATED)
def join_waitlist(request: Request, entry_in: schemas.WaitlistCreate, db: Session = Depends(get_db)):
    """Public endpoint — anyone can sign up to be considered as a Play Store
    tester. Idempotent: re-submitting the same e-mail succeeds again. The answer
    is the same whether or not the address was already on the list and never
    echoes stored data. Notifies the maintainer by e-mail when configured."""
    # Unauthenticated and it sends us an e-mail per new entry — prime spam target.
    rate_limit.enforce(
        "waitlist", rate_limit.client_ip(request), rate_limit.WAITLIST_IP,
        "Zu viele Anmeldungen von dieser Verbindung. Bitte versuche es später erneut.",
    )

    email = normalize_email(entry_in.email)
    ack = {"ok": True, "email": email}
    existing = db.query(models.WaitlistEntry).filter(
        func.lower(func.trim(models.WaitlistEntry.email)) == email
    ).first()
    if existing:
        return ack

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
        # Race on the unique index: the address is on the list now.
        db.rollback()
        existing = db.query(models.WaitlistEntry).filter(models.WaitlistEntry.email == email).first()
        if existing:
            return ack
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

    return ack


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
    """Admin-only: permanently delete a user and all their data (see purge_user)."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Du kannst dein eigenes Konto nicht löschen.")
    if target.is_admin:
        raise HTTPException(status_code=400, detail="Admin-Konten können nicht gelöscht werden.")

    purge_user(db, target)
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

