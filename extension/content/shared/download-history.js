// Grabbit download history — deduplication via chrome.storage.local

const HISTORY_KEY = 'downloadHistory';
const HISTORY_MAX_ENTRIES = 50000;

/**
 * Build a media key for deduplication.
 * IG: "ig:{shortcode}_{index}"  e.g. "ig:abc123_0"
 * YT: "yt:{videoId}"            e.g. "yt:dQw4w9WgXcQ"
 */
function buildMediaKey({ source, shortcode, index, videoId }) {
  if (source === 'ig') {
    return `ig:${shortcode}_${index ?? 0}`;
  }
  if (source === 'yt') {
    return `yt:${videoId}`;
  }
  return null;
}

/**
 * Extract YT video ID from a URL.
 */
function extractYTVideoId(url) {
  try {
    const u = new URL(url);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/);
    if (shortsMatch) return shortsMatch[1];
  } catch { /* ignore */ }
  return null;
}

/**
 * Check if a single media key was already downloaded.
 * Returns the timestamp if found, or null.
 */
async function isDownloaded(mediaKey) {
  if (!mediaKey) return null;
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = data[HISTORY_KEY] || {};
  return history[mediaKey] || null;
}

/**
 * Check multiple media keys at once.
 * Returns a Set of keys that were already downloaded.
 */
async function filterDownloaded(mediaKeys) {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = data[HISTORY_KEY] || {};
  return new Set(mediaKeys.filter(k => k && history[k]));
}

/**
 * Record one or more media keys as downloaded.
 */
async function recordDownloaded(mediaKeys) {
  const keys = Array.isArray(mediaKeys) ? mediaKeys : [mediaKeys];
  const valid = keys.filter(Boolean);
  if (valid.length === 0) return;

  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = data[HISTORY_KEY] || {};
  const now = Date.now();

  for (const key of valid) {
    history[key] = now;
  }

  // Evict oldest entries if over limit
  const entries = Object.entries(history);
  if (entries.length > HISTORY_MAX_ENTRIES) {
    entries.sort((a, b) => a[1] - b[1]);
    const toRemove = entries.length - HISTORY_MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      delete history[entries[i][0]];
    }
  }

  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}
