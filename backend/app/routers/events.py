from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

from ..auth import Principal, get_current_principal
from ..db import SessionLocal
from ..events import sse_stream
from ..models import Trip
from ..permissions import TRIP_READ, access_for

router = APIRouter(prefix="/api", tags=["events"])


def _ensure_member(trip_id: int, principal: Principal) -> None:
    # Its own short-lived session rather than Depends(get_db): a
    # request-scoped session would stay open, holding a pooled connection,
    # for as long as the stream does.
    with SessionLocal() as db:
        if db.get(Trip, trip_id) is None:
            raise HTTPException(status_code=404, detail="Trip not found")
        access = access_for(db, trip_id, principal)
        if access is None:
            raise HTTPException(status_code=403, detail={"message": "You're not on this trip", "missing_scope": TRIP_READ})
        access.ensure(TRIP_READ)


@router.get("/trips/{trip_id}/events")
async def trip_events(trip_id: int, principal: Principal = Depends(get_current_principal)):
    """Server-Sent Events stream for one trip: votes, locks, pin edits, and
    comments all publish here (see app/events.py) so the group sees changes
    without refreshing — the "REST + SSE" answer from project setup.

    Members only (trip:read). Events carry ids, never content or costs; a
    client reads the details back through the scope-checked endpoints.

    Single-replica only for now; see app/events.py docstring for the
    scale-out path.
    """
    await run_in_threadpool(_ensure_member, trip_id, principal)
    return StreamingResponse(sse_stream(trip_id), media_type="text/event-stream")


trip_events.required_scopes = (TRIP_READ,)  # read by tests/test_permissions.py
