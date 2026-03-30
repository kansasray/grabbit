// Grabbit YT content script entry point

(function () {
  let watchObserver = null;
  let shortsObserver = null;

  function init() {
    if (isWatchPage()) {
      attemptWatchInject();
    }
    if (isShortsPage()) {
      attemptShortsInject();
    }
  }

  // Watch page: try to inject, with retries via MutationObserver
  async function attemptWatchInject() {
    if (await injectWatchButton()) return; // success on first try

    // Element not ready yet — observe DOM until it appears
    watchObserver = new MutationObserver(async () => {
      if (await injectWatchButton()) {
        watchObserver.disconnect();
        watchObserver = null;
      }
    });
    watchObserver.observe(document.body, { childList: true, subtree: true });

    // Safety timeout: stop observing after 15s
    setTimeout(() => {
      if (watchObserver) {
        watchObserver.disconnect();
        watchObserver = null;
      }
    }, 15000);
  }

  // Shorts page: observe for reel renderers and inject into each
  function attemptShortsInject() {
    injectShortsButton(); // try immediately

    shortsObserver = new MutationObserver(() => {
      injectShortsButton();
    });
    shortsObserver.observe(document.body, { childList: true, subtree: true });
  }

  function cleanup() {
    if (watchObserver) {
      watchObserver.disconnect();
      watchObserver = null;
    }
    if (shortsObserver) {
      shortsObserver.disconnect();
      shortsObserver = null;
    }
    cleanupYTUI();
  }

  function reinit() {
    cleanup();
    init();
  }

  // YouTube fires yt-navigate-finish on SPA navigation
  document.addEventListener('yt-navigate-finish', () => {
    reinit();
  });

  // Fallback: also use URL polling (some edge cases)
  setupUrlChangeDetection(() => {
    reinit();
  });

  // Initial setup
  init();
})();
