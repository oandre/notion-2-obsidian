from notion_extractor.convert.inline import rich_text_to_md


def _seg(
    text: str,
    *,
    bold: bool = False,
    italic: bool = False,
    code: bool = False,
    strikethrough: bool = False,
    underline: bool = False,
    href: str | None = None,
) -> dict:
    return {
        "type": "text",
        "text": {"content": text, "link": {"url": href} if href else None},
        "plain_text": text,
        "href": href,
        "annotations": {
            "bold": bold,
            "italic": italic,
            "strikethrough": strikethrough,
            "underline": underline,
            "code": code,
            "color": "default",
        },
    }


def test_plain_text() -> None:
    assert rich_text_to_md([_seg("hello")]) == "hello"


def test_bold() -> None:
    assert rich_text_to_md([_seg("hi", bold=True)]) == "**hi**"


def test_italic() -> None:
    assert rich_text_to_md([_seg("hi", italic=True)]) == "*hi*"


def test_bold_italic() -> None:
    assert rich_text_to_md([_seg("hi", bold=True, italic=True)]) == "***hi***"


def test_strikethrough() -> None:
    assert rich_text_to_md([_seg("hi", strikethrough=True)]) == "~~hi~~"


def test_underline_uses_html() -> None:
    assert rich_text_to_md([_seg("hi", underline=True)]) == "<u>hi</u>"


def test_code() -> None:
    assert rich_text_to_md([_seg("x", code=True)]) == "`x`"


def test_link() -> None:
    assert rich_text_to_md([_seg("docs", href="https://x.dev")]) == "[docs](https://x.dev)"


def test_link_with_bold() -> None:
    result = rich_text_to_md([_seg("docs", bold=True, href="https://x.dev")])
    assert result == "[**docs**](https://x.dev)"


def test_mention_page_emits_placeholder() -> None:
    mention = {
        "type": "mention",
        "mention": {"type": "page", "page": {"id": "abc-123"}},
        "plain_text": "Some Page",
        "href": "https://www.notion.so/abc123",
        "annotations": {
            "bold": False,
            "italic": False,
            "strikethrough": False,
            "underline": False,
            "code": False,
            "color": "default",
        },
    }
    assert rich_text_to_md([mention]) == "{{notion-link:abc-123|Some Page}}"


def test_mention_date() -> None:
    mention = {
        "type": "mention",
        "mention": {"type": "date", "date": {"start": "2026-05-11"}},
        "plain_text": "2026-05-11",
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
    assert rich_text_to_md([mention]) == "2026-05-11"


def test_inline_equation() -> None:
    seg = {
        "type": "equation",
        "equation": {"expression": "x^2"},
        "plain_text": "x^2",
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
    assert rich_text_to_md([seg]) == "$x^2$"


def test_concatenates_segments() -> None:
    segs = [_seg("hello "), _seg("world", bold=True)]
    assert rich_text_to_md(segs) == "hello **world**"


def test_empty() -> None:
    assert rich_text_to_md([]) == ""
