from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",
    )

    # Server Configuration
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    # CORS Configuration
    ALLOWED_ORIGINS: list = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ]

    # JWT Configuration (used by backend/utils/security.py)
    JWT_SECRET: str = "change-me"
    JWT_ALG: str = "HS256"
    JWT_EXPIRES_MIN: int = 60

    # Supabase configuration for backend banking APIs
    SUPABASE_URL: Optional[str] = None
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None

    # Google Maps / Places configuration for ATM locator
    GOOGLE_MAPS_API_KEY: Optional[str] = None

    # Internal scheduler auth for processing due transfer plans
    TRANSFER_RUNNER_SECRET: Optional[str] = None

    # API-wide rate limiting
    RATE_LIMIT_REQUESTS_PER_WINDOW: int = 240
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    # External account linking provider: stripe_sandbox | local
    EXTERNAL_ACCOUNT_PROVIDER: str = "stripe_sandbox"

    # Stripe sandbox linking configuration (Financial Connections)
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_PUBLISHABLE_KEY: Optional[str] = None

settings = Settings()

if not settings.DEBUG and settings.JWT_SECRET == "change-me":
    raise ValueError("JWT_SECRET must be set to a non-default value in production.")
