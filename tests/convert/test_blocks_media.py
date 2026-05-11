from notion_extractor.convert.blocks import blocks_to_md


def _text_rich(content: str) -> list[dict]:
    return [{
        "type": "text",
        "text": {"content": content, "link": None},
        "plain_text": content,
        "href": None,
        "annotations": {
            "bold": False, "italic": False, "strikethrough": False,
            "underline": False, "code": False, "color": "default",
        },
    }]


def _file_block(
    block_type: str, url: str, *, caption: str = "", file_kind: str = "file"
) -> dict:
    if file_kind == "file":
        payload = {
            "type": "file",
            "file": {"url": url, "expiry_time": "2026-12-31T00:00:00.000Z"},
            "caption": _text_rich(caption) if caption else [],
        }
    else:
        payload = {
            "type": "external",
            "external": {"url": url},
            "caption": _text_rich(caption) if caption else [],
        }
    return {
        "type": block_type,
        block_type: payload,
        "has_children": False,
        "children": [],
    }


def test_image_internal_emits_asset_placeholder() -> None:
    block = _file_block(
        "image", "https://prod-files.s3.amazonaws.com/x.png", caption="screenshot"
    )
    assert blocks_to_md([block]) == (
        "![screenshot]({{notion-asset:https://prod-files.s3.amazonaws.com/x.png}})\n"
    )


def test_image_external_kept_as_external() -> None:
    block = _file_block("image", "https://example.com/x.png", file_kind="external")
    assert blocks_to_md([block]) == "![](https://example.com/x.png)\n"


def test_pdf_block() -> None:
    block = _file_block(
        "pdf", "https://prod-files.s3.amazonaws.com/doc.pdf", caption="paper"
    )
    assert blocks_to_md([block]) == (
        "[paper]({{notion-asset:https://prod-files.s3.amazonaws.com/doc.pdf}})\n"
    )


def test_file_block_no_caption_uses_basename() -> None:
    block = _file_block(
        "file", "https://prod-files.s3.amazonaws.com/folder/report.docx"
    )
    assert blocks_to_md([block]) == (
        "[report.docx]({{notion-asset:https://prod-files.s3.amazonaws.com/folder/report.docx}})\n"
    )


def test_video_internal() -> None:
    block = _file_block(
        "video", "https://prod-files.s3.amazonaws.com/v.mp4", caption="clip"
    )
    assert blocks_to_md([block]) == (
        "[clip]({{notion-asset:https://prod-files.s3.amazonaws.com/v.mp4}})\n"
    )
