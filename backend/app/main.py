import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import download, files
from app.services.task_manager import TaskManager
from app.services.ytdlp_service import YtDlpService

task_manager = TaskManager(ttl_minutes=settings.file_ttl_minutes)
ytdlp_service = YtDlpService(settings.download_dir, task_manager)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize router singletons
    download.init(task_manager, ytdlp_service)

    # Start periodic cleanup
    cleanup_task = asyncio.create_task(periodic_cleanup())
    yield
    cleanup_task.cancel()


async def periodic_cleanup():
    while True:
        await asyncio.sleep(300)  # every 5 minutes
        await task_manager.cleanup_expired()


app = FastAPI(title="Grabbit API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Extension sends Origin: chrome-extension://...
    allow_methods=["GET", "POST"],
    allow_headers=["X-API-Key", "Content-Type"],
)

app.include_router(download.router)
app.include_router(files.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
