import asyncio
import enum
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any


class EventKind(enum.StrEnum):
    DISCOVERY_STARTED = "discovery_started"
    DISCOVERY_PROGRESS = "discovery_progress"
    DISCOVERY_DONE = "discovery_done"
    NODE_STARTED = "node_started"
    NODE_DONE = "node_done"
    NODE_FAILED = "node_failed"
    ATTACHMENT_DOWNLOADED = "attachment_downloaded"
    EXTRACTION_DONE = "extraction_done"
    ERROR = "error"


@dataclass
class Event:
    kind: EventKind
    data: dict[str, Any] = field(default_factory=dict)

    def to_sse(self) -> str:
        payload = json.dumps(self.data)
        return f"event: {self.kind.value}\ndata: {payload}\n\n"


class EventBus:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[Event]] = []

    async def publish(self, event: Event) -> None:
        for q in list(self._subscribers):
            await q.put(event)

    async def subscribe(self) -> AsyncIterator[Event]:
        queue: asyncio.Queue[Event] = asyncio.Queue()
        self._subscribers.append(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._subscribers.remove(queue)
