from fastapi import APIRouter, Depends, HTTPException

from app.auth import verify_api_key
from app.services.obs_service import ObsService

router = APIRouter(prefix="/api/record", tags=["recording"])

_obs_service: ObsService | None = None


def init(obs_service: ObsService):
    global _obs_service
    _obs_service = obs_service


@router.post("/start")
def start_recording(_: str = Depends(verify_api_key)):
    try:
        return _obs_service.start()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OBS error: {e}")


@router.post("/stop")
def stop_recording(_: str = Depends(verify_api_key)):
    try:
        return _obs_service.stop()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OBS error: {e}")


@router.get("/status")
def get_recording_status(_: str = Depends(verify_api_key)):
    try:
        return _obs_service.status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OBS error: {e}")
