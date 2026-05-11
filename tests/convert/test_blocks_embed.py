from notion_extractor.convert.blocks import blocks_to_md


def _embed(block_type: str, url: str, caption: str = "") -> dict:
    payload = {"url": url, "caption": []}
    if caption:
        payload["caption"] = [
            {
                "type": "text",
                "text": {"content": caption, "link": None},
                "plain_text": caption,
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
        ]
    return {
        "type": block_type,
        block_type: payload,
        "has_children": False,
        "children": [],
    }


def test_bookmark_falls_back_to_link() -> None:
    block = _embed("bookmark", "https://example.com")
    assert blocks_to_md([block]) == "[example.com](https://example.com)\n"


def test_bookmark_with_caption() -> None:
    block = _embed("bookmark", "https://example.com", caption="Cool site")
    assert blocks_to_md([block]) == "[Cool site](https://example.com)\n"


def test_youtube_embed() -> None:
    block = _embed("embed", "https://www.youtube.com/watch?v=abc")
    assert blocks_to_md([block]) == "![](https://www.youtube.com/watch?v=abc)\n"


def test_link_preview() -> None:
    block = _embed("link_preview", "https://example.com/page")
    assert blocks_to_md([block]) == "[example.com/page](https://example.com/page)\n"


def test_twitter_embed_native() -> None:
    block = _embed("embed", "https://twitter.com/x/status/123")
    assert blocks_to_md([block]) == "![](https://twitter.com/x/status/123)\n"
