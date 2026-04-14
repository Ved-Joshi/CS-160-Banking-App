from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
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

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="Banking App API",
        version="1.0.0",
        description="Banking API with Bearer Auth",
        routes=app.routes,
    )

    openapi_schema["components"]["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
        }
    }

    openapi_schema["security"] = [{"BearerAuth": []}]

    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi

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
