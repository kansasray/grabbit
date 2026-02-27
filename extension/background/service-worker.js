// Grabbit background service worker

const DOWNLOAD_BASE_DIR = 'grabbit';

// Active backend polls: { taskId: { apiBase, apiKey, filename, subfolder, queueId, pollCount } }
const activePollTasks = new Map();

// ─── Message handling ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message)
      .then(sendResponse)
      .catch(err => {
        console.error('Grabbit SW download error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.action === 'queueUpdate') {
    handleQueueUpdate(message.item)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.action === 'downloadAll') {
    handleDownloadAll(message)
      .then(sendResponse)
      .catch(err => {
        console.error('Grabbit SW downloadAll error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.action === 'downloadViaBackend') {
    handleBackendDownload(message)
      .then(sendResponse)
      .catch(err => {
        console.error('Grabbit SW backend download error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});

// ─── chrome.alarms for MV3 service worker lifecycle ────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'grabbit-poll-tasks') {
    await pollAllActiveTasks();
  }
});

function ensureAlarmRunning() {
  if (activePollTasks.size > 0) {
    // Create alarm if not already running (every 6 seconds — minimum for MV3 is ~0.1 min)
    // We use delayInMinutes: 0.1 (6 seconds) as minimum
    chrome.alarms.get('grabbit-poll-tasks', (alarm) => {
      if (!alarm) {
        chrome.alarms.create('grabbit-poll-tasks', {
          delayInMinutes: 0.1,
          periodInMinutes: 0.1,
        });
        console.log('Grabbit SW: started poll alarm');
      }
    });
  }
}

function stopAlarmIfIdle() {
  if (activePollTasks.size === 0) {
    chrome.alarms.clear('grabbit-poll-tasks');
    console.log('Grabbit SW: stopped poll alarm (no active tasks)');
  }
}

// ─── Direct download (IG photos, etc.) ─────────────────────────

async function handleDownload({ url, filename, subfolder }) {
  const downloadPath = subfolder
    ? `${DOWNLOAD_BASE_DIR}/${subfolder}/${filename}`
    : `${DOWNLOAD_BASE_DIR}/${filename}`;

  console.log('Grabbit SW: downloading', downloadPath, url?.substring(0, 80));

  try {
    return await chromeDownload(url, downloadPath);
  } catch (err) {
    console.warn('Grabbit SW: direct download failed, trying fetch-blob:', err.message);
    return await fetchAndDownload(url, downloadPath);
  }
}

function chromeDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify' },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (downloadId === undefined) {
          reject(new Error('Download returned no ID'));
        } else {
          console.log('Grabbit SW: download started, id:', downloadId);
          resolve({ success: true, downloadId });
        }
      }
    );
  });
}

async function fetchAndDownload(url, filename) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);

  try {
    const result = await chromeDownload(blobUrl, filename);
    return result;
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
}

// ─── Download queue (chrome.storage.session) ───────────────────

async function handleQueueUpdate(item) {
  const data = await chrome.storage.session.get('downloadQueue');
  const queue = data.downloadQueue || [];
  const idx = queue.findIndex(q => q.id === item.id);
  if (idx >= 0) {
    queue[idx] = { ...queue[idx], ...item };
  } else {
    queue.push(item);
  }
  if (queue.length > 50) queue.splice(0, queue.length - 50);
  await chrome.storage.session.set({ downloadQueue: queue });
}

// ─── Download multiple files sequentially ──────────────────────

async function handleDownloadAll({ items, subfolder }) {
  const results = [];
  for (const item of items) {
    try {
      const result = await handleDownload({
        url: item.url,
        filename: item.filename,
        subfolder,
      });
      results.push(result);
    } catch (err) {
      results.push({ success: false, error: err.message, filename: item.filename });
    }
  }
  return { success: true, results };
}

// ─── Backend download (yt-dlp) ─────────────────────────────────

/**
 * Initiate a backend download via POST /api/download, then poll for completion.
 * Used for IG Reels, YT videos, or anything requiring yt-dlp.
 */
async function handleBackendDownload({ pageUrl, format, filenameHint, subfolder, queueId }) {
  // Get backend settings
  const settings = await chrome.storage.local.get(['apiBaseUrl', 'apiKey']);
  const apiBase = settings.apiBaseUrl;
  const apiKey = settings.apiKey;

  if (!apiBase) {
    throw new Error('Backend not configured — open Grabbit settings to set API URL');
  }

  const baseUrl = apiBase.replace(/\/$/, '');

  // POST /api/download
  const resp = await fetch(`${baseUrl}/api/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey || '',
    },
    body: JSON.stringify({
      url: pageUrl,
      format: format || 'best',
      filename_hint: filenameHint || null,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Backend error ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  const taskId = data.task_id;
  console.log('Grabbit SW: backend task created:', taskId);

  // Update queue to show "queued" status
  if (queueId) {
    await handleQueueUpdate({
      id: queueId,
      status: 'queued',
      backendTaskId: taskId,
      progress: 0,
    });
  }

  // Register for polling
  activePollTasks.set(taskId, {
    apiBase: baseUrl,
    apiKey: apiKey || '',
    subfolder: subfolder || '',
    queueId: queueId || null,
    filenameHint: filenameHint || null,
    pollCount: 0,
    maxPolls: 120, // 120 × 6s = 12 minutes
  });
  ensureAlarmRunning();

  return { success: true, taskId };
}

/**
 * Poll all active backend tasks. Called by chrome.alarms.
 */
async function pollAllActiveTasks() {
  const taskIds = [...activePollTasks.keys()];
  for (const taskId of taskIds) {
    try {
      await pollSingleTask(taskId);
    } catch (err) {
      console.error(`Grabbit SW: poll error for ${taskId}:`, err.message);
    }
  }
  stopAlarmIfIdle();
}

/**
 * Poll a single backend task and handle completion/failure.
 */
async function pollSingleTask(taskId) {
  const info = activePollTasks.get(taskId);
  if (!info) return;

  info.pollCount++;
  if (info.pollCount > info.maxPolls) {
    // Timeout
    activePollTasks.delete(taskId);
    if (info.queueId) {
      await handleQueueUpdate({ id: info.queueId, status: 'error', error: 'Backend download timed out' });
    }
    return;
  }

  // GET /api/status/{task_id}
  const resp = await fetch(`${info.apiBase}/api/status/${taskId}`, {
    headers: { 'X-API-Key': info.apiKey },
  });

  if (!resp.ok) {
    console.warn(`Grabbit SW: status poll failed (${resp.status}) for ${taskId}`);
    return; // Will retry on next alarm
  }

  const status = await resp.json();

  // Update queue with progress
  if (info.queueId) {
    await handleQueueUpdate({
      id: info.queueId,
      status: status.status === 'completed' ? 'downloading_file' : status.status,
      progress: status.progress || 0,
      filename: status.filename || info.filenameHint,
    });
  }

  if (status.status === 'completed' && status.download_url) {
    // Download the completed file
    activePollTasks.delete(taskId);

    const fileUrl = `${info.apiBase}${status.download_url}`;
    const filename = status.filename || 'download';
    const downloadPath = info.subfolder
      ? `${DOWNLOAD_BASE_DIR}/${info.subfolder}/${filename}`
      : `${DOWNLOAD_BASE_DIR}/${filename}`;

    console.log('Grabbit SW: backend task completed, downloading file:', downloadPath);

    try {
      // Download with API key header via fetch-blob approach
      const fileResp = await fetch(fileUrl, {
        headers: { 'X-API-Key': info.apiKey },
      });
      if (!fileResp.ok) throw new Error(`File fetch failed: ${fileResp.status}`);
      const blob = await fileResp.blob();
      const blobUrl = URL.createObjectURL(blob);

      try {
        await chromeDownload(blobUrl, downloadPath);
      } finally {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      }

      if (info.queueId) {
        await handleQueueUpdate({ id: info.queueId, status: 'done', filename, progress: 100 });
      }
    } catch (err) {
      console.error('Grabbit SW: file download failed:', err.message);
      if (info.queueId) {
        await handleQueueUpdate({ id: info.queueId, status: 'error', error: err.message });
      }
    }
  } else if (status.status === 'failed') {
    activePollTasks.delete(taskId);
    if (info.queueId) {
      await handleQueueUpdate({
        id: info.queueId,
        status: 'error',
        error: status.error || 'Backend download failed',
      });
    }
  }
  // Otherwise still in progress — will poll again on next alarm
}
