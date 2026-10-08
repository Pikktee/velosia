import hashlib
import hmac
import os
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# JWT configuration
# SECRET_KEY MUST come from the environment. There is deliberately no usable
# fallback: a hardcoded default would be public in the source tree, and anyone
# could then mint valid session tokens. Fail fast at import time instead of
# booting insecure. Values that ever appeared in this repository (code or
# example config) are rejected explicitly, as is anything obviously a
# placeholder or too short to be a real random secret.
_KNOWN_PLACEHOLDERS = {
    "velosia_default_secret_key_change_me_in_production",
    "velosia_super_secret_signing_key_change_me_in_production",
    "vintamie_super_secret_signing_key_change_me_in_production",
    "vintamie_default_secret_key_change_me_in_production",
}
_MIN_SECRET_LEN = 32


def _validate_secret(key: Optional[str]) -> str:
    if (
        not key
        or key in _KNOWN_PLACEHOLDERS
        or "change_me" in key.lower()
        or len(key) < _MIN_SECRET_LEN
    ):
        raise RuntimeError(
            "SECRET_KEY environment variable is missing, a placeholder or shorter than "
            f"{_MIN_SECRET_LEN} characters. Set a strong random SECRET_KEY "
            "(e.g. `python -c \"import secrets; print(secrets.token_urlsafe(48))\"`) "
            "before starting the server."
        )
    return key


SECRET_KEY = _validate_secret(os.getenv("SECRET_KEY"))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")) # 1440 minutes = 24 hours

# Short-lived, draft-scoped token handed to the platform WebView (see
# create_platform_token). Default: 3 hours — long enough to review and publish
# a listing, short enough that it is worthless soon after.
PLATFORM_TOKEN_TTL_MIN = int(os.getenv("PLATFORM_TOKEN_TTL_MIN", "180"))
PLATFORM_SCOPE = "platform"


def derive_key(label: bytes) -> bytes:
    """Purpose-specific subkey of SECRET_KEY, so that a value signed for one
    purpose (session token, platform token, upload URL) can never be replayed
    as another."""
    return hmac.new(SECRET_KEY.encode(), label, hashlib.sha256).digest()


_PLATFORM_KEY = derive_key(b"velosia/platform-token/v1")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies that a plain password matches its hashed version."""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8')[:72], hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    """Hashes a password using bcrypt."""
    pw_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pw_bytes, salt)
    return hashed.decode('utf-8')


# Hash of a random throwaway password. Login verifies against it when no account
# matches, so a lookup miss costs the same bcrypt time as a wrong password.
DUMMY_PASSWORD_HASH = get_password_hash(os.urandom(16).hex())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Creates a JWT access token containing the provided data payload."""
    to_encode = data.copy()
    now = _now()
    expire = now + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "iat": now})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_user_token(user) -> str:
    """Session token for a user: e-mail as `sub` (kept for older clients),
    plus the account id and its token generation, so that a password/Google
    re-link or an account deletion invalidates every token issued before."""
    return create_access_token({
        "sub": user.email,
        "uid": user.id,
        "ver": int(user.token_version or 0),
    })


def decode_access_token(token: str) -> Optional[dict]:
    """Decodes a JWT access token and returns its payload, or None if invalid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("scope"):
        return None
    return payload


def create_platform_token(user, draft_id: int) -> str:
    """Draft-scoped token for the platform WebView (Vinted/Kleinanzeigen page).

    Signed with a derived key, so get_current_user never accepts it; only the
    handful of endpoints the autofill flow needs (see get_platform_principal in
    main.py) do, and only for this one draft."""
    now = _now()
    return jwt.encode(
        {
            "uid": user.id,
            "did": int(draft_id),
            "ver": int(user.token_version or 0),
            "scope": PLATFORM_SCOPE,
            "iat": now,
            "exp": now + timedelta(minutes=PLATFORM_TOKEN_TTL_MIN),
        },
        _PLATFORM_KEY,
        algorithm=ALGORITHM,
    )


def decode_platform_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, _PLATFORM_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("scope") != PLATFORM_SCOPE:
        return None
    if not isinstance(payload.get("uid"), int) or not isinstance(payload.get("did"), int):
        return None
    return payload
