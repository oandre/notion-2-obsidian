from collections.abc import Callable
from typing import Any

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
}
