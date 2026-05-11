from typing import Any


def rich_text_to_md(segments: list[dict[str, Any]]) -> str:
    return "".join(_segment_to_md(s) for s in segments)


def _segment_to_md(seg: dict[str, Any]) -> str:
    seg_type = seg.get("type", "text")

    if seg_type == "equation":
        return f"${seg['equation']['expression']}$"

    if seg_type == "mention":
        return _mention_to_md(seg)

    return _text_to_md(seg)


def _text_to_md(seg: dict[str, Any]) -> str:
    text = seg.get("plain_text", "")
    if not text:
        return ""

    ann = seg.get("annotations", {})
    href = seg.get("href")

    formatted = text
    if ann.get("code"):
        formatted = f"`{formatted}`"
    if ann.get("bold") and ann.get("italic"):
        formatted = f"***{formatted}***"
    elif ann.get("bold"):
        formatted = f"**{formatted}**"
    elif ann.get("italic"):
        formatted = f"*{formatted}*"
    if ann.get("strikethrough"):
        formatted = f"~~{formatted}~~"
    if ann.get("underline"):
        formatted = f"<u>{formatted}</u>"
    if href:
        formatted = f"[{formatted}]({href})"
    return formatted


def _mention_to_md(seg: dict[str, Any]) -> str:
    mention = seg.get("mention", {})
    m_type = mention.get("type")
    plain = seg.get("plain_text", "")

    if m_type == "page":
        page_id = mention["page"]["id"]
        return f"{{{{notion-link:{page_id}|{plain}}}}}"
    if m_type == "database":
        db_id = mention["database"]["id"]
        return f"{{{{notion-link:{db_id}|{plain}}}}}"
    if m_type == "date":
        return plain
    if m_type == "user":
        return plain
    return plain
