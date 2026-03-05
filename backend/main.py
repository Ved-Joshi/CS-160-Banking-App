from fastapi import FastAPI
from .routers import auth

app = FastAPI(title="Bank Backend")

app.include_router(auth.router)