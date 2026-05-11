from pathlib import Path

from notion_extractor.extract.plan import NodeKind, PlannedNode, plan_paths, slugify


def test_slugify_keeps_unicode() -> None:
    assert slugify("Notas de Reunião") == "Notas de Reunião"


def test_slugify_replaces_forbidden_chars() -> None:
    assert slugify('a/b\\c:d*e?f"g<h>i|j') == "a-b-c-d-e-f-g-h-i-j"


def test_slugify_strips_outer_whitespace() -> None:
    assert slugify("  hello  ") == "hello"


def test_slugify_handles_empty() -> None:
    assert slugify("") == "untitled"


def test_leaf_page_is_file() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(id="r", kind=NodeKind.PAGE, title="Notas", parent_id=None, children_ids=[]),
    ]
    paths = plan_paths(nodes, root)
    assert paths["r"] == root / "Notas.md"


def test_page_with_children_is_folder_plus_sibling_file() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(id="r", kind=NodeKind.PAGE, title="Notas", parent_id=None, children_ids=["c"]),
        PlannedNode(id="c", kind=NodeKind.PAGE, title="Sub", parent_id="r", children_ids=[]),
    ]
    paths = plan_paths(nodes, root)
    assert paths["r"] == root / "Notas.md"
    assert paths["c"] == root / "Notas" / "Sub.md"


def test_database_always_folder_with_sibling_index() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(
            id="db",
            kind=NodeKind.DATABASE,
            title="Tarefas",
            parent_id=None,
            children_ids=["i1"],
        ),
        PlannedNode(
            id="i1",
            kind=NodeKind.DB_ITEM,
            title="Fazer X",
            parent_id="db",
            children_ids=[],
        ),
    ]
    paths = plan_paths(nodes, root)
    assert paths["db"] == root / "Tarefas.md"
    assert paths["i1"] == root / "Tarefas" / "Fazer X.md"


def test_slug_collision_suffix() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(id="a", kind=NodeKind.PAGE, title="Dup", parent_id=None, children_ids=[]),
        PlannedNode(id="b", kind=NodeKind.PAGE, title="Dup", parent_id=None, children_ids=[]),
        PlannedNode(id="c", kind=NodeKind.PAGE, title="Dup", parent_id=None, children_ids=[]),
    ]
    paths = plan_paths(nodes, root)
    assert paths["a"] == root / "Dup.md"
    assert paths["b"] == root / "Dup (2).md"
    assert paths["c"] == root / "Dup (3).md"


def test_deep_nesting() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(id="A", kind=NodeKind.PAGE, title="A", parent_id=None, children_ids=["B"]),
        PlannedNode(id="B", kind=NodeKind.PAGE, title="B", parent_id="A", children_ids=["C"]),
        PlannedNode(id="C", kind=NodeKind.PAGE, title="C", parent_id="B", children_ids=[]),
    ]
    paths = plan_paths(nodes, root)
    assert paths["A"] == root / "A.md"
    assert paths["B"] == root / "A" / "B.md"
    assert paths["C"] == root / "A" / "B" / "C.md"
