from fastapi import APIRouter
from starlette.responses import StreamingResponse

from ..events import sse_stream

router = APIRouter(prefix="/api", tags=["events"])


@router.get("/trips/{trip_id}/events")
async def trip_events(trip_id: int):
    """Server-Sent Events stream for one trip: votes, locks, pin edits, and
    comments all publish here (see app/events.py) so the group sees changes
    without refreshing — the "REST + SSE" answer from project setup.

    Single-replica only for now; see app/events.py docstring for the
    scale-out path.
    """
    return StreamingResponse(sse_stream(trip_id), media_type="text/event-stream")
