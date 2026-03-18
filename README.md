# Grabbit

Personal Chrome Extension (MV3) + Python backend for downloading Instagram and YouTube media.

## Features

**Instagram**
- Single post download (photos, videos, carousels)
- Reel download (via backend yt-dlp)
- Profile batch download ("Grabbit All" button)
- Downloads saved to per-username folders

**YouTube**
- Watch page video download
- Shorts download
- Quality selection (configurable in settings)

## Project Structure

```
grabbit/
├── extension/           # Chrome Extension (Manifest V3)
│   ├── background/      # Service worker
│   ├── content/
│   │   ├── instagram/   # IG content scripts
│   │   ├── youtube/     # YT content scripts
│   │   └── shared/      # Shared utilities
│   ├── lib/             # Constants
│   ├── popup/           # Extension popup UI
│   └── options/         # Settings page
└── backend/             # FastAPI + yt-dlp
    └── app/
        ├── routers/     # API endpoints
        ├── services/    # yt-dlp wrapper, task manager
        └── models/      # Pydantic schemas
```

## Setup

### Extension

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `extension/` folder
4. Open extension settings → set Backend API URL and API Key

### Backend

**Requirements:**
- Python 3.13+
- Node.js (for YouTube signature solving)
- yt-dlp 2026.2.21+

**Install:**

```bash
cd backend
/usr/local/bin/python3.13 -m pip install -r requirements.txt
/usr/local/bin/python3.13 -m pip install "yt-dlp[default]" yt-dlp-ejs
```

**Export browser cookies** (required for YouTube):

```bash
/usr/local/bin/python3.13 -m yt_dlp --cookies-from-browser chrome --cookies /tmp/grabbit_cookies.txt --skip-download "https://www.youtube.com"
```

**Run:**

```bash
cd backend
GRABBIT_COOKIES_FILE=/tmp/grabbit_cookies.txt \
  /usr/local/bin/python3.13 -m uvicorn app.main:app --reload --port 8001
```

### Extension Settings

| Setting | Default |
|---------|---------|
| API URL | `http://localhost:8001` |
| API Key | `change-me-in-production` |
| Max Batch Size | `100` |
| YT Quality | `best` |

## Download Structure

```
~/Downloads/grabbit/
├── ig/
│   └── {username}/
│       ├── username_2026-02-27_abc123_0.jpg
│       └── username_2026-02-27_abc123_1.mp4
└── yt/
    └── channel_title_best.mp4
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/download` | Submit download task |
| GET | `/api/status/{task_id}` | Poll task progress |
| GET | `/files/{file_id}` | Download completed file |
| GET | `/health` | Health check |
