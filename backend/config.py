from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # Database Configuration - supports Supabase
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/bank"
    SQLALCHEMY_ECHO: bool = False
    
    # Server Configuration
    DEBUG: bool = True
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    # CORS Configuration
    ALLOWED_ORIGINS: list = ["http://localhost:5173", "http://localhost:3000"]
    
    # JWT Configuration
    JWT_SECRET: str = "change-this-secret"
    JWT_ALG: str = "HS256"
    JWT_EXPIRES_MIN: int = 60
    
    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()