const DEFAULT_RAID_PRESETS = [
  'Nice one 🔥',
  'Love this.',
  'This looks interesting.',
  'Let’s go 🚀',
  'Great update.',
  'Solid work.'
];

const textarea = document.getElementById('raidPresets');
const presetCount = document.getElementById('presetCount');
const saveStatus = document.getElementById('saveStatus');
const saveButton = document.getElementById('savePresets');
const resetButton = document.getElementById('resetPresets');

function parsePresets() {
  return textarea.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function renderCount() {
  const count = parsePresets().length;
  presetCount.textContent = `${count}/100`;
  presetCount.title = `${count} ${count === 1 ? 'preset' : 'presets'}`;
}

function showStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle('error', isError);
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    saveStatus.textContent = '';
    saveStatus.classList.remove('error');
  }, 2200);
}

async function loadPresets() {
  const data = await chrome.storage.local.get('raidPresets');
  const presets = Array.isArray(data.raidPresets) && data.raidPresets.length
    ? data.raidPresets
    : DEFAULT_RAID_PRESETS;
  textarea.value = presets.join('\n');
  renderCount();
}

saveButton.addEventListener('click', async () => {
  const presets = parsePresets();
  if (!presets.length) {
    showStatus('Add at least one preset before saving.', true);
    return;
  }
  await chrome.storage.local.set({ raidPresets: presets });
  textarea.value = presets.join('\n');
  renderCount();
  showStatus('Raid presets saved.');
});

resetButton.addEventListener('click', async () => {
  await chrome.storage.local.set({ raidPresets: DEFAULT_RAID_PRESETS.slice() });
  textarea.value = DEFAULT_RAID_PRESETS.join('\n');
  renderCount();
  showStatus('Default presets restored.');
});

textarea.addEventListener('input', renderCount);
loadPresets().catch(() => showStatus('Could not load presets.', true));
