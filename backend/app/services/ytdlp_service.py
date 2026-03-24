import asyncio
import os
from pathlib import Path
from typing import Optional

import yt_dlp

from app.config import settings
from app.services.task_manager import TaskManager

FORMAT_MAP = {
    "best": "bv*+ba/b",
    "bestaudio": "ba/b",
    "720p": "bv*[height<=720]+ba/b[height<=720]",
    "1080p": "bv*[height<=1080]+ba/b[height<=1080]",
    "1440p": "bv*[height<=1440]+ba/b[height<=1440]",
    "2160p": "bv*[height<=2160]+ba/b[height<=2160]",
}


class YtDlpService:
    def __init__(self, download_dir: Path, task_manager: TaskManager):
        self.download_dir = download_dir
        self.task_manager = task_manager
        self._semaphore = asyncio.Semaphore(3)
        self.download_dir.mkdir(parents=True, exist_ok=True)

    def _make_progress_hook(self, task_id: str):
        def hook(d):
            if d["status"] == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes", 0)
                if total > 0:
                    progress = (downloaded / total) * 100
                    self.task_manager.update_task(
                        task_id, status="downloading", progress=round(progress, 1)
                    )
            elif d["status"] == "finished":
                self.task_manager.update_task(
                    task_id,
                    status="processing",
                    progress=100.0,
                    filename=os.path.basename(d["filename"]),
                )

        return hook

    async def download(
        self,
        task_id: str,
        url: str,
        format_key: str,
        filename_hint: Optional[str] = None,
    ):
        async with self._semaphore:
            try:
                self.task_manager.update_task(task_id, status="downloading")

                outtmpl = str(self.download_dir / "%(title)s [%(id)s].%(ext)s")
                if filename_hint:
                    base = Path(filename_hint).stem
                    outtmpl = str(self.download_dir / f"{base}.%(ext)s")

                opts = {
                    "format": FORMAT_MAP.get(format_key, FORMAT_MAP["best"]),
                    "outtmpl": outtmpl,
                    "progress_hooks": [self._make_progress_hook(task_id)],
                    "merge_output_format": "mp4",
                    "quiet": True,
                    "no_warnings": True,
                    "extractor_args": {
                        "facebook": {"js_runtimes": ["node"]},
                        "youtube": {"js_runtimes": ["node"]},
                    },
                }

                # Use cookies file if configured
                if settings.cookies_file and os.path.isfile(settings.cookies_file):
                    opts["cookiefile"] = settings.cookies_file

                loop = asyncio.get_event_loop()
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, self._do_download, opts, url),
                    timeout=600,  # 10 minute timeout
                )

                if result:
                    file_id = os.path.basename(result)
                    self.task_manager.update_task(
                        task_id,
                        status="completed",
                        file_path=result,
                        filename=file_id,
                        download_url=f"/files/{file_id}",
                    )
                else:
                    self.task_manager.update_task(
                        task_id, status="failed", error="No output file produced"
                    )

            except asyncio.TimeoutError:
                self.task_manager.update_task(
                    task_id, status="failed", error="Download timed out (10 min)"
                )
            except Exception as e:
                self.task_manager.update_task(
                    task_id, status="failed", error=str(e)
                )

    def _do_download(self, opts: dict, url: str) -> Optional[str]:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if info:
                return ydl.prepare_filename(info)
        return None

    async def extract_info(self, url: str) -> Optional[dict]:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "extractor_args": {
                "facebook": {"js_runtimes": ["node"]},
                "youtube": {"js_runtimes": ["node"]},
            },
        }
        if settings.cookies_file and os.path.isfile(settings.cookies_file):
            opts["cookiefile"] = settings.cookies_file

        loop = asyncio.get_event_loop()
        return await asyncio.wait_for(
            loop.run_in_executor(None, self._do_extract_info, opts, url),
            timeout=30,
        )

    GENERIC_TITLES = {"影片", "video", "reel", "reels", "watch", "短片", "视频"}

    # Suffixes to strip from titles (order matters — longest first)
    TITLE_STRIP_SUFFIXES = [
        " - 現場錄影",
        "- 現場錄影",
        " - 錄影",
        " - 直播",
    ]

    @classmethod
    def clean_title(cls, raw_title: str, uploader: str = "") -> str:
        title = raw_title.strip()

        # If title contains "|", take the part after the last "|"
        # e.g. "「系列名」（會員限定）日期 | 《課程名》描述 - 現場錄影"
        #   → "《課程名》描述 - 現場錄影"
        if "|" in title:
            title = title.rsplit("|", 1)[-1].strip()

        # Strip known suffixes
        for suffix in cls.TITLE_STRIP_SUFFIXES:
            if title.endswith(suffix):
                title = title[: -len(suffix)].strip()
                break
            # Also handle truncated suffixes (e.g. "...現場錄影�...")
            idx = title.rfind(suffix.lstrip(" -"))
            if idx > 0:
                title = title[:idx].strip().rstrip("-").strip()
                break

        # If still generic after cleaning, prepend uploader
        if title.lower() in cls.GENERIC_TITLES and uploader:
            title = f"{uploader} - {title}"

        return title

    def _do_extract_info(self, opts: dict, url: str) -> Optional[dict]:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                raw_title = info.get("title") or "video"
                uploader = (info.get("uploader") or "").strip()
                title = self.clean_title(raw_title, uploader)

                return {
                    "title": title,
                    "duration": info.get("duration"),
                    "thumbnail": info.get("thumbnail"),
                }
        return None
