from notion_extractor.convert.blocks import blocks_to_md


def _cell(text: str) -> list[dict]:
    return [
        {
            "type": "text",
            "text": {"content": text, "link": None},
            "plain_text": text,
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


def _row(cells: list[list[dict]]) -> dict:
    return {
        "type": "table_row",
        "table_row": {"cells": cells},
        "has_children": False,
        "children": [],
    }


def test_table_with_header() -> None:
    rows = [
        _row([_cell("Name"), _cell("Age")]),
        _row([_cell("Ana"), _cell("30")]),
        _row([_cell("Bia"), _cell("25")]),
    ]
    table = {
        "type": "table",
        "table": {"table_width": 2, "has_column_header": True, "has_row_header": False},
        "has_children": True,
        "children": rows,
    }
    expected = "| Name | Age |\n| --- | --- |\n| Ana | 30 |\n| Bia | 25 |\n"
    assert blocks_to_md([table]) == expected


def test_table_no_header_synthesizes_blank_header() -> None:
    rows = [
        _row([_cell("a"), _cell("b")]),
        _row([_cell("c"), _cell("d")]),
    ]
    table = {
        "type": "table",
        "table": {"table_width": 2, "has_column_header": False, "has_row_header": False},
        "has_children": True,
        "children": rows,
    }
    expected = "|  |  |\n| --- | --- |\n| a | b |\n| c | d |\n"
    assert blocks_to_md([table]) == expected
