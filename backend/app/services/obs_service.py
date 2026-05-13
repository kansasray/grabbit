"""OBS WebSocket recording control.

Talks to OBS via obsws-python. One recording active at a time.
After stop, moves the OBS output file to the download dir under a
timestamped name so the existing /files/ endpoint can serve it.
"""

import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import Optional

import obsws_python as obs

from app.config import settings

log = logging.getLogger(__name__)


class ObsService:
    def __init__(self):
        self._client: Optional[obs.ReqClient] = None
        self._started_at: Optional[float] = None
        self._recording_id: Optional[str] = None

    def _client_or_reconnect(self) -> obs.ReqClient:
        if self._client is None:
            if not settings.obs_ws_password:
                raise RuntimeError(
                    "obs_ws_password not configured (set GRABBIT_OBS_WS_PASSWORD)"
                )
            self._client = obs.ReqClient(
                host=settings.obs_ws_host,
                port=settings.obs_ws_port,
                password=settings.obs_ws_password,
                timeout=5,
            )
        return self._client

    def _drop_client(self):
        self._client = None

    def status(self) -> dict:
        try:
            r = self._client_or_reconnect().get_record_status()
        except Exception:
            self._drop_client()
            raise
        active = bool(r.output_active)
        return {
            "active": active,
            "recording_id": self._recording_id if active else None,
            "started_at": self._started_at if active else None,
            "elapsed_s": (time.time() - self._started_at) if (active and self._started_at) else None,
        }

    def start(self) -> dict:
        try:
            client = self._client_or_reconnect()
            if client.get_record_status().output_active:
                raise RuntimeError("Recording already active in OBS")
            client.start_record()
        except RuntimeError:
            raise
        except Exception:
            self._drop_client()
            raise

        self._started_at = time.time()
        self._recording_id = uuid.uuid4().hex[:8]
        return {
            "recording_id": self._recording_id,
            "started_at": self._started_at,
        }

    def stop(self) -> dict:
        try:
            client = self._client_or_reconnect()
            if not client.get_record_status().output_active:
                raise RuntimeError("No active recording")
            result = client.stop_record()
        except RuntimeError:
            raise
        except Exception:
            self._drop_client()
            raise

        recording_id = self._recording_id
        started_at = self._started_at
        duration_s = (time.time() - started_at) if started_at else None
        self._recording_id = None
        self._started_at = None

        src = Path(result.output_path)
        for _ in range(30):
            if src.exists() and src.stat().st_size > 0:
                break
            time.sleep(0.1)
        if not src.exists() or src.stat().st_size == 0:
            raise RuntimeError(f"OBS produced no output file at {src}")

        ts = time.strftime("%Y%m%d_%H%M%S", time.localtime(started_at or time.time()))
        dest_name = f"recording_{ts}_{recording_id}{src.suffix or '.mp3'}"
        settings.download_dir.mkdir(parents=True, exist_ok=True)
        dest = settings.download_dir / dest_name
        shutil.move(str(src), str(dest))

        return {
            "recording_id": recording_id,
            "filename": dest_name,
            "download_url": f"/files/{dest_name}",
            "duration_s": duration_s,
            "size_bytes": dest.stat().st_size,
        }
