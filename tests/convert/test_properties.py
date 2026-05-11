from notion_extractor.convert.properties import properties_to_frontmatter


def _title(text: str) -> dict:
    return {
        "type": "title",
        "title": [
            {
                "type": "text",
                "plain_text": text,
                "text": {"content": text, "link": None},
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
        ],
    }


def test_title_property() -> None:
    props = {"Name": _title("Fazer X")}
    fm = properties_to_frontmatter(props)
    assert fm == {"Name": "Fazer X"}


def test_rich_text() -> None:
    props = {
        "Notes": {
            "type": "rich_text",
            "rich_text": [
                {
                    "type": "text",
                    "plain_text": "some note",
                    "text": {"content": "some note", "link": None},
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
            ],
        }
    }
    assert properties_to_frontmatter(props) == {"Notes": "some note"}


def test_number() -> None:
    props = {"Score": {"type": "number", "number": 42}}
    assert properties_to_frontmatter(props) == {"Score": 42}


def test_select() -> None:
    props = {
        "Status": {
            "type": "select",
            "select": {"name": "Done", "color": "green", "id": "x"},
        }
    }
    assert properties_to_frontmatter(props) == {"Status": "Done"}


def test_select_empty() -> None:
    props = {"Status": {"type": "select", "select": None}}
    assert properties_to_frontmatter(props) == {"Status": None}


def test_multi_select() -> None:
    props = {
        "Tags": {
            "type": "multi_select",
            "multi_select": [
                {"name": "a", "color": "blue", "id": "1"},
                {"name": "b", "color": "red", "id": "2"},
            ],
        }
    }
    assert properties_to_frontmatter(props) == {"Tags": ["a", "b"]}


def test_status() -> None:
    props = {
        "State": {
            "type": "status",
            "status": {"name": "Doing", "color": "blue", "id": "x"},
        }
    }
    assert properties_to_frontmatter(props) == {"State": "Doing"}


def test_date_simple() -> None:
    props = {
        "Due": {
            "type": "date",
            "date": {"start": "2026-05-20", "end": None, "time_zone": None},
        }
    }
    assert properties_to_frontmatter(props) == {"Due": "2026-05-20"}


def test_date_range() -> None:
    props = {
        "Due": {
            "type": "date",
            "date": {
                "start": "2026-05-20",
                "end": "2026-05-21",
                "time_zone": None,
            },
        }
    }
    assert properties_to_frontmatter(props) == {"Due": "2026-05-20/2026-05-21"}


def test_checkbox() -> None:
    props = {"Done": {"type": "checkbox", "checkbox": True}}
    assert properties_to_frontmatter(props) == {"Done": True}


def test_url() -> None:
    props = {"Site": {"type": "url", "url": "https://x.dev"}}
    assert properties_to_frontmatter(props) == {"Site": "https://x.dev"}


def test_email_phone() -> None:
    props = {
        "Email": {"type": "email", "email": "a@b.c"},
        "Phone": {"type": "phone_number", "phone_number": "+55"},
    }
    assert properties_to_frontmatter(props) == {"Email": "a@b.c", "Phone": "+55"}


def test_people() -> None:
    props = {
        "Owner": {
            "type": "people",
            "people": [
                {"name": "Ana", "id": "u1", "object": "user"},
                {"name": "Bia", "id": "u2", "object": "user"},
            ],
        }
    }
    assert properties_to_frontmatter(props) == {"Owner": ["Ana", "Bia"]}


def test_files_emits_placeholders() -> None:
    props = {
        "Files": {
            "type": "files",
            "files": [
                {"name": "x.pdf", "type": "file", "file": {"url": "https://s3/x.pdf"}},
                {"name": "y.png", "type": "external", "external": {"url": "https://ex/y.png"}},
            ],
        }
    }
    assert properties_to_frontmatter(props) == {
        "Files": ["{{notion-asset:https://s3/x.pdf}}", "https://ex/y.png"]
    }


def test_relation_emits_link_placeholders() -> None:
    props = {"Rel": {"type": "relation", "relation": [{"id": "abc"}, {"id": "def"}]}}
    assert properties_to_frontmatter(props) == {
        "Rel": ["{{notion-link:abc}}", "{{notion-link:def}}"]
    }


def test_formula_number() -> None:
    props = {"X": {"type": "formula", "formula": {"type": "number", "number": 3.14}}}
    assert properties_to_frontmatter(props) == {"X": 3.14}


def test_formula_string() -> None:
    props = {"X": {"type": "formula", "formula": {"type": "string", "string": "hi"}}}
    assert properties_to_frontmatter(props) == {"X": "hi"}


def test_created_time() -> None:
    props = {
        "Created": {
            "type": "created_time",
            "created_time": "2026-01-01T00:00:00.000Z",
        }
    }
    assert properties_to_frontmatter(props) == {"Created": "2026-01-01T00:00:00.000Z"}
