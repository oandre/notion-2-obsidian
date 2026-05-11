from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

from notion_extractor.convert.inline import rich_text_to_md

BlockHandler = Callable[[dict[str, Any], "RenderContext"], str]


class RenderContext:
    def __init__(self, indent: int = 0, list_counter: list[int] | None = None) -> None:
        self.indent = indent
        self.list_counter = list_counter if list_counter is not None else [0]

    def child(self) -> "RenderContext":
        return RenderContext(indent=self.indent + 1, list_counter=[0])


def blocks_to_md(blocks: list[dict[str, Any]]) -> str:
    ctx = RenderContext()
    return _render_blocks(blocks, ctx)


def _render_blocks(blocks: list[dict[str, Any]], ctx: RenderContext) -> str:
    out: list[str] = []
    prev_type: str | None = None
    counter = 0

    for block in blocks:
        block_type = block.get("type", "")

        if block_type == "numbered_list_item":
            if prev_type != "numbered_list_item":
                counter = 0
            counter += 1
            line = _render_numbered(block, counter, ctx)
        else:
            counter = 0
            line = _render_block(block, ctx)

        if line:
            sep = _separator(prev_type, block_type)
            if sep and out:
                out.append(sep)
            out.append(line)
        prev_type = block_type

    return "".join(out)


def _separator(prev: str | None, current: str) -> str:
    list_types = {"bulleted_list_item", "numbered_list_item", "to_do"}
    if prev in list_types and current in list_types and prev == current:
        return ""
    if prev is None:
        return ""
    return "\n"


def _render_block(block: dict[str, Any], ctx: RenderContext) -> str:
    handler = _HANDLERS.get(block.get("type", ""))
    if handler is None:
        return f"<!-- unsupported block: {block.get('type')} -->\n"
    return handler(block, ctx)


def _indent_str(ctx: RenderContext) -> str:
    return "  " * ctx.indent


def _render_children(block: dict[str, Any], ctx: RenderContext) -> str:
    children = block.get("children", [])
    if not children:
        return ""
    return _render_blocks(children, ctx.child())


def _paragraph(block: dict, ctx: RenderContext) -> str:
    text = rich_text_to_md(block["paragraph"]["rich_text"])
    body = f"{_indent_str(ctx)}{text}\n"
    return body + _render_children(block, ctx)


def _heading(level: int) -> BlockHandler:
    def handler(block: dict, ctx: RenderContext) -> str:
        key = f"heading_{level}"
        text = rich_text_to_md(block[key]["rich_text"])
        return f"{'#' * level} {text}\n" + _render_children(block, ctx)

    return handler


def _bulleted(block: dict, ctx: RenderContext) -> str:
    text = rich_text_to_md(block["bulleted_list_item"]["rich_text"])
    body = f"{_indent_str(ctx)}- {text}\n"
    return body + _render_children(block, ctx)


def _render_numbered(block: dict, n: int, ctx: RenderContext) -> str:
    text = rich_text_to_md(block["numbered_list_item"]["rich_text"])
    body = f"{_indent_str(ctx)}{n}. {text}\n"
    return body + _render_children(block, ctx)


def _todo(block: dict, ctx: RenderContext) -> str:
    payload = block["to_do"]
    text = rich_text_to_md(payload["rich_text"])
    mark = "x" if payload.get("checked") else " "
    body = f"{_indent_str(ctx)}- [{mark}] {text}\n"
    return body + _render_children(block, ctx)


def _quote(block: dict, ctx: RenderContext) -> str:
    text = rich_text_to_md(block["quote"]["rich_text"])
    return f"> {text}\n" + _render_children(block, ctx)


def _divider(_block: dict, _ctx: RenderContext) -> str:
    return "---\n"


def _code(block: dict, _ctx: RenderContext) -> str:
    payload = block["code"]
    lang = payload.get("language", "")
    if lang == "plain text":
        lang = ""
    text = rich_text_to_md(payload["rich_text"])
    return f"```{lang}\n{text}\n```\n"


_CALLOUT_EMOJI_MAP = {
    "💡": "tip",
    "⚠️": "warning",
    "❌": "danger",
    "🚫": "danger",
    "ℹ️": "info",
    "✅": "success",
    "❓": "question",
}


def _callout(block: dict, _ctx: RenderContext) -> str:
    payload = block["callout"]
    text = rich_text_to_md(payload["rich_text"])
    icon = payload.get("icon") or {}
    emoji = icon.get("emoji", "") if icon.get("type") == "emoji" else ""
    callout_type = _CALLOUT_EMOJI_MAP.get(emoji, "note")

    lines = [f"> [!{callout_type}]", f"> {text}"]
    children = block.get("children", [])
    if children:
        child_md = _render_blocks(children, RenderContext())
        lines.append(">")
        for child_line in child_md.rstrip("\n").splitlines():
            lines.append(f"> {child_line}" if child_line else ">")
    return "\n".join(lines) + "\n"


def _toggle(block: dict, ctx: RenderContext) -> str:
    summary = rich_text_to_md(block["toggle"]["rich_text"])
    children_md = _render_children(block, ctx).strip()
    inner = f"\n{children_md}\n" if children_md else ""
    return f"<details>\n<summary>{summary}</summary>\n{inner}\n</details>\n"


def _equation_block(block: dict, _ctx: RenderContext) -> str:
    expr = block["equation"]["expression"]
    return f"$$\n{expr}\n$$\n"


def _table(block: dict, _ctx: RenderContext) -> str:
    table = block["table"]
    width = table.get("table_width", 0)
    has_header = table.get("has_column_header", False)
    rows = block.get("children", [])

    def render_row(cells: list[list[dict]]) -> str:
        rendered = [rich_text_to_md(c) for c in cells]
        padded = rendered + [""] * (width - len(rendered))
        return "| " + " | ".join(padded) + " |\n"

    out: list[str] = []
    if has_header and rows:
        out.append(render_row(rows[0]["table_row"]["cells"]))
        out.append("| " + " | ".join(["---"] * width) + " |\n")
        body = rows[1:]
    else:
        out.append("| " + " | ".join([""] * width) + " |\n")
        out.append("| " + " | ".join(["---"] * width) + " |\n")
        body = rows

    for row in body:
        out.append(render_row(row["table_row"]["cells"]))
    return "".join(out)


def _media_url_and_external(payload: dict) -> tuple[str, bool]:
    kind = payload.get("type", "file")
    inner = payload.get(kind, {})
    url = inner.get("url", "")
    is_external = kind == "external"
    return url, is_external


def _asset_target(url: str, is_external: bool) -> str:
    return url if is_external else f"{{{{notion-asset:{url}}}}}"


def _basename(url: str) -> str:
    path = urlparse(url).path
    return path.rsplit("/", 1)[-1] or "file"


def _image(block: dict, _ctx: RenderContext) -> str:
    payload = block["image"]
    url, is_external = _media_url_and_external(payload)
    caption = rich_text_to_md(payload.get("caption") or [])
    target = _asset_target(url, is_external)
    return f"![{caption}]({target})\n"


def _file_like(field: str) -> BlockHandler:
    def handler(block: dict, _ctx: RenderContext) -> str:
        payload = block[field]
        url, is_external = _media_url_and_external(payload)
        caption = rich_text_to_md(payload.get("caption") or []) or _basename(url)
        target = _asset_target(url, is_external)
        return f"[{caption}]({target})\n"

    return handler


_OBSIDIAN_EMBED_HOSTS = {
    "www.youtube.com",
    "youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "vimeo.com",
    "loom.com",
    "www.loom.com",
    "figma.com",
    "www.figma.com",
}


def _is_embeddable(url: str) -> bool:
    return urlparse(url).hostname in _OBSIDIAN_EMBED_HOSTS


def _display_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.path and parsed.path != "/":
        return f"{parsed.hostname}{parsed.path}"
    return parsed.hostname or url


def _embed_block(field: str) -> BlockHandler:
    def handler(block: dict, _ctx: RenderContext) -> str:
        payload = block[field]
        url = payload.get("url", "")
        caption = rich_text_to_md(payload.get("caption") or [])
        if _is_embeddable(url):
            return f"![{caption}]({url})\n"
        display = caption or _display_url(url)
        return f"[{display}]({url})\n"

    return handler


def _child_page(block: dict, _ctx: RenderContext) -> str:
    page_id = block.get("id", "")
    title = block["child_page"].get("title", "")
    return f"{{{{notion-link:{page_id}|{title}}}}}\n"


def _child_database(block: dict, _ctx: RenderContext) -> str:
    db_id = block.get("id", "")
    title = block["child_database"].get("title", "")
    return f"{{{{notion-link:{db_id}|{title}}}}}\n"


def _link_to_page(block: dict, _ctx: RenderContext) -> str:
    payload = block["link_to_page"]
    if payload.get("type") == "page_id":
        target = payload["page_id"]
    elif payload.get("type") == "database_id":
        target = payload["database_id"]
    else:
        return ""
    return f"{{{{notion-link:{target}}}}}\n"


_HANDLERS: dict[str, BlockHandler] = {
    "paragraph": _paragraph,
    "heading_1": _heading(1),
    "heading_2": _heading(2),
    "heading_3": _heading(3),
    "bulleted_list_item": _bulleted,
    "to_do": _todo,
    "quote": _quote,
    "divider": _divider,
    "code": _code,
    "callout": _callout,
    "toggle": _toggle,
    "equation": _equation_block,
    "table": _table,
    "image": _image,
    "pdf": _file_like("pdf"),
    "file": _file_like("file"),
    "video": _file_like("video"),
    "audio": _file_like("audio"),
    "bookmark": _embed_block("bookmark"),
    "embed": _embed_block("embed"),
    "link_preview": _embed_block("link_preview"),
    "child_page": _child_page,
    "child_database": _child_database,
    "link_to_page": _link_to_page,
}
