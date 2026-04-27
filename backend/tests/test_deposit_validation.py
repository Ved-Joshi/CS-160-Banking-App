import pytest
from fastapi import HTTPException

from routers.banking_read import validate_check_image_upload_meta


def test_validate_check_image_upload_meta_accepts_valid_image() -> None:
    validate_check_image_upload_meta(
        side="Front",
        file_name="front-check.jpg",
        content_type="image/jpeg",
        size_bytes=150_000,
    )


def test_validate_check_image_upload_meta_rejects_invalid_type() -> None:
    with pytest.raises(HTTPException) as exc:
        validate_check_image_upload_meta(
            side="Front",
            file_name="front-check.jpg",
            content_type="application/pdf",
            size_bytes=150_000,
        )
    assert exc.value.status_code == 400


def test_validate_check_image_upload_meta_rejects_invalid_extension() -> None:
    with pytest.raises(HTTPException) as exc:
        validate_check_image_upload_meta(
            side="Back",
            file_name="back-check.bmp",
            content_type="image/jpeg",
            size_bytes=150_000,
        )
    assert exc.value.status_code == 400


def test_validate_check_image_upload_meta_rejects_too_small() -> None:
    with pytest.raises(HTTPException) as exc:
        validate_check_image_upload_meta(
            side="Back",
            file_name="back-check.png",
            content_type="image/png",
            size_bytes=100,
        )
    assert exc.value.status_code == 400
