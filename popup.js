// ── Tab navigation ────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    const target = document.getElementById("tab-" + tab.dataset.tab);
    if (target) target.classList.add("active");
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(ms) { return ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "–"; }
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

// ── Status Tab ────────────────────────────────────────────────────────────────
const statusDot   = document.getElementById("statusDot");
const statusTitle = document.getElementById("statusTitle");
const statusDesc  = document.getElementById("statusDesc");
const activeCountEl = document.getElementById("activeCount");
const totalValueEl  = document.getElementById("totalValue");
const siteRowsEl  = document.getElementById("siteRows");
const headerStatus = document.getElementById("headerStatus");
const runBtn  = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");

async function refreshStatus() {
  const stored = await chrome.storage.local.get([
    "running", "settings", "activityLog", "activeTabs", "claimHistory", 
    "lastRunStart", "cryptoPrices", "minWdThresholds"
  ]);
  
  const settings     = stored.settings || {};
  const enabled      = settings.enabled !== false;
  const faucets      = (settings.faucets || []);
  const running      = stored.running;
  const activeTabs   = stored.activeTabs || {};
  const claimHistory = stored.claimHistory || {};
  const log          = stored.activityLog || [];
  cryptoPrices       = stored.cryptoPrices?.data || {};
  minWdThresholds    = stored.minWdThresholds || {};
  const now          = Date.now();

  // Header status
  const activeList = Object.values(activeTabs).filter(t => t.phase !== "done");
  if (!enabled) {
    headerStatus.textContent = "OFF";
    headerStatus.style.background = "rgba(255, 77, 77, 0.1)";
    headerStatus.style.color = "#ff4d4d";
  } else {
    headerStatus.textContent = activeList.length > 0 ? "BUSY" : "AUTO";
    headerStatus.style.background = activeList.length > 0 ? "rgba(240, 185, 11, 0.1)" : "rgba(0, 255, 136, 0.1)";
    headerStatus.style.color = activeList.length > 0 ? "#f0b90b" : "#00ff88";
  }

  // Status card
  if (running && activeList.length > 0) {
    const names = activeList.map(t => hostname(t.faucetUrl)).join(", ");
    statusDot.style.background = "#f0b90b";
    statusTitle.textContent = "Claiming…";
    statusDesc.textContent = names;
  } else if (!enabled) {
    statusDot.style.background = "#ff4d4d";
    statusTitle.textContent = "Disabled";
    statusDesc.textContent = "Toggle in settings to start";
  } else {
    statusDot.style.background = "#00ff88";
    statusTitle.textContent = "Idle";
    statusDesc.textContent = "Monitoring faucets…";
  }

  // Stats
  activeCountEl.textContent = faucets.filter(f => f.active !== false).length;
  
  // Estimate total value from logs (simplified)
  let totalUsd = 0;
  log.forEach(e => {
    if (e.balance && e.status === "ok") {
      const priceId = getPriceIdForHost(e.url);
      const price = cryptoPrices[priceId]?.usd || 0;
      // Note: we can't accurately sum historical balances, but we can show current total if we had it.
      // For now, let's just show the USD rate of the most recent balance in logs.
    }
  });
  // Instead of summing, let's just updated the totalValue with "Updated [time]"
  totalValueEl.textContent = cryptoPrices ? "LIVE" : "OFFLINE";

  // Per-site cards
  siteRowsEl.innerHTML = "";
  faucets.filter(f => f.active !== false).forEach(f => {
    const host = hostname(f.url);
    const tabEntry = Object.values(activeTabs).find(t => hostname(t.faucetUrl) === host);
    const lastLog  = log.find(e => hostname(e.url) === host);
    const lastClaim = claimHistory[f.url] || 0;
    
    // Calculate next run with some margin as displayed in background
    const intervalMs  = (f.intervalMinutes || 61) * 60000;
    const nextDue     = lastClaim + intervalMs;

    const card = document.createElement("div");
    card.className = "site-card";
    
    let statusTag = "";
    if (tabEntry) {
      statusTag = `<span class="site-status-tag" style="background:rgba(240,185,11,0.1); color:#f0b90b;">${tabEntry.phase.toUpperCase()}</span>`;
    } else if (lastLog) {
      if (lastLog.status === "ok" || lastLog.status === "wd-ok") {
        statusTag = `<span class="site-status-tag" style="background:rgba(0,255,136,0.1); color:#00ff88;">OK ${fmtTime(lastLog.ts)}</span>`;
      } else {
        statusTag = `<span class="site-status-tag" style="background:rgba(255,77,77,0.1); color:#ff4d4d;">FAIL</span>`;
      }
    } else {
      statusTag = `<span class="site-status-tag" style="background:var(--glass); color:var(--text-dim);">IDLE</span>`;
    }

    const priceId = getPriceIdForHost(f.url);
    const price = cryptoPrices[priceId]?.usd || 0;
    const usdVal = lastLog?.balance ? (lastLog.balance * price).toFixed(2) : "0.00";

    card.innerHTML = `
      <div class="site-info">
        <div class="site-icon">${host[0].toUpperCase()}</div>
        <div class="site-meta">
          <h3>${host}</h3>
          <p>${nextDue > now ? "Next: " + fmtCountdown(nextDue - now) : "Due now"}</p>
        </div>
      </div>
      <div style="text-align:right">
        ${statusTag}
        <div style="font-size:10px; color:var(--text-dim); margin-top:4px;">${lastLog?.balance ? lastLog.balance.toFixed(4) + " ($" + usdVal + ")" : ""}</div>
      </div>
    `;
    siteRowsEl.appendChild(card);
  });

  runBtn.disabled = !enabled || activeList.length > 0;
  runBtn.style.display = activeList.length > 0 ? "none" : "flex";
  stopBtn.style.display = activeList.length > 0 ? "flex" : "none";

  renderLog(log);
}

// ── Log Tab ───────────────────────────────────────────────────────────────────
function renderLog(log) {
  const el = document.getElementById("logList");
  if (!log || log.length === 0) {
    el.innerHTML = `<div style="text-align:center; color:var(--text-dim); font-size:12px; margin-top:40px;">No events recorded</div>`;
    return;
  }
  
  el.innerHTML = log.map(e => {
    let cls = "ok", icon = "✓", action = "Claimed faucet";
    if (e.status === "wd-ok") { cls = "ok"; icon = "↑"; action = "Withdrawal success"; }
    else if (e.status === "wd-error") { cls = "err"; icon = "⚠"; action = "WD Error: " + (e.reason || "unknown"); }
    else if (e.status === "error") { cls = "err"; icon = "✗"; action = "Error: " + (e.reason || "unknown"); }
    
    const host = hostname(e.url);
    const priceId = getPriceIdForHost(e.url);
    const price = cryptoPrices[priceId]?.usd || 0;
    const usdStr = e.balance ? ` ($${(e.balance * price).toFixed(3)})` : "";

    return `
      <div class="log-item ${cls}">
        <div class="log-main">
          <span class="log-site">${host}</span>
          <span class="log-action">${action}</span>
        </div>
        <div class="log-info">
          <div class="log-balance">${e.balance ? e.balance.toFixed(6) + usdStr : icon}</div>
          <div class="log-time">${fmtTime(e.ts)}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ── Config Tab ────────────────────────────────────────────────────────────────
const cfgEnabled = document.getElementById("cfgEnabled");
const siteSelectorGrid = document.getElementById("siteSelectorGrid");
const faucetConfigSection = document.getElementById("faucetConfigSection");
const siteConfigCard = document.getElementById("siteConfigCard");
const selectedSiteLabel = document.getElementById("selectedSiteLabel");
const saveBtn    = document.getElementById("saveBtn");
const saveMsg    = document.getElementById("saveMsg");

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderSiteSelector() {
  siteSelectorGrid.innerHTML = "";
  currentFaucets.forEach((f, i) => {
    const isActive = f.active !== false;
    const isSelected = i === selectedFaucetIndex;
    
    const div = document.createElement("div");
    div.className = "site-option" + (isSelected ? " selected" : "");
    div.innerHTML = `
      <input type="checkbox" id="fsite${i}" ${isActive ? "checked" : ""} />
      <div class="site-option-icon">${f.label[0].toUpperCase()}</div>
      <div class="site-option-name">${f.label}</div>
    `;
    siteSelectorGrid.appendChild(div);

    const checkbox = div.querySelector(`#fsite${i}`);
    checkbox.addEventListener("click", (e) => { e.stopPropagation(); });
    checkbox.addEventListener("change", () => {
      currentFaucets[i].active = checkbox.checked;
    });

    div.addEventListener("click", () => {
      selectedFaucetIndex = i;
      document.querySelectorAll(".site-option").forEach(el => el.classList.remove("selected"));
      div.classList.add("selected");
      renderConfigForSite(i);
    });
  });
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(["settings", "cryptoPrices", "minWdThresholds"]);
  const s = stored.settings || {};
  cryptoPrices = stored.cryptoPrices?.data || {};
  minWdThresholds = stored.minWdThresholds || {};
  
  cfgEnabled.checked = s.enabled !== false;

  const storedFaucets = s.faucets || [];
  const storedByUrl = {};
  for (const f of storedFaucets) { if (f.url) storedByUrl[f.url] = f; }
  
  currentFaucets = makeFaucetDefaults().map(def => {
    const merged = { ...def, ...(storedByUrl[def.url] || {}) };
    return {
      ...merged,
      wdThreshold: normalizeWdThresholdForUrl(def.url, merged.wdThreshold),
      dbStrategy: normalizeDbStrategy(merged.dbStrategy, merged.dbEnabled === true),
      dbChance: normalizeDbChance(merged.dbChance, merged.dbStrategy)
    };
  });

  renderSiteSelector();
  renderConfigForSite(selectedFaucetIndex);
}

function renderConfigForSite(index) {
  const f = currentFaucets[index];
  selectedSiteLabel.textContent = f.label.toUpperCase() + " CONFIG";
  faucetConfigSection.style.display = "block";

  const priceId = getPriceIdForHost(f.url);
  const price = cryptoPrices[priceId]?.usd || 0;
  const host = hostname(f.url);
  const minThreshold = minWdThresholds[host];

  siteConfigCard.innerHTML = `
    <!-- Scheduling -->
    <div class="input-field">
      <label class="input-label">Base Interval (minutes)</label>
      <input type="number" id="fint" value="${f.intervalMinutes || 61}" min="5" />
    </div>
    <div class="input-field">
      <label class="input-label">Random Offset Range (minutes)</label>
      <div class="range-inputs">
        <div>
          <input type="number" id="frmin" value="${f.minRandomMinutes || 0}" min="0" placeholder="Min" />
        </div>
        <div>
          <input type="number" id="frmax" value="${f.maxRandomMinutes || 5}" min="0" placeholder="Max" />
        </div>
      </div>
    </div>

    <hr style="border:none; border-top:1px solid var(--glass-border); margin:20px 0;">

    <!-- Credentials -->
    <div class="input-field">
      <label class="input-label">Login Credentials (Optional)</label>
      <input type="text" id="fuser" value="${escapeAttr(f.username || "")}" placeholder="Username / Email" style="margin-bottom:8px;">
      <input type="password" id="fpwd" value="${escapeAttr(f.password || "")}" placeholder="Password">
    </div>

    <hr style="border:none; border-top:1px solid var(--glass-border); margin:20px 0;">

    <!-- Withdrawal -->
    <div class="cfg-header-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
      <span style="font-size:12px; font-weight:700;">AUTO-WITHDRAWAL</span>
      <input type="checkbox" id="fwd" ${f.wdEnabled ? "checked" : ""} style="width:16px; height:16px; accent-color:var(--accent);">
    </div>
    
    <div class="input-field">
      <label class="input-label">Withdrawal Threshold</label>
      <div class="input-container">
        <input type="number" id="fwdth" value="${f.wdThreshold || ""}" step="any" min="0">
      </div>
      <span class="usd-rate" id="usdRate">≈ $0.00 USD</span>
      ${minThreshold ? `<span class="min-label">Min required: ${minThreshold}</span>` : ""}
    </div>

    <div class="input-field">
      <label class="input-label">Wallet Address</label>
      <input type="text" id="fwdaddr" value="${escapeAttr(f.wdAddress || "")}" placeholder="Enter address">
    </div>

    <hr style="border:none; border-top:1px solid var(--glass-border); margin:20px 0;">

    <!-- Dice -->
    <div class="cfg-header-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
      <span style="font-size:12px; font-weight:700;">AUTO-DICE (BETA)</span>
      <input type="checkbox" id="fdb" ${f.dbEnabled ? "checked" : ""} style="width:16px; height:16px; accent-color:var(--accent);">
    </div>

    <div class="input-field">
      <label class="input-label">Strategy</label>
      <select id="fdbstrategy">
        <option value="all-in-0.1" ${f.dbStrategy === "all-in-0.1" ? "selected" : ""}>All-In (1% default)</option>
        <option value="combined-high-roller" ${f.dbStrategy === "combined-high-roller" ? "selected" : ""}>Combined High-Roller</option>
      </select>
    </div>
  `;

  // Live USD rate updates
  const thresholdInput = siteConfigCard.querySelector("#fwdth");
  const usdRateEl = siteConfigCard.querySelector("#usdRate");
  const updateUsdLabel = () => {
    const val = parseFloat(thresholdInput.value) || 0;
    usdRateEl.textContent = `≈ $${(val * price).toFixed(2)} USD`;
    if (minThreshold && val < parseFloat(minThreshold)) {
      usdRateEl.style.color = "#ff4d4d";
      usdRateEl.textContent += " (BELOW MIN)";
    } else {
      usdRateEl.style.color = "#00ff88";
    }
  };
  thresholdInput.addEventListener("input", updateUsdLabel);
  updateUsdLabel();
}

saveBtn.addEventListener("click", async () => {
  const f = currentFaucets[selectedFaucetIndex];
  const host = hostname(f.url);
  const minThreshold = minWdThresholds[host];

  const intervalMinutes = parseInt(siteConfigCard.querySelector("#fint").value) || 61;
  const minRand = parseInt(siteConfigCard.querySelector("#frmin").value) || 0;
  const maxRand = parseInt(siteConfigCard.querySelector("#frmax").value) || 5;
  const username = siteConfigCard.querySelector("#fuser").value.trim();
  const password = siteConfigCard.querySelector("#fpwd").value;
  const wdEnabled = siteConfigCard.querySelector("#fwd").checked;
  const wdThreshold = siteConfigCard.querySelector("#fwdth").value.trim();
  
  // Validation
  if (minThreshold && parseFloat(wdThreshold) < parseFloat(minThreshold)) {
    alert(`Error: Withdrawal threshold for ${host} cannot be lower than the site minimum (${minThreshold}).`);
    return;
  }

  const wdAddress = siteConfigCard.querySelector("#fwdaddr").value.trim();
  const dbEnabled = siteConfigCard.querySelector("#fdb").checked;
  const dbStrategy = siteConfigCard.querySelector("#fdbstrategy").value;

  // Update memory
  f.intervalMinutes = intervalMinutes;
  f.minRandomMinutes = minRand;
  f.maxRandomMinutes = maxRand;
  f.username = username;
  f.password = password;
  f.wdEnabled = wdEnabled;
  f.wdThreshold = wdThreshold;
  f.wdAddress = wdAddress;
  f.dbEnabled = dbEnabled;
  f.dbStrategy = dbStrategy;

  chrome.runtime.sendMessage({ 
    type: "save-settings", 
    settings: { enabled: cfgEnabled.checked, faucets: currentFaucets } 
  });

  saveMsg.textContent = "Configuration Saved!";
  saveMsg.style.color = "#00ff88";
  setTimeout(() => { saveMsg.textContent = ""; }, 2500);
});

// ── Export / Reset ────────────────────────────────────────────────────────────
document.getElementById("resetBtn").addEventListener("click", async () => {
  if (confirm("Reset everything to factory defaults?")) {
    chrome.runtime.sendMessage({ type: "reset-all-sites" });
    setTimeout(() => location.reload(), 500);
  }
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  const { settings } = await chrome.storage.local.get("settings");
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `faucet-config-${Date.now()}.json`;
  a.click();
});

// ── Controls ──────────────────────────────────────────────────────────────────
runBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "manual-run" });
  refreshStatus();
});

stopBtn.addEventListener("click", async () => {
  const { activeTabs = {} } = await chrome.storage.local.get("activeTabs");
  for (const tabId of Object.keys(activeTabs)) {
    try { await chrome.tabs.remove(parseInt(tabId)); } catch (_) {}
  }
  await chrome.storage.local.set({ activeTabs: {}, running: false });
  refreshStatus();
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadConfig();
refreshStatus();
setInterval(refreshStatus, 3000);
