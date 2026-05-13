# Grabbit

## What
Personal Chrome MV3 extension + FastAPI backend for downloading Instagram and YouTube media. Adds a download button to IG posts/reels/profiles and YT watch/Shorts pages; backend wraps yt-dlp; downloads go to `~/Downloads/grabbit/{ig,yt}/`.

## Status (2026-05-06)
- No git commits found (no log output) — repo initialised but un-committed locally
- README dated 2026-03-30 implies feature work paused

## Stack
- Languages: JavaScript (extension), Python 3.13 (backend)
- Key deps: FastAPI, uvicorn, yt-dlp + yt-dlp-ejs, pydantic, aiofiles
- Entry: `extension/manifest.json`, `backend/app/main.py`

## Run
```bash
# Backend
cd backend
/usr/local/bin/python3.13 -m pip install -r requirements.txt
/usr/local/bin/python3.13 -m pip install "yt-dlp[default]" yt-dlp-ejs

# Export browser cookies for YouTube
/usr/local/bin/python3.13 -m yt_dlp --cookies-from-browser chrome \
  --cookies /tmp/grabbit_cookies.txt --skip-download "https://www.youtube.com"

GRABBIT_COOKIES_FILE=/tmp/grabbit_cookies.txt \
  /usr/local/bin/python3.13 -m uvicorn app.main:app --reload --port 8001

# Extension: chrome://extensions → Developer mode → Load unpacked → extension/
# Then set API URL=http://localhost:8001 and API Key in extension settings
```

## Gotchas
- YouTube needs cookies exported via `--cookies-from-browser chrome`; without them signature solving fails
- Default API key in README is a placeholder — change before exposing the backend
- Duplicate detection back-fills from Chrome download history on first batch run
- IG carousel posts download all slides at once; download button shows green ✓ when already grabbed but still allows re-download
- yt-dlp must be ≥ 2026.2.21 to handle current YT signature changes
- Node.js required on backend host for YouTube signature solving
