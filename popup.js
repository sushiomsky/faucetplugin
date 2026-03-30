// ── Globals ──────────────────────────────────────────────────────────────────
let currentSettings = { enabled: false, faucets: [] };
let selectedSiteIndex = 0;
let cryptoPrices = {};
let minWdThresholds = {};
let saveTimeout = null;

// ── DOM Elements ─────────────────────────────────────────────────────────────
const masterToggle = document.getElementById('masterToggle');
const navItems = document.querySelectorAll('.nav-item');
const panels = document.querySelectorAll('.panel');
const siteSelector = document.getElementById('siteSelector');
const configContent = document.querySelector('.config-content');
const statusGrid = document.getElementById('statusGrid');
const logGrid = document.getElementById('logGrid');
const saveHint = document.getElementById('saveHint');

// ── Initialization ───────────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(['settings', 'cryptoPrices', 'minWdThresholds']);
  currentSettings = stored.settings || { enabled: false, faucets: makeFaucetDefaults() };
  cryptoPrices = stored.cryptoPrices?.data || {};
  minWdThresholds = stored.minWdThresholds || {};

  // Setup Master Toggle
  masterToggle.checked = currentSettings.enabled;
  masterToggle.addEventListener('change', () => {
    currentSettings.enabled = masterToggle.checked;
    saveSettings();
  });

  // Setup Tabs
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(nav => nav.classList.remove('active'));
      panels.forEach(panel => panel.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`tab-${item.dataset.tab}`).classList.add('active');
    });
  });

  renderSiteChips();
  renderSelectedConfig();
  refreshStatus();
  
  // Periodic status refresh
  setInterval(refreshStatus, 3000);
}

// ── Config Panel Logic ───────────────────────────────────────────────────────
function renderSiteChips() {
  siteSelector.innerHTML = '';
  currentSettings.faucets.forEach((f, index) => {
    const chip = document.createElement('div');
    chip.className = `site-chip ${index === selectedSiteIndex ? 'active' : ''}`;
    chip.textContent = f.label;
    chip.addEventListener('click', () => {
      selectedSiteIndex = index;
      document.querySelectorAll('.site-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderSelectedConfig();
    });
    siteSelector.appendChild(chip);
  });
}

function renderSelectedConfig() {
  const f = currentSettings.faucets[selectedSiteIndex];
  if (!f) return;

  // Bind values
  document.getElementById('siteEnabled').checked = f.active !== false;
  document.getElementById('baseInterval').value = f.intervalMinutes || 61;
  document.getElementById('randOffset').value = f.maxRandomMinutes || 5;

  
  document.getElementById('wdEnabled').checked = !!f.wdEnabled;
  document.getElementById('wdThreshold').value = f.wdThreshold || '';
  document.getElementById('wdAddress').value = f.wdAddress || '';
  
  document.getElementById('dbEnabled').checked = !!f.dbEnabled;
  document.getElementById('dbStrategy').value = f.dbStrategy || 'all-in-0.1';

  const dbConfig = f.dbStrategyConfig || getDefaultHighRollerConfig();
  document.getElementById('dbBaseBet').value = dbConfig.base_bet_fraction;
  document.getElementById('dbMaxBet').value = dbConfig.max_bet_fraction;
  document.getElementById('dbLadderDepth').value = dbConfig.max_ladder_depth;
  document.getElementById('dbHistoryWindow').value = dbConfig.history_window;
  document.getElementById('dbStreakTrigger').value = dbConfig.streak_trigger;
  document.getElementById('dbVolatilityTrigger').value = dbConfig.volatility_trigger;

  // Dynamic Visibility
  updateDynamicFields();

  // Attach Listeners
  const inputs = configContent.querySelectorAll('input, select');
  inputs.forEach(input => {
    const handler = () => {
      updateSettingsFromUI();
      debouncedSave();
      updateDynamicFields();
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
}

function updateDynamicFields() {
  const wdEnabled = document.getElementById('wdEnabled').checked;
  const dbEnabled = document.getElementById('dbEnabled').checked;
  
  document.getElementById('wdFields').classList.toggle('hidden', !wdEnabled);
  document.getElementById('dbFields').classList.toggle('hidden', !dbEnabled);
  
  const strategy = document.getElementById('dbStrategy').value;
  document.getElementById('dbStrategyConfigFields').classList.toggle('hidden', strategy !== 'combined-high-roller');
  
  const host = new URL(currentSettings.faucets[selectedSiteIndex].url).hostname.replace('www.', '');
  const minWd = minWdThresholds[host];
  const minWdLabel = document.getElementById('minWdLabel');
  if (minWd) {
    minWdLabel.textContent = `Last scraped min: ${minWd}`;
  } else {
    minWdLabel.textContent = '';
  }
}

function updateSettingsFromUI() {
  const f = currentSettings.faucets[selectedSiteIndex];
  f.active = document.getElementById('siteEnabled').checked;
  f.intervalMinutes = parseInt(document.getElementById('baseInterval').value) || 61;
  f.maxRandomMinutes = parseInt(document.getElementById('randOffset').value) || 5;

  f.wdEnabled = document.getElementById('wdEnabled').checked;
  f.wdThreshold = document.getElementById('wdThreshold').value;
  f.wdAddress = document.getElementById('wdAddress').value.trim();
  f.dbEnabled = document.getElementById('dbEnabled').checked;
  f.dbStrategy = document.getElementById('dbStrategy').value;

  f.dbStrategyConfig = normalizeHighRollerConfig({
    base_bet_fraction: document.getElementById('dbBaseBet').value,
    max_bet_fraction: document.getElementById('dbMaxBet').value,
    max_ladder_depth: document.getElementById('dbLadderDepth').value,
    history_window: document.getElementById('dbHistoryWindow').value,
    streak_trigger: document.getElementById('dbStreakTrigger').value,
    volatility_trigger: document.getElementById('dbVolatilityTrigger').value
  });
}

// ── Status Panel Logic ───────────────────────────────────────────────────────
async function refreshStatus() {
  const stored = await chrome.storage.local.get(['activeTabs', 'claimHistory', 'activityLog']);
  const activeTabs = stored.activeTabs || {};
  const claimHistory = stored.claimHistory || {};
  const logs = stored.activityLog || [];

  // Update Stats
  const activeCount = currentSettings.faucets.filter(f => f.active !== false).length;
  document.getElementById('activeSitesCount').textContent = activeCount;

  // Render Grid
  statusGrid.innerHTML = '';
  currentSettings.faucets.filter(f => f.active !== false).forEach(f => {
    const host = new URL(f.url).hostname.replace('www.', '');
    const lastClaim = claimHistory[f.url] || 0;
    const intervalMs = (f.intervalMinutes || 61) * 60000;
    const nextDue = lastClaim + intervalMs;
    const now = Date.now();
    
    const isActive = Object.values(activeTabs).some(t => t.faucetUrl.includes(host));
    
    // Status color
    let statusClass = 'ok';
    let statusText = 'Ready';
    if (isActive) {
       statusClass = 'busy';
       statusText = 'In Progress';
    } else if (nextDue > now) {
       statusText = fmtCountdown(nextDue - now);
    } else {
       statusText = 'Due Now';
    }

    const card = document.createElement('div');
    card.className = `site-status-card ${isActive ? 'running' : ''}`;
    card.innerHTML = `
      <div class="card-top">
        <span class="site-name">${host}</span>
        <div class="site-indicator ${statusClass}"></div>
      </div>
      <div class="card-btm">
        Status: <span class="countdown">${statusText}</span>
      </div>
    `;
    statusGrid.appendChild(card);
  });

  renderLogs(logs);

  // Stop button visibility
  const isAnyActive = Object.keys(activeTabs).length > 0;
  document.getElementById('stopBtn').classList.toggle('hidden', !isAnyActive);
  document.getElementById('startBtn').classList.toggle('hidden', isAnyActive);
}

function renderLogs(logs) {
  if (logs.length === 0) {
    logGrid.innerHTML = '<div style="text-align:center; margin-top:40px; color:var(--text-dim);">No recent activity</div>';
    return;
  }
  
  logGrid.innerHTML = logs.slice(0, 15).map(log => {
    const host = new URL(log.url).hostname.replace('www.', '');
    const isError = log.status === 'error' || log.status === 'wd-error';
    return `
      <div class="log-item" style="${isError ? 'border-color: var(--status-err)' : ''}">
        <div class="log-main">
          <span class="log-site">${host}</span>
          <span class="log-title">${log.status === 'ok' ? 'Claim Successful' : log.reason || log.status}</span>
        </div>
        <div class="log-side">
          <div class="log-val">${log.balance ? log.balance.toFixed(4) : ''}</div>
          <div class="log-ts">${new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtCountdown(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function debouncedSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveSettings();
    showSaveHint();
  }, 800);
}

function showSaveHint() {
  saveHint.classList.add('show');
  setTimeout(() => saveHint.classList.remove('show'), 2000);
}

async function saveSettings() {
  chrome.runtime.sendMessage({ 
    type: "save-settings", 
    settings: currentSettings 
  });
}

// ── Bottom Buttons ───────────────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: "manual-run" });
});

document.getElementById('manualDiceBtn').addEventListener('click', () => {
    const f = currentSettings.faucets[selectedSiteIndex];
    if (f && f.dbEnabled) {
      chrome.runtime.sendMessage({ type: "manual-run-dice", url: f.url });
    }
});

document.getElementById('stopBtn').addEventListener('click', async () => {
    const { activeTabs = {} } = await chrome.storage.local.get("activeTabs");
    for (const tabId of Object.keys(activeTabs)) {
      try { await chrome.tabs.remove(parseInt(tabId)); } catch (_) {}
    }
    await chrome.storage.local.set({ activeTabs: {}, running: false });
    refreshStatus();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm("Factory reset all settings and history?")) {
    chrome.runtime.sendMessage({ type: "reset-all-sites" });
    setTimeout(() => location.reload(), 500);
  }
});

init();
