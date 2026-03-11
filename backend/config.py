from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./bank.db"
    JWT_SECRET: str = "change-this-secret"
    JWT_ALG: str = "HS256"
    JWT_EXPIRES_MIN: int = 60

settings = Settings()