// Grabbit filename utilities

/**
 * Remove illegal characters from a filename.
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 200);
}

/**
 * Format a date as YYYYMMDD.
 */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Build an Instagram filename.
 * Format: {username}_{YYYYMMDD}_{shortcode}_{index}.{ext}
 */
function buildIGFilename({ username, timestamp, shortcode, index, type }) {
  const date = formatDate(timestamp || new Date());
  const ext = type === 'video' ? 'mp4' : 'jpg';
  const indexSuffix = index !== undefined && index > 0 ? `_${index + 1}` : '';
  return sanitizeFilename(`${username}_${date}_${shortcode}${indexSuffix}.${ext}`);
}

/**
 * Build a YouTube filename.
 * Format: {channel}_{title}_{quality}.mp4
 */
function buildYTFilename({ channel, title, quality }) {
  return sanitizeFilename(`${channel}_${title}_${quality}.mp4`);
}
