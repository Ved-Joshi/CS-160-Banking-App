from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import ATMLocation
from schemas import ATMLocationResponse

router = APIRouter(prefix="/atm-locations", tags=["ATM Locations"])

@router.get("/{atm_id}", response_model=ATMLocationResponse)
def get_atm(atm_id: int, db: Session = Depends(get_db)):
    """Get ATM location details"""
    atm = db.query(ATMLocation).filter(ATMLocation.id == atm_id).first()
    if not atm:
        raise HTTPException(status_code=404, detail="ATM location not found")
    return atm

@router.get("/", response_model=list[ATMLocationResponse])
def list_atms(limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    """List all ATM locations"""
    atms = db.query(ATMLocation)\
        .offset(offset)\
        .limit(limit)\
        .all()
    return atms

@router.get("/city/{city}", response_model=list[ATMLocationResponse])
def get_atms_by_city(city: str, state: str = None, db: Session = Depends(get_db)):
    """Get ATM locations by city"""
    query = db.query(ATMLocation).filter(ATMLocation.city.ilike(f"%{city}%"))
    
    if state:
        query = query.filter(ATMLocation.state.ilike(f"%{state}%"))
    
    atms = query.all()
    return atms

@router.get("/nearby/", response_model=list[ATMLocationResponse])
def find_nearby_atms(latitude: float, longitude: float, radius_miles: float = 5.0, db: Session = Depends(get_db)):
    """Find nearby ATM locations (requires latitude and longitude)"""
    # Simple distance calculation (in production, use PostGIS)
    atms = db.query(ATMLocation)\
        .filter(ATMLocation.latitude != None)\
        .filter(ATMLocation.longitude != None)\
        .all()
    
    # Filter by approximate distance
    nearby = []
    for atm in atms:
        # Rough approximation: 1 degree ~ 69 miles
        lat_diff = abs(atm.latitude - latitude) * 69
        lon_diff = abs(atm.longitude - longitude) * 69
        distance = (lat_diff ** 2 + lon_diff ** 2) ** 0.5
        
        if distance <= radius_miles:
            nearby.append(atm)
    
    return nearby

@router.post("/", response_model=ATMLocationResponse)
def create_atm(atm_data: dict, db: Session = Depends(get_db)):
    """Create a new ATM location (admin only)"""
    new_atm = ATMLocation(**atm_data)
    db.add(new_atm)
    db.commit()
    db.refresh(new_atm)
    return new_atm
