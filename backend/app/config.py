from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    api_key: str = "change-me-in-production"
    download_dir: Path = Path("/tmp/grabbit_downloads")
    file_ttl_minutes: int = 30
    max_concurrent_downloads: int = 3
    allowed_domains: list[str] = [
        "instagram.com", "www.instagram.com",
        "youtube.com", "www.youtube.com", "youtu.be",
        "facebook.com", "www.facebook.com", "m.facebook.com",
        "web.facebook.com",
    ]
    cookies_file: str = ""

    obs_ws_host: str = "localhost"
    obs_ws_port: int = 4455
    obs_ws_password: str = ""
    obs_record_output_path: Path = Path("/tmp/grabbit_recordings/output.mp3")

    model_config = {"env_prefix": "GRABBIT_", "env_file": ".env"}


settings = Settings()
