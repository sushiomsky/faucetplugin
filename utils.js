(function() {
// ── utils.js ──────────────────────────────────────────────────────────────
window.__FP_POLL_MS            = 500;
window.__FP_MAX_WAIT_MS        = 90000;
window.POST_CLAIM_WAIT_MS = 5000;
window.POST_WD_WAIT_MS    = 5000;
window.RANDOM_DELAY_MIN_MS = 15000;
window.RANDOM_DELAY_MAX_MS = 60000;

window.LOGIN_FORM_WAIT_MS = 20000;
window.INPUT_SETTLE_MS    = 500;
window.CAPTCHA_SETTLE_MS  = 1000;
window.__FP_RETRY_MS   = 5000;
window.MAX_CAPTCHA_RETRIES = 60;
window.NATIVE_CLICK_MIN_INTERVAL_MS = 900;
window.DICE_FIXED_MULTIPLIER = 2.0;
window.MIN_STARTING_BALANCE_BET_FRACTION = 0.10;
window.PHASE_HEARTBEAT_INTERVAL_MS = 15000;
window.FAUCET_HANG_TO_DICE_TIMEOUT_MS = 60 * 1000;
window.DEFAULT_ALL_IN_CHANCE_PERCENT = 1;
window.RANDOM_14_CHANCE_PERCENT = 14;
window.RANDOM_14_MIN_BET_INTERVAL = 5;
window.RANDOM_14_MAX_BET_INTERVAL = 20;
window.RANDOM_14_STATE_STORAGE_KEY = "diceRandom14State";

window.lastNativeClickAt = 0;
window.lastPhaseHeartbeatAt = 0;

window.DEBUG = false; 
window.log = function log(...a) {
  if (window.DEBUG) {
    console.log("[FaucetPick]", ...a);
  }
}
window.sleep = function sleep(ms) {
  return new Promise(function resolveSleep(resolveSleepPromise) {
    setTimeout(resolveSleepPromise, ms);
  });
}

window.sameHost = function sameHost(url1, url2) {
  try {
    return new URL(url1).hostname === new URL(url2).hostname;
  } catch {
    return url1 === url2;
  }
}

function randomDelay() {
  return window.RANDOM_DELAY_MIN_MS + Math.random() * (window.RANDOM_DELAY_MAX_MS - window.RANDOM_DELAY_MIN_MS);
}

function randomIntInclusive(min, max) {
  const safeMin = Math.ceil(Math.min(min, max));
  const safeMax = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function getUsdFiveWdThresholdForHost(host) {
  const fallback = DEFAULT_USD5_WD_THRESHOLD_BY_HOST[normalizeHost(host)] || "5";
  const parsed = parseFloat(fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function normalizeWdThresholdForHost(host, rawThreshold) {
  const fallback = getUsdFiveWdThresholdForHost(host);
  const parsed = parseFloat(rawThreshold);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getDicePageUrl() {
  try {
    return new URL(location.href).origin + "/dice.php";
  } catch {
    return "/dice.php";
  }
}

window.scrollToBottom = function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  const main = document.querySelector("main, .container, #content, #wrap");
  if (main) main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
}

window.sendDone = function sendDone(balance)   { chrome.runtime.sendMessage({ type: "faucet-done",   balance }); }
window.sendError = function sendError(reason)   { chrome.runtime.sendMessage({ type: "faucet-error",  reason }); }
window.sendWdDone = function sendWdDone()        { chrome.runtime.sendMessage({ type: "withdraw-done" }); }
window.sendWdError = function sendWdError(reason) { chrome.runtime.sendMessage({ type: "withdraw-error", reason }); }

window.sendPhaseHeartbeat = function sendPhaseHeartbeat(detail = "") {
  const now = Date.now();
  if (now - window.lastPhaseHeartbeatAt < window.PHASE_HEARTBEAT_INTERVAL_MS) return;
  window.lastPhaseHeartbeatAt = now;
  chrome.runtime.sendMessage({ type: "phase-heartbeat", phase: "faucet", detail, ts: now });
}

async window.isPluginTab = function isPluginTab() {
  if (location.hash === "#manual") return true;
  
  // Retry 5 times with 500ms intervals (2.5s total) to allow background/storage sync
  for (let attempt = 1; attempt <= 5; attempt++) {
    const isReady = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "check-plugin-tab" }, (resp) => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        resolve(resp?.yes === true);
      });
    });

    if (isReady) {
      if (attempt > 1) log(`✓ Plugin Tab Verified on attempt ${attempt}`);
      return true;
    }
    
    if (attempt < 5) {
      log(`⚠️ Plugin Tab Verification attempt ${attempt} failed, retrying in 500ms...`);
      await sleep(500);
    }
  }

  return false;
}

window.getWithdrawInfo = function getWithdrawInfo() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "get-withdraw-info" }, (resp) => {
      if (chrome.runtime.lastError) { resolve({ isWithdrawTab: false, address: "" }); return; }
      resolve(resp || { isWithdrawTab: false, address: "" });
    });
  });
}

window.getCurrentTabState = function getCurrentTabState() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "get-tab-state" }, (resp) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(resp?.tabState || null);
    });
  });
}

window.isFaucetPage = window.isFaucetPage = function isFaucetPage()   { return location.pathname.includes("faucet.php"); }
window.isWithdrawPage = function isWithdrawPage() { return /withdraw/i.test(location.pathname); }
window.isDicebetPage = window.isDicebetPage = function isDicebetPage()  { return location.pathname.includes("dice.php") || /dice|dicebet/i.test(location.pathname); }
window.hasLoginForm = function hasLoginForm()   { 
  try {
    return !!document.querySelector('input[type="password"]'); 
  } catch (_) { return false; }
}

window.parseNumericValue = function parseNumericValue(rawText) {
  if (typeof rawText !== "string") return null;
  const cleaned = rawText.replace(/,/g, "");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

window.readBalance = function readBalance() {
  const els = [
    ...__FP_Selectors.getAllValid("balance"),
    ...__FP_Selectors.getAllValid("balancePrimary"),
    ...__FP_Selectors.getAllValid("balanceFallback")
  ];
  
  for (const el of els) {
    const value = parseNumericValue(el.textContent?.trim() || "");
    if (value != null) return value;
  }
  return null;
}

async window.getFaucetUrl = function getFaucetUrl() {
  const tabState = await getCurrentTabState();
  if (tabState?.faucetUrl) return tabState.faucetUrl;
  return location.origin + '/faucet.php';
}
})();
