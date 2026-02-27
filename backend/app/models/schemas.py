from enum import Enum
from typing import Optional
from pydantic import BaseModel, HttpUrl


class DownloadFormat(str, Enum):
    best = "best"
    best_audio = "bestaudio"
    p720 = "720p"
    p1080 = "1080p"
    p1440 = "1440p"
    p4k = "2160p"


class DownloadRequest(BaseModel):
    url: HttpUrl
    format: DownloadFormat = DownloadFormat.best
    filename_hint: Optional[str] = None


class DownloadResponse(BaseModel):
    task_id: str
    status: str = "queued"


class TaskStatus(BaseModel):
    task_id: str
    status: str  # queued, downloading, processing, completed, failed
    progress: Optional[float] = None
    filename: Optional[str] = None
    download_url: Optional[str] = None
    error: Optional[str] = None
