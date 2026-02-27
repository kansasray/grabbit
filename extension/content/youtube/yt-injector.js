// Grabbit YouTube download button injection

// ─── Page detection ────────────────────────────────────────────

function isWatchPage() {
  return location.pathname === '/watch' && new URLSearchParams(location.search).has('v');
}

function isShortsPage() {
  return location.pathname.startsWith('/shorts/');
}

function getVideoUrl() {
  return location.href;
}

// ─── DOM info extraction ───────────────────────────────────────

function getVideoTitle() {
  if (isWatchPage()) {
    const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
      || document.querySelector('#title h1 yt-formatted-string')
      || document.querySelector('h1.ytd-watch-metadata')
      || document.querySelector('#title h1')
      || document.querySelector('ytd-watch-metadata #title');
    return el?.textContent?.trim() || '';
  }
  if (isShortsPage()) {
    // Try to get title from the active/visible shorts renderer
    const renderers = document.querySelectorAll('ytd-reel-video-renderer');
    for (const r of renderers) {
      if (r.hasAttribute('is-active') || r.querySelector('video')?.closest('[is-active]')) {
        const t = r.querySelector('#title, h2 yt-formatted-string, .title');
        if (t?.textContent?.trim()) return t.textContent.trim();
      }
    }
    // Fallback
    const el = document.querySelector('ytd-shorts #title')
      || document.querySelector('#shorts-inner-container #title');
    return el?.textContent?.trim() || '';
  }
  return '';
}

function getChannelName() {
  if (isWatchPage()) {
    const el = document.querySelector('#owner ytd-channel-name a')
      || document.querySelector('ytd-channel-name yt-formatted-string a')
      || document.querySelector('#channel-name a')
      || document.querySelector('ytd-video-owner-renderer ytd-channel-name a');
    return el?.textContent?.trim() || '';
  }
  if (isShortsPage()) {
    const renderers = document.querySelectorAll('ytd-reel-video-renderer');
    for (const r of renderers) {
      if (r.hasAttribute('is-active')) {
        const ch = r.querySelector('ytd-channel-name a, #channel-name a, .ytd-channel-name a');
        if (ch?.textContent?.trim()) return ch.textContent.trim();
      }
    }
    const el = document.querySelector('ytd-shorts ytd-channel-name a');
    return el?.textContent?.trim() || '';
  }
  return '';
}

// ─── Download handler ──────────────────────────────────────────

async function handleYTDownload(btn) {
  btn.classList.add('grabbit-loading');
  btn.disabled = true;

  try {
    if (!chrome.runtime?.id) {
      throw new Error('Extension was reloaded — please refresh this page');
    }

    const videoUrl = getVideoUrl();
    const title = getVideoTitle() || 'video';
    const channel = getChannelName() || 'unknown';

    // Read quality setting
    const settings = await chrome.storage.local.get('ytDefaultQuality');
    const quality = settings.ytDefaultQuality || 'best';

    const filename = buildYTFilename({ channel, title, quality });
    const queueId = generateId();

    // Add to queue
    await updateQueueItem({
      id: queueId,
      source: 'yt',
      status: 'queued',
      filename,
      progress: 0,
    });

    // Send to backend via service worker
    const resp = await chrome.runtime.sendMessage({
      action: 'downloadViaBackend',
      pageUrl: videoUrl,
      format: quality,
      filenameHint: filename,
      subfolder: GRABBIT.DOWNLOAD_SUBFOLDER_YT,
      queueId,
    });

    if (resp && !resp.success) {
      await failQueueItem(queueId, resp.error || 'Backend download failed');
      throw new Error(resp.error || 'Backend download failed');
    }

    btn.classList.add('grabbit-done');
  } catch (err) {
    console.error('Grabbit YT download error:', err);
    btn.classList.add('grabbit-error');
    btn.title = err.message;
  } finally {
    btn.classList.remove('grabbit-loading');
    btn.disabled = false;
    setTimeout(() => {
      btn.classList.remove('grabbit-done', 'grabbit-error');
      btn.title = 'Download with Grabbit';
    }, 3000);
  }
}

// ─── SVG icon ──────────────────────────────────────────────────

const DOWNLOAD_SVG = `<svg viewBox="0 0 24 24" width="24" height="24">
  <path d="M12 2v13m0 0l-4-4m4 4l4-4M4 19h16"
        stroke="currentColor" stroke-width="2" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// ─── Watch page button injection ───────────────────────────────

// Multiple selector strategies for Watch page action buttons
const WATCH_ACTION_SELECTORS = [
  '#top-level-buttons-computed',
  'ytd-menu-renderer #top-level-buttons-computed',
  'ytd-watch-metadata ytd-menu-renderer',
  '#actions-inner #menu #top-level-buttons-computed',
  '#actions ytd-menu-renderer',
];

/**
 * Try to inject the download button on a Watch page.
 * Returns true if injection succeeded, false if target not found yet.
 */
function injectWatchButton() {
  if (!isWatchPage()) return true; // not a watch page, nothing to do
  if (document.querySelector('.grabbit-yt-btn')) return true; // already injected

  let actionsRow = null;
  for (const sel of WATCH_ACTION_SELECTORS) {
    actionsRow = document.querySelector(sel);
    if (actionsRow) break;
  }
  if (!actionsRow) return false; // not ready yet

  const btn = document.createElement('button');
  btn.className = 'grabbit-yt-btn';
  btn.setAttribute(GRABBIT.ATTR, 'yt-watch');
  btn.title = 'Download with Grabbit';
  btn.innerHTML = `${DOWNLOAD_SVG}<span class="grabbit-yt-btn-label">Download</span>`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleYTDownload(btn);
  });

  actionsRow.appendChild(btn);
  console.log('Grabbit: injected Watch download button');
  return true;
}

// ─── Shorts button injection ───────────────────────────────────

// Multiple selector strategies for finding Shorts action containers
const SHORTS_ACTION_SELECTORS = [
  '#actions',
  'ytd-reel-player-overlay-renderer #actions',
  '.overlay #actions',
];

/**
 * Inject download button into all visible Shorts renderers that don't have one yet.
 */
function injectShortsButton() {
  if (!isShortsPage()) return;

  // Find all reel renderers (each Shorts video has one)
  const renderers = document.querySelectorAll('ytd-reel-video-renderer');

  for (const renderer of renderers) {
    // Skip if already injected in this renderer
    if (renderer.querySelector('.grabbit-yt-shorts-btn')) continue;

    // Try to find the actions container within this renderer
    let actionsContainer = null;
    for (const sel of SHORTS_ACTION_SELECTORS) {
      actionsContainer = renderer.querySelector(sel);
      if (actionsContainer) break;
    }
    if (!actionsContainer) continue;

    const btn = document.createElement('button');
    btn.className = 'grabbit-yt-shorts-btn';
    btn.setAttribute(GRABBIT.ATTR, 'yt-shorts');
    btn.title = 'Download with Grabbit';
    btn.innerHTML = DOWNLOAD_SVG;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleYTDownload(btn);
    });

    actionsContainer.appendChild(btn);
    console.log('Grabbit: injected Shorts download button');
  }
}

// ─── Cleanup ───────────────────────────────────────────────────

function cleanupYTUI() {
  document.querySelectorAll('.grabbit-yt-btn, .grabbit-yt-shorts-btn').forEach(el => el.remove());
}
