#!/bin/zsh
# Grabbit backend startup script (used by launchd)

export GRABBIT_COOKIES_FILE="/tmp/grabbit_cookies.txt"
export GRABBIT_API_KEY="${GRABBIT_API_KEY:-change-me-in-production}"

cd /Users/kansasray/claude/grabbit/backend

exec /usr/local/bin/python3.13 -m uvicorn app.main:app --host 127.0.0.1 --port 8001
