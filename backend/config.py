from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # Server Configuration
    DEBUG: bool = True
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    # CORS Configuration
    ALLOWED_ORIGINS: list = ["http://localhost:5173", "http://localhost:3000"]

    # JWT Configuration (used by backend/utils/security.py)
    JWT_SECRET: str = "change-me"
    JWT_ALG: str = "HS256"
    JWT_EXPIRES_MIN: int = 60

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()

if not settings.DEBUG and settings.JWT_SECRET == "change-me":
    raise ValueError("JWT_SECRET must be set to a non-default value in production.")
