import asyncio
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from notion_extractor.extract.pipeline import run_extraction
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.notion.discovery import list_shared_roots
from notion_extractor.progress import EventBus

STATIC_DIR = Path(__file__).parent / "web" / "static"


class RootDTO(BaseModel):
    id: str
    kind: str
    title: str


class ExtractRequest(BaseModel):
    selection: list[RootDTO]


def create_app(*, token: str, output_dir: str) -> FastAPI:
    app = FastAPI(title="notion-extractor")
    jobs: dict[str, EventBus] = {}

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/api/roots")
    async def get_roots() -> list[dict[str, Any]]:
        async with AsyncNotionClient(token=token) as client:
            roots = await list_shared_roots(client)
        return [{"id": r.id, "kind": r.kind.value, "title": r.title} for r in roots]

    @app.post("/api/extract")
    async def extract(req: ExtractRequest) -> dict[str, str]:
        bus = EventBus()
        job_id = uuid.uuid4().hex
        jobs[job_id] = bus

        selection = [(r.id, r.kind) for r in req.selection]

        async def run() -> None:
            async with AsyncNotionClient(token=token) as client:
                await run_extraction(
                    client=client,
                    bus=bus,
                    output_dir=Path(output_dir),
                    root_selection=selection,
                )

        asyncio.create_task(run())
        return {"job_id": job_id}

    @app.get("/api/events")
    async def events(job: str) -> StreamingResponse:
        bus = jobs.get(job)
        if bus is None:
            return StreamingResponse(iter([]), media_type="text/event-stream")

        async def stream():
            async for event in bus.subscribe():
                yield event.to_sse()

        return StreamingResponse(stream(), media_type="text/event-stream")

    return app
