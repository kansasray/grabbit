from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.auth import verify_api_key
from app.config import settings

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/{file_id}")
async def serve_file(
    file_id: str,
    _: str = Depends(verify_api_key),
):
    # Sanitize to prevent path traversal
    safe_name = Path(file_id).name
    file_path = settings.download_dir / safe_name

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=str(file_path),
        filename=safe_name,
        media_type="application/octet-stream",
    )
