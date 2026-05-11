from notion_extractor.convert.blocks import blocks_to_md


def test_child_page() -> None:
    block = {
        "type": "child_page",
        "id": "abc-123",
        "child_page": {"title": "Some Page"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "{{notion-link:abc-123|Some Page}}\n"


def test_child_database() -> None:
    block = {
        "type": "child_database",
        "id": "db-456",
        "child_database": {"title": "Tasks"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "{{notion-link:db-456|Tasks}}\n"


def test_link_to_page() -> None:
    block = {
        "type": "link_to_page",
        "link_to_page": {"type": "page_id", "page_id": "p-1"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "{{notion-link:p-1}}\n"


def test_link_to_database() -> None:
    block = {
        "type": "link_to_page",
        "link_to_page": {"type": "database_id", "database_id": "d-1"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "{{notion-link:d-1}}\n"
