from fastapi import FastAPI
from database import Base, engine
from routers import auth
import models  # important: ensures models are imported

app = FastAPI(title="CS160 Banking API")

# DEV ONLY: creates tables on startup. Later replace with Alembic migrations.
Base.metadata.create_all(bind=engine)

app.include_router(auth.router)

@app.get("/health")
def health():
    return {"ok": True}