"""In-memory Server-Sent Events broadcaster, one channel per trip.

Per the project's AskUserQuestion answer ("REST + SSE" for live sync): votes,
comments, and edits should be visible to the whole group without a manual
refresh. This in-memory implementation is intentionally simple for a first
pass — it works as long as the Container App runs a single replica. Scaling
to multiple replicas needs a shared broker behind this same interface
(Azure Web PubSub or Redis pub/sub are the natural fits on Azure); nothing
in the routers needs to change, only `publish`/`subscribe` below.
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any


@dataclass
class _TripChannel:
    subscribers: set[asyncio.Queue] = field(default_factory=set)


class EventBus:
    def __init__(self) -> None:
        self._channels: dict[str, _TripChannel] = defaultdict(_TripChannel)

    def subscribe(self, trip_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._channels[trip_id].subscribers.add(queue)
        return queue

    def unsubscribe(self, trip_id: str, queue: asyncio.Queue) -> None:
        self._channels[trip_id].subscribers.discard(queue)

    def publish(self, trip_id: str, event: str, data: dict[str, Any]) -> None:
        channel = self._channels.get(trip_id)
        if not channel:
            return
        message = json.dumps({"event": event, "data": data})
        for queue in list(channel.subscribers):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # A slow subscriber falls behind rather than blocking
                # everyone else; it'll pick up fresh state on next fetch.
                continue


bus = EventBus()


async def sse_stream(trip_id: str) -> AsyncIterator[str]:
    queue = bus.subscribe(trip_id)
    try:
        yield "event: connected\ndata: {}\n\n"
        while True:
            message = await queue.get()
            yield f"data: {message}\n\n"
    finally:
        bus.unsubscribe(trip_id, queue)
