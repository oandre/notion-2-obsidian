from notion_extractor.convert.blocks import blocks_to_md


def test_block_equation() -> None:
    block = {
        "type": "equation",
        "equation": {"expression": "e^{i\\pi} + 1 = 0"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "$$\ne^{i\\pi} + 1 = 0\n$$\n"
