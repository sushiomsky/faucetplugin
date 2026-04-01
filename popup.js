// ── Navigation ────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    item.classList.add("active");
    const target = document.getElementById("tab-" + item.dataset.tab);
    if (target) target.classList.add("active");
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(ms) { return ms ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }) + " " + new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "–"; }
function fmtCountdown(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}m ${String(s).padStart(2,"0")}s`;
}
function hostname(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}

// ── Globals ──────────────────────────────────────────────────────────────────
let currentFaucets = [];
let selectedFaucetIndex = 0;
let cryptoPrices = {};
let minWdThresholds = {};

// ── UI Elements ──────────────────────────────────────────────────────────────
const dashboardGrid = document.getElementById("dashboardGrid");
const sitesListContainer = document.getElementById("sitesListContainer");
const historyList = document.getElementById("historyList");
const totalValueEl = document.getElementById("totalValue");
const nodeNameEl = document.getElementById("nodeName");
const protocolStatusEl = document.getElementById("protocolStatus");
const headerStatusText = document.getElementById("headerStatusText");
const runBtn = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");
const saveBtn = document.getElementById("saveBtn");
const saveMsg = document.getElementById("saveMsg");

// ── Status Refresh Loop ──────────────────────────────────────────────────────
async function refreshStatus() {
  const stored = await chrome.storage.local.get([
    "running", "settings", "activityLog", "activeTabs", "claimHistory", 
    "cryptoPrices", "minWdThresholds", "updateAvailable", "updateVersion", "updateUrl", "claimCounts"
  ]);
  
  const settings     = stored.settings || {};
  const enabled      = settings.enabled !== false;
  const faucets      = settings.faucets || [];
  const running      = stored.running;
  const activeTabs   = stored.activeTabs || {};
  const claimHistory = stored.claimHistory || {};
  const claimCounts  = stored.claimCounts || {};
  const log          = stored.activityLog || [];
  cryptoPrices       = stored.cryptoPrices?.data || {};
  minWdThresholds    = stored.minWdThresholds || {};
  const now          = Date.now();

  // 1. Branding & Header
  nodeNameEl.textContent = settings.nodeName || "Astra Node-01";
  const activeList = Object.values(activeTabs).filter(t => t.phase !== "done");
  
  if (!enabled) {
    headerStatusText.textContent = "OFFLINE";
    protocolStatusEl.innerHTML = `<span id="statusLabel">PROTOCOL DEACTIVATED</span>`;
    protocolStatusEl.className = "protocol-status";
  } else {
    headerStatusText.textContent = activeList.length > 0 ? "BUSY" : "SYNCED";
    protocolStatusEl.innerHTML = activeList.length > 0 ? `<span id="statusLabel" class="active">ALPHA CYCLE IN PROGRESS</span>` : `<span id="statusLabel">STANDBY — OPTIMIZING YIELD</span>`;
  }

  // 2. Update Banner
  const updateBanner = document.getElementById("updateBanner");
  if (stored.updateAvailable) {
    updateBanner.textContent = `🚀 PROTOCOL v${stored.updateVersion} READY`;
    updateBanner.style.display = "block";
    updateBanner.onclick = () => { window.open(stored.updateUrl || "https://github.com/sushiomsky/faucetplugin", "_blank"); };
  } else {
    updateBanner.style.display = "none";
  }

  // 3. Analytics & Total Value
  // Sum up balances if possible, or just show LIVE status
  totalValueEl.textContent = cryptoPrices ? "PROTOCOL LIVE" : "OFFLINE";

  // 4. Dashboard Site Grid (Premium Cards)
  dashboardGrid.innerHTML = "";
  faucets.filter(f => f.active !== false).forEach(f => {
    const host = hostname(f.url);
    const tabEntry = Object.values(activeTabs).find(t => hostname(t.faucetUrl) === host);
    const lastLog = log.find(e => hostname(e.url) === host);
    const lastClaim = claimHistory[f.url] || 0;
    const intervalMs = (f.intervalMinutes || 61) * 60000;
    const nextDue = lastClaim + intervalMs;
    const timeLeft = nextDue - now;
    
    // Calculate progress percentage
    let perc = 0;
    if (timeLeft > 0) {
      perc = Math.max(0, Math.min(100, Math.round(((intervalMs - timeLeft) / intervalMs) * 100)));
    } else {
      perc = 100;
    }
    const offset = 201 - (2.01 * perc);

    const card = document.createElement("div");
    card.className = "site-card-premium" + (tabEntry ? " busy" : "");
    
    card.innerHTML = `
      <div class="progress-ring-container">
        <svg class="progress-ring-svg" width="70" height="70">
          <circle class="progress-ring-circle-bg" cx="35" cy="35" r="32"></circle>
          <circle class="progress-ring-circle" cx="35" cy="35" r="32" style="stroke-dashoffset: ${offset}"></circle>
        </svg>
        <span class="progress-ring-percentage">${perc}%</span>
        <span class="token-symbol">${f.label.toUpperCase()}</span>
      </div>
      <div class="card-meta">
        <div class="card-site-name">${host}</div>
        <div class="card-site-timer">${timeLeft > 0 ? fmtCountdown(timeLeft) : "CLAIMABLE"}</div>
        <div class="card-site-balance">${lastLog?.balance ? lastLog.balance.toFixed(4) : "–"}</div>
      </div>
    `;
    dashboardGrid.appendChild(card);
  });

  // 5. Protocol Library (Sites Panel)
  sitesListContainer.innerHTML = "";
  faucets.forEach((f, i) => {
    const card = document.createElement("div");
    card.style = "background:var(--panel); border:1px solid var(--glass-border); border-radius:15px; padding:12px 15px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;";
    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:32px; height:32px; border-radius:8px; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:var(--accent);">${f.label[0].toUpperCase()}</div>
        <div>
          <div style="font-size:12px; font-weight:700;">${f.label.toUpperCase()}</div>
          <div style="font-size:10px; color:var(--text-dim);">${hostname(f.url)}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="font-size:9px; font-weight:700; color:${f.active ? 'var(--status-ok)' : 'var(--text-dim)'};">${f.active ? 'ACTIVE' : 'INACTIVE'}</div>
        <input type="checkbox" ${f.active ? 'checked' : ''} style="accent-color:var(--accent);">
      </div>
    `;
    
    card.onclick = () => {
      selectedFaucetIndex = i;
      document.querySelectorAll(".nav-item")[3].click(); // Switch to settings
      renderConfigForSite(i);
    };

    sitesListContainer.appendChild(card);
  });

  // 6. History List
  renderHistory(log);

  // 7. Action Bar Logic
  runBtn.disabled = !enabled || activeList.length > 0;
  runBtn.style.display = activeList.length > 0 ? "none" : "flex";
  stopBtn.style.display = activeList.length > 0 ? "flex" : "none";
}

function renderHistory(log) {
  if (!log || log.length === 0) {
    historyList.innerHTML = `<div style="text-align:center; color:var(--text-dim); font-size:11px; margin-top:40px;">No protocol events recorded</div>`;
    return;
  }
  historyList.innerHTML = log.map(e => {
    let icon = "✓", cls = "ok";
    if (e.status.includes("error")) { icon = "✗"; cls = "err"; }
    return `
      <div class="history-item">
        <div class="history-main">
          <span class="history-site">${hostname(e.url)}</span>
          <span class="history-action">${e.status.toUpperCase()}</span>
          <span class="history-meta">${e.reason || "Executed"}</span>
        </div>
        <div class="history-side">
          <div class="history-val">${e.balance ? e.balance.toFixed(4) : icon}</div>
          <div class="history-ts">${fmtTime(e.ts)}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ── Canvas Sparkline ──────────────────────────────────────────────────────────
function drawSparkline() {
  const canvas = document.getElementById("sparkline");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.offsetWidth;
  const h = canvas.height = canvas.offsetHeight;
  
  ctx.clearRect(0,0,w,h);
  ctx.beginPath();
  ctx.strokeStyle = "#f0b90b";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";

  let points = 20;
  let step = w / points;
  ctx.moveTo(0, h * 0.8);
  for (let i = 1; i <= points; i++) {
    ctx.lineTo(i * step, h * (0.3 + Math.random() * 0.5));
  }
  ctx.stroke();

  // Glow
  ctx.shadowBlur = 10;
  ctx.shadowColor = "rgba(240, 185, 11, 0.4)";
}

// ── Settings Logic ────────────────────────────────────────────────────────────
async function loadSettings() {
  const stored = await chrome.storage.local.get(["settings", "cryptoPrices", "minWdThresholds"]);
  const s = stored.settings || {};
  cryptoPrices = stored.cryptoPrices?.data || {};
  minWdThresholds = stored.minWdThresholds || {};
  
  document.getElementById("cfgEnabled").checked = s.enabled !== false;
  document.getElementById("cfgNodeName").value = s.nodeName || "";
  document.getElementById("longBreakEnabled").checked = s.longBreakEnabled === true;
  document.getElementById("longBreakFrequency").value = s.longBreakFrequency || 5;
  document.getElementById("longBreakMin").value = s.longBreakMin || 65;
  document.getElementById("longBreakMax").value = s.longBreakMax || 80;

  const tg = s.telegram || {};
  document.getElementById("tgEnabled").checked = tg.enabled === true;
  document.getElementById("tgToken").value = tg.botToken || "";
  document.getElementById("tgChatId").value = tg.chatId || "";

  const storedFaucets = s.faucets || [];
  const storedByUrl = {};
  for (const f of storedFaucets) { if (f.url) storedByUrl[f.url] = f; }
  
  const defaultFaucets = makeFaucetDefaults();
  const customSites = s.customFaucets || [];
  const allBaseFaucets = [...defaultFaucets, ...customSites];

  currentFaucets = await Promise.all(allBaseFaucets.map(async def => {
    const merged = { ...def, ...(storedByUrl[def.url] || {}) };
    let dUser = merged.username || "";
    let dPass = merged.password || "";
    if (typeof CryptoUtils !== "undefined") {
      dUser = await CryptoUtils.decrypt(dUser);
      dPass = await CryptoUtils.decrypt(dPass);
    }
    return { ...merged, username: dUser, password: dPass };
  }));

  renderConfigForSite(selectedFaucetIndex);
}

function renderConfigForSite(index) {
  const f = currentFaucets[index];
  const section = document.getElementById("siteConfigSection");
  const card = document.getElementById("siteConfigCard");
  const label = document.getElementById("selectedSiteLabel");

  if (!f) return;
  section.style.display = "block";
  label.textContent = f.label.toUpperCase() + " PROTOCOL";

  const host = hostname(f.url);
  const minThreshold = minWdThresholds[host];

  card.innerHTML = `
    <div class="field">
      <label class="label">Base Interval (min)</label>
      <input type="number" id="fint" value="${f.intervalMinutes || 61}" min="1">
    </div>
    <div style="display:flex; gap:10px;">
      <div class="field" style="flex:1">
        <label class="label">Min Random (min)</label>
        <input type="number" id="frmin" value="${f.minRandomMinutes || 0}" min="0">
      </div>
      <div class="field" style="flex:1">
        <label class="label">Max Random (min)</label>
        <input type="number" id="frmax" value="${f.maxRandomMinutes || 5}" min="0">
      </div>
    </div>
    <hr style="border:none; border-top:1px solid var(--glass-border); margin:5px 0;">
    <div class="toggle-switch">
       <span class="label">Auto-Withdrawal</span>
       <input type="checkbox" id="fwd" ${f.wdEnabled ? "checked" : ""}>
    </div>
    <div class="field">
      <label class="label">Withdraw Threshold</label>
      <input type="number" id="fwdth" value="${f.wdThreshold || ""}" step="any">
      ${minThreshold ? `<span style="font-size:9px; color:var(--accent);">Min: ${minThreshold}</span>` : ""}
    </div>
    <div class="field">
      <label class="label">Wallet Address</label>
      <input type="text" id="fwdaddr" value="${f.wdAddress || ""}" placeholder="Enter address">
    </div>
  `;

  // Attach sync listener
  card.querySelectorAll("input").forEach(el => {
    el.addEventListener("input", () => {
      f.intervalMinutes = parseInt(card.querySelector("#fint").value) || 61;
      f.minRandomMinutes = parseInt(card.querySelector("#frmin").value) || 0;
      f.maxRandomMinutes = parseInt(card.querySelector("#frmax").value) || 5;
      f.wdEnabled = card.querySelector("#fwd").checked;
      f.wdThreshold = card.querySelector("#fwdth").value.trim();
      f.wdAddress = card.querySelector("#fwdaddr").value.trim();
    });
  });
}

saveBtn.onclick = async () => {
  const f = currentFaucets[selectedFaucetIndex];
  
  const faucetsToSave = await Promise.all(currentFaucets.map(async f => {
    let eUser = f.username || "";
    let ePass = f.password || "";
    if (typeof CryptoUtils !== "undefined") {
      eUser = await CryptoUtils.encrypt(eUser);
      ePass = await CryptoUtils.encrypt(ePass);
    }
    return { ...f, username: eUser, password: ePass };
  }));

  const settings = {
    enabled: document.getElementById("cfgEnabled").checked,
    nodeName: document.getElementById("cfgNodeName").value.trim(),
    longBreakEnabled: document.getElementById("longBreakEnabled").checked,
    longBreakFrequency: parseInt(document.getElementById("longBreakFrequency").value) || 5,
    longBreakMin: parseInt(document.getElementById("longBreakMin").value) || 65,
    longBreakMax: parseInt(document.getElementById("longBreakMax").value) || 80,
    telegram: {
      enabled: document.getElementById("tgEnabled").checked,
      botToken: document.getElementById("tgToken").value.trim(),
      chatId: document.getElementById("tgChatId").value.trim()
    },
    faucets: faucetsToSave
  };

  chrome.runtime.sendMessage({ type: "save-settings", settings });
  saveMsg.className = "save-indicator show";
  setTimeout(() => { saveMsg.className = "save-indicator"; }, 2000);
};

// ── Manual Lifecycle ───────────────────────────────────────────────────────────
runBtn.onclick = () => chrome.runtime.sendMessage({ type: "manual-run" });
stopBtn.onclick = () => chrome.runtime.sendMessage({ type: "save-settings", settings: { enabled: false } });

// ── Initialization ────────────────────────────────────────────────────────────
(async () => {
  await loadSettings();
  await refreshStatus();
  drawSparkline();
  setInterval(refreshStatus, 1000);
})();
