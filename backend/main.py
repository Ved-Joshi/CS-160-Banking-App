from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from database import Base, engine
from routers import auth, accounts, transactions, billpay, atm

# Create all database tables
Base.metadata.create_all(bind=engine)

# Initialize FastAPI app
app = FastAPI(
    title="Banking App API",
    description="FastAPI backend for banking application with SQLAlchemy and Supabase",
    version="1.0.0",
    debug=settings.DEBUG
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(transactions.router)
app.include_router(billpay.router)
app.include_router(atm.router)

# Health check endpoint
@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/")
async def root():
    return {
        "message": "Banking App API",
        "version": "1.0.0",
        "docs": "/docs"
    }