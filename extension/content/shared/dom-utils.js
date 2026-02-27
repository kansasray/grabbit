// Grabbit DOM utilities for SPA content script injection

/**
 * Wait for a DOM element to appear.
 * Returns a Promise that resolves when an element matching `selector`
 * exists under `parent`. Times out after `timeoutMs`.
 */
function waitForElement(selector, parent = document, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const existing = parent.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver((mutations, obs) => {
      const el = parent.querySelector(selector);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });
    observer.observe(parent, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`waitForElement timed out: ${selector}`));
    }, timeoutMs);
  });
}

/**
 * Observe a parent element and call `callback(addedNode)` for every
 * descendant matching `selector` that gets added.
 * Also processes already-existing matches.
 * Returns the MutationObserver instance.
 */
function observeNewElements(selector, callback, parent = document.body) {
  parent.querySelectorAll(selector).forEach(callback);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.(selector)) callback(node);
        node.querySelectorAll?.(selector).forEach(callback);
      }
    }
  });
  observer.observe(parent, { childList: true, subtree: true });
  return observer;
}

/**
 * Detect SPA navigation by injecting a script into the MAIN world
 * to intercept history.pushState/replaceState, then listening for
 * a custom event in the content script's isolated world.
 */
function setupUrlChangeDetection(callback) {
  // Poll location.href — CSP-safe, no script injection needed
  let lastUrl = location.href;
  const check = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      callback(lastUrl);
    }
  };
  // Use MutationObserver on <head> as a proxy for navigation changes
  const head = document.querySelector('head') || document.documentElement;
  const observer = new MutationObserver(check);
  observer.observe(head, { childList: true, subtree: true });
  // Also poll as a safety net (IG sometimes doesn't trigger DOM mutations on nav)
  setInterval(check, 1000);
}

/**
 * Simple sleep utility.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
