from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from database import get_db                                                 # dependency that gives a DB session per request
from models.user import User                                                # SQLAlchemy model (users table)
from schemas.auth import RegisterIn, LoginIn, TokenOut                       # Pydantic request/response schemas
from utils.security import hash_password, verify_password, create_access_token    

# APIRouter groups endpoints together under a prefix.
# prefix="/auth" means routes become /auth/register, /auth/login
router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", status_code=201)
def register(data: RegisterIn, db: Session = Depends(get_db)):
    """
    1) FastAPI reads JSON body and validates it using RegisterIn schema.
    2) db is created by get_db() and injected here.
    3) We check for duplicate email.
    4) Hash password, create user, commit.
    """
    existing = db.execute(select(User).where(User.email == data.email)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail={"code": "EMAIL_EXISTS", "message": "Email already registered"})

    user = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"id": str(user.id), "email": user.email}

@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db)):
    """
    1) Validate input using LoginIn.
    2) Find user by email.
    3) Verify bcrypt password hash.
    4) Create JWT token with user_id + role.
    """
    user = db.execute(select(User).where(User.email == data.email)).scalar_one_or_none()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "INVALID_CREDENTIALS", "message": "Bad email or password"})

    token = create_access_token(user_id=str(user.id), role=user.role.value)
    return TokenOut(access_token=token)