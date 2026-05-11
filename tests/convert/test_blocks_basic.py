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


def test_paragraph() -> None:
    block = _block("paragraph", {"rich_text": _text_rich("hello")})
    assert blocks_to_md([block]) == "hello\n"


def test_heading_levels() -> None:
    blocks = [
        _block("heading_1", {"rich_text": _text_rich("A")}),
        _block("heading_2", {"rich_text": _text_rich("B")}),
        _block("heading_3", {"rich_text": _text_rich("C")}),
    ]
    assert blocks_to_md(blocks) == "# A\n\n## B\n\n### C\n"


def test_bulleted_list() -> None:
    blocks = [
        _block("bulleted_list_item", {"rich_text": _text_rich("one")}),
        _block("bulleted_list_item", {"rich_text": _text_rich("two")}),
    ]
    assert blocks_to_md(blocks) == "- one\n- two\n"


def test_numbered_list() -> None:
    blocks = [
        _block("numbered_list_item", {"rich_text": _text_rich("one")}),
        _block("numbered_list_item", {"rich_text": _text_rich("two")}),
    ]
    assert blocks_to_md(blocks) == "1. one\n2. two\n"


def test_numbered_list_resets_after_paragraph() -> None:
    blocks = [
        _block("numbered_list_item", {"rich_text": _text_rich("one")}),
        _block("paragraph", {"rich_text": _text_rich("p")}),
        _block("numbered_list_item", {"rich_text": _text_rich("two")}),
    ]
    assert blocks_to_md(blocks) == "1. one\n\np\n\n1. two\n"


def test_todo() -> None:
    blocks = [
        _block("to_do", {"rich_text": _text_rich("do it"), "checked": False}),
        _block("to_do", {"rich_text": _text_rich("done"), "checked": True}),
    ]
    assert blocks_to_md(blocks) == "- [ ] do it\n- [x] done\n"


def test_quote() -> None:
    block = _block("quote", {"rich_text": _text_rich("wise words")})
    assert blocks_to_md([block]) == "> wise words\n"


def test_divider() -> None:
    block = _block("divider", {})
    assert blocks_to_md([block]) == "---\n"


def test_code_block() -> None:
    block = _block("code", {"rich_text": _text_rich("print(1)"), "language": "python"})
    assert blocks_to_md([block]) == "```python\nprint(1)\n```\n"


def test_code_block_plain() -> None:
    block = _block("code", {"rich_text": _text_rich("x"), "language": "plain text"})
    assert blocks_to_md([block]) == "```\nx\n```\n"


def test_nested_bullets_indented() -> None:
    child = _block("bulleted_list_item", {"rich_text": _text_rich("child")})
    parent = _block("bulleted_list_item", {"rich_text": _text_rich("parent")}, children=[child])
    assert blocks_to_md([parent]) == "- parent\n  - child\n"
