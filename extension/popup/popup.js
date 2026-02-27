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
    const source = item.source === 'yt' ? 'YT' : 'IG';

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
          <span class="queue-source">${source}</span>
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

// Options link
document.getElementById('options-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
