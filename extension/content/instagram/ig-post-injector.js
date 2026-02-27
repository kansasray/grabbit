// Grabbit IG post download button injection

// ─── Action bar detection strategies ────────────────────────────

const ACTION_BAR_STRATEGIES = [
  // Strategy 1: find Save/Bookmark SVG by aria-label (multi-locale)
  (article) => {
    // Try multiple known aria-labels across locales
    const svgs = article.querySelectorAll('svg[aria-label]');
    for (const svg of svgs) {
      const label = svg.getAttribute('aria-label')?.toLowerCase() || '';
      if (label.includes('save') || label.includes('bookmark')
        || label.includes('remove') || label.includes('儲存')
        || label.includes('收藏') || label.includes('保存')) {
        return svg.closest('section');
      }
    }
    return null;
  },
  // Strategy 2: section containing 3+ SVG icons (like/comment/share)
  (article) => {
    const sections = article.querySelectorAll('section');
    for (const sec of sections) {
      if (sec.querySelectorAll('svg').length >= 3) return sec;
    }
    return null;
  },
  // Strategy 3: structural — direct child section of article
  (article) => article.querySelector(':scope > div > section'),
];

function findActionBar(article) {
  for (const strategy of ACTION_BAR_STRATEGIES) {
    try {
      const result = strategy(article);
      if (result) return result;
    } catch (e) {
      // Strategy failed, try next
    }
  }
  return null;
}

// ─── Download button injection ──────────────────────────────────

function createDownloadButton(carouselCount) {
  const btn = document.createElement('button');
  btn.setAttribute(GRABBIT.ATTR, 'true');
  btn.className = 'grabbit-dl-btn';
  btn.title = carouselCount
    ? `Download all ${carouselCount} slides with Grabbit`
    : 'Download with Grabbit';
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24">
    <path d="M12 2v13m0 0l-4-4m4 4l4-4M4 19h16"
          stroke="currentColor" stroke-width="2" fill="none"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>${carouselCount ? `<span class="grabbit-badge">${carouselCount}</span>` : ''}`;
  return btn;
}

function injectDownloadButton(article) {
  try {
    if (article.querySelector(`[${GRABBIT.ATTR}]`)) return;

    const actionBar = findActionBar(article);
    if (!actionBar) return;

    const carousel = isCarousel(article);
    const count = carousel ? getCarouselCount(article) : 0;
    const btn = createDownloadButton(count);

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handlePostDownload(article, btn);
    });

    const actionRow = actionBar.querySelector(':scope > div') || actionBar;
    const lastChild = actionRow.lastElementChild;
    if (lastChild) {
      actionRow.insertBefore(btn, lastChild);
    } else {
      actionRow.appendChild(btn);
    }
  } catch (err) {
    console.warn('Grabbit: Failed to inject button on article:', err.message);
  }
}

// ─── Download handler ───────────────────────────────────────────

async function handlePostDownload(article, btn) {
  btn.classList.add('grabbit-loading');

  try {
    let { media, username, shortcode, timestamp } = await extractAllMedia(article);
    console.log('Grabbit: extracted media:', JSON.stringify(media.map(m => ({
      type: m.type, index: m.index, url: m.url?.substring(0, 60)
    }))));

    // If carousel but API only got partial results, offer DOM collection
    const carousel = isCarousel(article);
    if (carousel && media.length <= 1) {
      console.log('Grabbit: Carousel detected but only got', media.length, 'items — starting DOM collection');
      btn.classList.remove('grabbit-loading');
      const collected = await collectCarouselFromDOM(article);
      if (collected.length > media.length) {
        media = collected;
        username = username || extractUsername(article) || 'unknown';
        shortcode = shortcode || extractShortcode(article) || 'unknown';
      }
      btn.classList.add('grabbit-loading');
    }

    if (media.length === 0) {
      showToast('No downloadable media found', article);
      return;
    }

    if (!chrome.runtime?.id) {
      throw new Error('Extension was reloaded — please refresh this page (Cmd+Shift+R)');
    }

    let downloaded = 0;
    for (const item of media) {
      const filename = buildIGFilename({
        username,
        timestamp,
        shortcode,
        index: item.index,
        type: item.type,
      });

      const queueId = generateId();

      // Check if this is a video with a blob: URL or no direct URL — needs backend
      const needsBackend = item.type === 'video' && (!item.url || item.url.startsWith('blob:'));

      if (needsBackend) {
        // Fall back to backend (yt-dlp) for Reels/videos
        const postUrl = `https://www.instagram.com/reel/${shortcode}/`;
        await updateQueueItem({
          id: queueId, source: 'ig', status: 'queued',
          filename, progress: 0,
        });

        const resp = await chrome.runtime.sendMessage({
          action: 'downloadViaBackend',
          pageUrl: postUrl,
          format: 'best',
          filenameHint: filename,
          subfolder: `${GRABBIT.DOWNLOAD_SUBFOLDER_IG}/${username}`,
          queueId,
        });

        if (resp && !resp.success) {
          await failQueueItem(queueId, resp.error || 'Backend download failed');
          console.warn('Grabbit: backend fallback failed:', resp.error);
          // Don't throw — continue with other items
        } else {
          downloaded++;
        }
      } else {
        // Direct download (photos, videos with direct URLs)
        await updateQueueItem({
          id: queueId, source: 'ig', status: 'downloading',
          filename, url: item.url, progress: 0,
        });

        const resp = await chrome.runtime.sendMessage({
          action: 'download',
          url: item.url,
          filename,
          subfolder: `${GRABBIT.DOWNLOAD_SUBFOLDER_IG}/${username}`,
        });

        if (resp && !resp.success) {
          await failQueueItem(queueId, resp.error || 'Download failed');
          throw new Error(resp.error || 'Download failed');
        }

        await completeQueueItem(queueId, filename);
        downloaded++;
      }

      if (media.length > 1) await sleep(300);
    }

    btn.classList.add('grabbit-done');
    showToast(`Downloaded ${downloaded} file${downloaded > 1 ? 's' : ''}`, article);
  } catch (err) {
    console.error('Grabbit download error:', err);
    showToast('Download failed: ' + err.message, article);
    btn.classList.add('grabbit-error');
  } finally {
    btn.classList.remove('grabbit-loading');
    setTimeout(() => {
      btn.classList.remove('grabbit-done', 'grabbit-error');
    }, 3000);
  }
}

// ─── Toast notification ─────────────────────────────────────────

function showToast(message, article) {
  const existing = article.querySelector('.grabbit-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'grabbit-toast';
  toast.textContent = message;
  article.style.position = article.style.position || 'relative';
  article.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}
