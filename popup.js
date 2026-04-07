// ── Navigation ────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    item.classList.add("active");
    const target = document.getElementById("tab-" + item.dataset.tab);
    if (target) {
      target.classList.add("active");
      chrome.storage.local.set({ lastTab: item.dataset.tab });
    }
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
let autoSaveTimeout = null;
let saveIndicatorTimeout = null;

function triggerAutoSave(debounceMs = 1000) {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(async () => {
    if (typeof saveBtn !== "undefined") {
      await saveBtn.onclick();
    }
    autoSaveTimeout = null;
  }, debounceMs);
}

// ── UI Elements ──────────────────────────────────────────────────────────────
const dashboardGrid = document.getElementById("dashboardGrid");
const sitesListContainer = document.getElementById("sitesListContainer");
const historyList = document.getElementById("historyList");
const totalValueEl = document.getElementById("totalValue");
const globalClaimsEl = document.getElementById("globalClaims");
const protocolStatusEl = document.getElementById("protocolStatus");
const headerStatusText = document.getElementById("headerStatusText");
const botNameEl = document.getElementById("botName");
const runBtn = document.getElementById("runBtn");
const betBtn = document.getElementById("betBtn");
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
  const activeTabs   = stored.activeTabs || {};
  const claimHistory = stored.claimHistory || {};
  const log          = stored.activityLog || [];
  cryptoPrices       = stored.cryptoPrices?.data || {};
  const now          = Date.now();

  // 1. Header & Status
  const activeList = Object.values(activeTabs).filter(t => t.phase !== "done");
  
  if (!enabled) {
    headerStatusText.textContent = "Status: Disabled";
    protocolStatusEl.innerHTML = `<span>Automation is disabled. Enable in settings.</span>`;
  } else {
    headerStatusText.textContent = activeList.length > 0 ? "Status: Working" : "Status: Waiting";
    protocolStatusEl.innerHTML = activeList.length > 0 ? `<span style="color:var(--status-ok);">Bot is currently claiming faucets...</span>` : `<span>All tasks complete. Monitoring for next claim.</span>`;
  }

  // 2. Analytics
  totalValueEl.textContent = "RUNNING";
  globalClaimsEl.textContent = log.length || "0";

  // 3. Update Banner
  const updateBanner = document.getElementById("updateBanner");
  if (stored.updateAvailable) {
    updateBanner.style.display = "block";
    updateBanner.onclick = () => { window.open(stored.updateUrl || "https://github.com/sushiomsky/faucetplugin", "_blank"); };
  } else {
    updateBanner.style.display = "none";
  }

  // 4. Dashboard Site Grid
  dashboardGrid.innerHTML = "";
  faucets.filter(f => f.active !== false).forEach(f => {
    const host = hostname(f.url);
    const tabEntry = Object.values(activeTabs).find(t => hostname(t.faucetUrl) === host);
    const lastLog = log.find(e => hostname(e.url) === host);
    const lastClaim = claimHistory[f.url] || 0;
    const intervalMs = (f.intervalMinutes || 61) * 60000;
    const nextDue = lastClaim + intervalMs;
    const timeLeft = nextDue - now;
    
    let perc = 0;
    if (timeLeft > 0) perc = Math.max(0, Math.min(100, Math.round(((intervalMs - timeLeft) / intervalMs) * 100)));
    else perc = 100;
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
        <span class="token-symbol">${f.coin || f.label.toUpperCase()}</span>
      </div>
      <div class="card-meta">
        <div class="card-site-name">${host}</div>
        <div class="card-site-timer">${timeLeft > 0 ? fmtCountdown(timeLeft) : "READY"}</div>
        <div class="card-site-balance">${lastLog?.balance ? lastLog.balance.toFixed(4) : "–"}</div>
      </div>
    `;
    card.onclick = () => {
      const idx = faucets.indexOf(f);
      if (idx !== -1) {
        selectedFaucetIndex = idx;
        renderConfigForSite(idx);
      }
    };
    dashboardGrid.appendChild(card);
  });

  // 4. Action Buttons Visibility
  runBtn.style.display = "block";
  betBtn.style.display = "block";
  stopBtn.style.display = enabled ? "block" : "none";

  // 5. Faucets Panel
  sitesListContainer.innerHTML = "";
  faucets.forEach((f, i) => {
    const card = document.createElement("div");
    card.style = "background:var(--panel); border:1px solid var(--glass-border); border-radius:15px; padding:12px 15px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;";
    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:32px; height:32px; border-radius:8px; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:var(--accent);">${f.label[0].toUpperCase()}</div>
        <div>
          <div style="font-size:12px; font-weight:700;">${f.coin || f.label.toUpperCase()}</div>
          <div style="font-size:10px; color:var(--text-dim);">${hostname(f.url)}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="font-size:9px; font-weight:700; color:${f.active ? 'var(--status-ok)' : 'var(--text-dim)'};">${f.active ? 'ENABLED' : 'DISABLED'}</div>
        <input type="checkbox" ${f.active ? 'checked' : ''} style="accent-color:var(--accent);">
      </div>
    `;
    card.onclick = () => {
      selectedFaucetIndex = i;
      renderConfigForSite(i);
    };
    sitesListContainer.appendChild(card);
  });

  // 6. History List
  renderHistory(log);

  // 7. Buttons
  runBtn.disabled = false; 
  betBtn.disabled = false;
  runBtn.style.display = activeList.length > 0 ? "none" : "flex";
  stopBtn.style.display = activeList.length > 0 ? "flex" : "none";
}

function renderHistory(log) {
  if (!log || log.length === 0) {
    historyList.innerHTML = `<div style="text-align:center; color:var(--text-dim); font-size:11px; margin-top:40px;">No recent activity</div>`;
    return;
  }
  historyList.innerHTML = log.map(e => `
    <div class="history-item">
      <div class="history-main">
        <span class="history-site">${hostname(e.url)}</span>
        <span class="history-action">${e.status.split('-').join(' ').toUpperCase()}</span>
        <span class="history-meta">${e.reason || "Success"}</span>
      </div>
      <div class="history-side">
        <div class="history-val">${e.balance ? e.balance.toFixed(5) : "✓"}</div>
        <div class="history-ts">${fmtTime(e.ts)}</div>
      </div>
    </div>
  `).join("");
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const stored = await chrome.storage.local.get(["settings", "minWdThresholds", "lastTab"]);
  const s = stored.settings || {};
  minWdThresholds = stored.minWdThresholds || {};
  
  const currentTab = stored.lastTab || "dashboard";
  const navItem = document.querySelector(`.nav-item[data-tab="${currentTab}"]`);
  if (navItem) navItem.click();

  document.getElementById("cfgEnabled").checked = s.enabled !== false;
  document.getElementById("cfgBotName").value = s.botName === "Faucet Bot" ? "" : (s.botName || "");
  if (botNameEl) botNameEl.textContent = s.botName || "Welcome Back!";
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
  const allBaseFaucets = [...defaultFaucets, ...(s.customFaucets || [])];

  currentFaucets = await Promise.all(allBaseFaucets.map(async def => {
    const merged = { ...def, ...(storedByUrl[def.url] || {}) };
    let dUser = merged.username || "", dPass = merged.password || "";
    if (typeof CryptoUtils !== "undefined" && dUser && dUser.length > 30) {
      dUser = await CryptoUtils.decrypt(dUser);
      dPass = await CryptoUtils.decrypt(dPass);
    }
    return { ...merged, username: dUser, password: dPass };
  }));

  // Attach global auto-save listeners
  document.querySelectorAll("#tab-settings input, #tab-settings select").forEach(el => {
    const event = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(event, () => triggerAutoSave(el.type === 'checkbox' ? 0 : 1000));
  });
}

function renderConfigForSite(index) {
  const f = currentFaucets[index];
  const modal = document.getElementById("siteModal");
  const card = document.getElementById("siteConfigCard");
  const label = document.getElementById("selectedSiteLabel");

  if (!f) return;
  modal.classList.add("active");
  label.textContent = (f.coin || f.label.toUpperCase()) + " Settings";

  const host = hostname(f.url);
  const minThreshold = minWdThresholds[host];

  card.innerHTML = `
    <div class="field">
      <label class="label">Claim Every (Minutes)</label>
      <input type="number" id="fint" value="${f.intervalMinutes || 61}" min="1">
    </div>
    <div style="display:flex; gap:10px;">
      <div class="field" style="flex:1">
        <label class="label">Extra Wait Min</label>
        <input type="number" id="frmin" value="${f.minRandomMinutes || 0}" min="0">
      </div>
      <div class="field" style="flex:1">
        <label class="label">Extra Wait Max</label>
        <input type="number" id="frmax" value="${f.maxRandomMinutes || 5}" min="0">
      </div>
    </div>

    <div class="group-header" style="margin-top:15px; border-top:1px solid var(--glass-border); padding-top:10px;"><span>🎲</span> Dice Betting</div>
    <div class="toggle-switch" style="margin-bottom:10px;">
       <span class="label">Enable Dice Strategy</span>
       <input type="checkbox" id="fdb" ${f.dbEnabled ? "checked" : ""}>
    </div>
    
    <div id="diceSettings" style="display:${f.dbEnabled ? 'block' : 'none'};">
      <div class="field">
        <label class="label">Strategy</label>
        <select id="fdbStrategy" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); color:#fff; padding:8px; border-radius:8px;">
          <option value="${DICE_STRATEGY_ALL_IN_001}" ${f.dbStrategy === DICE_STRATEGY_ALL_IN_001 ? "selected" : ""}>All-In (Target Threshold)</option>
          <option value="${DICE_STRATEGY_COMBINED_HIGH_ROLLER}" ${f.dbStrategy === DICE_STRATEGY_COMBINED_HIGH_ROLLER ? "selected" : ""}>Combined High Roller</option>
          <option value="${DICE_STRATEGY_PYRAMID}" ${f.dbStrategy === DICE_STRATEGY_PYRAMID ? "selected" : ""}>Win-Streak Pyramid</option>
        </select>
      </div>

      <div id="pyramidConfig" style="display:${f.dbStrategy === DICE_STRATEGY_PYRAMID ? 'block' : 'none'}; margin-top:10px; background:rgba(255,255,255,0.02); padding:10px; border-radius:10px; border:1px solid var(--glass-border);">
        <div style="display:flex; gap:10px;">
          <div class="field" style="flex:1">
            <label class="label">Base Bet %</label>
            <input type="number" id="pyrBase" value="${f.dbPyramidConfig?.base_bet_pct || 0.05}" step="any">
          </div>
          <div class="field" style="flex:1">
            <label class="label">Multiplier</label>
            <input type="number" id="pyrMult" value="${f.dbPyramidConfig?.multiplier || 2.0}" step="any">
          </div>
        </div>
        <div style="display:flex; gap:10px;">
          <div class="field" style="flex:1">
            <label class="label">Max Level</label>
            <input type="number" id="pyrMax" value="${f.dbPyramidConfig?.max_level || 5}">
          </div>
          <div class="field" style="flex:1">
            <label class="label">Drop Level</label>
            <input type="number" id="pyrDrop" value="${f.dbPyramidConfig?.drop_levels || 2}">
          </div>
        </div>
        <div style="display:flex; gap:10px;">
          <div class="field" style="flex:1">
            <label class="label">Target Profit %</label>
            <input type="number" id="pyrTP" value="${f.dbPyramidConfig?.target_profit_pct || 10}" step="any">
          </div>
          <div class="field" style="flex:1">
            <label class="label">Stop Loss %</label>
            <input type="number" id="pyrSL" value="${f.dbPyramidConfig?.max_loss_pct || 20}" step="any">
          </div>
        </div>
        <div class="toggle-switch">
          <span class="label">Switch Side on Loss</span>
          <input type="checkbox" id="pyrSwitch" ${f.dbPyramidConfig?.switch_on_loss !== false ? "checked" : ""}>
        </div>
      </div>
    </div>

    <div class="group-header" style="margin-top:15px; border-top:1px solid var(--glass-border); padding-top:10px;"><span>💰</span> Withdrawal</div>
    <div class="toggle-switch" style="margin-bottom:10px;">
       <span class="label">Auto-Withdrawal</span>
       <input type="checkbox" id="fwd" ${f.wdEnabled ? "checked" : ""}>
    </div>
    <div class="field">
      <label class="label">Withdraw Amount</label>
      <input type="number" id="fwdth" value="${f.wdThreshold || ""}" step="any">
      ${minThreshold ? `<span style="font-size:9px; color:var(--accent);">Minimum: ${minThreshold}</span>` : ""}
    </div>
    <div class="field">
      <label class="label">Wallet Address</label>
      <input type="text" id="fwdaddr" value="${f.wdAddress || ""}" placeholder="Enter your address">
    </div>
    <div style="margin-top:15px;">
      <button class="btn-secondary" id="openSiteBtn" style="width:100%; background:var(--glass-border); border:none; color:#fff; padding:10px; border-radius:12px; font-size:11px; cursor:pointer; font-weight:600;">🌐 Open Signup Page (?ref=)</button>
    </div>
  `;

  const dSettings = card.querySelector("#diceSettings");
  const pConfig = card.querySelector("#pyramidConfig");

  card.querySelector("#fdb").addEventListener("change", (e) => {
    dSettings.style.display = e.target.checked ? "block" : "none";
    f.dbEnabled = e.target.checked;
  });

  card.querySelector("#fdbStrategy").addEventListener("change", (e) => {
    pConfig.style.display = e.target.value === DICE_STRATEGY_PYRAMID ? "block" : "none";
    f.dbStrategy = e.target.value;
  });

  card.querySelector("#openSiteBtn").addEventListener("click", () => {
    const refUrl = f.referralId ? `${f.url.replace(/\/$/, '')}/signup.php?ref=${f.referralId}` : f.url;
    window.open(refUrl, "_blank");
  });

  card.querySelectorAll("input, select").forEach(el => {
    const event = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(event, () => {
      f.intervalMinutes = parseInt(card.querySelector("#fint").value) || 61;
      f.minRandomMinutes = parseInt(card.querySelector("#frmin").value) || 0;
      f.maxRandomMinutes = parseInt(card.querySelector("#frmax").value) || 5;
      
      f.dbEnabled = card.querySelector("#fdb").checked;
      f.dbStrategy = card.querySelector("#fdbStrategy").value;
      
      if (!f.dbPyramidConfig) f.dbPyramidConfig = {};
      f.dbPyramidConfig.base_bet_pct = parseFloat(card.querySelector("#pyrBase").value);
      f.dbPyramidConfig.multiplier = parseFloat(card.querySelector("#pyrMult").value);
      f.dbPyramidConfig.max_level = parseInt(card.querySelector("#pyrMax").value);
      f.dbPyramidConfig.drop_levels = parseInt(card.querySelector("#pyrDrop").value);
      f.dbPyramidConfig.target_profit_pct = parseFloat(card.querySelector("#pyrTP").value);
      f.dbPyramidConfig.max_loss_pct = parseFloat(card.querySelector("#pyrSL").value);
      f.dbPyramidConfig.switch_on_loss = card.querySelector("#pyrSwitch").checked;

      f.wdEnabled = card.querySelector("#fwd").checked;
      f.wdThreshold = card.querySelector("#fwdth").value.trim();
      f.wdAddress = card.querySelector("#fwdaddr").value.trim();

      triggerAutoSave(el.type === 'checkbox' ? 0 : 1000);
    });
  });
}

function closeModal() {
  document.getElementById("siteModal").classList.remove("active");
  refreshStatus();
}

document.getElementById("modalClose").onclick = closeModal;
document.getElementById("modalSaveBtn").onclick = async () => {
  await saveBtn.onclick(); 
  closeModal();
};

window.onclick = (event) => {
  const modal = document.getElementById("siteModal");
  if (event.target === modal) closeModal();
};

saveBtn.onclick = async () => {
  const faucetsToSave = await Promise.all(currentFaucets.map(async f => {
    let eUser = f.username || "", ePass = f.password || "";
    if (typeof CryptoUtils !== "undefined") {
      eUser = await CryptoUtils.encrypt(eUser);
      ePass = await CryptoUtils.encrypt(ePass);
    }
    return { ...f, username: eUser, password: ePass };
  }));

  const settings = {
    enabled: document.getElementById("cfgEnabled").checked,
    botName: document.getElementById("cfgBotName").value.trim() || "Faucet Bot",
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
  
  if (saveIndicatorTimeout) clearTimeout(saveIndicatorTimeout);
  saveMsg.textContent = "✓ Changes Saved";
  saveMsg.classList.add("show");
  saveIndicatorTimeout = setTimeout(() => {
    saveMsg.classList.remove("show");
    saveIndicatorTimeout = null;
  }, 1500);
};

runBtn.onclick = () => chrome.runtime.sendMessage({ type: "manual-run" });

betBtn.onclick = async () => {
  try {
    await chrome.runtime.sendMessage({ type: "manual-dice-run" });
    window.close(); // Close only after message is accepted
  } catch (err) {
    console.error("[Popup] Send failed:", err);
    // Fallback if message fails
    chrome.runtime.sendMessage({ type: "manual-dice-run" });
    setTimeout(() => window.close(), 100);
  }
};

stopBtn.onclick = () => {
  chrome.runtime.sendMessage({ type: "stop-all-activity" });
};

(async () => {
  const { setupComplete } = await chrome.storage.local.get("setupComplete");
  if (!setupComplete) {
    window.location.href = "setup.html";
    return;
  }
  await loadSettings();
  await refreshStatus();
  setInterval(refreshStatus, 1000);
  
  // Heartbeat: Signal to background that configuration is active
  try { chrome.runtime.connect({ name: "popup" }); } catch (err) {}
})();
