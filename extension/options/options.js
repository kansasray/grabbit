// Grabbit options page

const FIELDS = ['apiBaseUrl', 'apiKey', 'maxBatchSize', 'ytDefaultQuality'];

// Load saved settings
async function loadSettings() {
  const data = await chrome.storage.local.get(FIELDS);
  for (const field of FIELDS) {
    const el = document.getElementById(field);
    if (el && data[field] !== undefined) {
      el.value = data[field];
    }
  }
}

// Save settings
document.getElementById('options-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const settings = {};
  for (const field of FIELDS) {
    const el = document.getElementById(field);
    if (el) {
      settings[field] = el.type === 'number' ? parseInt(el.value) || 100 : el.value;
    }
  }
  await chrome.storage.local.set(settings);

  const status = document.getElementById('save-status');
  status.textContent = 'Saved!';
  status.className = 'status-ok';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

// Test backend connection
document.getElementById('testConnection').addEventListener('click', async () => {
  const result = document.getElementById('testResult');
  const url = document.getElementById('apiBaseUrl').value;
  const key = document.getElementById('apiKey').value;

  if (!url) {
    result.textContent = 'Enter a URL first';
    result.className = 'status-err';
    return;
  }

  result.textContent = 'Testing...';
  result.className = '';

  try {
    const resp = await fetch(`${url.replace(/\/$/, '')}/health`, {
      headers: { 'X-API-Key': key },
    });
    if (resp.ok) {
      result.textContent = 'Connected!';
      result.className = 'status-ok';
    } else {
      result.textContent = `Error: ${resp.status}`;
      result.className = 'status-err';
    }
  } catch (err) {
    result.textContent = 'Cannot connect';
    result.className = 'status-err';
  }
});

loadSettings();
