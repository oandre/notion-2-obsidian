import uvicorn

from notion_extractor.app import create_app
from notion_extractor.config import Settings


def main() -> None:
    settings = Settings()  # type: ignore[call-arg]
    app = create_app(
        token=settings.notion_token,
        output_dir=str(settings.output_dir),
    )
    print(f"Open http://{settings.host}:{settings.port}/")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
