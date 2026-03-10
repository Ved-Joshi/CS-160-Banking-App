from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime
from enum import Enum

class TransactionTypeEnum(str, Enum):
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    TRANSFER = "transfer"
    PAYMENT = "payment"

class TransactionStatusEnum(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"

# User Schemas
class UserBase(BaseModel):
    username: str
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None

class UserResponse(UserBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# Account Schemas
class AccountBase(BaseModel):
    account_type: str
    currency: str = "USD"

class AccountCreate(AccountBase):
    pass

class AccountResponse(AccountBase):
    id: int
    user_id: int
    account_number: str
    balance: float
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# Transaction Schemas
class TransactionBase(BaseModel):
    type: TransactionTypeEnum
    amount: float
    description: Optional[str] = None

class TransactionCreate(TransactionBase):
    account_id: int

class TransactionResponse(TransactionBase):
    id: int
    user_id: int
    account_id: int
    status: TransactionStatusEnum
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# Bill Payment Schemas
class BillPaymentCreate(BaseModel):
    payee_name: str
    payee_account: str
    amount: float
    due_date: Optional[datetime] = None
    is_recurring: bool = False

class BillPaymentResponse(BaseModel):
    id: int
    user_id: int
    payee_name: str
    payee_account: str
    amount: float
    due_date: Optional[datetime]
    is_recurring: bool
    status: TransactionStatusEnum
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# ATM Location Schemas
class ATMLocationResponse(BaseModel):
    id: int
    name: str
    address: str
    city: str
    state: str
    zip_code: str
    latitude: Optional[float]
    longitude: Optional[float]
    is_24_7: bool
    
    class Config:
        from_attributes = True
