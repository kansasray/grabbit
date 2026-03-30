// Grabbit IG profile batch download

// Module-level abort controller for cancellation across navigations
let _profileAbort = null;

// ─── Profile page detection ────────────────────────────────────

const RESERVED_PATHS = new Set([
  'p', 'reel', 'reels', 'explore', 'direct', 'accounts',
  'stories', 'tv', 'about', 'developer', 'legal', 'lite',
  'nametag', 'session', 'settings', 'topics', 'challenge',
]);

function isProfilePage(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'www.instagram.com') return false;
    const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    // Profile URL is exactly /<username>/ (1 segment, not reserved)
    // Also accept /<username>/tagged/ or /<username>/reels/ etc. (2 segments)
    if (parts.length === 0) return false;
    if (RESERVED_PATHS.has(parts[0].toLowerCase())) return false;
    // Must look like a username (alphanumeric, dots, underscores)
    return /^[A-Za-z0-9._]+$/.test(parts[0]);
  } catch {
    return false;
  }
}

function extractUsernameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts.length > 0 && !RESERVED_PATHS.has(parts[0].toLowerCase())) {
      return parts[0];
    }
  } catch { /* ignore */ }
  return null;
}

// ─── IG API calls ──────────────────────────────────────────────

const IG_APP_ID = '936619743392459';

async function fetchUserInfo(username) {
  const resp = await fetch(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    {
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-IG-App-ID': IG_APP_ID,
      },
    },
  );

  if (resp.status === 404) throw new Error('User not found');
  if (resp.status === 401) throw new Error('Login to Instagram required');
  if (!resp.ok) throw new Error(`User info API returned ${resp.status}`);

  const data = await resp.json();
  const user = data.data?.user;
  if (!user) throw new Error('User data not available');

  return {
    pk: user.pk || user.id,
    username: user.username,
    fullName: user.full_name,
    mediaCount: user.edge_owner_to_timeline_media?.count ?? user.media_count ?? 0,
    isPrivate: user.is_private,
    followedByViewer: user.followed_by_viewer,
  };
}

async function* paginateUserFeed(userId, { maxItems = 100, signal = null, onPage = null }) {
  let cursor = null;
  let totalCollected = 0;
  const PER_PAGE = 33;
  const PAGE_DELAY = 1500;

  while (totalCollected < maxItems) {
    if (signal?.aborted) break;

    const params = new URLSearchParams({ count: String(PER_PAGE) });
    if (cursor) params.set('max_id', cursor);

    const resp = await fetch(
      `https://www.instagram.com/api/v1/feed/user/${userId}/?${params}`,
      {
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'X-IG-App-ID': IG_APP_ID,
        },
        signal,
      },
    );

    if (resp.status === 429) {
      // Rate limited — back off and retry once
      await sleep(10000);
      continue;
    }
    if (!resp.ok) throw new Error(`Feed API returned ${resp.status}`);

    const data = await resp.json();
    const items = data.items || [];
    const remaining = maxItems - totalCollected;
    const batch = items.slice(0, remaining);

    totalCollected += batch.length;
    if (onPage) onPage({ collected: totalCollected });
    yield batch;

    cursor = data.next_max_id;
    if (!data.more_available || !cursor || batch.length === 0) break;

    await sleep(PAGE_DELAY);
  }
}

// ─── Feed item parsing ─────────────────────────────────────────

function bestCandidate(candidates) {
  if (!candidates?.length) return null;
  return candidates.reduce((best, c) =>
    (c.width * c.height) > (best.width * best.height) ? c : best
  );
}

function parseFeedItem(item) {
  const shortcode = item.code;
  const username = item.user?.username || 'unknown';
  const timestamp = item.taken_at ? new Date(item.taken_at * 1000) : new Date();
  const media = [];

  function addMedia(entry, index) {
    if (entry.video_versions?.length) {
      const best = bestCandidate(entry.video_versions);
      if (best) media.push({ type: 'video', url: best.url, index });
    } else if (entry.image_versions2?.candidates?.length) {
      const best = bestCandidate(entry.image_versions2.candidates);
      if (best) media.push({ type: 'image', url: best.url, index });
    }
  }

  if (item.media_type === 8 && item.carousel_media) {
    item.carousel_media.forEach((cm, i) => addMedia(cm, i));
  } else {
    addMedia(item, 0);
  }

  return { shortcode, username, timestamp, media };
}

// ─── Profile area detection ───────────────────────────────────

const PROFILE_ACTION_LABELS = [
  'follow', 'following', 'message', 'edit profile', 'share profile',
  '追蹤', '追蹤中', '發訊息', '編輯個人檔案', '分享個人檔案',
  '关注', '正在关注', '发消息', '编辑个人资料', '分享个人主页',
];

/**
 * Find the profile action row by looking for Follow/Message/Edit buttons.
 * Searches entire document — does not depend on <header> existing.
 */
function findProfileActionRow() {
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const text = btn.textContent?.trim().toLowerCase();
    if (PROFILE_ACTION_LABELS.some(l => text === l)) {
      return btn.parentElement;
    }
  }
  return null;
}

/**
 * Find any suitable container in the profile area.
 * Uses multiple strategies from specific to broad.
 */
function findProfileHeaderEl() {
  // Strategy 1: classic header section
  const classic = document.querySelector('header section');
  if (classic) return classic;

  // Strategy 2: find Follow/Message buttons → use their container
  const actionRow = findProfileActionRow();
  if (actionRow) {
    return actionRow.closest('section') || actionRow.closest('header') || actionRow.parentElement;
  }

  // Strategy 3: profile stats (posts/followers/following links)
  const statsLink = document.querySelector('a[href*="/followers"], a[href*="/following"]');
  if (statsLink) {
    const container = statsLink.closest('section') || statsLink.closest('ul')?.parentElement;
    if (container) return container;
  }

  // Strategy 4: broader header fallbacks
  return document.querySelector('header > div > section')
    || document.querySelector('header > section')
    || document.querySelector('main header > div')
    || document.querySelector('main header')
    || document.querySelector('header');
}

/**
 * Wait until any profile area element is found.
 */
function findProfileHeader(parent = document, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const existing = findProfileHeaderEl();
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const el = findProfileHeaderEl();
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(parent, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error('Profile header not found'));
    }, timeoutMs);
  });
}

// ─── Button injection ──────────────────────────────────────────

function injectProfileButton() {
  if (document.querySelector('.grabbit-profile-dl-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'grabbit-profile-dl-btn';
  btn.setAttribute(GRABBIT.ATTR, 'profile');
  btn.textContent = 'Grabbit All';
  btn.addEventListener('click', handleProfileBatchDownload);

  // Try to find the action row (Follow/Message buttons)
  const actionRow = findProfileActionRow();
  if (actionRow) {
    actionRow.appendChild(btn);
    return;
  }

  // Fallback: append to whatever profile area we can find
  const header = findProfileHeaderEl();
  if (header) {
    header.appendChild(btn);
  }
}

function cleanupProfileUI() {
  if (_profileAbort) {
    _profileAbort.abort();
    _profileAbort = null;
  }
  document.querySelectorAll('.grabbit-profile-dl-btn').forEach(el => el.remove());
  document.querySelectorAll('.grabbit-profile-progress').forEach(el => el.remove());
}

// ─── Progress banner ───────────────────────────────────────────

function showProgressBanner() {
  let banner = document.querySelector('.grabbit-profile-progress');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'grabbit-profile-progress';
    // Insert before the post grid / tab bar
    const tabBar = document.querySelector('[role="tablist"]');
    if (tabBar?.parentElement) {
      tabBar.parentElement.insertBefore(banner, tabBar);
    } else {
      const header = document.querySelector('header');
      if (header) header.after(banner);
    }
  }
  return banner;
}

function updateProgress(banner, { phase, scanned, totalPosts, downloaded, totalMedia, skipped, error }) {
  if (!banner) return;

  const skippedHtml = skipped ? ` <span class="grabbit-progress-skip">(${skipped} skipped)</span>` : '';

  let html = '';
  if (phase === 'scanning') {
    const pct = totalPosts > 0 ? Math.round((scanned / totalPosts) * 100) : 0;
    html = `
      <div class="grabbit-progress-text">Scanning posts... ${scanned}/${totalPosts}</div>
      <div class="grabbit-progress-bar"><div class="grabbit-progress-fill" style="width:${pct}%"></div></div>
      <button class="grabbit-cancel-btn">Cancel</button>`;
  } else if (phase === 'downloading') {
    const pct = totalMedia > 0 ? Math.round((downloaded / totalMedia) * 100) : 0;
    html = `
      <div class="grabbit-progress-text">Downloading... ${downloaded}/${totalMedia} files${skippedHtml}</div>
      <div class="grabbit-progress-bar"><div class="grabbit-progress-fill" style="width:${pct}%"></div></div>
      <button class="grabbit-cancel-btn">Cancel</button>`;
  } else if (phase === 'done') {
    html = `<div class="grabbit-progress-text grabbit-progress-done">Done! Downloaded ${downloaded} files.${skippedHtml}</div>`;
    setTimeout(() => banner.remove(), 5000);
  } else if (phase === 'cancelled') {
    html = `<div class="grabbit-progress-text grabbit-progress-warn">Cancelled. Downloaded ${downloaded || 0} files.${skippedHtml}</div>`;
    setTimeout(() => banner.remove(), 5000);
  } else if (phase === 'error') {
    html = `<div class="grabbit-progress-text grabbit-progress-error">Error: ${error}</div>`;
    setTimeout(() => banner.remove(), 8000);
  }

  banner.innerHTML = html;

  const cancelBtn = banner.querySelector('.grabbit-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => _profileAbort?.abort());
  }
}

// ─── Batch download handler ────────────────────────────────────

async function handleProfileBatchDownload(e) {
  e.preventDefault();
  e.stopPropagation();

  const btn = e.currentTarget;
  btn.disabled = true;

  _profileAbort = new AbortController();
  const signal = _profileAbort.signal;
  const banner = showProgressBanner();

  try {
    // 1. Extract username
    const username = extractUsernameFromUrl(location.href);
    if (!username) throw new Error('Could not determine username from URL');

    // 2. Fetch user info
    updateProgress(banner, { phase: 'scanning', scanned: 0, totalPosts: '?' });
    const userInfo = await fetchUserInfo(username);

    if (userInfo.isPrivate && !userInfo.followedByViewer) {
      throw new Error('This is a private account you do not follow');
    }

    // 3. Read maxBatchSize setting
    const settings = await chrome.storage.local.get('maxBatchSize');
    const maxItems = Math.min(settings.maxBatchSize || 100, userInfo.mediaCount || 9999);

    // 4. Paginate and collect all media
    const allMedia = [];
    let scanned = 0;

    for await (const batch of paginateUserFeed(userInfo.pk, {
      maxItems,
      signal,
      onPage: ({ collected }) => {
        scanned = collected;
        updateProgress(banner, { phase: 'scanning', scanned, totalPosts: maxItems });
      },
    })) {
      for (const item of batch) {
        const parsed = parseFeedItem(item);
        for (const m of parsed.media) {
          allMedia.push({
            ...m,
            shortcode: parsed.shortcode,
            username: parsed.username,
            timestamp: parsed.timestamp,
          });
        }
      }
    }

    if (signal.aborted) {
      updateProgress(banner, { phase: 'cancelled', downloaded: 0 });
      return;
    }

    if (allMedia.length === 0) {
      updateProgress(banner, { phase: 'error', error: 'No downloadable media found' });
      return;
    }

    // 5. Filter out already-downloaded media
    const mediaKeys = allMedia.map(item =>
      buildMediaKey({ source: 'ig', shortcode: item.shortcode, index: item.index })
    );
    const alreadyInHistory = await filterDownloaded(mediaKeys);

    // Also check Chrome download history for files downloaded before dedup feature
    let existingFileBases = new Set();
    try {
      const existingResp = await chrome.runtime.sendMessage({
        action: 'findExistingDownloads',
        subfolder: `${GRABBIT.DOWNLOAD_SUBFOLDER_IG}/${username}`,
      });
      if (existingResp?.filenames) {
        existingFileBases = new Set(existingResp.filenames);
      }
    } catch (e) {
      console.warn('Grabbit: could not check existing downloads:', e.message);
    }

    const newMedia = [];
    const toSeed = []; // media keys to back-fill into history
    for (let i = 0; i < allMedia.length; i++) {
      const item = allMedia[i];
      const key = mediaKeys[i];

      if (alreadyInHistory.has(key)) continue; // already in our history

      const filename = buildIGFilename({
        username: item.username,
        timestamp: item.timestamp,
        shortcode: item.shortcode,
        index: item.index,
        type: item.type,
      });

      if (existingFileBases.has(filename)) {
        toSeed.push(key); // file exists on disk — seed history
        continue;
      }

      newMedia.push(item);
    }

    // Back-fill history for pre-existing files
    if (toSeed.length > 0) {
      await recordDownloaded(toSeed);
    }
    const skipped = allMedia.length - newMedia.length;

    if (newMedia.length === 0) {
      updateProgress(banner, { phase: 'done', downloaded: 0, skipped });
      return;
    }

    // 6. Download new media only
    if (!chrome.runtime?.id) {
      throw new Error('Extension was reloaded — please refresh this page');
    }

    let downloaded = 0;
    const totalMedia = newMedia.length;
    updateProgress(banner, { phase: 'downloading', downloaded, totalMedia, skipped });

    for (const item of newMedia) {
      if (signal.aborted) {
        updateProgress(banner, { phase: 'cancelled', downloaded, skipped });
        return;
      }

      const filename = buildIGFilename({
        username: item.username,
        timestamp: item.timestamp,
        shortcode: item.shortcode,
        index: item.index,
        type: item.type,
      });

      const mediaKey = buildMediaKey({ source: 'ig', shortcode: item.shortcode, index: item.index });

      try {
        await chrome.runtime.sendMessage({
          action: 'download',
          url: item.url,
          filename,
          subfolder: `${GRABBIT.DOWNLOAD_SUBFOLDER_IG}/${item.username}`,
        });
        downloaded++;
        // Record in history
        await recordDownloaded([mediaKey]);
      } catch (err) {
        console.warn(`Grabbit: batch download failed for ${item.shortcode}:`, err.message);
      }

      updateProgress(banner, { phase: 'downloading', downloaded, totalMedia, skipped });
      await sleep(300);
    }

    updateProgress(banner, { phase: 'done', downloaded, skipped });
  } catch (err) {
    if (err.name === 'AbortError') {
      updateProgress(banner, { phase: 'cancelled', downloaded: 0 });
    } else {
      console.error('Grabbit profile batch error:', err);
      updateProgress(banner, { phase: 'error', error: err.message });
    }
  } finally {
    btn.disabled = false;
    _profileAbort = null;
  }
}
