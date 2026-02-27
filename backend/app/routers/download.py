from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import verify_api_key
from app.config import settings
from app.models.schemas import DownloadRequest, DownloadResponse, TaskStatus
from app.services.task_manager import TaskManager
from app.services.ytdlp_service import YtDlpService

router = APIRouter(prefix="/api", tags=["download"])

# Singletons (initialized in main.py)
_task_manager: TaskManager = None
_ytdlp_service: YtDlpService = None


def init(task_manager: TaskManager, ytdlp_service: YtDlpService):
    global _task_manager, _ytdlp_service
    _task_manager = task_manager
    _ytdlp_service = ytdlp_service


@router.post("/download", response_model=DownloadResponse, status_code=202)
async def create_download(
    req: DownloadRequest,
    background_tasks: BackgroundTasks,
    _: str = Depends(verify_api_key),
):
    # Validate domain
    parsed = urlparse(str(req.url))
    hostname = parsed.hostname or ""
    if not any(hostname.endswith(d) for d in settings.allowed_domains):
        raise HTTPException(status_code=400, detail=f"Domain not allowed: {hostname}")

    task = _task_manager.create_task(str(req.url), req.format.value)

    background_tasks.add_task(
        _ytdlp_service.download,
        task.id,
        str(req.url),
        req.format.value,
        req.filename_hint,
    )

    return DownloadResponse(task_id=task.id, status="queued")


@router.get("/status/{task_id}", response_model=TaskStatus)
async def get_status(
    task_id: str,
    _: str = Depends(verify_api_key),
):
    task = _task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskStatus(
        task_id=task.id,
        status=task.status,
        progress=task.progress,
        filename=task.filename,
        download_url=task.download_url,
        error=task.error,
    )
