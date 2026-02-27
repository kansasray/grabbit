// Grabbit download queue manager — routes through service worker

async function updateQueueItem(item) {
  if (!chrome.runtime?.id) return;
  await chrome.runtime.sendMessage({ action: 'queueUpdate', item });
}

async function completeQueueItem(id, filename) {
  await updateQueueItem({ id, status: 'done', filename, progress: 100 });
}

async function failQueueItem(id, error) {
  await updateQueueItem({ id, status: 'error', error });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}
