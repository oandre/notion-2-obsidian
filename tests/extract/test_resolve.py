from pathlib import Path

from notion_extractor.extract.resolve import LinkContext, render_report, resolve_placeholders


def test_resolve_known_link() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={"abc": Path("/v/Other.md")},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "see {{notion-link:abc|Other}} for more"
    result, broken = resolve_placeholders(md, ctx)
    assert result == "see [[Other]] for more"
    assert broken == []


def test_resolve_known_link_no_label_uses_basename() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={"abc": Path("/v/Some Page.md")},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "{{notion-link:abc}}"
    result, broken = resolve_placeholders(md, ctx)
    assert result == "[[Some Page]]"
    assert broken == []


def test_resolve_unknown_link_becomes_text_and_reports() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "{{notion-link:xyz|External Page}}"
    result, broken = resolve_placeholders(md, ctx)
    assert result == "External Page"
    assert broken == [("xyz", "External Page", Path("/v/A.md"))]


def test_resolve_unknown_link_no_label() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "{{notion-link:xyz}}"
    result, broken = resolve_placeholders(md, ctx)
    assert result == "(link removed)"
    assert broken == [("xyz", None, Path("/v/A.md"))]


def test_resolve_asset_writes_relative_path() -> None:
    ctx = LinkContext(
        from_file=Path("/v/sub/A.md"),
        id_to_path={},
        url_to_local={"https://x/y.png": Path("/v/assets/a1b2c3d4-y.png")},
        vault_root=Path("/v"),
    )
    md = "![alt]({{notion-asset:https://x/y.png}})"
    result, _ = resolve_placeholders(md, ctx)
    assert result == "![alt](../assets/a1b2c3d4-y.png)"


def test_resolve_asset_missing_keeps_url() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "![]({{notion-asset:https://x/y.png}})"
    result, _ = resolve_placeholders(md, ctx)
    assert result == "![](https://x/y.png)"


def test_render_report_groups_broken_links() -> None:
    broken = [
        ("xyz", "External", Path("/v/A.md")),
        ("xyz", "External again", Path("/v/B.md")),
        ("abc", None, Path("/v/A.md")),
    ]
    report = render_report(
        vault_root=Path("/v"),
        pages_extracted=10,
        items_extracted=5,
        attachments_downloaded=2,
        total_bytes=1024,
        duration_s=1.5,
        broken_links=broken,
        failures=[("page-1", "404")],
        warnings=["unknown block: template"],
    )
    assert "Páginas extraídas: 10" in report
    assert "Itens de database extraídos: 5" in report
    assert "xyz" in report
    assert "Falhas (1)" in report
