from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",
    )

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

    # Supabase configuration for backend banking APIs
    SUPABASE_URL: Optional[str] = None
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None

    # Google Maps / Places configuration for ATM locator
    GOOGLE_MAPS_API_KEY: Optional[str] = None

settings = Settings()

if not settings.DEBUG and settings.JWT_SECRET == "change-me":
    raise ValueError("JWT_SECRET must be set to a non-default value in production.")
