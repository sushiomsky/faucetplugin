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
let currentModalTab = "claim"; // Persist modal tab state
let currentFaucets = [];
let selectedFaucetIndex = 0;
let minWdThresholds = {};
let cryptoPrices = {};
let faucetLoginStates = {}; // Cache for login status
let faucetBalances = {}; // Cache for site balances
let autoSaveTimeout = null;
let saveIndicatorTimeout = null;
let lastStatusCheck = 0; // Throttle background scraper

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
let isStatusRefreshing = false;
async function refreshStatus() {
  if (isStatusRefreshing) return;
  isStatusRefreshing = true;
  try {
  const stored = await chrome.storage.local.get([
    "running", "settings", "activityLog", "activeTabs", "claimHistory", 
    "cryptoPrices", "minWdThresholds", "updateAvailable", "updateVersion", "updateUrl", "claimCounts"
  ]);
  
  const settings     = stored.settings || {};
  const enabled      = settings.enabled !== false;
  const activeTabs   = stored.activeTabs || {};
  const claimHistory = stored.claimHistory || {};
  const log          = stored.activityLog || [];
  
  // Ensure we have a list to render even if loadSettings is still working
  const faucets      = (currentFaucets && currentFaucets.length > 0) ? currentFaucets : (settings.faucets || []);
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
  const updateDownloadBtn = document.getElementById("updateDownloadBtn");
  if (stored.updateAvailable) {
    updateBanner.style.display = "block";
    updateDownloadBtn.onclick = () => { 
      window.open(stored.updateUrl || "https://github.com/sushiomsky/faucetplugin/releases/latest", "_blank"); 
    };
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

    // Live balance from scraper takes priority over historical log
    const liveBalance = faucetBalances[f.url];
    const displayBalance = liveBalance || (lastLog?.balance ? lastLog.balance.toFixed(4) : "–");

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
        <div class="card-site-balance">${displayBalance}</div>
      </div>
    `;
    card.onclick = () => {
      const isLoggedIn = faucetLoginStates[f.url];
      if (isLoggedIn === false) {
        const refUrl = f.referralId ? `${f.url.replace(/\/$/, '')}/signup.php?ref=${f.referralId}` : f.url;
        window.open(refUrl, "_blank");
        return;
      }
      
      // Find the site index in currentFaucets for reliable rendering
      const actualIdx = currentFaucets.findIndex(cf => cf.url === f.url);
      if (actualIdx !== -1) {
        selectedFaucetIndex = actualIdx;
        renderConfigForSite(actualIdx);
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
    const host = hostname(f.url);
    const isLoggedIn = faucetLoginStates[f.url];
    const detectedMin = minWdThresholds[host];
    const balance = faucetBalances[f.url];

    const card = document.createElement("div");
    card.style = "background:var(--panel); border:1px solid var(--glass-border); border-radius:15px; padding:12px 15px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;";
    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:32px; height:32px; border-radius:8px; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:var(--accent);">${f.label[0].toUpperCase()}</div>
        <div>
          <div style="font-size:12px; font-weight:700;">${f.coin || f.label.toUpperCase()}</div>
          <div style="display:flex; gap:5px; align-items:center;">
            <div style="font-size:9px; color:${isLoggedIn ? 'var(--status-ok)' : 'var(--status-err)'}; font-weight:700; text-transform:uppercase;">${isLoggedIn ? 'LOGGED IN' : 'LOGIN REQ.'}</div>
            ${balance ? `<div style="font-size:9px; color:#fff; font-weight:700; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;">${balance}</div>` : ""}
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="text-align:right;">
           <div style="font-size:9px; font-weight:700; color:${f.active ? 'var(--accent)' : 'var(--text-dim)'};">${f.active ? 'ACTIVE' : 'IDLE'}</div>
           ${detectedMin ? `<div style="font-size:8px; color:var(--text-dim);">Min: ${detectedMin}</div>` : ""}
        </div>
        <input type="checkbox" ${f.active ? 'checked' : ''} style="accent-color:var(--accent); width:14px; height:14px;">
      </div>
    `;
    card.onclick = (e) => {
      // Toggle logic if clicking checkbox directly
      if (e.target.tagName === 'INPUT') {
          f.active = e.target.checked;
          triggerAutoSave(0);
          return;
      }
      
      if (isLoggedIn === false) {
        const refUrl = f.referralId ? `${f.url.replace(/\/$/, '')}/signup.php?ref=${f.referralId}` : f.url;
        window.open(refUrl, "_blank");
      } else {
        const actualIdx = currentFaucets.findIndex(cf => cf.url === f.url);
        if (actualIdx !== -1) {
          selectedFaucetIndex = actualIdx;
          renderConfigForSite(actualIdx);
        }
      }
    };
    sitesListContainer.appendChild(card);
  });

  // 6. Background Scraper Trigger (Throttle: 1min)
  if (now - lastStatusCheck > 60000) {
    lastStatusCheck = now;
    faucets.forEach(async (f) => {
        const loggedIn = await checkLoginStatus(f);
        faucetLoginStates[f.url] = loggedIn;
        
        if (loggedIn) {
            // Fetch multiple data points concurrently
            const [min, bal, cooldown] = await Promise.all([
                fetchMinWithdrawal(f),
                fetchBalance(f),
                fetchCooldown(f)
            ]);
            
            if (min) {
                const host = hostname(f.url);
                minWdThresholds[host] = min;
                
                // Auto-update threshold if invalid or missing AND not manual
                const currentTh = parseFloat(f.wdThreshold);
                if (!f.wdThresholdIsManual && (!Number.isFinite(currentTh) || currentTh < parseFloat(min))) {
                    f.wdThreshold = min;
                    triggerAutoSave(5000); // Debounce auto-update
                }
            }
            if (bal) {
                faucetBalances[f.url] = bal;
            }
            if (cooldown !== null) {
                // Background update for claimHistory
                chrome.runtime.sendMessage({ type: "faucet-cooldown", waitMinutes: Math.ceil(cooldown), silent: true, url: f.url });
            }
        }
    });
  }

  // 6. History List
  renderHistory(log);

  // 7. Buttons
  runBtn.disabled = false; 
  betBtn.disabled = false;
  runBtn.style.display = activeList.length > 0 ? "none" : "flex";
  stopBtn.style.display = activeList.length > 0 ? "flex" : "none";
  } catch (err) {
    console.error("[Popup] Refresh Error:", err);
  } finally {
    isStatusRefreshing = false;
  }
}

async function checkLoginStatus(faucet) {
  try {
    const baseUrl = faucet.url.replace(/\/$/, '');
    const testUrl = `${baseUrl}/faucet.php?_t=${Date.now()}`;
    const resp = await fetch(testUrl, { credentials: 'include', redirect: 'follow', cache: 'no-cache' });
    const finalUrl = resp.url.toLowerCase();
    const isLoggedOut = finalUrl.includes('login') || finalUrl.includes('signup') || (finalUrl.includes('index.php') && !finalUrl.includes('faucet')) || finalUrl === baseUrl.toLowerCase() || finalUrl === (baseUrl + '/').toLowerCase();
    return !isLoggedOut;
  } catch (e) { return false; }
}

async function fetchMinWithdrawal(faucet) {
  try {
    const baseUrl = faucet.url.replace(/\/$/, '');
    const testUrl = `${baseUrl}/withdrawal.php?_t=${Date.now()}`;
    const resp = await fetch(testUrl, { credentials: 'include', redirect: 'follow', cache: 'no-cache' });
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Scrape withdrawal minimums using unified selectors and patterns
    const selectors = SiteSelectors.get("withdrawMinAmountText");
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        for (const p of SCRAPE_WD_MIN_PATTERNS) {
          const m = text.match(p);
          if (m && m[1]) return m[1].replace(',', '');
        }
      }
    }
    
    // Fallback: search entire body text if selectors fail
    const fullText = doc.body.innerText;
    for (const p of SCRAPE_WD_MIN_PATTERNS) {
      const m = fullText.match(p);
      if (m && m[1]) return m[1].replace(',', '');
    }
    return null;
  } catch (e) { return null; }
}

async function fetchBalance(faucet) {
  const baseUrl = faucet.url.replace(/\/$/, '');
  const pages = ["/faucet.php", "/index.php", "/"];
  
  for (const page of pages) {
    try {
      const testUrl = `${baseUrl}${page}?_t=${Date.now()}`;
      const resp = await fetch(testUrl, { credentials: 'include', redirect: 'follow', cache: 'no-cache' });
      if (!resp.ok) continue;
      
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      const selectors = [
        "#game_dice .user_balance", ".user_balance", ".user-balance", ".header-balance", 
        ".balance-value", "#balance", ".bal-amt", ".val", "b",
        "[class*='balance' i]", "[id*='balance' i]"
      ];
      
      for (const sel of selectors) {
        const els = doc.querySelectorAll(sel);
        for (const el of els) {
          const text = el.textContent.trim();
          const cleaned = text.replace(/,/g, "");
          const matches = cleaned.match(/-?\d+(?:\.\d+)?/);
          if (matches) return matches[0];
        }
      }
    } catch (e) { continue; }
  }
  return null;
}

async function fetchCooldown(faucet) {
  try {
    const baseUrl = faucet.url.replace(/\/$/, '');
    const testUrl = `${baseUrl}/faucet.php?_t=${Date.now()}`;
    const resp = await fetch(testUrl, { credentials: 'include', redirect: 'follow', cache: 'no-cache' });
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Use unified selectors for cooldown timers
    const selectors = SiteSelectors.get("faucetCooldownTimer");
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (!text) continue;
        
        // Parse MM:SS or HH:MM:SS
        const matches = text.match(/(\d+):(\d+)(?::(\d+))?/);
        if (matches) {
          const h = matches[3] ? parseInt(matches[1], 10) : 0;
          const m = matches[3] ? parseInt(matches[2], 10) : parseInt(matches[1], 10);
          const s = matches[3] ? parseInt(matches[3], 10) : parseInt(matches[2], 10);
          return (h * 60) + m + (s / 60);
        }
        
        const minMatch = text.match(/(\d+)\s*(min|minute)/i);
        if (minMatch) return parseInt(minMatch[1], 10);
      }
    }
    return null;
  } catch (e) { return null; }
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
        <div class="history-val">${e.balance ? parseFloat(e.balance).toFixed(5) : "✓"}</div>
        <div class="history-ts">${fmtTime(e.ts)}</div>
      </div>
    </div>
  `).join("");
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
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
      try {
        const merged = { ...def, ...(storedByUrl[def.url] || {}) };
        let dUser = merged.username || "", dPass = merged.password || "";
        if (typeof CryptoUtils !== "undefined" && dUser && dUser.length > 30) {
          dUser = await CryptoUtils.decrypt(dUser);
          dPass = await CryptoUtils.decrypt(dPass);
        }
        return { ...merged, username: dUser, password: dPass };
      } catch (e) {
        console.warn(`[Popup] Failed to load config for ${def.url}:`, e);
        return def;
      }
    }));


    // Attach global auto-save listeners
    document.querySelectorAll("#tab-settings input, #tab-settings select").forEach(el => {
      const event = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(event, () => triggerAutoSave(el.type === 'checkbox' ? 0 : 1000));
    });
  } catch (err) {
    console.error("[Popup] Critical LoadSettings Failure:", err);
  }
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
  const minThreshold = f.wdMinDetected || minWdThresholds[host];

  card.innerHTML = `
    <div class="modal-tabs">
      <div class="modal-tab ${currentModalTab === 'claim' ? 'active' : ''}" data-target="section-claim">Claim</div>
      <div class="modal-tab ${currentModalTab === 'dice' ? 'active' : ''}" data-target="section-dice">Dice</div>
      <div class="modal-tab ${currentModalTab === 'withdraw' ? 'active' : ''}" data-target="section-withdraw">Withdraw</div>
    </div>

    <!-- ── SECTION: CLAIM ── -->
    <div class="modal-section ${currentModalTab === 'claim' ? 'active' : ''}" id="section-claim">
      <div class="toggle-switch" style="margin-bottom:15px; background:rgba(74,144,226,0.1); padding:10px; border-radius:12px; border:1px solid rgba(74,144,226,0.2);">
         <span class="label" style="color:#fff; font-weight:700;">🟢 Site Automation Active</span>
         <input type="checkbox" id="factive" ${f.active !== false ? "checked" : ""}>
      </div>

      <div class="field">
        <label class="label">Claim Every (Minutes)</label>
        <input type="number" id="fint" value="${f.intervalMinutes || 61}" min="1">
      </div>
      <div class="input-row">
        <div class="field">
          <label class="label">Extra Wait Min</label>
          <input type="number" id="frmin" value="${f.minRandomMinutes || 0}" min="0">
        </div>
        <div class="field">
          <label class="label">Extra Wait Max</label>
          <input type="number" id="frmax" value="${f.maxRandomMinutes || 5}" min="0">
        </div>
      </div>
      <div style="margin-top:auto; padding-top:10px;">
        <button class="btn-secondary" id="openSiteBtn" style="width:100%; background:var(--glass-border); border:none; color:var(--text-dim); padding:10px; border-radius:12px; font-size:10px; cursor:pointer; font-weight:600;">🌐 Open Faucet URL</button>
      </div>
    </div>

    <!-- ── SECTION: DICE ── -->
    <div class="modal-section ${currentModalTab === 'dice' ? 'active' : ''}" id="section-dice">
      <div class="toggle-switch">
         <span class="label" style="color:var(--accent)">Enable Dice Strategy</span>
         <input type="checkbox" id="fdb" ${f.dbEnabled ? "checked" : ""}>
      </div>
      
      <div id="diceSettings" style="display:${f.dbEnabled ? 'flex' : 'none'}; flex-direction:column; gap:15px;">
        <div class="field">
          <label class="label">Strategy Mode</label>
          <select id="fdbStrategy">
            <option value="${DICE_STRATEGY_ALL_IN_001}" ${f.dbStrategy === DICE_STRATEGY_ALL_IN_001 ? "selected" : ""}>All-In (Target Threshold)</option>
            <option value="${DICE_STRATEGY_COMBINED_HIGH_ROLLER}" ${f.dbStrategy === DICE_STRATEGY_COMBINED_HIGH_ROLLER ? "selected" : ""}>Combined High Roller</option>
            <option value="${DICE_STRATEGY_PYRAMID}" ${f.dbStrategy === DICE_STRATEGY_PYRAMID ? "selected" : ""}>Win-Streak Pyramid</option>
            <option value="${DICE_STRATEGY_TIME_ACCUMULATOR}" ${f.dbStrategy === DICE_STRATEGY_TIME_ACCUMULATOR ? "selected" : ""}>Time-Accumulator</option>
          </select>
        </div>

        <div id="allInConfig" style="display:${f.dbStrategy === DICE_STRATEGY_ALL_IN_001 ? 'flex' : 'none'}; flex-direction:column; gap:12px; background:rgba(255,255,255,0.02); padding:10px; border-radius:12px; border:1px solid var(--glass-border);">
          <div class="input-row">
            <div class="field">
              <label class="label" style="font-size:9px;">Side</label>
              <select id="allInSide">
                <option value="higher" ${f.dbAllInConfig?.side !== "lower" ? "selected" : ""}>Over</option>
                <option value="lower" ${f.dbAllInConfig?.side === "lower" ? "selected" : ""}>Under</option>
              </select>
            </div>
            <div class="field">
              <label class="label" style="font-size:9px;">Win %</label>
              <input type="number" id="allInChance" value="${f.dbAllInConfig?.chance || f.dbChance || 49.5}" step="0.01">
            </div>
          </div>
        </div>

        <div id="pyramidConfig" style="display:${f.dbStrategy === DICE_STRATEGY_PYRAMID ? 'flex' : 'none'}; flex-direction:column; gap:8px; background:rgba(255,255,255,0.02); padding:10px; border-radius:12px; border:1px solid var(--glass-border);">
          <div class="input-row">
            <div class="field">
              <label class="label" style="font-size:9px;">Side</label>
              <select id="pyrSide">
                <option value="higher" ${f.dbPyramidConfig?.side !== "lower" ? "selected" : ""}>Over</option>
                <option value="lower" ${f.dbPyramidConfig?.side === "lower" ? "selected" : ""}>Under</option>
              </select>
            </div>
            <div class="field">
              <label class="label" style="font-size:9px;">Win %</label>
              <input type="number" id="pyrChance" value="${f.dbPyramidConfig?.chance || f.dbChance || 49.5}" step="0.01">
            </div>
          </div>
          <div class="input-row">
            <div class="field">
              <label class="label" style="font-size:9px;">Base %</label>
              <input type="number" id="pyrBase" value="${f.dbPyramidConfig?.base_bet_pct || 0.05}" step="any">
            </div>
            <div class="field">
              <label class="label" style="font-size:9px;">Mult</label>
              <input type="number" id="pyrMult" value="${f.dbPyramidConfig?.multiplier || 2.0}" step="any">
            </div>
          </div>
          <div class="input-row">
            <div class="field">
              <label class="label" style="font-size:9px;">Max Lvl</label>
              <input type="number" id="pyrMax" value="${f.dbPyramidConfig?.max_level || 5}">
            </div>
            <div class="field">
              <label class="label" style="font-size:9px;">Drop</label>
              <input type="number" id="pyrDrop" value="${f.dbPyramidConfig?.drop_levels || 2}">
            </div>
          </div>
          <div class="toggle-switch" style="margin-top:2px;">
            <span class="label" style="font-size:9px;">Flip on Loss</span>
            <input type="checkbox" id="pyrSwitch" ${f.dbPyramidConfig?.switch_on_loss !== false ? "checked" : ""}>
          </div>
        </div>

        <div id="highRollerConfig" style="display:${f.dbStrategy === DICE_STRATEGY_COMBINED_HIGH_ROLLER ? 'flex' : 'none'}; flex-direction:column; gap:8px; background:rgba(255,255,255,0.02); padding:10px; border-radius:12px; border:1px solid var(--glass-border);">
          <div class="input-row">
            <div class="field">
              <label class="label" style="font-size:9px;">Side</label>
              <select id="hrSide">
                <option value="higher" ${f.dbStrategyConfig?.side !== "lower" ? "selected" : ""}>Over</option>
                <option value="lower" ${f.dbStrategyConfig?.side === "lower" ? "selected" : ""}>Under</option>
              </select>
            </div>
            <div class="field">
              <label class="label" style="font-size:9px;">Win %</label>
              <input type="number" id="hrChance" value="${f.dbStrategyConfig?.chance || f.dbChance || 49.5}" step="0.01">
            </div>
          </div>
          <div class="input-row">
            <div class="field">
              <label class="label" style="font-size:9px;">Base Frac.</label>
              <input type="number" id="hrBase" value="${f.dbStrategyConfig?.base_bet_fraction || 0.10}" step="any">
            </div>
            <div class="field">
              <label class="label" style="font-size:9px;">Max Frac.</label>
              <input type="number" id="hrMaxBet" value="${f.dbStrategyConfig?.max_bet_fraction || 0.40}" step="any">
            </div>
          </div>
          <div class="input-row">
            <div class="field">
              <label class="label" style="font-size:9px;">Ladder</label>
              <input type="number" id="hrLadder" value="${f.dbStrategyConfig?.max_ladder_depth || 5}">
            </div>
            <div class="field">
              <label class="label" style="font-size:9px;">History</label>
              <input type="number" id="hrHistory" value="${f.dbStrategyConfig?.history_window || 10}">
            </div>
          </div>
        </div>

        <div id="timeAccumulatorConfig" style="display:${f.dbStrategy === DICE_STRATEGY_TIME_ACCUMULATOR ? 'flex' : 'none'}; flex-direction:column; gap:8px; background:rgba(255,255,255,0.02); padding:10px; border-radius:12px; border:1px solid var(--glass-border);">
          <div class="input-row">
            <div class="field">
              <label class="label" style="font-size:9px;">Side</label>
              <select id="taSide">
                <option value="higher" ${f.dbTimeAccumulatorConfig?.side !== "lower" ? "selected" : ""}>Over</option>
                <option value="lower" ${f.dbTimeAccumulatorConfig?.side === "lower" ? "selected" : ""}>Under</option>
              </select>
            </div>
            <div class="field">
              <label class="label" style="font-size:9px;">Win %</label>
              <input type="number" id="taChance" value="${f.dbTimeAccumulatorConfig?.chance || 50}" step="0.01">
            </div>
          </div>
          <div class="input-row">
            <div class="field">
              <label class="label" style="font-size:9px;">Min Frac.</label>
              <input type="number" id="taMinFrac" value="${f.dbTimeAccumulatorConfig?.min_bet_fraction || 0.01}" step="any">
            </div>
            <div class="field">
              <label class="label" style="font-size:9px;">Max Frac.</label>
              <input type="number" id="taMaxFrac" value="${f.dbTimeAccumulatorConfig?.max_bet_fraction || 0.90}" step="any">
            </div>
          </div>
          <div class="field" style="margin-top:2px;">
            <label class="label" style="font-size:9px;">Seed Bet (if no profit) % of balance</label>
            <input type="number" id="taSeed" value="${f.dbTimeAccumulatorConfig?.safety_floor_pct || 0.05}" step="any">
          </div>
        </div>
      </div>
    </div>

    <!-- ── SECTION: WITHDRAW ── -->
    <div class="modal-section ${currentModalTab === 'withdraw' ? 'active' : ''}" id="section-withdraw">
      <div class="toggle-switch" style="margin-bottom:10px;">
         <span class="label" style="color:var(--status-err)">Auto-Withdrawal</span>
         <input type="checkbox" id="fwd" ${f.wdEnabled ? "checked" : ""}>
      </div>
      <div class="field">
        <label class="label">Withdraw Amount</label>
        <div style="display:flex; align-items:center; gap:10px;">
          <input type="number" id="fwdth" value="${f.wdThreshold || ""}" step="any" min="${minThreshold || 0}" style="flex:1;">
          <span id="detectedMinLabel" style="font-size:9px; color:var(--accent); white-space:nowrap; background:rgba(74,144,226,0.05); padding:2px 6px; border-radius:4px; border:1px solid rgba(74,144,226,0.1);">Min: ${minThreshold || "–"}</span>
        </div>
      </div>
      <div class="field">
        <label class="label">Receiver Wallet Address</label>
        <input type="text" id="fwdaddr" value="${f.wdAddress || ""}" placeholder="Address">
      </div>
    </div>
  `;

  // Attach tab switching logic
  card.querySelectorAll(".modal-tab").forEach(tab => {
    tab.onclick = () => {
      card.querySelectorAll(".modal-tab").forEach(t => t.classList.remove("active"));
      card.querySelectorAll(".modal-section").forEach(s => s.classList.remove("active"));
      tab.classList.add("active");
      const target = card.querySelector("#" + tab.dataset.target);
      if (target) target.classList.add("active");
      currentModalTab = tab.dataset.target.replace("section-", "");
      
      // Trigger fresh scraper if navigating to Withdraw tab
      if (currentModalTab === "withdraw") {
        fetchMinWithdrawal(f).then(min => {
          if (min) {
            f.wdMinDetected = min;
            const label = card.querySelector("#detectedMinLabel");
            if (label) label.textContent = "Min: " + min;
            const input = card.querySelector("#fwdth");
            if (input) {
              input.min = min;
              if (!f.wdThresholdIsManual) {
                input.value = min;
                f.wdThreshold = min;
              }
            }
          }
        });
      }
    };
  });

  const dSettings = card.querySelector("#diceSettings");
  const pConfig = card.querySelector("#pyramidConfig");

  card.querySelector("#fdb").addEventListener("change", (e) => {
    dSettings.style.display = e.target.checked ? "flex" : "none";
    f.dbEnabled = e.target.checked;
  });

  card.querySelector("#fdbStrategy").addEventListener("change", (e) => {
    pConfig.style.display = e.target.value === DICE_STRATEGY_PYRAMID ? "flex" : "none";
    const hrConfig = card.querySelector("#highRollerConfig");
    if (hrConfig) hrConfig.style.display = e.target.value === DICE_STRATEGY_COMBINED_HIGH_ROLLER ? "flex" : "none";
    const taConfig = card.querySelector("#timeAccumulatorConfig");
    if (taConfig) taConfig.style.display = e.target.value === DICE_STRATEGY_TIME_ACCUMULATOR ? "flex" : "none";
    f.dbStrategy = e.target.value;
  });

  card.querySelector("#openSiteBtn").addEventListener("click", () => {
    const refUrl = f.referralId ? `${f.url.replace(/\/$/, '')}/signup.php?ref=${f.referralId}` : f.url;
    window.open(refUrl, "_blank");
  });

  card.querySelectorAll("input, select").forEach(el => {
    const event = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(event, () => {
      const factiveEl = card.querySelector("#factive");
      if (factiveEl) f.active = factiveEl.checked;
      
      const fintEl = card.querySelector("#fint");
      if (fintEl) f.intervalMinutes = parseInt(fintEl.value) || 61;
      
      const frminEl = card.querySelector("#frmin");
      if (frminEl) f.minRandomMinutes = parseInt(frminEl.value) || 0;
      
      const frmaxEl = card.querySelector("#frmax");
      if (frmaxEl) f.maxRandomMinutes = parseInt(frmaxEl.value) || 5;
      
      f.dbEnabled = card.querySelector("#fdb").checked;
      f.dbStrategy = card.querySelector("#fdbStrategy").value;
      
      // Toggle Strategy Container Visibility
      card.querySelector("#allInConfig").style.display = f.dbStrategy === DICE_STRATEGY_ALL_IN_001 ? "flex" : "none";
      card.querySelector("#pyramidConfig").style.display = f.dbStrategy === DICE_STRATEGY_PYRAMID ? "flex" : "none";
      card.querySelector("#highRollerConfig").style.display = f.dbStrategy === DICE_STRATEGY_COMBINED_HIGH_ROLLER ? "flex" : "none";
      card.querySelector("#timeAccumulatorConfig").style.display = f.dbStrategy === DICE_STRATEGY_TIME_ACCUMULATOR ? "flex" : "none";

      // All-In Mapping
      if (!f.dbAllInConfig) f.dbAllInConfig = {};
      const allInSideEl = card.querySelector("#allInSide");
      if (allInSideEl) f.dbAllInConfig.side = allInSideEl.value;
      const allInChanceEl = card.querySelector("#allInChance");
      if (allInChanceEl) f.dbAllInConfig.chance = parseFloat(allInChanceEl.value);

      // Pyramid Mapping
      if (!f.dbPyramidConfig) f.dbPyramidConfig = {};
      const pyrSideEl = card.querySelector("#pyrSide");
      if (pyrSideEl) f.dbPyramidConfig.side = pyrSideEl.value;
      const pyrChanceEl = card.querySelector("#pyrChance");
      if (pyrChanceEl) f.dbPyramidConfig.chance = parseFloat(pyrChanceEl.value);
      const pyrBaseEl = card.querySelector("#pyrBase");
      if (pyrBaseEl) f.dbPyramidConfig.base_bet_pct = parseFloat(pyrBaseEl.value);
      const pyrMultEl = card.querySelector("#pyrMult");
      if (pyrMultEl) f.dbPyramidConfig.multiplier = parseFloat(pyrMultEl.value);
      const pyrMaxEl = card.querySelector("#pyrMax");
      if (pyrMaxEl) f.dbPyramidConfig.max_level = parseInt(pyrMaxEl.value);
      const pyrDropEl = card.querySelector("#pyrDrop");
      if (pyrDropEl) f.dbPyramidConfig.drop_levels = parseInt(pyrDropEl.value);
      const pyrSwitchEl = card.querySelector("#pyrSwitch");
      if (pyrSwitchEl) f.dbPyramidConfig.switch_on_loss = pyrSwitchEl.checked;
      
      // High Roller Mapping
      if (!f.dbStrategyConfig) f.dbStrategyConfig = {};
      const hrSideEl = card.querySelector("#hrSide");
      if (hrSideEl) f.dbStrategyConfig.side = hrSideEl.value;
      const hrChanceEl = card.querySelector("#hrChance");
      if (hrChanceEl) f.dbStrategyConfig.chance = parseFloat(hrChanceEl.value);
      const hrBaseEl = card.querySelector("#hrBase");
      if (hrBaseEl) f.dbStrategyConfig.base_bet_fraction = parseFloat(hrBaseEl.value);
      const hrMaxBetEl = card.querySelector("#hrMaxBet");
      if (hrMaxBetEl) f.dbStrategyConfig.max_bet_fraction = parseFloat(hrMaxBetEl.value);
      
      const hrLadderEl = card.querySelector("#hrLadder");
      if (hrLadderEl) f.dbStrategyConfig.max_ladder_depth = parseInt(hrLadderEl.value);
      
      const hrHistoryEl = card.querySelector("#hrHistory");
      if (hrHistoryEl) f.dbStrategyConfig.history_window = parseInt(hrHistoryEl.value);
      
      // Time-Accumulator Mapping
      if (!f.dbTimeAccumulatorConfig) f.dbTimeAccumulatorConfig = {};
      const taSideEl = card.querySelector("#taSide");
      if (taSideEl) f.dbTimeAccumulatorConfig.side = taSideEl.value;
      const taChanceEl = card.querySelector("#taChance");
      if (taChanceEl) f.dbTimeAccumulatorConfig.chance = parseFloat(taChanceEl.value);
      const taMinFracEl = card.querySelector("#taMinFrac");
      if (taMinFracEl) f.dbTimeAccumulatorConfig.min_bet_fraction = parseFloat(taMinFracEl.value);
      const taMaxFracEl = card.querySelector("#taMaxFrac");
      if (taMaxFracEl) f.dbTimeAccumulatorConfig.max_bet_fraction = parseFloat(taMaxFracEl.value);
      const taSeedEl = card.querySelector("#taSeed");
      if (taSeedEl) f.dbTimeAccumulatorConfig.safety_floor_pct = parseFloat(taSeedEl.value);

      const fwdEl = card.querySelector("#fwd");
      if (fwdEl) f.wdEnabled = fwdEl.checked;
      
      const fwdthEl = card.querySelector("#fwdth");
      if (fwdthEl) {
        const newVal = fwdthEl.value.trim();
        if (newVal !== f.wdThreshold) {
          f.wdThreshold = newVal;
          f.wdThresholdIsManual = true; // Mark as manual once user edits
        }
      }
      
      const fwdaddrEl = card.querySelector("#fwdaddr");
      if (fwdaddrEl) f.wdAddress = fwdaddrEl.value.trim();

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
  try {
    await saveBtn.onclick(); 
  } finally {
    closeModal();
  }
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

  // Identify custom faucets (those not in the default list)
  const defaultUrls = new Set(makeFaucetDefaults().map(d => d.url));
  const customFaucets = faucetsToSave.filter(f => !defaultUrls.has(f.url));

  const settings = {
    enabled: document.getElementById("cfgEnabled").checked,
    botName: (document.getElementById("cfgBotName").value.trim() || "Faucet Bot"),
    longBreakEnabled: document.getElementById("longBreakEnabled").checked,
    longBreakFrequency: parseInt(document.getElementById("longBreakFrequency").value) || 5,
    longBreakMin: parseInt(document.getElementById("longBreakMin").value) || 65,
    longBreakMax: parseInt(document.getElementById("longBreakMax").value) || 80,
    telegram: {
      enabled: document.getElementById("tgEnabled").checked,
      botToken: document.getElementById("tgToken").value.trim(),
      chatId: document.getElementById("tgChatId").value.trim()
    },
    faucets: faucetsToSave,
    customFaucets: customFaucets // Explicitly preserve custom site definitions
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

// ── Telegram Verification ─────────────────────────────────────────────────────
const tgVerifyBtn = document.getElementById("tgVerifyBtn");
const tgStatusMsg = document.getElementById("tgStatusMsg");

if (tgVerifyBtn) {
  tgVerifyBtn.onclick = async () => {
    const token = document.getElementById("tgToken").value.trim();
    if (!token) {
      tgStatusMsg.textContent = "Please enter a Bot Token first.";
      tgStatusMsg.style.color = "var(--status-err)";
      return;
    }

    tgVerifyBtn.disabled = true;
    tgVerifyBtn.textContent = "Checking...";
    tgStatusMsg.textContent = "Fetching latest messages from Telegram...";
    tgStatusMsg.style.color = "var(--text-dim)";

    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
      const data = await resp.json();

      if (!data.ok) {
        throw new Error(data.description || "Invalid token or bot error.");
      }

      const updates = data.result || [];
      if (updates.length === 0) {
        tgStatusMsg.textContent = "No messages found. Send any message to your bot first!";
        tgStatusMsg.style.color = "var(--accent)";
        tgVerifyBtn.disabled = false;
        tgVerifyBtn.textContent = "Verify & Link";
        return;
      }

      // Get latest chat id
      const lastUpdate = updates[updates.length - 1];
      const chatId = lastUpdate.message?.chat?.id || lastUpdate.callback_query?.message?.chat?.id;

      if (!chatId) {
        throw new Error("Could not find a Chat ID in the latest updates.");
      }

      document.getElementById("tgChatId").value = chatId;
      tgStatusMsg.textContent = `✓ Found Chat ID: ${chatId}. Sending test message...`;
      tgStatusMsg.style.color = "var(--status-ok)";

      // Send test message
      const testResp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🚀 *FaucetPick Sync Successful!*\n\nThis bot is now linked to your extension and will receive claim/error notifications.\n\n_Note: You can now safely close the extension settings._",
          parse_mode: "Markdown"
        })
      });

      if (testResp.ok) {
        tgStatusMsg.textContent = "✓ Connected! Found Chat ID & Sent Test Message.";
        tgStatusMsg.style.color = "var(--status-ok)";
        // Auto-save
        await saveBtn.onclick();
      } else {
        throw new Error("Found ID, but failed to send test message.");
      }
    } catch (err) {
      console.error("[Telegram Verification]", err);
      tgStatusMsg.textContent = "✗ Error: " + err.message;
      tgStatusMsg.style.color = "var(--status-err)";
    } finally {
      tgVerifyBtn.disabled = false;
      tgVerifyBtn.textContent = "Verify & Link";
    }
  };
}

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

// ── Export / Import / Reset ───────────────────────────────────────────────
document.getElementById("exportBtn").onclick = async () => {
  try {
    // Ensure current UI state is saved to storage before exporting
    if (typeof saveBtn !== "undefined" && saveBtn.onclick) {
      await saveBtn.onclick();
    }
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings) {
      alert("No configuration found to export.");
      return;
    }

    // Decrypt sensitive fields for the export file so it's a "clean" backup
    if (settings.faucets) {
      settings.faucets = await Promise.all(settings.faucets.map(async f => {
        let u = f.username || "", p = f.password || "";
        if (typeof CryptoUtils !== "undefined" && u.length > 30) {
          try { u = await CryptoUtils.decrypt(u); } catch(e){}
          try { p = await CryptoUtils.decrypt(p); } catch(e){}
        }
        return { ...f, username: u, password: p };
      }));
    }

    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `faucetpick-config-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[Popup] Export failed:", err);
    alert("Export failed: " + err.message);
  }
};

document.getElementById("importBtn").onclick = () => {
  document.getElementById("importFile").click();
};

document.getElementById("importFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const imported = JSON.parse(event.target.result);
      if (!imported.faucets) throw new Error("Invalid config: No faucets found.");

      // Re-encrypt if needed (saveBtn logic)
      if (imported.faucets) {
        imported.faucets = await Promise.all(imported.faucets.map(async f => {
          let u = f.username || "", p = f.password || "";
          if (typeof CryptoUtils !== "undefined" && u && u.length < 30) {
            try { u = await CryptoUtils.encrypt(u); } catch(e){}
            try { p = await CryptoUtils.encrypt(p); } catch(e){}
          }
          return { ...f, username: u, password: p };
        }));
      }

      await chrome.storage.local.set({ settings: imported });
      chrome.runtime.sendMessage({ type: "save-settings", settings: imported });
      
      alert("Configuration imported successfully! Reloading...");
      window.location.reload();
    } catch (err) {
      console.error("[Popup] Import failed:", err);
      alert("Import failed: " + err.message);
    }
  };
  reader.readAsText(file);
};

document.getElementById("resetBtn").onclick = async () => {
  if (!confirm("Are you sure you want to reset ALL settings to factory defaults? This cannot be undone.")) return;
  try {
    const defaults = makeFaucetDefaults();
    const settings = {
        enabled: false,
        botName: "Faucet Bot",
        longBreakEnabled: false,
        longBreakFrequency: 5,
        longBreakMin: 65,
        longBreakMax: 80,
        telegram: { enabled: false, botToken: "", chatId: "" },
        faucets: defaults
    };
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ settings, setupComplete: true });
    chrome.runtime.sendMessage({ type: "save-settings", settings });
    window.location.reload();
  } catch (err) {
    console.error("[Popup] Reset failed:", err);
  }
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
  
  // Universal Auto-Save: Instant persistence for all settings inputs
  document.querySelectorAll("#tab-settings input, #tab-settings select").forEach(el => {
    const event = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(event, () => triggerAutoSave(el.type === 'checkbox' ? 0 : 1000));
  });

  // Heartbeat: Signal to background that configuration is active
  try { chrome.runtime.connect({ name: "popup" }); } catch (err) {}
})();
