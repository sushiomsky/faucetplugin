// ── Tab navigation ────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(ms) { return ms ? new Date(ms).toLocaleTimeString() : "–"; }
function fmtCountdown(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}m ${String(s).padStart(2,"0")}s`;
}
function hostname(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}

// ── Status tab ────────────────────────────────────────────────────────────────
const statusDot   = document.getElementById("statusDot");
const statusText  = document.getElementById("statusText");
const nextRunEl   = document.getElementById("nextRun");
const siteRowsEl  = document.getElementById("siteRows");
const headerState = document.getElementById("headerState");
const runBtn  = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");

async function refreshStatus() {
  const stored = await chrome.storage.local.get(["running", "settings", "activityLog", "activeTabs", "claimHistory", "lastRunStart"]);
  const settings     = stored.settings || {};
  const enabled      = settings.enabled !== false;
  const faucets      = (settings.faucets || []);
  const running      = stored.running;
  const activeTabs   = stored.activeTabs || {};
  const claimHistory = stored.claimHistory || {};
  const log          = stored.activityLog || [];
  const now          = Date.now();

  // Header state
  const activeList = Object.values(activeTabs).filter(t => t.phase !== "done");
  if (!enabled) {
    headerState.textContent = "○ Disabled";
    headerState.style.color = "#e05050";
  } else if (activeList.length > 0) {
    headerState.textContent = "● Running";
    headerState.style.color = "#e0b03f";
  } else {
    headerState.textContent = "● Scheduler";
    headerState.style.color = "#4caf50";
  }

  // Status badge
  if (running && activeList.length > 0) {
    const names = activeList.map(t => hostname(t.faucetUrl)).join(", ");
    statusDot.className = "dot orange";
    statusText.textContent = `Claiming: ${names}`;
  } else if (!enabled) {
    statusDot.className = "dot red";
    statusText.textContent = "Scheduler disabled";
  } else {
    statusDot.className = "dot green";
    statusText.textContent = "Scheduler mode — monitoring runs";
  }

  // Next run — earliest due faucet
  if (enabled && activeList.length === 0) {
    let earliest = Infinity;
    for (const f of faucets.filter(f => f.active !== false)) {
      const last = claimHistory[f.url] || 0;
      const next = last + (f.intervalMinutes || 61) * 60000;
      if (next < earliest) earliest = next;
    }
    if (earliest === Infinity) {
      nextRunEl.textContent = "No active sites selected";
    } else {
      nextRunEl.textContent = earliest < now
        ? "Due now"
        : `Next run in ${fmtCountdown(earliest - now)}`;
    }
  } else if (activeList.length > 0) {
    nextRunEl.textContent = `Started at ${fmtTime(stored.lastRunStart)}`;
  } else {
    nextRunEl.textContent = "";
  }

  // Per-site rows
  siteRowsEl.innerHTML = "";
  faucets.filter(f => f.active !== false).forEach(f => {
    const tabEntry = Object.values(activeTabs).find(t => hostname(t.faucetUrl) === hostname(f.url));
    const lastLog  = log.find(e => hostname(e.url) === hostname(f.url));
    const lastClaim = claimHistory[f.url] || 0;
    const nextDue   = lastClaim + (f.intervalMinutes || 61) * 60000;

    let badge = "";
    if (tabEntry) {
      const phase = tabEntry.phase;
      const color = phase === "withdraw" ? "#34d399" : "#e0b03f";
      badge = `<span class="site-status" style="color:${color}">● ${phase}…</span>`;
    } else if (lastLog) {
      badge = lastLog.status === "ok" || lastLog.status === "wd-ok"
        ? `<span class="site-status ok">✓ ${fmtTime(lastLog.ts)}</span>`
        : `<span class="site-status error">✗ ${lastLog.reason || "error"}</span>`;
    } else {
      badge = `<span class="site-status idle">–</span>`;
    }

    const countdown = !tabEntry && nextDue > now
      ? `<span style="font-size:10px;color:#555;margin-left:4px">${fmtCountdown(nextDue - now)}</span>` : "";

    const div = document.createElement("div");
    div.className = "site-row";
    div.innerHTML = `<span class="site-name">${hostname(f.url)}</span>${badge}${countdown}`;
    siteRowsEl.appendChild(div);
  });

  runBtn.disabled = !enabled;
  stopBtn.style.display = enabled ? "block" : "none";

  renderLog(log);
}

// ── Log tab ───────────────────────────────────────────────────────────────────
function renderLog(log) {
  const el = document.getElementById("logList");
  if (!log || log.length === 0) {
    el.innerHTML = `<div class="log-entry" style="color:#555;font-style:italic">No entries yet.</div>`;
    return;
  }
  el.innerHTML = log.map(e => {
    let cls, icon, label;
    if      (e.status === "ok")       { cls = "ok";       icon = "✓";  label = "claimed"; }
    else if (e.status === "wd-ok")    { cls = "wd-ok";    icon = "↑";  label = "withdrawn"; }
    else if (e.status === "wd-error") { cls = "wd-error"; icon = "↑✗"; label = e.reason || "wd-error"; }
    else                              { cls = "error";    icon = "✗";  label = e.reason || "error"; }
    const bal = e.balance != null ? ` [${e.balance}]` : "";
    return `<div class="log-entry"><span class="${cls}">${icon}</span> ${hostname(e.url)}${bal} — ${fmtTime(e.ts)} — ${label}</div>`;
  }).join("");
}

// ── Config tab ────────────────────────────────────────────────────────────────
const cfgEnabled = document.getElementById("cfgEnabled");
const faucetSiteSelector = document.getElementById("faucetSiteSelector");
const faucetConfigSection = document.getElementById("faucetConfigSection");
const faucetConfigBlock = document.getElementById("faucetConfigBlock");
const saveBtn    = document.getElementById("saveBtn");
const saveMsg    = document.getElementById("saveMsg");

// All shared constants and utility functions (normalizeHost, normalizeDbStrategy,
// normalizeDbChance, normalizeDiceSide, getDefaultHighRollerConfig,
// getDefaultWdThresholdForUrl, normalizeWdThresholdForUrl, normalizeHighRollerConfig,
// toFiniteNumber, clampNumber, makeFaucetDefaults) are loaded from constants.js.

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tipLabel(text, tooltip) {
  return `<span class="tip-label" title="${escapeAttr(tooltip)}">${text}<span class="tip-icon">ⓘ</span></span>`;
}

let currentFaucets = [];
let selectedFaucetIndex = 0;

function renderSiteSelector() {
  faucetSiteSelector.innerHTML = "";
  currentFaucets.forEach((f, i) => {
    const isActive = f.active !== false;
    const isSelected = i === selectedFaucetIndex;
    const div = document.createElement("div");
    div.className = "site-radio-option" + (isActive ? " checked" : "") + (isSelected ? " selected" : "");
    div.innerHTML =
      "<input type='checkbox' id='fsite" + i + "'" + (isActive ? " checked" : "") + " />" +
      "<label for='fsite" + i + "'>" + f.label + "</label>";
    faucetSiteSelector.appendChild(div);

    const checkbox = div.querySelector("#fsite" + i);
    checkbox.addEventListener("click", (e) => { e.stopPropagation(); });
    checkbox.addEventListener("change", function() {
      currentFaucets[i].active = checkbox.checked;
      div.classList.toggle("checked", checkbox.checked);
    });

    div.addEventListener("click", function() {
      selectedFaucetIndex = i;
      document.querySelectorAll(".site-radio-option").forEach(el => el.classList.remove("selected"));
      div.classList.add("selected");
      renderConfigForSite(i);
      faucetConfigSection.style.display = "block";
    });
  });
}

async function loadConfig() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {};
  cfgEnabled.checked = s.enabled !== false;

  const storedFaucets = s.faucets && s.faucets.length ? s.faucets : [];
  const storedByUrl = {};
  for (const f of storedFaucets) { if (f.url) storedByUrl[f.url] = f; }
  
  currentFaucets = makeFaucetDefaults().map(def => {
    const merged = { ...def, ...(storedByUrl[def.url] || {}) };
    const dbEnabled = merged.dbEnabled === true;
    const normalizedStrategy = normalizeDbStrategy(merged.dbStrategy, dbEnabled);
    const normalizedChance = normalizeDbChance(merged.dbChance, normalizedStrategy);
    return {
      ...merged,
      wdThreshold: normalizeWdThresholdForUrl(def.url, merged.wdThreshold),
      dbStrategy: normalizedStrategy,
      dbChance: normalizedChance
    };
  });

  const firstEnabled = currentFaucets.findIndex(f => f.active !== false);
  selectedFaucetIndex = firstEnabled >= 0 ? firstEnabled : 0;

  renderSiteSelector();
  renderConfigForSite(selectedFaucetIndex);
  faucetConfigSection.style.display = "block";
}

function renderConfigForSite(index) {
  const f = currentFaucets[index];
  const dbSide = normalizeDiceSide(f.dbSide || DEFAULT_DB_SIDE);
  const dbStrategy = normalizeDbStrategy(f.dbStrategy, f.dbEnabled === true);
  const dbChance = normalizeDbChance(f.dbChance, dbStrategy);
  const strategyCfg = normalizeHighRollerConfig(f.dbStrategyConfig);

  faucetConfigBlock.innerHTML = `
    <div class="faucet-config-block clean-config">
      <div class="cfg-card">
        <div class="cfg-card-title">General</div>
        <div class="cfg-row compact">
          <label for="fint">${tipLabel("Interval (min)", "How often this site runs in the scheduler.")}</label>
          <input type="number" id="fint" value="${f.intervalMinutes || 61}" min="5" step="1" />
        </div>
        <div class="cfg-row">
          <label>${tipLabel("Login credentials", "Optional: used only if this site requires login before claiming.")}</label>
          <div class="faucet-creds">
            <input type="text" id="fuser" value="${escapeAttr(f.username || "")}" placeholder="Username / Email" autocomplete="off" />
            <input type="password" id="fpwd" value="${escapeAttr(f.password || "")}" placeholder="Password" autocomplete="new-password" />
          </div>
        </div>
      </div>

      <div class="cfg-card">
        <div class="cfg-header-row">
          <div class="cfg-card-title">Auto-Withdraw</div>
          <label class="toggle">
            <input type="checkbox" id="fwd" ${f.wdEnabled ? "checked" : ""} />
            <span class="slider"></span>
          </label>
        </div>
        <div class="cfg-grid two-col">
          <div class="cfg-row">
            <label for="fwdth">${tipLabel("WD Threshold", "Single threshold for dice stop + withdrawal. Defaults are prefilled to roughly $5 coin-equivalent per faucet.")}</label>
            <input type="number" id="fwdth" value="${escapeAttr(f.wdThreshold || "")}" placeholder="e.g. 0.001" step="any" min="0" />
          </div>
          <div class="cfg-row">
            <label for="fwdaddr">${tipLabel("Withdrawal Address", "Wallet address where funds are sent once threshold is met.")}</label>
            <input type="text" id="fwdaddr" value="${escapeAttr(f.wdAddress || "")}" placeholder="Withdrawal wallet address" />
          </div>
        </div>
      </div>

      <div class="cfg-card">
        <div class="cfg-header-row">
          <div class="cfg-card-title">Auto-DiceBet</div>
          <label class="toggle">
            <input type="checkbox" id="fdb" ${f.dbEnabled ? "checked" : ""} />
            <span class="slider"></span>
          </label>
        </div>

        <div class="cfg-grid three-col">
          <div class="cfg-row">
            <label for="fdbc">${tipLabel("Bet Chance %", "Editable chance for both strategies. Default for All-In strategy is 1%.")}</label>
            <input type="number" id="fdbc" value="${escapeAttr(dbChance)}" step="0.01" min="0.01" max="99" />
          </div>
          <div class="cfg-row">
            <label for="fdbside">${tipLabel("Bet Side", "Higher = roll over target. Lower = roll under target.")}</label>
            <select id="fdbside">
              <option value="higher" ${dbSide === "higher" ? "selected" : ""}>Higher (Roll Over)</option>
              <option value="lower" ${dbSide === "lower" ? "selected" : ""}>Lower (Roll Under)</option>
            </select>
          </div>
          <div class="cfg-row">
            <label for="fdbstrategy">${tipLabel("Strategy", "Default is All-In (default chance 1%): one all-in shot after claim, withdraw if hit.")}</label>
            <select id="fdbstrategy">
              <option value="all-in-0.1" ${dbStrategy === "all-in-0.1" ? "selected" : ""}>All-In (Default)</option>
              <option value="combined-high-roller" ${dbStrategy === "combined-high-roller" ? "selected" : ""}>Combined High-Roller</option>
            </select>
          </div>
        </div>

        <div id="allInOptions" style="${dbStrategy === DICE_STRATEGY_ALL_IN_001 ? "" : "display:none;"}">
          <div class="cfg-subtitle">All-In Options</div>
          <div class="cfg-note">All-In places one bet using your selected chance and side, then proceeds to withdrawal only if threshold is reached.</div>
        </div>

        <div id="highRollerOptions" style="${dbStrategy === DICE_STRATEGY_COMBINED_HIGH_ROLLER ? "" : "display:none;"}">
          <div class="cfg-subtitle">Combined High-Roller Options</div>
          <div class="cfg-note" title="${escapeAttr("Bets never go below 10% of starting bankroll. If bankroll falls below that floor, the bot goes all-in.")}">Minimum bet floor: 10% of starting bankroll (all-in below floor).</div>
          <div class="cfg-grid three-col">
            <div class="cfg-row">
              <label for="fdb_bbf">${tipLabel("Base Bet Fraction", "Default Kelly bet fraction. Aggressive default is 10%.")}</label>
              <input type="number" id="fdb_bbf" value="${strategyCfg.base_bet_fraction}" step="0.01" min="0.0001" max="1" />
            </div>
            <div class="cfg-row">
              <label for="fdb_mbf">${tipLabel("Max Bet Fraction", "Maximum allowed bet fraction per roll. Aggressive default is 40%.")}</label>
              <input type="number" id="fdb_mbf" value="${strategyCfg.max_bet_fraction}" step="0.01" min="0.01" max="1" />
            </div>
            <div class="cfg-row">
              <label for="fdb_mld">${tipLabel("Max Ladder Depth", "How many ladder steps can be climbed before resetting to Kelly mode.")}</label>
              <input type="number" id="fdb_mld" value="${strategyCfg.max_ladder_depth}" step="1" min="1" max="10" />
            </div>
            <div class="cfg-row">
              <label for="fdb_hw">${tipLabel("History Window", "Number of recent rolls used to detect volatility.")}</label>
              <input type="number" id="fdb_hw" value="${strategyCfg.history_window}" step="1" min="1" max="200" />
            </div>
            <div class="cfg-row">
              <label for="fdb_st">${tipLabel("Streak Trigger", "Consecutive wins needed to enter Streak Harvester mode. Aggressive default is 1.")}</label>
              <input type="number" id="fdb_st" value="${strategyCfg.streak_trigger}" step="1" min="1" max="50" />
            </div>
            <div class="cfg-row">
              <label for="fdb_vt">${tipLabel("Volatility Trigger", "Minimum win/loss imbalance in history window to enter Breakout mode.")}</label>
              <input type="number" id="fdb_vt" value="${strategyCfg.volatility_trigger}" step="1" min="1" max="200" />
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const strategySelect = faucetConfigBlock.querySelector("#fdbstrategy");
  const allInOptions = faucetConfigBlock.querySelector("#allInOptions");
  const highRollerOptions = faucetConfigBlock.querySelector("#highRollerOptions");
  function toggleStrategyOptions() {
    const selectedStrategy = normalizeDbStrategy(strategySelect?.value || DEFAULT_DB_STRATEGY, true);
    const isHighRoller = selectedStrategy === DICE_STRATEGY_COMBINED_HIGH_ROLLER;
    if (allInOptions) allInOptions.style.display = isHighRoller ? "none" : "";
    if (highRollerOptions) highRollerOptions.style.display = isHighRoller ? "" : "none";
  }
  strategySelect?.addEventListener("change", toggleStrategyOptions);
  toggleStrategyOptions();
}

saveBtn.addEventListener("click", async function() {
  if (selectedFaucetIndex < 0 || selectedFaucetIndex >= currentFaucets.length) {
    saveMsg.textContent = "Select a site first";
    saveMsg.style.color = "#ff9800";
    setTimeout(() => { saveMsg.textContent = ""; }, 3000);
    return;
  }
  
  const intervalMinutes = Math.max(5, parseInt(faucetConfigBlock.querySelector("#fint").value) || 61);
  const username = faucetConfigBlock.querySelector("#fuser").value.trim();
  const password = faucetConfigBlock.querySelector("#fpwd").value;
  const wdEnabled = faucetConfigBlock.querySelector("#fwd").checked;
  const wdThreshold = faucetConfigBlock.querySelector("#fwdth").value.trim();
  const wdAddress = faucetConfigBlock.querySelector("#fwdaddr").value.trim();
  const dbEnabled = faucetConfigBlock.querySelector("#fdb").checked;
  const dbChanceInput = faucetConfigBlock.querySelector("#fdbc").value.trim();
  const dbSide = normalizeDiceSide(faucetConfigBlock.querySelector("#fdbside")?.value || DEFAULT_DB_SIDE);
  const dbStrategyRaw = faucetConfigBlock.querySelector("#fdbstrategy")?.value || DEFAULT_DB_STRATEGY;
  const dbStrategy = normalizeDbStrategy(dbStrategyRaw, dbEnabled);
  const dbChance = normalizeDbChance(dbChanceInput, dbStrategy);
  const dbStrategyConfig = normalizeHighRollerConfig({
    base_bet_fraction: faucetConfigBlock.querySelector("#fdb_bbf")?.value,
    max_bet_fraction: faucetConfigBlock.querySelector("#fdb_mbf")?.value,
    max_ladder_depth: faucetConfigBlock.querySelector("#fdb_mld")?.value,
    history_window: faucetConfigBlock.querySelector("#fdb_hw")?.value,
    streak_trigger: faucetConfigBlock.querySelector("#fdb_st")?.value,
    volatility_trigger: faucetConfigBlock.querySelector("#fdb_vt")?.value
  });
  const selectedIdx = selectedFaucetIndex;

  const faucets = currentFaucets.map((f, i) => ({
    url: f.url,
    label: f.label,
    active: f.active !== false,
    intervalMinutes: i === selectedIdx ? intervalMinutes : (f.intervalMinutes || 61),
    username: i === selectedIdx ? username : f.username,
    password: i === selectedIdx ? password : f.password,
    wdEnabled: i === selectedIdx ? wdEnabled : f.wdEnabled,
    wdThreshold: i === selectedIdx
      ? normalizeWdThresholdForUrl(f.url, wdThreshold)
      : normalizeWdThresholdForUrl(f.url, f.wdThreshold),
    wdAddress: i === selectedIdx ? wdAddress : f.wdAddress,
    dbEnabled: i === selectedIdx ? dbEnabled : (f.dbEnabled === true),
    dbChance: i === selectedIdx
      ? dbChance
      : normalizeDbChance(f.dbChance, normalizeDbStrategy(f.dbStrategy, f.dbEnabled === true)),
    dbSide: i === selectedIdx ? dbSide : normalizeDiceSide(f.dbSide || DEFAULT_DB_SIDE),
    dbStrategy: i === selectedIdx ? dbStrategy : normalizeDbStrategy(f.dbStrategy, f.dbEnabled === true),
    dbStrategyConfig: i === selectedIdx ? dbStrategyConfig : normalizeHighRollerConfig(f.dbStrategyConfig)
  }));

  currentFaucets = faucets;
  renderSiteSelector();

  chrome.runtime.sendMessage({ type: "save-settings", settings: { enabled: cfgEnabled.checked, faucets: faucets } });
  saveMsg.textContent = "Saved!";
  saveMsg.style.color = "#4caf50";
  setTimeout(() => { saveMsg.textContent = ""; }, 2000);
  await refreshStatus();
});

// ── Export/Import settings ────────────────────────────────────────────────────
const exportBtn   = document.getElementById("exportBtn");
const importBtn   = document.getElementById("importBtn");
const importFile  = document.getElementById("importFile");
const importMsg   = document.getElementById("importMsg");

function showImportMsg(text, isError = false) {
  importMsg.textContent = text;
  importMsg.style.color = isError ? "#e05050" : "#4caf50";
  setTimeout(() => { importMsg.textContent = ""; }, 3000);
}

exportBtn.addEventListener("click", async () => {
  const { settings } = await chrome.storage.local.get("settings");
  const toExport = settings || { enabled: true, faucets: [] };
  
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: toExport
  };
  
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  a.href = url;
  a.download = `faucet-settings-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  importMsg.textContent = "✓ Exported!";
  importMsg.style.color = "#4caf50";
  setTimeout(() => { importMsg.textContent = ""; }, 2000);
});

importBtn.addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      
      // Validate structure
      if (!data.settings || typeof data.settings !== "object") {
        throw new Error("Invalid file structure: missing 'settings' object");
      }
      if (!("enabled" in data.settings)) {
        throw new Error("Invalid settings: missing 'enabled' flag");
      }
      if (!Array.isArray(data.settings.faucets)) {
        throw new Error("Invalid settings: 'faucets' must be an array");
      }
      
      // Validate faucets structure
      for (const f of data.settings.faucets) {
        if (!f.url || typeof f.url !== "string") {
          throw new Error("Invalid faucet: each faucet must have a 'url' string");
        }
      }
      
      // Confirm before overwriting
      const confirmed = confirm("Import settings from this file? This will overwrite current settings.");
      if (!confirmed) {
        importFile.value = "";
        return;
      }
      
      // Save imported settings
      await chrome.storage.local.set({ settings: data.settings });
      showImportMsg("✓ Settings imported!");
      
      // Reload config UI
      await loadConfig();
      await refreshStatus();
      
    } catch (err) {
      console.error("[FaucetPlugin] Import error:", err);
      showImportMsg(`Error: ${err.message}`, true);
    }
    
    importFile.value = "";
  };
  
  reader.readAsText(file);
});

// ── Run / Stop buttons ────────────────────────────────────────────────────────
runBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "manual-run" });
  statusDot.className = "dot orange";
  statusText.textContent = "Starting…";
  runBtn.disabled = true;
});

stopBtn.addEventListener("click", async () => {
  const { activeTabs = {} } = await chrome.storage.local.get("activeTabs");
  for (const tabId of Object.keys(activeTabs)) {
    try { await chrome.tabs.remove(parseInt(tabId)); } catch (_) {}
  }
  await chrome.storage.local.set({ activeTabs: {}, running: false });
  await refreshStatus();
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadConfig();
refreshStatus();
setInterval(refreshStatus, 3000);
