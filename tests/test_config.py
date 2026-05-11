from pathlib import Path

from notion_extractor.config import Settings


def test_settings_load_from_env(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("NOTION_TOKEN", "secret_abc")
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "vault"))
    monkeypatch.setenv("HOST", "127.0.0.1")
    monkeypatch.setenv("PORT", "9000")

    settings = Settings()  # type: ignore[call-arg]

    assert settings.notion_token == "secret_abc"
    assert settings.output_dir == tmp_path / "vault"
    assert settings.host == "127.0.0.1"
    assert settings.port == 9000


def test_settings_defaults(monkeypatch) -> None:
    monkeypatch.setenv("NOTION_TOKEN", "secret_abc")
    monkeypatch.setenv("OUTPUT_DIR", "./vault")
    monkeypatch.delenv("HOST", raising=False)
    monkeypatch.delenv("PORT", raising=False)

    settings = Settings()  # type: ignore[call-arg]

    assert settings.host == "127.0.0.1"
    assert settings.port == 8765
