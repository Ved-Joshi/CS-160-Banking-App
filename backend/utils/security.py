from datetime import datetime, timedelta, timezone
import hashlib
import bcrypt
from jose import jwt

from config import settings


# ---------- Password hashing (Option 2: prehash + bcrypt) ----------

def _prehash(password: str) -> bytes:
    # fixed 32 bytes, avoids bcrypt 72-byte limit
    return hashlib.sha256(password.encode("utf-8")).digest()

def hash_password(password: str) -> str:
    pre = _prehash(password)
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pre, salt).decode("utf-8")

def verify_password(password: str, password_hash: str) -> bool:
    pre = _prehash(password)
    return bcrypt.checkpw(pre, password_hash.encode("utf-8"))


# ---------- JWT token ----------

def create_access_token(user_id: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRES_MIN)
    payload = {"sub": user_id, "role": role, "exp": exp}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)