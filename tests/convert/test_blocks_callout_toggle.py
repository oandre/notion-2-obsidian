from notion_extractor.convert.blocks import blocks_to_md


def _text_rich(content: str) -> list[dict]:
    return [
        {
            "type": "text",
            "text": {"content": content, "link": None},
            "plain_text": content,
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


def _block(block_type: str, payload: dict, children: list[dict] | None = None) -> dict:
    return {
        "type": block_type,
        block_type: payload,
        "has_children": bool(children),
        "children": children or [],
    }


def test_callout_default_note() -> None:
    block = _block(
        "callout",
        {
            "rich_text": _text_rich("heads up"),
            "icon": {"type": "emoji", "emoji": "🗒️"},
        },
    )
    assert blocks_to_md([block]) == "> [!note]\n> heads up\n"


def test_callout_tip_from_emoji() -> None:
    block = _block(
        "callout",
        {
            "rich_text": _text_rich("nice idea"),
            "icon": {"type": "emoji", "emoji": "💡"},
        },
    )
    assert blocks_to_md([block]) == "> [!tip]\n> nice idea\n"


def test_callout_warning() -> None:
    block = _block(
        "callout",
        {
            "rich_text": _text_rich("careful"),
            "icon": {"type": "emoji", "emoji": "⚠️"},
        },
    )
    assert blocks_to_md([block]) == "> [!warning]\n> careful\n"


def test_callout_danger() -> None:
    block = _block(
        "callout",
        {
            "rich_text": _text_rich("nope"),
            "icon": {"type": "emoji", "emoji": "❌"},
        },
    )
    assert blocks_to_md([block]) == "> [!danger]\n> nope\n"


def test_callout_info() -> None:
    block = _block(
        "callout",
        {
            "rich_text": _text_rich("fyi"),
            "icon": {"type": "emoji", "emoji": "ℹ️"},
        },
    )
    assert blocks_to_md([block]) == "> [!info]\n> fyi\n"


def test_callout_with_multiline_children() -> None:
    child = _block("paragraph", {"rich_text": _text_rich("extra")})
    block = _block(
        "callout",
        {"rich_text": _text_rich("main"), "icon": {"type": "emoji", "emoji": "💡"}},
        children=[child],
    )
    assert blocks_to_md([block]) == "> [!tip]\n> main\n>\n> extra\n"


def test_toggle_collapsible() -> None:
    child = _block("paragraph", {"rich_text": _text_rich("hidden")})
    block = _block("toggle", {"rich_text": _text_rich("Click me")}, children=[child])
    expected = "<details>\n<summary>Click me</summary>\n\nhidden\n\n</details>\n"
    assert blocks_to_md([block]) == expected


def test_toggle_empty() -> None:
    block = _block("toggle", {"rich_text": _text_rich("Click me")})
    expected = "<details>\n<summary>Click me</summary>\n\n</details>\n"
    assert blocks_to_md([block]) == expected
