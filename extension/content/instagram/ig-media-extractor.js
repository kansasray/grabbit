// Grabbit IG media URL extraction — multi-strategy

/**
 * Extract the shortcode from a URL or article element.
 */
function extractShortcode(articleOrUrl) {
  let url;
  if (typeof articleOrUrl === 'string') {
    url = articleOrUrl;
  } else {
    const timeLink = articleOrUrl.querySelector('a[href*="/p/"]')
                  || articleOrUrl.querySelector('a[href*="/reel/"]');
    url = timeLink?.href || location.href;
  }
  const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
  return match ? match[2] : null;
}

/**
 * Extract the username from an article element.
 */
function extractUsername(article) {
  const headerLink = article.querySelector('header a[href]');
  if (headerLink) {
    const match = headerLink.href.match(/instagram\.com\/([A-Za-z0-9._]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Convert IG shortcode to numeric media ID.
 */
function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = BigInt(0);
  for (const char of shortcode) {
    id = id * BigInt(64) + BigInt(alphabet.indexOf(char));
  }
  return id.toString();
}

// ─── Strategy 1: /api/v1/media/{id}/info/ ───────────────────────

async function fetchMediaInfo(shortcode) {
  const mediaId = shortcodeToMediaId(shortcode);
  const resp = await fetch(
    `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
    {
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-IG-App-ID': '936619743392459',
      },
    }
  );
  if (!resp.ok) throw new Error(`media/info API returned ${resp.status}`);
  return await resp.json();
}

// ─── Strategy 2: /p/{shortcode}/?__a=1&__d=dis ─────────────────

async function fetchPostDataViaAPI(shortcode) {
  const resp = await fetch(
    `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
    {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    }
  );
  if (!resp.ok) throw new Error(`__a=1 API returned ${resp.status}`);
  return await resp.json();
}

// ─── Strategy 3: Parse post page HTML ───────────────────────────

async function fetchMediaFromPostPage(shortcode) {
  const resp = await fetch(`https://www.instagram.com/p/${shortcode}/`, {
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(`Page fetch returned ${resp.status}`);
  const html = await resp.text();

  // Look for media data embedded in script tags
  const media = [];

  // Try to find JSON data containing image/video URLs
  const scriptPattern = /\"image_versions2\":\{\"candidates\":\[(.*?)\]/g;
  let match;
  let index = 0;
  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const candidates = JSON.parse('[' + match[1] + ']');
      const best = candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
      if (best?.url) {
        media.push({ type: 'image', url: best.url.replace(/\\u0026/g, '&'), index: index++ });
      }
    } catch (e) { /* skip */ }
  }

  // Also check for video URLs
  const videoPattern = /\"video_url\":\"(https?:[^\"]+)\"/g;
  while ((match = videoPattern.exec(html)) !== null) {
    const url = match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    media.push({ type: 'video', url, index: index++ });
  }

  return media;
}

// ─── Parse API response ─────────────────────────────────────────

function parseMediaFromAPIResponse(data) {
  const items = data.items || [];
  const item = items[0];
  if (!item) throw new Error('No items in API response');

  const media = [];
  const username = item.user?.username || 'unknown';
  const timestamp = item.taken_at ? new Date(item.taken_at * 1000) : new Date();

  if (item.carousel_media && item.carousel_media.length > 0) {
    item.carousel_media.forEach((cm, index) => {
      if (cm.video_versions && cm.video_versions.length > 0) {
        const best = cm.video_versions.sort((a, b) =>
          (b.width * b.height) - (a.width * a.height)
        )[0];
        media.push({ type: 'video', url: best.url, index });
      } else if (cm.image_versions2?.candidates) {
        const best = cm.image_versions2.candidates.sort((a, b) =>
          (b.width * b.height) - (a.width * a.height)
        )[0];
        media.push({ type: 'image', url: best.url, index });
      }
    });
  } else if (item.video_versions && item.video_versions.length > 0) {
    const best = item.video_versions.sort((a, b) =>
      (b.width * b.height) - (a.width * a.height)
    )[0];
    media.push({ type: 'video', url: best.url, index: 0 });
  } else if (item.image_versions2?.candidates) {
    const best = item.image_versions2.candidates.sort((a, b) =>
      (b.width * b.height) - (a.width * a.height)
    )[0];
    media.push({ type: 'image', url: best.url, index: 0 });
  }

  return { media, username, shortcode: item.code, timestamp };
}

// ─── DOM fallback ───────────────────────────────────────────────

function extractMediaFromDOM(article) {
  const media = [];

  const video = article.querySelector('video');
  if (video) {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) {
      media.push({ type: 'video', url: src, index: 0 });
    }
  }

  const imgs = article.querySelectorAll('img[srcset]');
  imgs.forEach((img, idx) => {
    if (img.width < 200 && img.height < 200) return;
    const sources = img.srcset.split(',').map(s => {
      const parts = s.trim().split(' ');
      return { url: parts[0], width: parseInt(parts[1]) || 0 };
    });
    const best = sources.sort((a, b) => b.width - a.width)[0];
    if (best) {
      media.push({ type: 'image', url: best.url, index: idx });
    }
  });

  return media;
}

// ─── Combined extraction (tries all strategies) ─────────────────

async function extractAllMedia(article) {
  const shortcode = extractShortcode(article);
  if (!shortcode) {
    console.warn('Grabbit: Could not extract shortcode');
    return { media: extractMediaFromDOM(article), username: 'unknown', shortcode: 'unknown', timestamp: new Date() };
  }

  const username = extractUsername(article) || 'unknown';

  // Strategy 1: /api/v1/media/{id}/info/
  try {
    const data = await fetchMediaInfo(shortcode);
    const result = parseMediaFromAPIResponse(data);
    if (result.media.length > 0) {
      console.log(`Grabbit: Strategy 1 (media/info) success — ${result.media.length} items`);
      return result;
    }
  } catch (err) {
    console.warn('Grabbit: Strategy 1 (media/info) failed:', err.message);
  }

  // Strategy 2: ?__a=1&__d=dis
  try {
    const data = await fetchPostDataViaAPI(shortcode);
    const result = parseMediaFromAPIResponse(data);
    if (result.media.length > 0) {
      console.log(`Grabbit: Strategy 2 (__a=1) success — ${result.media.length} items`);
      return result;
    }
  } catch (err) {
    console.warn('Grabbit: Strategy 2 (__a=1) failed:', err.message);
  }

  // Strategy 3: Parse post page HTML
  try {
    const media = await fetchMediaFromPostPage(shortcode);
    if (media.length > 0) {
      console.log(`Grabbit: Strategy 3 (HTML parse) success — ${media.length} items`);
      return { media, username, shortcode, timestamp: new Date() };
    }
  } catch (err) {
    console.warn('Grabbit: Strategy 3 (HTML parse) failed:', err.message);
  }

  // Strategy 4: DOM fallback (only gets visible images)
  console.warn('Grabbit: All API strategies failed, using DOM fallback (may miss carousel items)');
  return {
    media: extractMediaFromDOM(article),
    username,
    shortcode,
    timestamp: new Date(),
  };
}
