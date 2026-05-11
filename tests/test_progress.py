import asyncio

import pytest

from notion_extractor.progress import Event, EventBus, EventKind


@pytest.mark.asyncio
async def test_publish_and_subscribe() -> None:
    bus = EventBus()
    received: list[Event] = []

    async def consume() -> None:
        async for event in bus.subscribe():
            received.append(event)
            if event.kind == EventKind.EXTRACTION_DONE:
                break

    consumer = asyncio.create_task(consume())
    await asyncio.sleep(0)
    await bus.publish(Event(kind=EventKind.DISCOVERY_STARTED, data={}))
    await bus.publish(Event(kind=EventKind.EXTRACTION_DONE, data={"ok": True}))
    await consumer

    assert [e.kind for e in received] == [
        EventKind.DISCOVERY_STARTED,
        EventKind.EXTRACTION_DONE,
    ]


@pytest.mark.asyncio
async def test_event_to_sse_format() -> None:
    event = Event(kind=EventKind.NODE_DONE, data={"id": "p1", "title": "X"})
    sse = event.to_sse()
    assert sse.startswith("event: node_done\n")
    assert '"id": "p1"' in sse
    assert sse.endswith("\n\n")
