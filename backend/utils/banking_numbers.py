import random

from fastapi import HTTPException, status

from utils.supabase import supabase_client


def normalize_digits(value: str, *, field_name: str) -> str:
    digits = "".join(char for char in value if char.isdigit())
    if not digits:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required.")
    return digits


def validate_routing_number(value: str) -> str:
    digits = normalize_digits(value, field_name="Routing number")
    if len(digits) != 9:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Routing number must be 9 digits.")
    checksum = (
        3 * (int(digits[0]) + int(digits[3]) + int(digits[6]))
        + 7 * (int(digits[1]) + int(digits[4]) + int(digits[7]))
        + int(digits[2]) + int(digits[5]) + int(digits[8])
    )
    if checksum % 10 != 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Routing number is invalid.")
    return digits


def validate_account_number(value: str, *, field_name: str = "Account number") -> str:
    digits = normalize_digits(value, field_name=field_name)
    if len(digits) < 4 or len(digits) > 17:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be between 4 and 17 digits.",
        )
    if set(digits) == {"0"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} cannot be all zeros.")
    return digits


def _generate_valid_routing_number() -> str:
    prefix = "".join(str(random.randint(0, 9)) for _ in range(8))
    weighted = (
        3 * (int(prefix[0]) + int(prefix[3]) + int(prefix[6]))
        + 7 * (int(prefix[1]) + int(prefix[4]) + int(prefix[7]))
        + int(prefix[2]) + int(prefix[5])
    )
    check_digit = (10 - (weighted % 10)) % 10
    return f"{prefix}{check_digit}"


def _generate_account_number(length: int = 12) -> str:
    return "".join(str(random.randint(0, 9)) for _ in range(length))


async def generate_unique_account_identifiers(max_attempts: int = 100) -> tuple[str, str]:
    for _ in range(max_attempts):
        routing_number = _generate_valid_routing_number()
        account_number = _generate_account_number()
        if account_number == routing_number:
            continue
        existing = await supabase_client.select_rows(
            "accounts",
            select="id",
            filters={"or": f"(routing_number.eq.{routing_number},account_number.eq.{account_number})"},
            limit=1,
        )
        if not existing:
            return routing_number, account_number
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Unable to generate unique account identifiers. Please try again.",
    )


async def generate_unique_account_number(max_attempts: int = 100) -> str:
    for _ in range(max_attempts):
        account_number = _generate_account_number()
        existing = await supabase_client.select_rows(
            "accounts",
            select="id",
            filters={"account_number": f"eq.{account_number}"},
            limit=1,
        )
        if not existing:
            return account_number
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Unable to generate a unique account number. Please try again.",
    )
