from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status

from config import settings


GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText"
METERS_PER_MILE = 1609.344


@dataclass
class SearchCenter:
    latitude: float
    longitude: float
    label: str


def _ensure_configured() -> str:
    if settings.GOOGLE_MAPS_API_KEY:
        return settings.GOOGLE_MAPS_API_KEY
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="ATM locator is unavailable because GOOGLE_MAPS_API_KEY is not configured.",
    )


def _google_error_detail(response: httpx.Response, fallback: str) -> str:
    try:
        payload = response.json()
    except ValueError:
        return fallback

    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        status_text = error.get("status")
        if message and status_text:
            return f"{message} ({status_text})"
        if message:
            return str(message)
        return str(error)

    status_value = payload.get("status")
    error_message = payload.get("error_message")
    if error_message and status_value:
        return f"{error_message} ({status_value})"
    if error_message:
        return str(error_message)
    if status_value:
        return str(status_value)

    return fallback


def _distance_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)

    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lng / 2) ** 2
    )
    earth_radius_miles = 3958.7613
    return earth_radius_miles * (2 * math.atan2(math.sqrt(haversine), math.sqrt(1 - haversine)))


def _clamp_latitude(value: float) -> float:
    return max(-90.0, min(90.0, value))


def _normalize_longitude(value: float) -> float:
    while value < -180.0:
        value += 360.0
    while value > 180.0:
        value -= 360.0
    return value


def _rectangle_for_radius(center: SearchCenter, radius_miles: int) -> dict[str, dict[str, float]]:
    lat_delta = radius_miles / 69.0
    lng_divisor = max(math.cos(math.radians(center.latitude)), 0.01)
    lng_delta = radius_miles / (69.172 * lng_divisor)
    low_lat = _clamp_latitude(center.latitude - lat_delta)
    high_lat = _clamp_latitude(center.latitude + lat_delta)
    low_lng = _normalize_longitude(center.longitude - lng_delta)
    high_lng = _normalize_longitude(center.longitude + lng_delta)
    return {
        "low": {
            "latitude": low_lat,
            "longitude": low_lng,
        },
        "high": {
            "latitude": high_lat,
            "longitude": high_lng,
        },
    }


def _first_component(components: list[dict[str, Any]], component_type: str, *, short: bool = False) -> str:
    for component in components:
        if component_type in (component.get("types") or []):
            return component.get("shortText" if short else "longText") or component.get("longText") or ""
    return ""


def _build_address_fields(place: dict[str, Any]) -> tuple[str, str, str, str]:
    components = place.get("addressComponents") or []
    street_number = _first_component(components, "street_number")
    route = _first_component(components, "route")
    subpremise = _first_component(components, "subpremise")
    city = _first_component(components, "locality") or _first_component(components, "postal_town")
    state = _first_component(components, "administrative_area_level_1", short=True)
    zip_code = _first_component(components, "postal_code")

    street = " ".join(part for part in [street_number, route] if part).strip()
    if subpremise:
        street = ", ".join(part for part in [street, subpremise] if part)

    if not street:
        formatted = place.get("formattedAddress") or ""
        street = formatted.split(",")[0].strip() if formatted else ""

    return street, city, state, zip_code


def _build_directions_url(name: str, latitude: float, longitude: float, place_id: str) -> str:
    return "https://www.google.com/maps/dir/?" + urlencode(
        {
            "api": "1",
            "destination": f"{latitude},{longitude}",
            "destination_place_id": place_id,
            "travelmode": "driving",
            "query": name,
        }
    )


def _build_feature_chips(open_now: bool | None) -> list[str]:
    if open_now is True:
        return ["Open now"]
    if open_now is False:
        return ["Closed now"]
    return []


def _normalized_address_key(atm: dict[str, Any]) -> str:
    return "|".join(
        str(atm.get(part, "")).strip().lower()
        for part in ["address", "city", "state", "zip"]
    )


def _atm_priority(atm: dict[str, Any]) -> tuple[int, float]:
    source_type = str(atm.get("_sourceType") or "")
    return (0 if source_type == "atm" else 1, float(atm.get("distanceMiles") or 0.0))


def _map_place(place: dict[str, Any], *, center_lat: float, center_lng: float) -> dict[str, Any]:
    location = place.get("location") or {}
    latitude = float(location.get("latitude") or 0.0)
    longitude = float(location.get("longitude") or 0.0)
    display_name = ((place.get("displayName") or {}).get("text")) or "Chase ATM"
    open_now = (place.get("currentOpeningHours") or {}).get("openNow")
    street, city, state, zip_code = _build_address_fields(place)

    return {
        "id": place.get("id") or place.get("name") or display_name,
        "name": display_name,
        "address": street,
        "city": city,
        "state": state,
        "zip": zip_code,
        "latitude": latitude,
        "longitude": longitude,
        "distanceMiles": round(_distance_miles(center_lat, center_lng, latitude, longitude), 1),
        "features": _build_feature_chips(open_now),
        "hours": "Open now" if open_now is True else "Closed now" if open_now is False else "Hours unavailable",
        "openNow": open_now,
        "directionsUrl": _build_directions_url(display_name, latitude, longitude, place.get("id") or ""),
    }


async def geocode_query(query: str) -> SearchCenter:
    api_key = _ensure_configured()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            response = await client.get(
                GEOCODE_URL,
                params={"address": query, "key": api_key},
            )
            response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google geocoding timed out.") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Unable to reach Google geocoding: {exc}") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_google_error_detail(exc.response, "Google geocoding request failed."),
        ) from exc

    payload = response.json()
    if payload.get("status") != "OK" or not payload.get("results"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No locations matched that search.")

    result = payload["results"][0]
    location = result.get("geometry", {}).get("location", {})
    return SearchCenter(
        latitude=float(location.get("lat") or 0.0),
        longitude=float(location.get("lng") or 0.0),
        label=result.get("formatted_address") or query,
    )


async def search_chase_atms(
    *,
    center: SearchCenter,
    radius_miles: int,
    open_now: bool,
    limit: int,
) -> list[dict[str, Any]]:
    api_key = _ensure_configured()
    rectangle = _rectangle_for_radius(center, radius_miles)
    query_variants = [
        {"textQuery": "Chase ATM", "includedType": "atm"},
        {"textQuery": "Chase Bank", "includedType": "bank"},
    ]
    deduped_places: dict[str, tuple[str, dict[str, Any]]] = {}

    for variant in query_variants:
        next_page_token: str | None = None
        remaining_pages = 3

        while remaining_pages > 0:
            body: dict[str, Any] = {
                "textQuery": variant["textQuery"],
                "pageSize": 20,
                "includedType": variant["includedType"],
                "strictTypeFiltering": False,
                "rankPreference": "DISTANCE",
                "regionCode": "US",
                "locationRestriction": {
                    "rectangle": rectangle,
                },
            }
            if open_now:
                body["openNow"] = True
            if next_page_token:
                body["pageToken"] = next_page_token

            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
                    response = await client.post(
                        PLACES_SEARCH_TEXT_URL,
                        headers={
                            "X-Goog-Api-Key": api_key,
                            "X-Goog-FieldMask": ",".join(
                                [
                                    "places.id",
                                    "places.displayName",
                                    "places.formattedAddress",
                                    "places.addressComponents",
                                    "places.location",
                                    "places.currentOpeningHours.openNow",
                                    "nextPageToken",
                                ]
                            ),
                        },
                        json=body,
                    )
                    response.raise_for_status()
            except httpx.TimeoutException as exc:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google Places ATM search timed out.") from exc
            except httpx.RequestError as exc:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Unable to reach Google Places: {exc}") from exc
            except httpx.HTTPStatusError as exc:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=_google_error_detail(exc.response, "Google Places ATM search failed."),
                ) from exc

            payload = response.json()
            places = payload.get("places") or []
            for place in places:
                place_id = place.get("id") or place.get("name")
                if not place_id:
                    continue
                deduped_places[place_id] = (variant["includedType"], place)

            next_page_token = payload.get("nextPageToken")
            remaining_pages -= 1
            if not next_page_token:
                break

    mapped = [
        {
            **_map_place(place, center_lat=center.latitude, center_lng=center.longitude),
            "_sourceType": source_type,
        }
        for source_type, place in deduped_places.values()
        if "chase" in (((place.get("displayName") or {}).get("text")) or "").lower()
    ]
    mapped = [atm for atm in mapped if atm["distanceMiles"] <= radius_miles]
    by_address: dict[str, dict[str, Any]] = {}
    for atm in mapped:
        address_key = _normalized_address_key(atm)
        if not address_key:
            address_key = f"id:{atm['id']}"
        existing = by_address.get(address_key)
        if existing is None or _atm_priority(atm) < _atm_priority(existing):
            by_address[address_key] = atm
    mapped = list(by_address.values())
    mapped.sort(key=lambda atm: atm["distanceMiles"])
    return [
        {key: value for key, value in atm.items() if not key.startswith("_")}
        for atm in mapped[:limit]
    ]
