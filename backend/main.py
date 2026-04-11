from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from routers.banking_read import router as banking_read_router
from routers.admin import router as admin_router
from routers.me_admin import router as me_admin_router
from routers import accounts

app = FastAPI(
    title="Banking App API",
    description="Supabase-first backend shim (no local DB)",
    version="1.0.0",
    debug=settings.DEBUG,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(banking_read_router)
app.include_router(admin_router)
app.include_router(me_admin_router)
app.include_router(accounts.router)

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/")
async def root():
    return {
        "message": "Banking App API (Supabase-first)",
        "version": "1.0.0",
        "docs": "/docs",
    }
