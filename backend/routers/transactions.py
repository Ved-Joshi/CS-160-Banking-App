from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Transaction, Account, User, TransactionStatus
from schemas import TransactionCreate, TransactionResponse
from datetime import datetime, timedelta

router = APIRouter(prefix="/transactions", tags=["Transactions"])

@router.post("/", response_model=TransactionResponse)
def create_transaction(user_id: int, transaction: TransactionCreate, db: Session = Depends(get_db)):
    """Create a new transaction"""
    account = db.query(Account).filter(Account.id == transaction.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    if account.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to use this account")
    
    new_transaction = Transaction(
        user_id=user_id,
        account_id=transaction.account_id,
        type=transaction.type,
        amount=transaction.amount,
        description=transaction.description,
        status=TransactionStatus.COMPLETED
    )
    db.add(new_transaction)
    db.commit()
    db.refresh(new_transaction)
    return new_transaction

@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(transaction_id: int, db: Session = Depends(get_db)):
    """Get transaction details"""
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transaction

@router.get("/user/{user_id}", response_model=list[TransactionResponse])
def get_user_transactions(user_id: int, limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    """Get all transactions for a user"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    transactions = db.query(Transaction)\
        .filter(Transaction.user_id == user_id)\
        .order_by(Transaction.created_at.desc())\
        .offset(offset)\
        .limit(limit)\
        .all()
    return transactions

@router.get("/account/{account_id}", response_model=list[TransactionResponse])
def get_account_transactions(account_id: int, limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    """Get all transactions for an account"""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    transactions = db.query(Transaction)\
        .filter(Transaction.account_id == account_id)\
        .order_by(Transaction.created_at.desc())\
        .offset(offset)\
        .limit(limit)\
        .all()
    return transactions

@router.get("/recent/{user_id}", response_model=list[TransactionResponse])
def get_recent_transactions(user_id: int, days: int = 30, db: Session = Depends(get_db)):
    """Get recent transactions for a user"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    start_date = datetime.utcnow() - timedelta(days=days)
    transactions = db.query(Transaction)\
        .filter(Transaction.user_id == user_id)\
        .filter(Transaction.created_at >= start_date)\
        .order_by(Transaction.created_at.desc())\
        .all()
    return transactions
