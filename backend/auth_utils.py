import os
import bcrypt
from datetime import datetime, timedelta
from typing import Optional, Union
from jose import jwt, JWTError
from dotenv import load_dotenv

load_dotenv()

# JWT configuration
# SECRET_KEY MUST come from the environment. There is deliberately no usable
# fallback: a hardcoded default would be public in the source tree, and since
# admin rights are derived purely from the JWT `sub` (e-mail), anyone could then
# forge an admin token. Fail fast at import time instead of booting insecure.
_INSECURE_DEFAULT = "velosia_default_secret_key_change_me_in_production"
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY or SECRET_KEY == _INSECURE_DEFAULT:
    raise RuntimeError(
        "SECRET_KEY environment variable is missing or set to the insecure default. "
        "Set a strong random SECRET_KEY (e.g. `python -c \"import secrets; print(secrets.token_urlsafe(48))\"`) "
        "before starting the server."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")) # 1440 minutes = 24 hours

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies that a plain password matches its hashed version."""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    """Hashes a password using bcrypt."""
    pw_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pw_bytes, salt)
    return hashed.decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Creates a JWT access token containing the provided data payload."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    """Decodes a JWT access token and returns its payload, or None if invalid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None
