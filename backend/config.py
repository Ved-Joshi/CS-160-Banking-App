from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/bank"
    JWT_SECRET: str = "change-this-secret"
    JWT_ALG: str = "HS256"
    JWT_EXPIRES_MIN: int = 60

settings = Settings()