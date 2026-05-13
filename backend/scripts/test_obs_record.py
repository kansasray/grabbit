"""Verify OBS WebSocket recording works end-to-end.

Usage:
    pip install obsws-python
    OBS_WS_PASSWORD=xxxx /usr/local/bin/python3.13 scripts/test_obs_record.py [duration_seconds]
"""

import os
import sys
import time
from pathlib import Path

import obsws_python as obs

HOST = os.environ.get("OBS_WS_HOST", "localhost")
PORT = int(os.environ.get("OBS_WS_PORT", "4455"))
PASSWORD = os.environ.get("OBS_WS_PASSWORD")

if not PASSWORD:
    sys.exit("Set OBS_WS_PASSWORD env var (see OBS → Tools → WebSocket Server Settings)")

duration = int(sys.argv[1]) if len(sys.argv) > 1 else 5

client = obs.ReqClient(host=HOST, port=PORT, password=PASSWORD, timeout=5)

version = client.get_version()
print(f"connected — OBS {version.obs_version}, websocket {version.obs_web_socket_version}")

status = client.get_record_status()
if status.output_active:
    sys.exit("OBS is already recording — stop it manually first")

print(f"starting recording for {duration}s …")
client.start_record()
time.sleep(duration)
result = client.stop_record()

output_path = Path(result.output_path)
size_kb = output_path.stat().st_size / 1024 if output_path.exists() else 0
print(f"stopped — file: {output_path} ({size_kb:.1f} KB)")
