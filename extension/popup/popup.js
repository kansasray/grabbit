// Grabbit popup — download queue display

const STATUS_LABELS = {
  pending: 'Pending',
  downloading: 'Downloading',
  done: 'Done',
  error: 'Failed',
};

const STATUS_ICONS = {
  pending: '\u23F3',   // hourglass
  downloading: '\u2B07', // down arrow
  done: '\u2705',      // check
  error: '\u274C',     // cross
};

function renderQueue(items) {
  const container = document.getElementById('queue-container');
  const clearBtn = document.getElementById('clear-btn');

  if (!items || items.length === 0) {
    container.innerHTML = '<p class="empty-state">No recent downloads</p>';
    clearBtn.style.display = 'none';
    return;
  }

  const hasFinished = items.some(i => i.status === 'done' || i.status === 'error');
  clearBtn.style.display = hasFinished ? 'block' : 'none';

  container.innerHTML = items.slice().reverse().map(item => {
    const icon = STATUS_ICONS[item.status] || '';
    const label = STATUS_LABELS[item.status] || item.status;
    const name = item.filename || item.url?.substring(0, 40) || 'Unknown';
    const sourceMap = { yt: 'YT', fb: 'FB', ig: 'IG' };
    const source = sourceMap[item.source] || 'IG';

    let progressBar = '';
    if (item.status === 'downloading' && item.progress != null) {
      progressBar = `<div class="progress-bar"><div class="progress-fill" style="width:${item.progress}%"></div></div>`;
    }

    let errorMsg = '';
    if (item.status === 'error' && item.error) {
      errorMsg = `<div class="queue-error">${item.error}</div>`;
    }

    return `
      <div class="queue-item queue-${item.status}">
        <div class="queue-row">
          <span class="queue-icon">${icon}</span>
          <span class="queue-filename" title="${name}">${name}</span>
          <span class="queue-source source-${item.source || 'ig'}">${source}</span>
        </div>
        ${progressBar}
        ${errorMsg}
      </div>
    `;
  }).join('');
}

async function refreshQueue() {
  try {
    const data = await chrome.storage.session.get('downloadQueue');
    renderQueue(data.downloadQueue || []);
  } catch (e) {
    // Extension context might be invalid
  }
}

// Poll every 2 seconds
refreshQueue();
const pollInterval = setInterval(refreshQueue, 2000);
window.addEventListener('unload', () => clearInterval(pollInterval));

// Clear button
document.getElementById('clear-btn').addEventListener('click', async () => {
  const data = await chrome.storage.session.get('downloadQueue');
  const queue = (data.downloadQueue || []).filter(q => q.status === 'downloading' || q.status === 'pending');
  await chrome.storage.session.set({ downloadQueue: queue });
  refreshQueue();
});

// ─── URL paste download ──────────────────────────────────────

const SUPPORTED_DOMAINS = {
  fb: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'],
  yt: ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'],
};

function detectSource(url) {
  try {
    const host = new URL(url).hostname;
    for (const [src, domains] of Object.entries(SUPPORTED_DOMAINS)) {
      if (domains.some(d => host === d || host.endsWith('.' + d))) return src;
    }
  } catch { /* invalid URL */ }
  return null;
}

document.getElementById('dl-btn').addEventListener('click', () => startDownload());
document.getElementById('url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startDownload();
});
document.getElementById('filename-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startDownload();
});

async function startDownload() {
  const input = document.getElementById('url-input');
  const filenameField = document.getElementById('filename-input');
  const errorEl = document.getElementById('form-error');
  const dlBtn = document.getElementById('dl-btn');
  const rawUrl = input.value.trim();

  errorEl.style.display = 'none';

  if (!rawUrl) return;

  const source = detectSource(rawUrl);
  if (!source) {
    errorEl.textContent = 'Unsupported URL — paste a Facebook or YouTube link';
    errorEl.style.display = 'block';
    return;
  }

  const format = document.getElementById('format-select').value;
  const filenameHint = filenameField.value.trim() || null;
  const queueId = `popup-${Date.now()}`;
  const subfolder = source === 'fb' ? 'fb' : 'yt';

  await chrome.runtime.sendMessage({
    action: 'queueUpdate',
    item: { id: queueId, url: rawUrl, filename: filenameHint, status: 'pending', source, progress: 0 },
  });

  dlBtn.disabled = true;
  dlBtn.textContent = 'Sending…';

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'downloadViaBackend',
      pageUrl: rawUrl,
      format,
      filenameHint,
      subfolder,
      queueId,
    });

    if (resp && !resp.success) {
      errorEl.textContent = resp.error || 'Download failed';
      errorEl.style.display = 'block';
    } else {
      input.value = '';
      filenameField.value = '';
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    dlBtn.disabled = false;
    dlBtn.textContent = 'Download';
    refreshQueue();
  }
}

// Options link
document.getElementById('options-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
