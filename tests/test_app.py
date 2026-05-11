from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from notion_extractor.app import create_app


def test_get_roots(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/search",
        json={
            "results": [
                {
                    "object": "page",
                    "id": "p1",
                    "properties": {
                        "title": {
                            "type": "title",
                            "title": [
                                {
                                    "plain_text": "Top",
                                    "type": "text",
                                    "text": {"content": "Top", "link": None},
                                    "href": None,
                                    "annotations": {
                                        "bold": False,
                                        "italic": False,
                                        "strikethrough": False,
                                        "underline": False,
                                        "code": False,
                                        "color": "default",
                                    },
                                }
                            ],
                        }
                    },
                }
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )

    app = create_app(token="t", output_dir="/tmp/v")
    client = TestClient(app)
    response = client.get("/api/roots")
    assert response.status_code == 200
    data = response.json()
    assert data == [{"id": "p1", "kind": "page", "title": "Top"}]


def test_index_serves_html() -> None:
    app = create_app(token="t", output_dir="/tmp/v")
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "<html" in response.text.lower()
