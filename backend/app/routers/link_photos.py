from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..link_photos import find_link_photos
from ..permissions import IDEAS_ADD, Access, require

router = APIRouter(tags=["pins"])


class LinkPhotosOut(BaseModel):
    status: Literal["ok", "empty", "unreachable"]
    photos: list[str]


@router.get("/api/trips/{trip_id}/link-photos", response_model=LinkPhotosOut)
def link_photos(
    trip_id: int,
    url: str = Query(max_length=2000),
    _: Access = Depends(require(IDEAS_ADD)),
):
    """Photos a pin's link offers, for the photo picker
    (docs/features/pin-photos-spec.md). Sync on purpose: the fetch blocks,
    and FastAPI runs sync handlers in its threadpool. Scoped to a trip
    only so the server fetches pages for people adding ideas, not for any
    signed-in account."""
    found = find_link_photos(url)
    return LinkPhotosOut(status=found.status, photos=found.photos)
