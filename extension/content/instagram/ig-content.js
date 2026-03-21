// Grabbit IG content script entry point

(function () {
  let observer = null;

  function init() {
    // Observe for article elements (posts) added to the DOM
    observer = observeNewElements('article', (article) => {
      injectDownloadButton(article);
    });

    // If on a profile page, inject the "Grabbit All" button
    if (isProfilePage(location.href)) {
      findProfileHeader(document, 10000)
        .then(() => injectProfileButton())
        .catch(() => console.warn('Grabbit: profile header not found'));
    }
  }

  function cleanup() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    // Remove all injected buttons
    document.querySelectorAll(`[${GRABBIT.ATTR}]`).forEach(el => el.remove());
    document.querySelectorAll('.grabbit-toast').forEach(el => el.remove());
    // Clean up profile batch UI
    cleanupProfileUI();
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
