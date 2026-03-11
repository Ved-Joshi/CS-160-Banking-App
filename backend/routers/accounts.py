from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Account, User
from schemas import AccountCreate, AccountResponse
import random
import string

router = APIRouter(prefix="/accounts", tags=["Accounts"])

def generate_account_number():
    """Generate a unique account number"""
    return ''.join(random.choices(string.digits, k=12))

@router.post("/", response_model=AccountResponse)
def create_account(user_id: int, account: AccountCreate, db: Session = Depends(get_db)):
    """Create a new account for a user"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    new_account = Account(
        user_id=user_id,
        account_number=generate_account_number(),
        account_type=account.account_type,
        currency=account.currency,
        balance=0.0
    )
    db.add(new_account)
    db.commit()
    db.refresh(new_account)
    return new_account

@router.get("/{account_id}", response_model=AccountResponse)
def get_account(account_id: int, db: Session = Depends(get_db)):
    """Get account details"""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account

@router.get("/user/{user_id}", response_model=list[AccountResponse])
def get_user_accounts(user_id: int, db: Session = Depends(get_db)):
    """Get all accounts for a user"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    return accounts

@router.put("/{account_id}", response_model=AccountResponse)
def update_account(account_id: int, account_type: str, db: Session = Depends(get_db)):
    """Update account type"""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    account.account_type = account_type
    db.commit()
    db.refresh(account)
    return account

@router.delete("/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db)):
    """Delete account"""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    db.delete(account)
    db.commit()
    return {"message": "Account deleted successfully"}
