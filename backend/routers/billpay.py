from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import BillPayment, User, TransactionStatus
from schemas import BillPaymentCreate, BillPaymentResponse
from datetime import datetime, timedelta

router = APIRouter(prefix="/bill-payments", tags=["Bill Payments"])

@router.post("/", response_model=BillPaymentResponse)
def create_bill_payment(user_id: int, payment: BillPaymentCreate, db: Session = Depends(get_db)):
    """Create a new bill payment"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    new_payment = BillPayment(
        user_id=user_id,
        payee_name=payment.payee_name,
        payee_account=payment.payee_account,
        amount=payment.amount,
        due_date=payment.due_date,
        is_recurring=payment.is_recurring,
        status=TransactionStatus.COMPLETED
    )
    db.add(new_payment)
    db.commit()
    db.refresh(new_payment)
    return new_payment

@router.get("/{payment_id}", response_model=BillPaymentResponse)
def get_bill_payment(payment_id: int, db: Session = Depends(get_db)):
    """Get bill payment details"""
    payment = db.query(BillPayment).filter(BillPayment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Bill payment not found")
    return payment

@router.get("/user/{user_id}", response_model=list[BillPaymentResponse])
def get_user_bill_payments(user_id: int, limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    """Get all bill payments for a user"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    payments = db.query(BillPayment)\
        .filter(BillPayment.user_id == user_id)\
        .order_by(BillPayment.created_at.desc())\
        .offset(offset)\
        .limit(limit)\
        .all()
    return payments

@router.get("/upcoming/{user_id}", response_model=list[BillPaymentResponse])
def get_upcoming_bills(user_id: int, days: int = 30, db: Session = Depends(get_db)):
    """Get upcoming bill payments for a user"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    today = datetime.utcnow()
    future_date = today + timedelta(days=days)
    
    payments = db.query(BillPayment)\
        .filter(BillPayment.user_id == user_id)\
        .filter(BillPayment.due_date >= today)\
        .filter(BillPayment.due_date <= future_date)\
        .order_by(BillPayment.due_date.asc())\
        .all()
    return payments

@router.put("/{payment_id}", response_model=BillPaymentResponse)
def update_bill_payment(payment_id: int, payment: BillPaymentCreate, db: Session = Depends(get_db)):
    """Update bill payment"""
    existing_payment = db.query(BillPayment).filter(BillPayment.id == payment_id).first()
    if not existing_payment:
        raise HTTPException(status_code=404, detail="Bill payment not found")
    
    existing_payment.payee_name = payment.payee_name
    existing_payment.payee_account = payment.payee_account
    existing_payment.amount = payment.amount
    existing_payment.due_date = payment.due_date
    existing_payment.is_recurring = payment.is_recurring
    
    db.commit()
    db.refresh(existing_payment)
    return existing_payment

@router.delete("/{payment_id}")
def delete_bill_payment(payment_id: int, db: Session = Depends(get_db)):
    """Delete bill payment"""
    payment = db.query(BillPayment).filter(BillPayment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Bill payment not found")
    
    db.delete(payment)
    db.commit()
    return {"message": "Bill payment deleted successfully"}
