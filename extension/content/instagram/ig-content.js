// Grabbit IG content script entry point

(function () {
  let observer = null;

  function init() {
    // Observe for article elements (posts) added to the DOM
    observer = observeNewElements('article', (article) => {
      injectDownloadButton(article);
    });
  }

  function cleanup() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    // Remove all injected buttons
    document.querySelectorAll(`[${GRABBIT.ATTR}]`).forEach(el => el.remove());
    document.querySelectorAll('.grabbit-toast').forEach(el => el.remove());
  }

  function reinit() {
    cleanup();
    init();
  }

  // Set up SPA navigation detection
  setupUrlChangeDetection(() => {
    // Re-initialize on URL change (IG is an SPA)
    reinit();
  });

  // Initial setup
  init();
})();
