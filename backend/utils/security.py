from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from config import settings
import hashlib

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _prehash(password: str) -> bytes:
    """
    Pre-hash the password using SHA-256 to avoid bcrypt's 72-byte limit.
    Always encode as UTF-8.
    """
    return hashlib.sha256(password.encode("utf-8")).digest()


def hash_password(password: str) -> str:
    prehashed = _prehash(password)
    return pwd_context.hash(prehashed)


def verify_password(password: str, password_hash: str) -> bool:
    prehashed = _prehash(password)
    return pwd_context.verify(prehashed, password_hash)


def create_access_token(user_id: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRES_MIN)
    payload = {"sub": user_id, "role": role, "exp": exp}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)