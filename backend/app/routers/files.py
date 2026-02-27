from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import FileResponse

from app.config import settings

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/{file_id}")
async def serve_file(
    file_id: str,
    key: Optional[str] = Query(None),
    x_api_key: Optional[str] = Header(None),
):
    # Accept API key from query param OR header
    api_key = key or x_api_key
    if not api_key or api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")

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
