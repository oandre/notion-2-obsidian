from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    notion_token: str = Field(min_length=1)
    output_dir: Path
    host: str = "127.0.0.1"
    port: int = 8765
