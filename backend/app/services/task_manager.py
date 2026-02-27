import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Task:
    id: str
    url: str
    format: str
    status: str = "queued"
    progress: float = 0.0
    filename: Optional[str] = None
    file_path: Optional[str] = None
    download_url: Optional[str] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None


class TaskManager:
    def __init__(self, ttl_minutes: int = 30):
        self._tasks: dict[str, Task] = {}
        self._ttl_seconds = ttl_minutes * 60
        self._lock = asyncio.Lock()

    def create_task(self, url: str, fmt: str) -> Task:
        task = Task(id=str(uuid.uuid4()), url=url, format=fmt)
        self._tasks[task.id] = task
        return task

    def get_task(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

    def update_task(self, task_id: str, **kwargs):
        task = self._tasks.get(task_id)
        if task:
            for k, v in kwargs.items():
                setattr(task, k, v)
            if kwargs.get("status") in ("completed", "failed"):
                task.completed_at = time.time()

    async def cleanup_expired(self):
        now = time.time()
        expired = [
            tid
            for tid, t in self._tasks.items()
            if t.completed_at and (now - t.completed_at) > self._ttl_seconds
        ]
        for tid in expired:
            task = self._tasks.pop(tid, None)
            if task and task.file_path:
                try:
                    os.unlink(task.file_path)
                except OSError:
                    pass
