from typing import Any

from notion_extractor.convert.inline import rich_text_to_md


def properties_to_frontmatter(properties: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {name: _convert(prop) for name, prop in properties.items()}


def _convert(prop: dict[str, Any]) -> Any:
    ptype = prop.get("type")
    if ptype == "title":
        return rich_text_to_md(prop.get("title", []))
    if ptype == "rich_text":
        return rich_text_to_md(prop.get("rich_text", []))
    if ptype == "number":
        return prop.get("number")
    if ptype == "select":
        sel = prop.get("select")
        return sel.get("name") if sel else None
    if ptype == "multi_select":
        return [item["name"] for item in prop.get("multi_select", [])]
    if ptype == "status":
        st = prop.get("status")
        return st.get("name") if st else None
    if ptype == "date":
        return _date_to_str(prop.get("date"))
    if ptype == "checkbox":
        return prop.get("checkbox")
    if ptype == "url":
        return prop.get("url")
    if ptype == "email":
        return prop.get("email")
    if ptype == "phone_number":
        return prop.get("phone_number")
    if ptype == "people":
        return [p.get("name") for p in prop.get("people", []) if p.get("name")]
    if ptype == "files":
        return [_file_value(f) for f in prop.get("files", [])]
    if ptype == "relation":
        return [f"{{{{notion-link:{r['id']}}}}}" for r in prop.get("relation", [])]
    if ptype == "formula":
        return _formula_value(prop.get("formula", {}))
    if ptype == "rollup":
        return _rollup_value(prop.get("rollup", {}))
    if ptype in ("created_time", "last_edited_time"):
        return prop.get(ptype)
    if ptype in ("created_by", "last_edited_by"):
        user = prop.get(ptype) or {}
        return user.get("name")
    return None


def _date_to_str(date: dict[str, Any] | None) -> str | None:
    if not date:
        return None
    start = date.get("start")
    end = date.get("end")
    if end:
        return f"{start}/{end}"
    return start


def _file_value(f: dict[str, Any]) -> str:
    if f.get("type") == "external":
        return f["external"]["url"]
    return f"{{{{notion-asset:{f['file']['url']}}}}}"


def _formula_value(formula: dict[str, Any]) -> Any:
    ftype = formula.get("type")
    if ftype == "number":
        return formula.get("number")
    if ftype == "string":
        return formula.get("string")
    if ftype == "boolean":
        return formula.get("boolean")
    if ftype == "date":
        return _date_to_str(formula.get("date"))
    return None


def _rollup_value(rollup: dict[str, Any]) -> Any:
    rtype = rollup.get("type")
    if rtype == "number":
        return rollup.get("number")
    if rtype == "date":
        return _date_to_str(rollup.get("date"))
    if rtype == "array":
        return [_convert(item) for item in rollup.get("array", [])]
    return None
