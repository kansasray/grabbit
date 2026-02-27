// Grabbit IG carousel detection & DOM fallback collection

/**
 * Detect if an article is a carousel post.
 */
function isCarousel(article) {
  // Check for Next/Previous navigation arrows
  const hasArrows = article.querySelector('button[aria-label="Next"]')
    || article.querySelector('button[aria-label="Go to next image"]')
    || article.querySelector('button[aria-label="下一步"]')
    || article.querySelector('button[aria-label="下一張"]');
  if (hasArrows) return true;

  // Check for dot indicators
  if (article.querySelector('div[role="tablist"]')) return true;

  // Check for multiple small dots (carousel indicator)
  const dots = article.querySelectorAll('div[style*="transform"]');
  if (dots.length >= 3) return true;

  return false;
}

/**
 * Count carousel slides by looking at dot indicators.
 */
function getCarouselCount(article) {
  // Method 1: tablist children
  const tablist = article.querySelector('div[role="tablist"]');
  if (tablist) {
    const tabs = tablist.querySelectorAll('[role="tab"]');
    if (tabs.length > 0) return tabs.length;
  }

  // Method 2: small circle indicators (usually at bottom of carousel)
  // IG renders them as small divs in a row
  const indicatorContainers = article.querySelectorAll('div');
  for (const container of indicatorContainers) {
    const children = container.children;
    if (children.length >= 2 && children.length <= 20) {
      let allSmallCircles = true;
      for (const child of children) {
        const style = window.getComputedStyle(child);
        const w = parseFloat(style.width);
        const h = parseFloat(style.height);
        if (w > 10 || h > 10 || w < 3 || h < 3) {
          allSmallCircles = false;
          break;
        }
      }
      if (allSmallCircles && children.length >= 2) return children.length;
    }
  }

  return 0;
}

/**
 * DOM fallback: collect carousel images by observing slide changes.
 * Shows a "swipe through slides" prompt, collects each new image,
 * and resolves when user clicks "Done".
 */
function collectCarouselFromDOM(article) {
  return new Promise((resolve) => {
    const collected = new Map(); // url -> {type, url, index}
    let currentIndex = 0;

    const captureVisible = () => {
      // Capture visible images
      const imgs = article.querySelectorAll('img[srcset]');
      imgs.forEach(img => {
        if (img.width < 200 && img.height < 200) return;
        const sources = img.srcset.split(',').map(s => {
          const parts = s.trim().split(' ');
          return { url: parts[0], width: parseInt(parts[1]) || 0 };
        });
        const best = sources.sort((a, b) => b.width - a.width)[0];
        if (best && !collected.has(best.url)) {
          collected.set(best.url, { type: 'image', url: best.url, index: currentIndex++ });
        }
      });

      // Capture visible videos
      const videos = article.querySelectorAll('video');
      videos.forEach(video => {
        const src = video.src || video.querySelector('source')?.src;
        if (src && !src.startsWith('blob:') && !collected.has(src)) {
          collected.set(src, { type: 'video', url: src, index: currentIndex++ });
        }
      });

      updateBadge();
    };

    // Badge showing collected count
    let badge = null;
    const updateBadge = () => {
      if (badge) badge.textContent = `Collected: ${collected.size} slides — swipe for more, then click Done`;
    };

    // Show collection UI
    badge = document.createElement('div');
    badge.className = 'grabbit-carousel-badge';
    badge.textContent = `Swipe through all slides, then click Done`;
    article.style.position = article.style.position || 'relative';
    article.appendChild(badge);

    const doneBtn = document.createElement('button');
    doneBtn.className = 'grabbit-carousel-done-btn';
    doneBtn.textContent = 'Done — Download All';
    article.appendChild(doneBtn);

    // Observe DOM changes in the carousel area
    const observer = new MutationObserver(() => captureVisible());
    const list = article.querySelector('ul') || article;
    observer.observe(list, { childList: true, subtree: true, attributes: true });

    // Capture initial state
    captureVisible();

    // Done button handler
    doneBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      observer.disconnect();
      badge.remove();
      doneBtn.remove();
      resolve(Array.from(collected.values()));
    });

    // Auto-timeout after 2 minutes
    setTimeout(() => {
      observer.disconnect();
      badge.remove();
      doneBtn.remove();
      resolve(Array.from(collected.values()));
    }, 120000);
  });
}
