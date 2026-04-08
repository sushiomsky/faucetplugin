importScripts('constants.js');
const ALARM_NAME = "faucet-tick"; 
const SITE_PHASE_TIMEOUT_MS = 20 * 60 * 1000;
const DEBUG = false;

function log(...a) { if (DEBUG) console.log("[FaucetPick:BG]", ...a); }

// Multi-site configuration: all enabled faucets are queued sequentially
const DEFAULT_SETTINGS = {
  enabled: true,
  faucets: makeFaucetDefaults(),
  customFaucets: [],
  longBreakEnabled: DEFAULT_LONG_BREAK_ENABLED,
  longBreakFrequency: DEFAULT_LONG_BREAK_FREQUENCY,
  longBreakMin: DEFAULT_LONG_BREAK_MIN,
  longBreakMax: DEFAULT_LONG_BREAK_MAX,
  botName: DEFAULT_BOT_NAME
};

async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  const s = stored.settings || {};
  const storedFaucets = s.faucets && s.faucets.length ? s.faucets : [];
  
  // Match by URL so adding new faucets doesn't lose stored per-faucet config
  const storedByUrl = {};
  for (const f of storedFaucets) { if (f.url) storedByUrl[f.url] = f; }
  
  const defaultFaucets = DEFAULT_SETTINGS.faucets;
  const customFaucets = s.customFaucets || [];
  const allBaseFaucets = [...defaultFaucets, ...customFaucets];
  
  const faucets = allBaseFaucets.map(def => {
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
  
  return { ...DEFAULT_SETTINGS, ...s, faucets };
}

function getWithdrawUrl(f) {
  if (!f) return null;
  if (f.withdrawUrl) return f.withdrawUrl;
  try { return new URL(f.url).origin + "/withdraw.php"; } catch { return null; }
}

function sameHost(a, b) {
  try { return new URL(a).hostname === new URL(b).hostname; } catch { return false; }
}

function hostKey(url) {
  try { return new URL(url).hostname; } catch { return url || ""; }
}

let checkLoopRunning = false;
let pendingCheckRequested = false;
let pendingForceAll = false;
let isConfiguring = false;

// Configuration Lock: Pauses all automated activity while the popup is open
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") {
    isConfiguring = true;
    console.log("[Faucet] Configuration Lock ACTIVE (Popup Open)");
    port.onDisconnect.addListener(() => {
      isConfiguring = false;
      console.log("[Faucet] Configuration Lock RELEASED (Popup Closed) - Resuming...");
      requestCheckAndRun(false); // Immediate resume
    });
  }
});

async function requestCheckAndRun(forceAll = false) {
  pendingCheckRequested = true;
  pendingForceAll = pendingForceAll || forceAll;
  if (checkLoopRunning) return;

  checkLoopRunning = true;
  try {
    while (pendingCheckRequested) {
      const runForceAll = pendingForceAll;
      pendingCheckRequested = false;
      pendingForceAll = false;
      await checkAndRun(runForceAll);
    }
  } catch (err) {
    console.error("[Faucet] check loop error:", err?.message || err);
  } finally {
    checkLoopRunning = false;
    if (pendingCheckRequested) {
      requestCheckAndRun(false);
    }
  }
}

// ── Alarm management ─────────────────────────────────────────────────────────

async function ensureTickAlarm() {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
    console.log("[Faucet] Tick alarm set (every 1 min)");
  }
}

async function cancelAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
  log("[Faucet] Alarm cancelled");
}

async function stopAllActivity() {
  await cancelAlarm();
  const { activeTabs = {}, settings = {} } = await chrome.storage.local.get(["activeTabs", "settings"]);
  
  // Close all active faucet tabs
  for (const tabId of Object.keys(activeTabs)) {
    try { await chrome.tabs.remove(parseInt(tabId, 10)); } catch (err) {}
  }

  // Clear all runtime state
  await chrome.storage.local.set({
    activeTabs: {},
    claimQueue: [],
    running: false,
    settings: { ...settings, enabled: false }
  });
  
  log("[Faucet] ALL ACTIVITY STOPPED immediately.");
}

// ── Check & open due faucets ─────────────────────────────────────────────────
// activeTabs = { [tabId]: { faucetUrl, phase, wdAddress? } }

async function checkAndRun(forceAll = false) {
  const s = await getSettings();
  if (isConfiguring && !forceAll) {
    console.log("[Faucet] Skipping automated check: Configuration in progress...");
    return; 
  }
  
  if (forceAll) console.log("[Manual] Bypassing Configuration Lock for user request");
  if (!s.enabled) {
    console.log("[Faucet] Plugin disabled");
    await chrome.storage.local.set({ running: false });
    return;
  }

  const state = await chrome.storage.local.get(["claimHistory", "activeTabs", "claimQueue", "running"]);
  const claimHistory = state.claimHistory || {};
  const activeTabs = state.activeTabs || {};
  const claimQueue = Array.isArray(state.claimQueue) ? state.claimQueue : [];
  const schedulerRunning = state.running === true;
  const now = Date.now();

  log("[Faucet] Checking faucets...", s.faucets.length, "configured");
  log("[Faucet] Currently active tabs:", Object.keys(activeTabs).length);
  log("[Faucet] Queue length:", claimQueue.length);

  // Prune stale activeTabs entries whose tabs no longer exist
  const allTabIds = (await chrome.tabs.query({})).map(t => t.id);
  let stateDirty = false;
  const timedOutEntries = [];
  for (const id of Object.keys(activeTabs)) {
    const tabId = parseInt(id, 10);
    const entry = activeTabs[id];
    const phaseStartedAt = entry?.phaseStartedAt || entry?.startedAt || 0;
    const lastHeartbeatAt = entry?.lastHeartbeatAt || 0;
    const hasFreshHeartbeat = lastHeartbeatAt > 0 && (now - lastHeartbeatAt) <= SITE_PHASE_TIMEOUT_MS;

    if (!allTabIds.includes(tabId)) {
      delete activeTabs[id]; 
      stateDirty = true;
      console.log(`[Faucet] Removed stale tab ${id} from activeTabs`);
      continue;
    }

    // Protection: Never timeout manual betting/dice sessions
    if (entry?.faucetUrl?.includes("#manual") || entry?.phase?.includes("dice")) {
      continue;
    }

    if (phaseStartedAt && (now - phaseStartedAt) > SITE_PHASE_TIMEOUT_MS && !hasFreshHeartbeat) {
      delete activeTabs[id];
      stateDirty = true;
      timedOutEntries.push({ tabId, faucetUrl: entry?.faucetUrl, phase: entry?.phase || "unknown" });
      console.warn(`[Faucet] Timing out stuck tab ${id} phase=${entry?.phase || "unknown"}`);
      continue;
    }
  }

  // Keep only one active tab per faucet host (races can create duplicates)
  const duplicateHostEntries = [];
  const primaryByHost = {};
  const sortedActiveEntries = Object.entries(activeTabs).sort(([, a], [, b]) => {
    const aTs = a?.startedAt || a?.phaseStartedAt || 0;
    const bTs = b?.startedAt || b?.phaseStartedAt || 0;
    return aTs - bTs;
  });
  for (const [id, entry] of sortedActiveEntries) {
    const host = hostKey(entry?.faucetUrl);
    if (!host) continue;
    if (!primaryByHost[host]) {
      primaryByHost[host] = id;
      continue;
    }
    delete activeTabs[id];
    stateDirty = true;
    duplicateHostEntries.push({
      tabId: parseInt(id, 10),
      faucetUrl: entry?.faucetUrl,
      phase: entry?.phase || "unknown"
    });
    console.warn(`[Faucet] Removing duplicate active tab ${id} for host ${host}`);
  }

  for (const t of timedOutEntries) {
    try { await chrome.tabs.remove(t.tabId); } catch (_) {}
    if (t.faucetUrl) {
      await appendLog({ url: t.faucetUrl, status: "error", reason: `phase-timeout:${t.phase}`, ts: Date.now() });
    }
  }

  for (const t of duplicateHostEntries) {
    try { await chrome.tabs.remove(t.tabId); } catch (_) {}
    if (t.faucetUrl) {
      await appendLog({ url: t.faucetUrl, status: "error", reason: `duplicate-active-tab:${t.phase}`, ts: Date.now() });
    }
  }

  // Sanitize queue: remove hosts already active and remove duplicate hosts
  const activeHosts = new Set(
    Object.values(activeTabs)
      .map(tab => hostKey(tab?.faucetUrl))
      .filter(Boolean)
  );
  const seenQueueHosts = new Set();
  const sanitizedQueue = [];
  for (const url of claimQueue) {
    const host = hostKey(url);
    if (!host) {
      stateDirty = true;
      continue;
    }
    if (activeHosts.has(host)) {
      console.log(`[Faucet] Removing queued ${url} because host is already active`);
      stateDirty = true;
      continue;
    }
    if (seenQueueHosts.has(host)) {
      console.log(`[Faucet] Removing duplicate queued host ${host}`);
      stateDirty = true;
      continue;
    }
    seenQueueHosts.add(host);
    sanitizedQueue.push(url);
  }
  if (sanitizedQueue.length !== claimQueue.length) {
    claimQueue.length = 0;
    claimQueue.push(...sanitizedQueue);
  }

  // Build list of due faucets
  const dueFaucets = [];
  for (const f of s.faucets) {
    const isActive = f.active !== false;
    if (!isActive) {
      console.log(`[Faucet] ${f.url} — DISABLED (active=${f.active})`);
      continue;
    }
    const lastClaimed = claimHistory[f.url] || 0;
    const intervalMs  = (f.intervalMinutes || 61) * 60 * 1000;
    
    // Check for Long Break
    const { claimCounts = {} } = await chrome.storage.local.get("claimCounts");
    const count = claimCounts[f.url] || 0;
    const isLongBreakDue = s.longBreakEnabled && (count > 0) && (count % s.longBreakFrequency === 0);
    
    // Calculate random offset
    let minRand = (f.minRandomMinutes || 0) * 60 * 1000;
    let maxRand = (f.maxRandomMinutes || 5) * 60 * 1000;
    
    if (isLongBreakDue) {
      minRand = (s.longBreakMin || 65) * 60 * 1000;
      maxRand = (s.longBreakMax || 80) * 60 * 1000;
      log(`[Faucet] ${f.url} — Entering Long Break (${minRand/60000}-${maxRand/60000} min)`);
    }

    const randomOffset = Math.floor(Math.random() * (maxRand - minRand + 1)) + minRand;
    
    const isDue       = forceAll || (now - lastClaimed) >= (intervalMs + randomOffset);
    const isRunning   = Object.values(activeTabs).some(t => sameHost(t.faucetUrl, f.url));
    const isQueued    = claimQueue.some(url => sameHost(url, f.url));
    const timeUntilDue = Math.max(0, (lastClaimed + intervalMs + randomOffset) - now);
    
    console.log(`[Faucet] ${f.url} — isDue=${isDue}, isRunning=${isRunning}, isQueued=${isQueued}, nextIn=${(timeUntilDue/1000/60).toFixed(1)}min (+rand)`);
    
    if (isDue && !isRunning && !isQueued) {
      dueFaucets.push(f);
      console.log(`[Faucet]   → Added to dueFaucets`);
    }
  }

  // Add due faucets to queue (avoid duplicates)
  for (const f of dueFaucets) {
    const isDuplicate = claimQueue.some(url => sameHost(url, f.url));
    if (!isDuplicate) {
      claimQueue.push(f.url);
      console.log(`[Faucet] Added to queue: ${f.url}`);
    } else {
      console.log(`[Faucet] SKIP: ${f.url} already in queue`);
    }
  }

  // If no tabs are running and queue has items, start the next one
  if (Object.keys(activeTabs).length === 0 && claimQueue.length > 0) {
    const nextUrl = claimQueue.shift();
    console.log(`[Faucet] No active tabs. Starting next from queue: ${nextUrl}`);
    
    try {
      let finalUrl = nextUrl;
      const s = await getSettings();
      const faucetCfg = s.faucets.find(f => sameHost(f.url, nextUrl));
      
      // If we have a referral ID and no credentials stored, use the referral link
      if (faucetCfg && faucetCfg.referralId && (!faucetCfg.username || !faucetCfg.password)) {
        const urlObj = new URL(nextUrl);
        urlObj.searchParams.set("ref", faucetCfg.referralId);
        finalUrl = urlObj.toString();
        console.log(`[Faucet] Opening with referral link: ${finalUrl}`);
      }

      const tab = await chrome.tabs.create({ url: finalUrl, active: false });
      console.log(`[Faucet] ✓ Opened tab ${tab.id} for ${finalUrl}`);
      activeTabs[tab.id] = { faucetUrl: nextUrl, phase: "faucet", startedAt: Date.now(), phaseStartedAt: Date.now() };
      await chrome.storage.local.set({ activeTabs, claimQueue, running: true, lastRunStart: Date.now() });
      log(`[Faucet] ✓ Stored tab ${tab.id} in activeTabs`);
    } catch (err) {
      console.error(`[Faucet] ✗ ERROR opening ${nextUrl}:`, err.message);
      if (err.message.includes('no permission') || err.message.includes('No host permission')) {
        console.error(`[Faucet] ✗ PERMISSION DENIED! Extension doesn't have access to ${nextUrl}`);
        console.error(`[Faucet] ✗ You must grant permission at chrome://extensions → Details → Permissions`);
      }
      claimQueue.push(nextUrl); // re-queue on error
      await chrome.storage.local.set({ activeTabs, claimQueue, running: true });
    }
    return;
  }

  if (claimQueue.length > 0) {
    console.log(`[Faucet] Queue has ${claimQueue.length} items waiting for current claim to finish`);
  }

  if (stateDirty || claimQueue.length > 0 || !schedulerRunning) {
    await chrome.storage.local.set({ activeTabs, claimQueue, running: true });
  }
}

// ── Close tab + update running state ─────────────────────────────────────────

async function closeTab(tabId) {
  const { activeTabs = {}, settings = {} } = await chrome.storage.local.get(["activeTabs", "settings"]);
  const entry = activeTabs[tabId];
  
  // Protection: Never close manual tabs automatically
  if (entry?.faucetUrl?.includes("#manual")) {
    console.log("[Faucet] Ignoring close request for manual betting tab", tabId);
    return;
  }

  delete activeTabs[tabId];
  const running = settings.enabled !== false;
  await chrome.storage.local.set({ activeTabs, running });
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url.includes("#manual")) {
      console.log("[Faucet] Safety check: ignoring close for manual URL", tab.url);
      return;
    }
    await chrome.tabs.remove(tabId);
  } catch (_) {}
  console.log("[Faucet] Tab", tabId, "closed. Remaining active:", Object.keys(activeTabs).length);
}

async function dispatchNativeClick(tabId, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("invalid-click-coordinates");
  }

  const target = { tabId };
  const protocolVersion = "1.3";
  let attached = false;

  try {
    await chrome.debugger.attach(target, protocolVersion);
    attached = true;
  } catch (err) {
    throw new Error(`debugger-attach-failed: ${err?.message || err}`);
  }

  try {
    const moveParams = {
      type: "mouseMoved",
      x: Math.round(x),
      y: Math.round(y),
      button: "none",
      pointerType: "mouse"
    };
    const downParams = {
      type: "mousePressed",
      x: Math.round(x),
      y: Math.round(y),
      button: "left",
      clickCount: 1,
      pointerType: "mouse"
    };
    const upParams = {
      type: "mouseReleased",
      x: Math.round(x),
      y: Math.round(y),
      button: "left",
      clickCount: 1,
      pointerType: "mouse"
    };

    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", moveParams);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", downParams);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", upParams);
  } finally {
    if (attached) {
      try { await chrome.debugger.detach(target); } catch (_) {}
    }
  }
}

// ── Message handling ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Sync messages that don't need async
  if (msg.type === "focus-tab") {
    if (sender.tab?.id) chrome.tabs.update(sender.tab.id, { active: true });
    sendResponse({ ok: true });
    return false;
  }

  // Async messages
  (async () => {
    try {
      if (msg.type === "check-plugin-tab") {
        const { activeTabs = {} } = await chrome.storage.local.get("activeTabs");
        const isManual = sender.tab?.url && (sender.tab.url.includes("#manual") || sender.tab.url.includes("manualMode=true"));
        const isReady = isManual || (!!sender.tab && !!activeTabs[sender.tab.id]);
        sendResponse({ yes: isReady });
      } else if (msg.type === "get-withdraw-info") {
        const d = await chrome.storage.local.get("activeTabs");
        const tab = (d.activeTabs || {})[sender.tab?.id];
        sendResponse({ isWithdrawTab: tab?.phase === "withdraw", address: tab?.wdAddress || "" });
      } else if (msg.type === "get-tab-state") {
        const d = await chrome.storage.local.get("activeTabs");
        const tab = (d.activeTabs || {})[sender.tab?.id];
        sendResponse({ tabState: tab || null });
      } else if (msg.type === "native-click") {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: "no-tab" });
          return;
        }
        chrome.tabs.update(tabId, { active: true }).catch(() => {});
        await dispatchNativeClick(tabId, msg.x, msg.y);
        sendResponse({ ok: true });
      } else {
        // Fallback for popup/internal messages
        await handleMessage(msg, sender);
        sendResponse({ ok: true });
      }
    } catch (err) {
      console.error("[Faucet:BG Message Error]", err);
    }
  })();

  return true; // Keep channel open for async sendResponse
});


// ── Alarm handler ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) requestCheckAndRun();
});

// ── Install / startup ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const { settings, setupComplete } = await chrome.storage.local.get(["settings", "setupComplete"]);
  
  if (!settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }

  // If setup not complete, open setup wizard
  if (!setupComplete) {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }

  const s = await getSettings();
  // Clear any stale state from previous session
  await chrome.storage.local.set({ activeTabs: {}, running: s.enabled !== false });
  if (s.enabled) { ensureTickAlarm(); requestCheckAndRun(true); }
});

chrome.runtime.onStartup.addListener(async () => {
  const s = await getSettings();
  await chrome.storage.local.set({ activeTabs: {}, running: s.enabled !== false });
  if (s.enabled) { ensureTickAlarm(); requestCheckAndRun(); }
});

// ── Telegram Webhook ─────────────────────────────────────────────────────────

async function sendTelegramAlert(message) {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings?.telegram?.enabled || !settings?.telegram?.botToken || !settings?.telegram?.chatId) return;

  const botPrefix = settings.botName ? `[${settings.botName}] ` : "";
  const finalMessage = `${botPrefix}${message}`;

  const url = `https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: settings.telegram.chatId,
        text: finalMessage,
        parse_mode: "Markdown"
      })
    });
  } catch (err) {
    console.error("[Faucet] Telegram delivery failed", err);
  }
}

// ── Activity log (last 30 entries) ───────────────────────────────────────────

async function appendLog(entry) {
  const { activityLog = [] } = await chrome.storage.local.get("activityLog");
  activityLog.unshift(entry);
  await chrome.storage.local.set({ activityLog: activityLog.slice(0, 30) });

  let host = "Unknown";
  try { host = new URL(entry.url).hostname.replace('www.', ''); } catch (_) {}

  if (entry.status === "wd-ok") {
    sendTelegramAlert(`💸 *Withdrawal Successful!*\n\n*Site:* ${host}\n*Status:* Confirmed and processing.`);
  } else if (entry.status === "error" || entry.status === "wd-error") {
    sendTelegramAlert(`🚨 *Bot Error Detected*\n\n*Site:* ${host}\n*Action:* ${entry.status === "error" ? "Claim/Dice" : "Withdraw"}\n*Reason:* \`${entry.reason || "Unknown"}\``);
  }
}

// ── Price fetcher (CoinGecko) ────────────────────────────────────────────────

async function fetchPrices() {
  try {
    const ids = Object.values(CRYPTO_PRICE_IDS).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
    const data = await resp.json();
    
    // Store with timestamp
    await chrome.storage.local.set({ cryptoPrices: { data, ts: Date.now() } });
    console.log("[Faucet] Crypto prices updated:", data);
  } catch (err) {
    console.warn("[Faucet] Failed to fetch crypto prices:", err.message);
  }
}

// Periodically update prices (every 15 minutes)
chrome.alarms.create("price-update", { periodInMinutes: 15 });
// Astra Synchronization: Every 12 hours
chrome.alarms.create("protocol-sync", { periodInMinutes: 720 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "price-update") fetchPrices();
  if (alarm.name === "protocol-sync") checkProtocolUpdates();
});

fetchPrices(); // Initial fetch
checkProtocolUpdates(); // Initial fetch

// ── Message handling (cont.) ─────────────────────────────────────────────────

async function handleMessage(msg, sender) {
  // ── Scraped minimum withdrawal ──
  if (msg.type === "scraped-min-wd") {
    const { minWdThresholds = {} } = await chrome.storage.local.get("minWdThresholds");
    const host = hostKey(msg.url);
    if (host && msg.value) {
      minWdThresholds[host] = msg.value;
      await chrome.storage.local.set({ minWdThresholds });
      console.log(`[Faucet] Stored min threshold for ${host}: ${msg.value}`);
    }
    return;
  }

  // ── Popup messages (no tab) ──────────────────────────────────────────────
  if (msg.type === "manual-run") {
    // Reset claimHistory for all active faucets so they are treated as due
    const { claimHistory = {} } = await chrome.storage.local.get("claimHistory");
    const s = await getSettings();
    for (const f of s.faucets) { if (f.active !== false) claimHistory[f.url] = 0; }
    await chrome.storage.local.set({ claimHistory });
    requestCheckAndRun(true);
    return;
  }

  if (msg.type === "save-settings") {
    const old = await getSettings();
    await chrome.storage.local.set({ settings: { ...old, ...msg.settings } });
    const s = await getSettings();
    if (s.enabled) {
      await chrome.storage.local.set({ running: true });
      ensureTickAlarm();
      requestCheckAndRun();
    }
    else { 
      await stopAllActivity(); // Use the new comprehensive stop
    }
    log("[Faucet] Settings saved");
    return;
  }

  if (msg.type === "stop-all-activity") {
    await stopAllActivity();
    return;
  }

  if (msg.type === "manual-dice-run") {
    const s = await getSettings();
    const faucet = s.faucets.find(f => f.active !== false) || s.faucets[0];
    const diceUrl = `${faucet.url.replace(/\/$/, "")}/dice.php#manual`; // Append #manual token
    
    const tab = await chrome.tabs.create({ url: diceUrl, active: true });
    const { activeTabs = {} } = await chrome.storage.local.get("activeTabs");
    activeTabs[tab.id] = {
      faucetUrl: faucet.url,
      phase: "dice",
      manualMode: true, // NEW: Ensures the tab doesn't close automatically
      startedAt: Date.now(),
      phaseStartedAt: Date.now()
    };
    await chrome.storage.local.set({ activeTabs });
    log(`[Faucet] Manual dice run started for ${faucet.label}`);
    return;
  }

  if (msg.type === "reset-all-sites") {
    // Reset to factory defaults with first site enabled, clear all runtime state
    const faucets = makeFaucetDefaults();
    faucets[0].active = true; // enable litepick as a starting point
    const defaultSettings = { enabled: true, faucets };
    await chrome.storage.local.set({ settings: defaultSettings, claimHistory: {}, claimQueue: [], activeTabs: {}, running: true });
    ensureTickAlarm();
    requestCheckAndRun(true);
    log("[Faucet] All sites reset to enabled with cleared history");
    return;
  }

  // ── Content-script messages (require a known tab) ────────────────────────
  const tabId = sender.tab?.id;
  if (!tabId) return;

  const { activeTabs = {}, claimHistory = {} } = await chrome.storage.local.get(["activeTabs", "claimHistory"]);
  const tabData = activeTabs[tabId];
  if (!tabData) return; // not our tab

  if (msg.type === "phase-heartbeat") {
    activeTabs[tabId] = {
      ...tabData,
      phaseStartedAt: Date.now(),
      lastHeartbeatAt: Date.now()
    };
    await chrome.storage.local.set({ activeTabs });
    return;
  }

  const s   = await getSettings();
  const cfg = s.faucets.find(f => sameHost(f.url, tabData.faucetUrl));

  // ── faucet-done / faucet-error ────────────────────────────────────────────
  if (msg.type === "faucet-done" || msg.type === "faucet-error") {
    if (msg.type === "faucet-error") {
      log("[Faucet]", tabData.faucetUrl, "error:", msg.reason || "unknown");
      await appendLog({ url: tabData.faucetUrl, status: "error", reason: msg.reason, balance: msg.balance, ts: Date.now() });
    } else {
      log("[Faucet]", tabData.faucetUrl, "done.", "Balance:", msg.balance);
      await appendLog({ url: tabData.faucetUrl, status: "ok", reason: msg.reason, balance: msg.balance, ts: Date.now() });

      const { claimCounts = {} } = await chrome.storage.local.get("claimCounts");
      claimCounts[tabData.faucetUrl] = (claimCounts[tabData.faucetUrl] || 0) + 1;
      await chrome.storage.local.set({ claimCounts });

      // Unified Withdrawal Threshold Check (Dice or Standard)
      const threshold = parseFloat(cfg?.wdThreshold);
      const isAboveThreshold = !isNaN(threshold) && threshold > 0 && msg.balance >= threshold;

      if (cfg?.wdEnabled && cfg?.wdAddress && isAboveThreshold) {
        log(`[Faucet] Above Threshold (${threshold}). Moving to withdrawal.`);
        activeTabs[tabId] = { ...tabData, phase: "withdraw", wdAddress: cfg.wdAddress, phaseStartedAt: Date.now() };
        await chrome.storage.local.set({ activeTabs });
        chrome.tabs.update(tabId, { url: getWithdrawUrl(cfg) });
        return;
      }
    }

    if (cfg) claimHistory[cfg.url] = Date.now();
    await chrome.storage.local.set({ claimHistory });

    // Check for manualMode flag OR #manual hash in the tab URL
    const isManualTab = tabData.manualMode || (sender.tab?.url && sender.tab.url.includes("#manual"));
    
    if (isManualTab) {
      log("[Faucet] Manual session complete (#manual). Keeping tab open for user.");
      delete activeTabs[tabId];
      await chrome.storage.local.set({ activeTabs });
      return;
    }

    await closeTab(tabId);
    
    // Check for next due faucet in queue
    log("[Faucet] Site cycle complete, checking queue...");
    await requestCheckAndRun();
    return;
  }

  // ── withdraw-done / withdraw-error ────────────────────────────────────────
  if (msg.type === "withdraw-done" || msg.type === "withdraw-error") {
    console.log("[Faucet] Withdraw", msg.type);
    await appendLog({ url: tabData.faucetUrl, status: msg.type === "withdraw-done" ? "wd-ok" : "wd-error", reason: msg.reason, ts: Date.now() });
    if (cfg) claimHistory[cfg.url] = Date.now();
    await chrome.storage.local.set({ claimHistory });
    await closeTab(tabId);
    
    // Check for next due faucet in queue
    console.log("[Faucet] Withdrawal complete, checking for next in queue");
    await requestCheckAndRun();
    return;
  }
}

// ── Astra Synchronization Protocol (Auto-Update) ───────────────────────────────

const PROTOCOL_MANIFEST_URL = "https://raw.githubusercontent.com/sushiomsky/faucetplugin/main/version.json";

async function checkProtocolUpdates() {
  try {
    const localVersion = chrome.runtime.getManifest().version;
    const resp = await fetch(`${PROTOCOL_MANIFEST_URL}?t=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
    const remote = await resp.json();

    if (isNewerVersion(remote.version, localVersion)) {
      console.log(`[Astra] Protocol Update Available: v${remote.version} (Local: v${localVersion})`);
      await chrome.storage.local.set({ 
        updateAvailable: true, 
        updateVersion: remote.version, 
        updateUrl: remote.download_url 
      });
      sendTelegramAlert(`🚀 *Astra Protocol Update Ready (v${remote.version})*\n\nNew optimization features and anti-detection headers are available for synchronization.\n\n*Local Version:* v${localVersion}\n*Download:* [Latest Release](${remote.download_url || "https://github.com/sushiomsky/faucetplugin"})`);
    } else {
      await chrome.storage.local.set({ updateAvailable: false });
      console.log(`[Astra] Protocol is synchronized (v${localVersion})`);
    }
  } catch (err) {
    console.warn("[Astra] Synchronization check failed:", err.message);
  }
}

function isNewerVersion(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (r[i] > l[i]) return true;
    if (r[i] < l[i]) return false;
  }
  return false;
}

// ── Withdrawal Threshold Sync ──────────────────────────────────────────────────
async function checkWithdrawalMinimums() {
  console.log("[Faucet] Checking withdrawal minimums...");
  const s = await getSettings();
  if (!s.enabled) return;

  let changed = false;
  for (const f of s.faucets) {
    if (f.active === false) continue;
    if (f.wdThresholdIsManual) continue;

    try {
      const baseUrl = f.url.replace(/\/$/, '');
      const testUrl = `${baseUrl}/withdrawal.php?_t=${Date.now()}`;
      const resp = await fetch(testUrl, { credentials: 'include', redirect: 'follow', cache: 'no-cache' });
      if (!resp.ok) continue;

      const html = await resp.text();
      let detectedMin = null;
      for (const p of SCRAPE_WD_MIN_PATTERNS) {
        const m = html.match(p);
        if (m && m[1]) {
          detectedMin = m[1].replace(',', '');
          break;
        }
      }
      
      if (detectedMin) {
        f.wdMinDetected = detectedMin; // Always update detected value
        
        if (!f.wdThresholdIsManual && f.wdThreshold !== detectedMin) {
          console.log(`[Faucet] Updating threshold for ${f.url}: ${f.wdThreshold} -> ${detectedMin}`);
          f.wdThreshold = detectedMin;
          changed = true;
        } else if (f.wdThresholdIsManual) {
          changed = true; // Still save if we updated wdMinDetected
        }
      }
    } catch (e) {
      console.warn(`[Faucet] Failed to fetch min for ${f.url}:`, e.message);
    }
  }

  if (changed) {
    await chrome.storage.local.set({ settings: s });
  }
}

// Initial checks
checkProtocolUpdates();
checkWithdrawalMinimums();

// Set alarms for periodic checks
chrome.alarms.create("protocol-sync", { periodInMinutes: 60 });
chrome.alarms.create("threshold-sync", { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "protocol-sync") checkProtocolUpdates();
  if (alarm.name === "threshold-sync") checkWithdrawalMinimums();
});
