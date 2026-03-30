# Grabbit

Personal Chrome Extension (MV3) + Python backend for downloading Instagram and YouTube media.

## Features

**Instagram**
- Single post download (photos, videos, carousels)
- Reel download (via backend yt-dlp)
- Profile batch download ("Grabbit All" button)
- Downloads saved to per-username folders
- Duplicate detection — already downloaded media is automatically skipped

**YouTube**
- Watch page video download
- Shorts download
- Quality selection (configurable in settings)

## Usage

### Instagram — Single Post

1. Browse Instagram feed or open any post
2. A **download button** (↓) appears in the action bar next to like/comment/share
3. Click it to download all photos/videos in that post
4. Carousel posts show a badge with slide count — all slides are downloaded at once
5. If the post was already downloaded, the button turns **green with a ✓**. You can still click to re-download

### Instagram — Profile Batch Download

1. Visit any public profile page (e.g. `instagram.com/username`)
2. Click the **"Grabbit All"** button next to Follow/Message
3. A progress bar shows scanning and downloading progress
4. Already downloaded files are **automatically skipped** (shows skip count)
5. Click **Cancel** anytime to stop

### YouTube — Watch Page & Shorts

1. Open any YouTube video or Shorts
2. A **Download** button appears in the action bar (Watch) or side panel (Shorts)
3. Click to download via the backend (yt-dlp)
4. Quality is configurable in extension settings (default: best)
5. Already downloaded videos show a **✓** indicator

### Duplicate Detection

Grabbit tracks every downloaded file to prevent re-downloading:

- **New downloads**: Recorded automatically after each successful download
- **Old downloads** (before this feature): Detected via Chrome's download history on the first batch run, then back-filled into Grabbit's records
- **Batch download**: Duplicates are skipped automatically with a "(N skipped)" counter
- **Single download**: Button shows green ✓ but still allows re-download on click

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
