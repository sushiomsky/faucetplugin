// ── Faucet content script ──────────────────────────────────────────────────
// Runs on all *.pick.io pages. Only acts when the tab was opened by the plugin
// (guard prevents automating manual visits).
//
// Flow:
//   login page   → fill creds + captcha → submit
//   faucet page  → captcha → click Claim → read balance → (auto-withdraw if needed)
//   withdraw page→ fill address + captcha → submit
//
// Shared constants and utilities (normalizeHost, toFiniteNumber, clampNumber,
// normalizeDiceSide, normalizeDbStrategy, normalizeDbChance, normalizeHighRollerConfig,
// DEFAULT_USD5_WD_THRESHOLD_BY_HOST, WD_THRESHOLD_MIGRATION_BY_HOST,
// DICE_STRATEGY_ALL_IN_001, DICE_STRATEGY_COMBINED_HIGH_ROLLER, DEFAULT_DB_STRATEGY,
// DEFAULT_HIGH_ROLLER_CONFIG) are loaded from constants.js (injected first).

const POLL_MS            = 500;
const MAX_WAIT_MS        = 90000;
const POST_CLAIM_WAIT_MS = 5000;
const POST_WD_WAIT_MS    = 5000;
const RANDOM_DELAY_MIN_MS = 15000;  // 15 seconds
const RANDOM_DELAY_MAX_MS = 60000;  // 60 seconds

// Enhanced reliability settings for login and captcha
const LOGIN_FORM_WAIT_MS = 20000;   // Wait for login fields to appear
const INPUT_SETTLE_MS    = 500;     // Time for form to settle after filling
const CAPTCHA_SETTLE_MS  = 1000;    // Time for captcha widget to settle
const CAPTCHA_RETRY_MS   = 1500;    // Retry captcha click every 1.5 seconds
const MAX_CAPTCHA_RETRIES = 60;     // Keep trying through longer challenge loads
const NATIVE_CLICK_MIN_INTERVAL_MS = 900;
const DICE_FIXED_MULTIPLIER = 2.0;
const MIN_STARTING_BALANCE_BET_FRACTION = 0.10;
const PHASE_HEARTBEAT_INTERVAL_MS = 15000;
const FAUCET_HANG_TO_DICE_TIMEOUT_MS = 60 * 1000;
const DEFAULT_ALL_IN_CHANCE_PERCENT = 1;
const RANDOM_14_CHANCE_PERCENT = 14;
const RANDOM_14_MIN_BET_INTERVAL = 5;
const RANDOM_14_MAX_BET_INTERVAL = 20;
const RANDOM_14_STATE_STORAGE_KEY = "diceRandom14State";

let lastNativeClickAt = 0;
let lastPhaseHeartbeatAt = 0;

function log(...a) { console.log("[FaucetPlugin]", ...a); }
function sleep(ms) {
  return new Promise(function resolveSleep(resolveSleepPromise) {
    setTimeout(resolveSleepPromise, ms);
  });
}

function sameHost(url1, url2) {
  try {
    const host1 = new URL(url1).hostname;
    const host2 = new URL(url2).hostname;
    return host1 === host2;
  } catch {
    return url1 === url2;
  }
}

// Generate random delay between 15-60 seconds to avoid detection
function randomDelay() {
  return RANDOM_DELAY_MIN_MS + Math.random() * (RANDOM_DELAY_MAX_MS - RANDOM_DELAY_MIN_MS);
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

  const hostKey = normalizeHost(host);
  const migrationCandidates = WD_THRESHOLD_MIGRATION_BY_HOST[hostKey] || [];
  for (const candidateRaw of migrationCandidates) {
    const candidateParsed = parseFloat(candidateRaw);
    if (Number.isFinite(candidateParsed) && Math.abs(parsed - candidateParsed) < 1e-12) {
      return fallback;
    }
  }

  return parsed;
}

function getDicePageUrl() {
  try {
    return new URL(location.href).origin + "/dice.php";
  } catch {
    return "/dice.php";
  }
}

async function loadRandom14Schedule(hostname) {
  const hostKey = normalizeHost(hostname || location.hostname);
  const stored = await chrome.storage.local.get(RANDOM_14_STATE_STORAGE_KEY);
  const allState = stored?.[RANDOM_14_STATE_STORAGE_KEY];
  const hostState = allState && typeof allState === "object" ? allState[hostKey] : null;

  const settledBetCount = Math.max(0, Math.round(Number(hostState?.settledBetCount) || 0));
  const parsedNext = Number(hostState?.nextRandom14BetAt);
  let nextRandom14BetAt = Number.isFinite(parsedNext) && parsedNext > 0
    ? Math.max(1, Math.round(parsedNext))
    : 0;
  if (nextRandom14BetAt <= settledBetCount) {
    nextRandom14BetAt = settledBetCount + randomIntInclusive(RANDOM_14_MIN_BET_INTERVAL, RANDOM_14_MAX_BET_INTERVAL);
  }

  return { hostKey, settledBetCount, nextRandom14BetAt };
}

async function persistRandom14Schedule(hostKey, settledBetCount, nextRandom14BetAt) {
  const stored = await chrome.storage.local.get(RANDOM_14_STATE_STORAGE_KEY);
  const currentState = stored?.[RANDOM_14_STATE_STORAGE_KEY];
  const allState = currentState && typeof currentState === "object" ? { ...currentState } : {};
  allState[hostKey] = {
    settledBetCount: Math.max(0, Math.round(Number(settledBetCount) || 0)),
    nextRandom14BetAt: Math.max(1, Math.round(Number(nextRandom14BetAt) || 1)),
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ [RANDOM_14_STATE_STORAGE_KEY]: allState });
}

function sendDone(balance)   { chrome.runtime.sendMessage({ type: "faucet-done",   balance }); }
function sendError(reason)   { chrome.runtime.sendMessage({ type: "faucet-error",  reason }); }
function sendWdDone()        { chrome.runtime.sendMessage({ type: "withdraw-done" }); }
function sendWdError(reason) { chrome.runtime.sendMessage({ type: "withdraw-error", reason }); }

function sendPhaseHeartbeat(detail = "") {
  const now = Date.now();
  if (now - lastPhaseHeartbeatAt < PHASE_HEARTBEAT_INTERVAL_MS) return;
  lastPhaseHeartbeatAt = now;
  chrome.runtime.sendMessage({ type: "phase-heartbeat", phase: "faucet", detail, ts: now });
}

// ── Plugin-tab guard ──────────────────────────────────────────────────────────
// Prevents the script from running when the user opens a faucet page manually.

function isPluginTab() {
  // Retry up to 6 times (3s total) to handle the race where background
  // hasn't stored the tabId yet when the content script first runs.
  return new Promise(resolve => {
    let attempts = 0;
    function handlePluginTabCheckResponse(resp) {
      if (chrome.runtime.lastError) { resolve(false); return; }
      if (resp?.yes === true) { resolve(true); return; }
      attempts++;
      if (attempts < 6) setTimeout(attempt, 500);
      else resolve(false);
    }
    function attempt() {
      chrome.runtime.sendMessage({ type: "check-plugin-tab" }, handlePluginTabCheckResponse);
    }
    attempt();
  });
}

function getWithdrawInfo() {
  return new Promise(resolve => {
    function handleWithdrawInfoResponse(resp) {
      if (chrome.runtime.lastError) { resolve({ isWithdrawTab: false, address: "" }); return; }
      resolve(resp || { isWithdrawTab: false, address: "" });
    }
    chrome.runtime.sendMessage({ type: "get-withdraw-info" }, handleWithdrawInfoResponse);
  });
}

function getCurrentTabState() {
  return new Promise(resolve => {
    function handleTabStateResponse(resp) {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(resp?.tabState || null);
    }
    chrome.runtime.sendMessage({ type: "get-tab-state" }, handleTabStateResponse);
  });
}

// ── Page-type detection ───────────────────────────────────────────────────────

function isFaucetPage()   { return location.pathname.includes("faucet.php"); }
function isWithdrawPage() { return /withdraw/i.test(location.pathname); }
function isDicebetPage()  { return location.pathname.includes("dice.php") || /dice|dicebet/i.test(location.pathname); }
function hasLoginForm()   { return !!document.querySelector('input[type="password"]'); }

function startDiceHangWatchdog(diceEnabled) {
  if (!diceEnabled) return () => {};

  let active = true;
  const timerId = setTimeout(async () => {
    if (!active) return;
    if (!isFaucetPage() || isDicebetPage() || isWithdrawPage()) return;

    const pluginTab = await isPluginTab();
    if (!pluginTab) return;

    const diceUrl = getDicePageUrl();
    log(`Faucet flow exceeded ${(FAUCET_HANG_TO_DICE_TIMEOUT_MS / 1000).toFixed(0)}s — forcing DiceBet load: ${diceUrl}`);
    sendPhaseHeartbeat("faucet-hang-timeout-to-dice");
    window.location.href = diceUrl;
  }, FAUCET_HANG_TO_DICE_TIMEOUT_MS);

  return () => {
    active = false;
    clearTimeout(timerId);
  };
}

// ── Credentials from storage ──────────────────────────────────────────────────

async function getCredentials() {
  const { settings } = await chrome.storage.local.get("settings");
  const faucets = settings?.faucets || [];
  const faucet = faucets.find(f => {
    try { return new URL(f.url).hostname === location.hostname; } catch { return false; }
  });
  // faucet may be missing from stored settings if added after initial install
  return { username: faucet?.username || "", password: faucet?.password || "" };
}

function triggerInputEvents(input) {
  if (!input) return;
  input.dispatchEvent(new Event("input",  { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur",   { bubbles: true }));
}

function fillInput(input, value) {
  if (!input) return;
  input.focus();
  input.value = value;
  triggerInputEvents(input);
}

async function waitForPasswordManagerAutofill(userInput, pwdInput, timeoutMs = 15000) {
  const started = Date.now();
  let nudged = false;

  while (Date.now() - started < timeoutMs) {
    const username = userInput?.value?.trim() || "";
    const password = pwdInput?.value?.trim() || "";

    if (password) return { username, password };

    // Nudge once: focusing fields often triggers browser autofill on supported forms.
    if (!nudged) {
      if (userInput) userInput.focus();
      await sleep(200);
      if (pwdInput) pwdInput.focus();
      nudged = true;
    }

    await sleep(300);
  }

  return null;
}

// ── Scrolling ─────────────────────────────────────────────────────────────────

function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  const main = document.querySelector("main, .container, #content, #wrap");
  if (main) main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
}

// ── Captcha handling ──────────────────────────────────────────────────────────

function getCaptchaToken() {
  // Turnstile / hCaptcha / reCaptcha
  const el = document.querySelector(
    'input[name="cf-turnstile-response"], ' +
    'input[name="h-captcha-response"], ' +
    'input[name="g-recaptcha-response"]'
  );
  if (el && el.value) return el.value;

  // IconCaptcha — token input filled when user completes the icon challenge
  const ic = document.querySelector(
    'input[name="iconcaptcha-token"], ' +
    'input[name="ic-token"], ' +
    '.iconcaptcha-token'
  );
  if (ic && ic.value) return ic.value;

  // IconCaptcha completion state — widget gets a "passed" / "done" class
  if (document.querySelector('.iconcaptcha-holder.iconcaptcha-passed, .iconcaptcha-holder[data-completed="true"]'))
    return "iconcaptcha-passed";

  return null;
}

/**
 * Enhanced Turnstile captcha checkbox clicking.
 * Handles multiple widget types and tries multiple strategies.
 */
function isVisibleForClick(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function dispatchMouseEvent(el, type, x, y) {
  const EventCtor = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  const payload = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0
  };
  if (EventCtor === PointerEvent) {
    payload.pointerId = 1;
    payload.pointerType = "mouse";
    payload.isPrimary = true;
  }
  el.dispatchEvent(new EventCtor(type, payload));
}

function requestNativeClick(x, y, label) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const now = Date.now();
  if (now - lastNativeClickAt < NATIVE_CLICK_MIN_INTERVAL_MS) return;
  lastNativeClickAt = now;

  function handleNativeClickResponse(resp) {
    if (chrome.runtime.lastError) {
      log(`Native click message failed for ${label}: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (resp?.ok) {
      log(`Native click dispatched for ${label}`);
    } else if (resp?.error) {
      log(`Native click failed for ${label}: ${resp.error}`);
    }
  }

  chrome.runtime.sendMessage(
    { type: "native-click", x: Math.round(x), y: Math.round(y), label },
    handleNativeClickResponse
  );
}

function clickElementRobust(el, label) {
  if (!isVisibleForClick(el)) return false;

  try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (_) {}
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  let target = document.elementFromPoint(x, y) || el;

  try { if (target.focus) target.focus({ preventScroll: true }); } catch (_) {
    try { if (target.focus) target.focus(); } catch (_) {}
  }

  for (const evt of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    try { dispatchMouseEvent(target, evt, x, y); } catch (_) {}
  }

  try { target.click(); } catch (_) {}
  if (target !== el) {
    try { el.click(); } catch (_) {}
  }

  requestNativeClick(x, y, label);

  log(`Clicked ${label}`);
  return true;
}

function tryClickCaptchaWidget() {
  // Strategy 1: Click explicit Turnstile iframes (most common rendering path)
  const turnstileFrames = [
    ...document.querySelectorAll('iframe[src*="challenges.cloudflare.com"][src*="turnstile"]'),
    ...document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]'),
    ...document.querySelectorAll('iframe[src*="turnstile"]'),
    ...document.querySelectorAll('iframe[src*="captcha"]'),
    ...document.querySelectorAll('iframe[title*="turnstile" i]')
  ];
  for (const frame of turnstileFrames) {
    if (clickElementRobust(frame, "Turnstile iframe")) return true;
  }

  // Strategy 2: Click Turnstile checkbox directly when present in DOM
  const turnstileCheckboxes = [
    ...document.querySelectorAll('.cf-turnstile input[type="checkbox"]'),
    ...document.querySelectorAll('input[type="checkbox"][name*="turnstile" i]')
  ];
  for (const checkbox of turnstileCheckboxes) {
    if (checkbox.checked) continue;
    if (clickElementRobust(checkbox, "Turnstile checkbox")) return true;
  }

  // Strategy 3: Click Turnstile container
  let widget = document.querySelector('.cf-turnstile, [id*="turnstile" i], [class*="turnstile" i], [data-turnstile-callback]');
  if (widget && clickElementRobust(widget, "Turnstile container")) {
    return true;
  }

  // Strategy 4: Try hCaptcha
  widget = document.querySelector('.h-captcha');
  if (widget && clickElementRobust(widget, "hCaptcha widget")) {
    return true;
  }

  // Strategy 5: Look for any element with data-sitekey (generic captcha container)
  widget = document.querySelector('[data-sitekey]');
  if (widget && clickElementRobust(widget, "generic captcha container")) {
    return true;
  }

  // Strategy 6: Look for invisible Turnstile (no visible checkbox)
  // Try to trigger it by clicking on the page
  let invisibleTurnstile = document.querySelector('[data-turnstile-callback], [id*="turnstile"]');
  if (invisibleTurnstile && clickElementRobust(invisibleTurnstile, "invisible Turnstile trigger")) {
    return true;
  }

  // Strategy 7: IconCaptcha
  widget = document.querySelector('.iconcaptcha-holder');
  if (widget && clickElementRobust(widget, "IconCaptcha widget")) {
    return true;
  }

  log("No captcha widget found to click");
  return false;
}

function hasCaptchaWidget() {
  return !!(
    document.querySelector('.cf-turnstile, .h-captcha, [data-sitekey], .iconcaptcha-holder, [data-turnstile-callback], [id*="turnstile" i], [class*="turnstile" i]') ||
    document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="captcha"], iframe[title*="turnstile" i], iframe[src*="hcaptcha.com"]') ||
    document.querySelector('input[name="cf-turnstile-response"], input[name="h-captcha-response"], input[name="g-recaptcha-response"], input[name="iconcaptcha-token"], input[name="ic-token"]')
  );
}

/**
 * Enhanced captcha token waiting with multiple retry strategies.
 * More reliable Turnstile/hCaptcha handling.
 */
function waitForCaptchaToken(timeoutMs = MAX_WAIT_MS) {
  return new Promise(function waitForCaptchaTokenPromise(resolveCaptchaToken) {
    const start = Date.now();
    let clickAttempts = 0;
    let lastClickTime = 0;
    let lastFocusTime = 0;
    const maxClickAttempts = Math.max(MAX_CAPTCHA_RETRIES, Math.ceil(timeoutMs / CAPTCHA_RETRY_MS));
    let timer = null;

    log(`Waiting for captcha token (timeout: ${timeoutMs}ms)...`);

    function pollCaptchaToken() {
      const token = getCaptchaToken();
      if (token) {
        log(`✓ Captcha token obtained after ${Date.now() - start}ms`);
        clearInterval(timer);
        resolveCaptchaToken(token);
        return;
      }

      const elapsed = Date.now() - start;
      const now = Date.now();

      if (now - lastFocusTime >= 10000) {
        chrome.runtime.sendMessage({ type: "focus-tab" });
        lastFocusTime = now;
      }

      // Periodically try clicking the captcha widget
      if (now - lastClickTime >= CAPTCHA_RETRY_MS && clickAttempts < maxClickAttempts) {
        const clicked = tryClickCaptchaWidget();
        if (clicked) {
          lastClickTime = now;
          clickAttempts++;
          log(`Captcha click attempt ${clickAttempts}/${maxClickAttempts}`);
        }
      }

      // Timeout check
      if (elapsed > timeoutMs) {
        log(`✗ Captcha timeout after ${elapsed}ms (${clickAttempts} click attempts)`);
        clearInterval(timer);
        resolveCaptchaToken(null);
      }
    }

    timer = setInterval(pollCaptchaToken, POLL_MS);
  });
}

// ── Balance detection ─────────────────────────────────────────────────────────

function parseNumericValue(rawText) {
  if (typeof rawText !== "string") return null;
  const cleaned = rawText.replace(/,/g, "");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

function readBalance() {
  const preferredSelectors = [
    "#game_dice .user_balance",
    ".user_balance",
    "#game_dice [class*='balance' i]",
    "#game_dice [id*='balance' i]"
  ];

  for (const sel of preferredSelectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const value = parseNumericValue(el.textContent?.trim() || "");
    if (value != null) return value;
  }

  const selectors = [
    '[class*="balance"]', '[id*="balance"]',
    '[class*="wallet"]',  '[id*="wallet"]',
    '[class*="amount"]',  '[id*="amount"]',
    '.bal', '#bal'
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const value = parseNumericValue(el.textContent?.trim() || "");
      if (value != null) return value;
    }
  }
  return null;
}

// ── Auto-capture login credentials ─────────────────────────────────────────────
// When user logs in manually without stored credentials, capture and save them

function setupManualLoginCapture() {
  // Listen for form submission
  const forms = document.querySelectorAll('form');
  for (const form of forms) {
    if (!form.querySelector('input[type="password"]')) continue; // not a login form
    
    async function onManualLoginSubmit() {
      // Get the input values before submission
      const userInput =
        form.querySelector('input[type="email"]')   ||
        form.querySelector('input[name*="user"]')   ||
        form.querySelector('input[name*="email"]')  ||
        form.querySelector('input[name*="login"]')  ||
        form.querySelector('input[type="text"]');
      
      const pwdInput = form.querySelector('input[type="password"]');
      
      const username = userInput?.value?.trim();
      const password = pwdInput?.value?.trim();
      
      if (username && password) {
        log(`Captured credentials from manual login: ${username}`);
        
        // Save to chrome storage for this site
        const faucetUrl = await getFaucetUrl();
        const { settings = {} } = await chrome.storage.local.get('settings');
        
        if (settings.faucets) {
          const faucet = settings.faucets.find(f => sameHost(f.url, faucetUrl));
          if (faucet) {
            faucet.username = username;
            faucet.password = password;
            await chrome.storage.local.set({ settings });
            log(`✓ Stored credentials for ${faucet.label}`);
          }
        }
      }
    }

    form.addEventListener('submit', onManualLoginSubmit, { once: true }); // only listen once
  }
}

async function getFaucetUrl() {
  const tabState = await getCurrentTabState();
  if (tabState?.faucetUrl) return tabState.faucetUrl;
  return location.origin + '/faucet.php';
}

// ── Login flow ────────────────────────────────────────────────────────────────

async function runLogin() {
  log("Login page:", location.href);

  await sleep(1500);
  scrollToBottom();
  await sleep(800);

  // Wait for login inputs to appear (some sites don't wrap them in a <form>)
  let form = null;
  let loginScope = null;
  let pwdInput = null;
  let attemptCount = 0;
  const maxAttempts = Math.ceil(LOGIN_FORM_WAIT_MS / 500);

  for (let i = 0; i < maxAttempts; i++) {
    form = [...document.querySelectorAll("form")].find(f => f.querySelector('input[type="password"]'));
    pwdInput = form?.querySelector('input[type="password"]') || document.querySelector('input[type="password"]');

    if (pwdInput) {
      loginScope = form || pwdInput.closest("form") || document;
      log(`✓ Login inputs found on attempt ${i + 1}/${maxAttempts} (${loginScope === document ? "document scope" : "form scope"})`);
      break;
    }
    attemptCount = i + 1;
    await sleep(500);
  }

  if (!pwdInput) {
    log(`✗ Password input not found after ${attemptCount} attempts (${attemptCount * 500}ms)`);
    sendError("no-password-input");
    return;
  }

  // Find username input with enhanced selector strategy
  const usernameSelector =
    'input[type="email"], ' +
    'input[name*="user" i], ' +
    'input[name*="email" i], ' +
    'input[name*="login" i], ' +
    'input[name*="account" i], ' +
    'input[name*="username" i], ' +
    'input[autocomplete="username" i], ' +
    'input[type="text"][name]:not([readonly]), ' +
    'input[type="text"]';
  const userInput =
    loginScope.querySelector(usernameSelector) ||
    document.querySelector(usernameSelector);

  const creds = await getCredentials();
  const hasStoredCreds = !!(creds.username && creds.password);

  if (hasStoredCreds) {
    log("✓ Found extension-stored credentials, filling...");
    if (userInput) {
      fillInput(userInput, creds.username);
      await sleep(INPUT_SETTLE_MS);
    } else {
      log("Username input not found, continuing with password field only");
    }
    fillInput(pwdInput, creds.password);
    await sleep(INPUT_SETTLE_MS);
  } else {
    log("No extension credentials configured. Trying Chrome Password Manager autofill...");
    setupManualLoginCapture();

    const autofilled = await waitForPasswordManagerAutofill(userInput, pwdInput);
    if (!autofilled) {
      // No autofill available yet — let user login manually. We'll capture on submit.
      if (hasCaptchaWidget()) {
        log("Captcha present on login page, trying automatic checkbox click while waiting for manual login");
        chrome.runtime.sendMessage({ type: "focus-tab" });
        await sleep(400);
        tryClickCaptchaWidget();
      }
      log("No autofilled credentials detected — waiting for manual login");
      log("Manual login will be captured for future runs");
      return;
    }

    log(`✓ Using Chrome Password Manager autofill for ${autofilled.username || "saved account"}`);
    triggerInputEvents(userInput);
    triggerInputEvents(pwdInput);
    await sleep(INPUT_SETTLE_MS);
  }

  log("✓ Credentials filled, waiting for page to settle...");
  await sleep(CAPTCHA_SETTLE_MS);

  // Handle captcha if present
  if (hasCaptchaWidget()) {
    log("Captcha detected on login page");
    chrome.runtime.sendMessage({ type: "focus-tab" });
    await sleep(500); // Give tab time to focus

    // Try clicking captcha immediately and then let waitForCaptchaToken handle retries
    log("Attempting initial captcha click...");
    tryClickCaptchaWidget();
    await sleep(CAPTCHA_SETTLE_MS);

    const token = await waitForCaptchaToken(90000); // 90 second timeout for login
    if (!token) {
      log("✗ Login captcha timeout");
      sendError("login-captcha-timeout");
      return;
    }
    log("✓ Login captcha resolved");
  } else {
    log("No captcha on login page");
  }

  // Find and click submit button with enhanced selectors
  const submitBtn =
    loginScope.querySelector('button[type="submit"]:not([disabled])') ||
    loginScope.querySelector('button[type="submit"]') ||
    loginScope.querySelector('input[type="submit"]:not([disabled])') ||
    loginScope.querySelector('input[type="submit"]') ||
    [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"]')]
      .find(el => !el.disabled && /login|log in|sign in|submit|continue/i.test((el.textContent || el.value || "").trim())) ||
    loginScope.querySelector('button:not([disabled])') ||
    document.querySelector('button:not([disabled])');

  if (!submitBtn) {
    log("✗ Submit button not found");
    sendError("no-submit-button");
    return;
  }

  log(`✓ Found submit button: "${submitBtn.textContent?.trim() || submitBtn.value || 'Submit'}"`);
  log("Submitting login form...");
  
  // Ensure button is visible and clickable
  if (submitBtn.offsetParent === null) {
    log("Warning: Submit button is hidden, scrolling into view");
    submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(500);
  }

  if (!clickElementRobust(submitBtn, "login submit button")) {
    try { submitBtn.click(); } catch (_) {}
  }
  log("✓ Login form submitted");
  // Browser navigates → content script re-fires on faucet.php
  
  // Add random delay to avoid detection
  const delay = randomDelay();
  log(`Waiting ${(delay/1000).toFixed(1)}s before next action...`);
  await sleep(delay);
}

// ── Faucet claim flow ─────────────────────────────────────────────────────────

async function runFaucet() {
  log("Faucet page:", location.href);

  const dbConfig = await getDicebetConfig();
  const stopDiceHangWatchdog = startDiceHangWatchdog(dbConfig.enabled);

  await sleep(2000);

  try {
    // ── Normal claim first ──
    scrollToBottom();
    await sleep(1000);
    scrollToBottom();

    // Check if captcha is even present
    const hasCaptcha = hasCaptchaWidget();
    log("Captcha widget present:", hasCaptcha);

    if (hasCaptcha) {
      log("Captcha detected on faucet page, requesting tab focus...");
      chrome.runtime.sendMessage({ type: "focus-tab" });
      await sleep(500); // Give tab time to focus

      // Try initial click and let waitForCaptchaToken handle retries
      log("Attempting initial captcha widget click...");
      const clicked = tryClickCaptchaWidget();
      if (clicked) {
        log("Initial captcha click succeeded, waiting for response...");
        await sleep(CAPTCHA_SETTLE_MS);
      } else {
        log("Initial captcha click failed, will retry in waitForCaptchaToken...");
      }

      const token = await waitForCaptchaToken(MAX_WAIT_MS);
      if (!token) {
        log("✗ Captcha timeout on faucet page");
        sendError("turnstile-timeout");
        return;
      }
      log("✓ Captcha resolved");
    } else {
      log("No captcha detected — proceeding directly to claim");
    }

    const claimKeywords = ["claim", "collect", "roll", "submit", "get"];
    const selectors = [
      'button[type="submit"]', 'input[type="submit"]',
      'button.btn-claim', 'button.claim', '#claim',
      'button[onclick*="claim" i]', 'button[onclick*="roll" i]',
      'button[class*="claim"]', 'button[class*="submit"]',
      'a[onclick*="claim" i]', 'a[onclick*="roll" i]',
      'input[value*="claim" i]', 'input[value*="roll" i]',
      'button', 'input[type="button"]'
    ];
    let btn = null;
    outer: for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      log(`Searching with selector "${sel}" — found ${elements.length} element(s)`);
      for (const el of elements) {
        if (!el.offsetParent) continue; // skip hidden elements
        const text = (el.textContent || el.value || "").trim().toLowerCase();
        if (claimKeywords.some(k => text.includes(k))) {
          log(`✓ Matched selector "${sel}" with text "${text}"`);
          btn = el;
          break outer;
        }
      }
    }

    if (!btn) {
      log("WARNING: No claim button found with keyword matching");
      log("Trying fallback: any visible submit button");
      btn = document.querySelector('button[type="submit"], input[type="submit"]');
      if (btn) log(`Found fallback button: ${btn.textContent?.trim() || btn.value}`);
    }

    // Safety: don't submit a login form from the faucet flow
    if (!btn) {
      log("ERROR: No claim button found at all. Page structure might be different.");
      sendError("no-claim-button");
      return;
    }

    if (hasLoginForm()) {
      log("ERROR: Login form detected on faucet page. Aborting claim.");
      sendError("login-form-detected");
      return;
    }

    log("Clicking claim button:", btn.textContent?.trim() || btn.value);
    btn.click();

    await sleep(POST_CLAIM_WAIT_MS);

    // ── Bonus faucet claims after normal claim ──
    await claimBonusFaucets();

    const balance = readBalance();
    log("Balance after claim:", balance);

    // Check if dicebet is enabled and if balance was successfully extracted
    if (dbConfig.enabled && balance != null && balance > 0) {
      const diceUrl = getDicePageUrl();
      log(`DiceBet enabled, navigating to dice page: ${diceUrl}`);
      window.location.href = diceUrl;
      // Script continues via isPluginTab guard check in main()
      return;
    }

    // Add random delay before reporting completion
    const delay = randomDelay();
    log(`Claim completed, waiting ${(delay/1000).toFixed(1)}s before next action`);
    await sleep(delay);

    sendDone(balance);
  } finally {
    stopDiceHangWatchdog();
  }
}

// ── Bonus faucet loop ─────────────────────────────────────────────────────────
// The faucet page has a "Bonus Faucet" tab at the top. After the main claim:
//  1. Find and click the bonus tab to switch to that section.
//  2. Inside that section, loop: wait for captcha → click claim → repeat until
//     no visible claim button remains (i.e. all bonus claims exhausted).

const NO_MORE_PATTERNS = /no more|no bonus|all claimed|come back|no free|exhausted|used up|no spins|0 spins/i;

function bonusExhausted() {
  // Check badge is 0
  const badge = document.getElementById('free_spins');
  if (badge && parseInt(badge.textContent) <= 0) {
    log("Bonus exhausted: free_spins badge = 0");
    return true;
  }
  
  // Check for a visible "no more" message anywhere on page
  const msgEls = document.querySelectorAll('.alert, .message, .msg, .info, .notice, [class*="alert"], [class*="message"], [class*="result"], p, span, div');
  for (const el of msgEls) {
    if (!el.offsetParent) continue;
    if (el.children.length > 3) continue; // skip containers
    if (NO_MORE_PATTERNS.test(el.textContent)) {
      log(`Bonus exhausted: found message "${el.textContent.trim().substring(0, 50)}"`);
      return true;
    }
  }
  
  return false;
}


const CLAIM_KEYWORDS      = ["claim", "collect", "roll", "submit", "get", "spin"];

function findBonusTab() {
  // Try multiple selectors to find bonus tab
  const selectors = [
    '[data-type="bonus"].faucet-tab',
    '[data-type="bonus"]',
    'div[data-type="bonus"]',
    'a[data-type="bonus"]',
    '.faucet-tab[data-type="bonus"]',
    '[data-tab="bonus"]',
    'button[data-tab="bonus"]',
    '#bonus-tab',
    '.bonus-tab',
    'li[data-type="bonus"]',
    '[class*="bonus"][class*="tab"]'
  ];
  
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) {
      log(`Found bonus tab with selector: ${sel}`);
      return el;
    }
  }
  
  // Fallback: search ALL elements for text containing "bonus"
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (el.offsetParent === null) continue; // hidden
    if (el.children.length > 5) continue; // skip containers
    const text = el.textContent?.trim().toLowerCase() || '';
    if ((text === 'bonus' || text === 'bonus roll' || text === 'bonus faucet') && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
      // Found a bonus text - check if it's clickable (tab-like)
      if (el.onclick || el.getAttribute('data-tab') || el.className.includes('tab') || el.className.includes('nav')) {
        log(`Found bonus tab by text search (exact): "${el.textContent.trim()}"`);
        return el;
      }
    }
    if (/^bonus|bonus roll|bonus faucet|bonus spins|free spins/.test(text) && el.className.includes('tab')) {
      log(`Found bonus tab by text pattern: "${el.textContent.trim()}"`);
      return el;
    }
  }
  
  return null;
}

// Find a claim button in a specific container (for bonus section targeting)
function findClaimButtonInContext(context = document) {
  // Find a visible claim/submit button that is NOT disabled
  // Search within the context (default: whole page)
  for (const el of context.querySelectorAll('button, input[type="submit"], input[type="button"], a[onclick]')) {
    if (!el.offsetParent) continue; // element is hidden
    if (el.disabled) continue;
    
    // Skip dice-related buttons
    const onclick = el.getAttribute('onclick') || '';
    const text = (el.textContent || el.value || onclick).toLowerCase();
    if (text.includes('dice') || onclick.includes('dice')) {
      log(`Skipping dice button: "${text.substring(0, 30)}"`);
      continue;
    }
    
    const trimText = (el.textContent || el.value || "").trim().toLowerCase();
    if (CLAIM_KEYWORDS.some(k => trimText.includes(k))) {
      log(`Found claim button in context: tag=${el.tagName}, text="${trimText.substring(0, 30)}"`);
      return el;
    }
  }
  
  // Fallback: search for elements by attribute (wider search)
  const btnByAttr = context.querySelector('[onclick*="claim" i], [onclick*="roll" i], [onclick*="submit" i], [class*="claim" i], [class*="roll" i]');
  if (btnByAttr && btnByAttr.offsetParent) {
    // Check if it's a dice button
    const onclick = btnByAttr.getAttribute('onclick') || '';
    if (!onclick.includes('dice')) {
      log(`Found claim button in context by attribute/class`);
      return btnByAttr;
    }
  }

  return null;
}

// Backwards compatibility - search whole page
function findClaimButton() {
  return findClaimButtonInContext(document);
}

async function claimBonusFaucets() {
  try {
    // Step 1 — find and click the bonus tab
    const bonusTab = findBonusTab();
    if (!bonusTab) {
      log("No bonus faucet tab found — skipping bonus round");
      return;
    }

    // Check the free_spins badge — skip if 0
    const spinsEl = bonusTab.querySelector('#free_spins, .badge');
    const spins = spinsEl ? parseInt(spinsEl.textContent) : NaN;
    if (!isNaN(spins) && spins <= 0) {
      log("Bonus faucet: 0 spins remaining — skipping");
      return;
    }

    log(`Clicking bonus tab: "${bonusTab.textContent.trim()}"`);
    bonusTab.click();
    await sleep(800);
    bonusTab.click(); // double-click to ensure
    await sleep(3000); // wait longer for tab content to render and load

    // Step 1b — find the bonus content container
    // Try to find the section that became visible after clicking the tab
    let bonusContent = document.querySelector('[data-type="bonus"][class*="content"], [data-tab="bonus"][class*="content"], .bonus-content, [aria-labelledby*="bonus"]');
    if (!bonusContent) {
      // Fallback: look for any visible container that appeared after the click
      const containers = document.querySelectorAll('[class*="tab-pane"], [class*="tab-content"], .content, [role="tabpanel"]');
      for (const c of containers) {
        if (c.offsetParent !== null) { // visible
          bonusContent = c;
          break;
        }
      }
    }
    if (!bonusContent) {
      bonusContent = document.body; // fallback to whole page
    }
    log(`Bonus content container identified`);

    // Step 2 — claim loop inside the bonus section
    let consecutiveNoButton = 0;
    for (let round = 1; round <= 30; round++) {
      // Wait briefly for the UI to settle between rounds
      await sleep(round === 1 ? 1000 : 2500);

      // Check badge / "no more" message before attempting
      if (bonusExhausted()) {
        log(`Bonus round ${round}: exhausted (badge check) — done`);
        break;
      }

      // Scroll so captcha / claim button is visible
      scrollToBottom();
      await sleep(600);

      // Handle captcha if present (30s timeout for bonus — don't block forever)
      if (hasCaptchaWidget()) {
        log(`Bonus round ${round}: waiting for captcha…`);
        chrome.runtime.sendMessage({ type: "focus-tab" });
        await sleep(400);
        setTimeout(tryClickCaptchaWidget, 1000);
        const token = await Promise.race([
          waitForCaptchaToken(),
          sleep(30000).then(() => null)
        ]);
        if (!token) { 
          log("Bonus captcha timed out — stopping bonus loop"); 
          break; 
        }
        log("Bonus captcha resolved");
        await sleep(1500);
      }

      // Search for claim button WITHIN the bonus content container
      const claimBtn = findClaimButtonInContext(bonusContent);
      if (!claimBtn) {
        consecutiveNoButton++;
        log(`Bonus round ${round}: no claim button found in bonus content (${consecutiveNoButton}x)`);
        if (consecutiveNoButton >= 2) {
          log("No button found twice in a row — stopping bonus loop");
          break;
        }
        continue;
      }

      consecutiveNoButton = 0;
      log(`Bonus round ${round}: clicking claim/roll button "${claimBtn.textContent?.trim() || claimBtn.value}"`);
      claimBtn.click();
      await sleep(POST_CLAIM_WAIT_MS + 1000); // longer wait after bonus claim

      // Check after claim whether all bonus spins are gone
      if (bonusExhausted()) {
        log(`Bonus round ${round}: exhausted after claim — done`);
        break;
      }
    }
    log("Bonus faucets claim loop completed");
  } catch (err) {
    log("ERROR in claimBonusFaucets:", err.message);
  }
}

// ── DiceBet flow ──────────────────────────────────────────────────────────────
// Combined High-Roller strategy engine.
// Shared utilities (toFiniteNumber, clampNumber, normalizeDiceSide, normalizeDbStrategy,
// normalizeHighRollerConfig, DEFAULT_HIGH_ROLLER_CONFIG) are provided by constants.js.

// Returns the chance as a number (for actual dice calculations).
// Distinct from normalizeDbChance in constants.js which returns a string for storage.
function normalizeDiceChance(rawChance, dbStrategy) {
  const parsed = parseFloat(rawChance);
  if (!Number.isFinite(parsed)) {
    return dbStrategy === DICE_STRATEGY_ALL_IN_001 ? DEFAULT_ALL_IN_CHANCE_PERCENT : 48.5;
  }
  return clampNumber(parsed, 0.01, 99);
}

class CombinedHighRollerStrategy {
  constructor(config = {}, logger = log) {
    this.config = normalizeHighRollerConfig(config);
    this.logger = typeof logger === "function" ? logger : () => {};
    this.initialize(0);
  }

  initialize(start_bankroll) {
    const bankroll = Math.max(0, toFiniteNumber(start_bankroll, 0));
    this.start_bankroll = bankroll;
    this.current_bankroll = bankroll;
    this.roll_history = [];
    this.win_streak = 0;
    this.loss_streak = 0;
    this.mode = "kelly_hybrid";
    this.ladder_step = 0;
    this.last_bet = 0;
    this.last_stop_reason = null;
    this.total_rolls = 0;
    this.log_state("initialize");
  }

  calculate_kelly_bet() {
    let fraction = this.config.base_bet_fraction;
    if (this.win_streak >= 3) {
      fraction = 0.18;
    } else if (this.win_streak >= 2) {
      fraction = 0.12;
    }
    return this.current_bankroll * fraction;
  }

  calculate_streak_harvester_bet() {
    const stepOneFraction = clampNumber(this.config.base_bet_fraction, 0.05, 0.10);
    const stepIndex = Math.min(this.ladder_step, this.config.max_ladder_depth - 1);
    const fraction = stepOneFraction * Math.pow(2, stepIndex);
    return this.current_bankroll * fraction;
  }

  calculate_breakout_bet() {
    const breakoutFractions = [0.10, 0.15, 0.22];
    const maxDepth = Math.max(1, Math.min(this.config.max_ladder_depth, breakoutFractions.length));
    const stepIndex = Math.min(this.ladder_step, maxDepth - 1);
    const fraction = breakoutFractions[stepIndex];
    return this.current_bankroll * fraction;
  }

  get_volatility_delta() {
    if (this.roll_history.length < this.config.history_window) return 0;
    const recent = this.roll_history.slice(-this.config.history_window);
    const wins = recent.filter(Boolean).length;
    const losses = recent.length - wins;
    return Math.abs(wins - losses);
  }

  update_mode() {
    if (this.mode === "streak_harvester" || this.mode === "volatility_breakout") {
      return this.mode;
    }

    const volatilityDelta = this.get_volatility_delta();
    let nextMode = "kelly_hybrid";
    if (volatilityDelta >= this.config.volatility_trigger) {
      nextMode = "volatility_breakout";
    } else if (this.win_streak >= this.config.streak_trigger) {
      nextMode = "streak_harvester";
    }

    if (nextMode !== this.mode) {
      this.mode = nextMode;
      this.ladder_step = 0;
      this.log_state("mode-switch");
    }

    return this.mode;
  }

  apply_bankroll_protection() {
    if (this.current_bankroll <= 0) {
      return { stop: true, reason: "bankroll-zero" };
    }
    return { stop: false, reason: null };
  }

  should_stop() {
    const protection = this.apply_bankroll_protection();
    this.last_stop_reason = protection.reason;
    return protection.stop;
  }

  get_stop_reason() {
    return this.last_stop_reason;
  }

  get_next_bet() {
    if (this.should_stop()) {
      this.last_bet = 0;
      this.log_state("halted");
      return 0;
    }

    this.update_mode();

    let bet = 0;
    if (this.mode === "streak_harvester") {
      bet = this.calculate_streak_harvester_bet();
    } else if (this.mode === "volatility_breakout") {
      bet = this.calculate_breakout_bet();
    } else {
      bet = this.calculate_kelly_bet();
    }

    const hardCap = this.current_bankroll * this.config.max_bet_fraction;
    bet = Math.min(bet, hardCap, this.current_bankroll);

    const startBalanceFloor = this.start_bankroll * MIN_STARTING_BALANCE_BET_FRACTION;
    if (this.current_bankroll <= startBalanceFloor) {
      // When bankroll drops below the minimum floor, go all-in by request.
      bet = this.current_bankroll;
    } else {
      // Keep bets aggressive: never below 10% of starting bankroll.
      bet = Math.max(bet, startBalanceFloor);
    }

    if (!Number.isFinite(bet) || bet <= 0) {
      this.last_bet = 0;
      this.log_state("bet-invalid");
      return 0;
    }

    this.last_bet = bet;
    this.log_state("next-bet");
    return bet;
  }

  on_roll_result(win, observedBankroll = null) {
    const didWin = !!win;
    const bet = this.last_bet;
    if (!Number.isFinite(bet) || bet <= 0) {
      this.log_state("result-without-bet", { result: didWin ? "win" : "loss" });
      return;
    }

    const observed = Number(observedBankroll);
    if (Number.isFinite(observed) && observed >= 0) {
      this.current_bankroll = observed;
    } else {
      const delta = didWin ? bet * (DICE_FIXED_MULTIPLIER - 1) : -bet;
      this.current_bankroll = Math.max(0, this.current_bankroll + delta);
    }
    this.total_rolls += 1;

    if (didWin) {
      this.win_streak += 1;
      this.loss_streak = 0;
    } else {
      this.loss_streak += 1;
      this.win_streak = 0;
    }

    this.roll_history.push(didWin);
    if (this.roll_history.length > this.config.history_window) {
      this.roll_history.shift();
    }

    if (this.mode === "streak_harvester" || this.mode === "volatility_breakout") {
      if (didWin) {
        const maxStepIndex = Math.max(0, this.config.max_ladder_depth - 1);
        if (this.ladder_step < maxStepIndex) {
          this.ladder_step += 1;
        } else {
          this.mode = "kelly_hybrid";
          this.ladder_step = 0;
        }
      } else {
        this.mode = "kelly_hybrid";
        this.ladder_step = 0;
      }
    }

    if (!didWin) {
      this.mode = "kelly_hybrid";
    }

    this.log_state("roll-result", {
      result: didWin ? "win" : "loss",
      ladderStep: this.ladder_step + 1
    });
  }

  log_state(event, extra = {}) {
    const ladderSummary = this.mode === "kelly_hybrid"
      ? "0/0"
      : `${this.ladder_step + 1}/${this.config.max_ladder_depth}`;
    const parts = [
      `[HighRoller] ${event}`,
      `mode=${this.mode}`,
      `bankroll=${this.current_bankroll.toFixed(8)}`,
      `bet=${this.last_bet.toFixed(8)}`,
      `streak=${this.win_streak}`,
      `ladder=${ladderSummary}`
    ];
    for (const [key, value] of Object.entries(extra)) {
      parts.push(`${key}=${value}`);
    }
    this.logger(parts.join(" | "));
  }
}

async function getDicebetConfig() {
  const { settings } = await chrome.storage.local.get("settings");
  const faucets = settings?.faucets || [];
  const faucet = faucets.find(f => {
    try { return new URL(f.url).hostname === location.hostname; } catch { return false; }
  });
  const diceEnabled = faucet?.dbEnabled === true;
  const strategy = normalizeDbStrategy(faucet?.dbStrategy, diceEnabled);
  const parsedChance = parseFloat(faucet?.dbChance || "");
  const normalizedThreshold = normalizeWdThresholdForHost(location.hostname, faucet?.wdThreshold);
  const rawStrategyConfig = faucet?.dbStrategyConfig && typeof faucet.dbStrategyConfig === "object"
    ? faucet.dbStrategyConfig
    : (faucet?.dbStrategy && typeof faucet.dbStrategy === "object" ? faucet.dbStrategy : {});

  return {
    enabled: diceEnabled,
    side: normalizeDiceSide(faucet?.dbSide || "higher"),
    strategy,
    chance: normalizeDiceChance(parsedChance, strategy),
    wdThreshold: normalizedThreshold,
    strategyConfig: rawStrategyConfig
  };
}

function setDicebetInputValue(input, value) {
  if (!input) return;
  input.focus();
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
}

function findDicebetChanceInput() {
  const selectors = [
    "#win_chance",
    'input[id*="chance" i]', 'input[name*="chance" i]',
    'input[id*="percent" i]', 'input[name*="percent" i]',
    'input[id*="payout" i]', 'input[name*="payout" i]',
    'input[placeholder*="chance" i]', 'input[placeholder*="percent" i]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) {
      log(`✓ Found chance input with selector: ${sel}`);
      return el;
    }
  }
  log(`✗ No chance input found after ${selectors.length} selectors`);
  return null;
}

function findDicebetBetButton() {
  const selectors = [
    "#roll_dice",
    'button[onclick*="bet" i]', 'button[onclick*="play" i]', 'button[onclick*="roll" i]',
    'button[class*="bet" i]', 'button[class*="play" i]',
    'button[id*="bet" i]', 'button[id*="play" i]', 'button[id*="roll" i]',
    'input[type="button"][value*="Bet" i]', 'input[type="button"][value*="Roll" i]',
    'button[type="submit"]'
  ];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      if (!el.offsetParent) continue; // skip hidden
      const text = (el.textContent || el.value || '').toLowerCase();
      if (text.includes('roll') || text.includes('bet') || text.includes('play')) {
        log(`✓ Found bet button with selector: ${sel}, text: "${text}"`);
        return el;
      }
    }
  }
  log(`✗ No bet button found after ${selectors.length} selectors`);
  return null;
}

function findDicebetAmountInput() {
  const selectors = [
    "#bet_amount",
    'input[name="bet_amount"]',
    'input[id*="amount" i]', 'input[id*="stake" i]',
    'input[name*="amount" i]', 'input[name*="stake" i]', 'input[name*="bet" i]',
    'input[placeholder*="amount" i]', 'input[placeholder*="stake" i]',
    'input[type="number"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) {
      log(`✓ Found amount input with selector: ${sel}`);
      return el;
    }
  }
  log(`✗ No amount input found after ${selectors.length} selectors`);
  return null;
}

function findDicebetMultiplierInput() {
  const selectors = [
    "#multiplier",
    'input[name="multiplier"]',
    'input[id*="multiplier" i]',
    'input[id*="payout" i]',
    'input[name*="payout" i]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) {
      log(`✓ Found multiplier input with selector: ${sel}`);
      return el;
    }
  }
  log(`✗ No multiplier input found after ${selectors.length} selectors`);
  return null;
}

function applyDicebetSide(side) {
  const normalized = normalizeDiceSide(side);
  if (typeof window.bet_on === "string") {
    window.bet_on = normalized;
  }
  if (typeof window.set_roll_to_win === "function") {
    window.set_roll_to_win();
  }
  if (typeof window.set_slide_bar === "function") {
    window.set_slide_bar();
  }
  const label = document.getElementById("roll_to_win_lb");
  if (label) {
    label.textContent = normalized === "higher" ? "Roll over to win" : "Roll under to win";
  }
}

function readNumericInputById(id) {
  const input = document.getElementById(id);
  if (!input) return null;
  const parsed = parseFloat(String(input.value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function applyDicebetTargets(chance) {
  const chanceInput = findDicebetChanceInput();
  if (chanceInput && Number.isFinite(chance)) {
    setDicebetInputValue(chanceInput, chance.toFixed(2));
    if (typeof window.change_win_chance === "function") {
      window.change_win_chance();
    } else if (typeof window.change_win_chance2 === "function") {
      window.change_win_chance2(chance);
    }
  }

  return {
    appliedChance: readNumericInputById("win_chance"),
    appliedMultiplier: readNumericInputById("multiplier")
  };
}

async function readDicebetBalanceWithRetries(maxRetries = 4, delayMs = 900) {
  let balance = readBalance();
  let attempt = 0;
  while (balance == null && attempt < maxRetries) {
    attempt += 1;
    await sleep(delayMs);
    balance = readBalance();
  }
  return balance;
}

async function waitForDicebetIdle(maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    sendPhaseHeartbeat("dice-wait");
    const autoStatus = typeof window.auto_betting_status === "string" ? window.auto_betting_status : "stopped";
    if (autoStatus !== "running") return true;
    await sleep(250);
  }
  return false;
}

function placeDicebetRound(side) {
  applyDicebetSide(side);

  if (typeof window.process_bet_game_dice === "function") {
    window.process_bet_game_dice();
    return true;
  }

  const betButton = findDicebetBetButton();
  if (!betButton) return false;
  betButton.focus();
  betButton.click();
  return true;
}

async function runAllIn001Dicebet(side, threshold, chance) {
  const allInChance = clampNumber(toFiniteNumber(chance, DEFAULT_ALL_IN_CHANCE_PERCENT), 0.01, 99);
  log(`Running DiceBet strategy ${DICE_STRATEGY_ALL_IN_001}: single all-in shot at ${allInChance}%`);

  for (let attempt = 0; attempt < 5; attempt++) {
    const chanceInput = findDicebetChanceInput();
    const amountInput = findDicebetAmountInput();
    const betButton = findDicebetBetButton();
    if (chanceInput && amountInput && betButton) {
      log(`✓ DiceBet page ready on attempt ${attempt + 1}`);
      break;
    }
    if (attempt === 4) {
      sendError("dicebet-page-not-ready");
      return false;
    }
    await sleep(1000);
  }

  const balanceBefore = await readDicebetBalanceWithRetries(4, 750);
  if (balanceBefore == null) {
    log("ERROR: Cannot read starting balance for all-in strategy");
    sendError("dicebet-balance-read-failed");
    return false;
  }
  if (balanceBefore <= 0) {
    log(`Balance ${balanceBefore} is 0 or negative — cannot place all-in bet`);
    sendError("dicebet-no-balance-before-bet");
    return false;
  }

  if (balanceBefore >= threshold) {
    log(`Balance ${balanceBefore} already reached WD threshold ${threshold}`);
    return true;
  }

  const readyToBet = await waitForDicebetIdle(120000);
  if (!readyToBet) {
    log("ERROR: Dice page stayed busy before all-in bet");
    sendError("dicebet-stuck-running-before");
    return false;
  }

  const amountInput = findDicebetAmountInput();
  if (!amountInput) {
    log("ERROR: Cannot find bet amount input for all-in strategy");
    sendError("dicebet-no-amount-input");
    return false;
  }

  const targetSnapshot = applyDicebetTargets(allInChance);
  applyDicebetSide(side);
  setDicebetInputValue(amountInput, balanceBefore.toFixed(8));
  if (typeof window.change_bet_amount === "function") {
    window.change_bet_amount();
  }
  log(
    `Placing ALL-IN ${balanceBefore.toFixed(8)} | chance=${allInChance.toFixed(2)}%` +
    ` | appliedChance=${Number.isFinite(targetSnapshot.appliedChance) ? targetSnapshot.appliedChance.toFixed(2) : "n/a"}` +
    ` | appliedPayout=${Number.isFinite(targetSnapshot.appliedMultiplier) ? targetSnapshot.appliedMultiplier.toFixed(2) : "n/a"}`
  );

  const started = placeDicebetRound(side);
  if (!started) {
    log("ERROR: Failed to trigger all-in dice round");
    sendError("dicebet-round-not-started");
    return false;
  }

  const finishedRound = await waitForDicebetIdle(180000);
  if (!finishedRound) {
    log("ERROR: All-in dice round did not settle");
    sendError("dicebet-stuck-running-after");
    return false;
  }

  await sleep(500);
  const balanceAfter = await readDicebetBalanceWithRetries(4, 900);
  if (balanceAfter == null) {
    log("ERROR: Cannot read balance after all-in bet");
    sendError("dicebet-balance-read-failed-after");
    return false;
  }

  const won = balanceAfter > balanceBefore;
  log(`All-in result: ${won ? "WIN" : "LOSS"} | balance=${balanceAfter.toFixed(8)}`);

  if (balanceAfter >= threshold) {
    log(`Balance ${balanceAfter} >= threshold ${threshold} — proceeding to withdrawal`);
    return true;
  }

  if (balanceAfter <= 0 || !won) {
    sendError("dicebet-allin-loss");
    return false;
  }

  // Rare case: win but threshold still not met due custom high threshold.
  sendError("dicebet-allin-not-hit");
  return false;
}

async function runDicebet() {
  log("Starting DiceBet");
  sendPhaseHeartbeat("dice-start");

  const config = await getDicebetConfig();
  if (!config.enabled) {
    log("DiceBet disabled in config");
    return false;
  }

  const threshold = toFiniteNumber(config.wdThreshold, 0);
  if (threshold <= 0) {
    log("ERROR: DiceBet WD threshold must be greater than 0");
    sendError("dicebet-invalid-threshold");
    return false;
  }

  const side = normalizeDiceSide(config.side);
  const strategyType = normalizeDbStrategy(config.strategy, true);
  if (strategyType === DICE_STRATEGY_ALL_IN_001) {
    return runAllIn001Dicebet(side, threshold, config.chance);
  }

  const chance = clampNumber(toFiniteNumber(config.chance, 48.5), 0.01, 99);
  const strategy = new CombinedHighRollerStrategy(config.strategyConfig, log);
  const random14Schedule = await loadRandom14Schedule(location.hostname);
  const random14HostKey = random14Schedule.hostKey;
  let settledBetCount = random14Schedule.settledBetCount;
  let nextRandom14BetAt = random14Schedule.nextRandom14BetAt;
  log(
    `Random 14% rounds active every ${RANDOM_14_MIN_BET_INTERVAL}-${RANDOM_14_MAX_BET_INTERVAL} settled bets | ` +
    `globalSettled=${settledBetCount} | nextAt=#${nextRandom14BetAt}`
  );

  for (let attempt = 0; attempt < 5; attempt++) {
    const chanceInput = findDicebetChanceInput();
    const amountInput = findDicebetAmountInput();
    const betButton = findDicebetBetButton();
    if (chanceInput && amountInput && betButton) {
      log(`✓ DiceBet page ready on attempt ${attempt + 1}`);
      break;
    }
    if (attempt === 4) {
      sendError("dicebet-page-not-ready");
      return false;
    }
    await sleep(1000);
  }

  const startBalance = await readDicebetBalanceWithRetries(4, 750);
  if (startBalance == null) {
    log("ERROR: Cannot read starting balance for DiceBet");
    sendError("dicebet-balance-read-failed");
    return false;
  }
  if (startBalance <= 0) {
    log(`Balance ${startBalance} is 0 or negative — cannot start DiceBet`);
    sendError("dicebet-no-balance-before-bet");
    return false;
  }

  strategy.initialize(startBalance);
  log(`DiceBet config loaded: side=${side}, baseChance=${chance}%, threshold=${threshold}`);

  let round = 0;
  while (true) {
    round += 1;
    sendPhaseHeartbeat(`dice-round-${round}`);
    log(`═══ DiceBet round ${round}: side=${side}, chance=${chance}% ═══`);

    const balanceBefore = await readDicebetBalanceWithRetries(3, 700);
    if (balanceBefore == null) {
      log("ERROR: Cannot read balance before bet — aborting DiceBet");
      sendError("dicebet-balance-read-failed");
      return false;
    }
    if (balanceBefore <= 0) {
      log(`Balance ${balanceBefore} is 0 or negative — cannot place bet`);
      sendError("dicebet-no-balance-before-bet");
      return false;
    }

    if (balanceBefore >= threshold) {
      log(`Balance ${balanceBefore} already reached WD threshold ${threshold}`);
      return true;
    }

    if (strategy.should_stop()) {
      const reason = strategy.get_stop_reason();
      log(`Strategy stop triggered before betting: ${reason}`);
      sendError(`dicebet-${reason || "stopped"}`);
      return false;
    }

    const amountInput = findDicebetAmountInput();
    if (!amountInput) {
      log("ERROR: Cannot find bet amount input");
      sendError("dicebet-no-amount-input");
      return false;
    }

    strategy.current_bankroll = balanceBefore;
    const nextBet = strategy.get_next_bet();
    if (!Number.isFinite(nextBet) || nextBet <= 0) {
      const reason = strategy.get_stop_reason();
      log(`Strategy returned invalid bet (${nextBet}) with reason: ${reason}`);
      sendError(`dicebet-${reason || "invalid-bet"}`);
      return false;
    }

    const upcomingBetNumber = settledBetCount + 1;
    const isRandom14Round = upcomingBetNumber >= nextRandom14BetAt;
    const activeChance = isRandom14Round ? RANDOM_14_CHANCE_PERCENT : chance;
    log(
      `Preparing bet #${upcomingBetNumber} (${isRandom14Round ? "RANDOM-14" : "base chance"}) | ` +
      `stake=${nextBet.toFixed(8)} | targetChance=${activeChance.toFixed(2)}%`
    );

    const readyToBet = await waitForDicebetIdle(120000);
    if (!readyToBet) {
      log("Dice page stayed busy before placing bet; waiting for the round to finish.");
      await sleep(1200);
      continue;
    }

    const activeAmountInput = findDicebetAmountInput() || amountInput;
    if (!activeAmountInput) {
      log("ERROR: Cannot find active bet amount input right before placing bet");
      sendError("dicebet-no-amount-input");
      return false;
    }
    const targetSnapshot = applyDicebetTargets(activeChance);
    applyDicebetSide(side);
    setDicebetInputValue(activeAmountInput, nextBet.toFixed(8));
    if (typeof window.change_bet_amount === "function") {
      window.change_bet_amount();
    }
    log(
      `Placing bet ${nextBet.toFixed(8)} | chance=${activeChance.toFixed(2)}%${isRandom14Round ? " [RANDOM-14]" : ""}` +
      ` | appliedChance=${Number.isFinite(targetSnapshot.appliedChance) ? targetSnapshot.appliedChance.toFixed(2) : "n/a"}` +
      ` | appliedPayout=${Number.isFinite(targetSnapshot.appliedMultiplier) ? targetSnapshot.appliedMultiplier.toFixed(2) : "n/a"}` +
      ` | mode=${strategy.mode} | streak=${strategy.win_streak} | ladderStep=${strategy.ladder_step + 1}`
    );

    const started = placeDicebetRound(side);
    if (!started) {
      log("Dice bet trigger not ready yet; retrying without closing tab.");
      await sleep(2000);
      continue;
    }

    const finishedRound = await waitForDicebetIdle(180000);
    if (!finishedRound) {
      log("Dice round is still in progress after extended wait; continuing without closing tab.");
      await sleep(1200);
      continue;
    }
    await sleep(500);

    const balanceAfter = await readDicebetBalanceWithRetries(4, 900);
    if (balanceAfter == null) {
      log("ERROR: Cannot read balance after bet — aborting DiceBet");
      sendError("dicebet-balance-read-failed-after");
      return false;
    }

    const win = balanceAfter > balanceBefore;
    strategy.on_roll_result(win, balanceAfter);
    settledBetCount += 1;
    if (isRandom14Round) {
      nextRandom14BetAt = settledBetCount + randomIntInclusive(RANDOM_14_MIN_BET_INTERVAL, RANDOM_14_MAX_BET_INTERVAL);
      log(`Random 14% round executed at settled bet #${settledBetCount}; next random-14 round at #${nextRandom14BetAt}`);
    }
    await persistRandom14Schedule(random14HostKey, settledBetCount, nextRandom14BetAt);
    log(`Round ${round} result: ${win ? "WIN" : "LOSS"} | bankroll=${balanceAfter.toFixed(8)} | mode=${strategy.mode}`);

    if (balanceAfter >= threshold) {
      log(`Balance ${balanceAfter} >= threshold ${threshold} — proceeding to withdrawal`);
      return true;
    }

    if (balanceAfter <= 0) {
      log(`Balance ${balanceAfter} is 0 or negative — cannot bet anymore`);
      sendError("dicebet-no-balance-left");
      return false;
    }

    if (strategy.should_stop()) {
      const reason = strategy.get_stop_reason();
      log(`Strategy protection stop after round ${round}: ${reason}`);
      sendError(`dicebet-${reason || "stopped"}`);
      return false;
    }

    await sleep(1200);
  }
}

// ── Withdrawal flow ───────────────────────────────────────────────────────────

async function runWithdraw(address) {
  log("Withdrawal page:", location.href, "address:", address);

  if (!address) { sendWdError("no-address-configured"); return; }

  // Wait for Rocket Loader to finish executing page scripts (jQuery etc.)
  await sleep(2000);
  await new Promise(function waitForJQuery(resolveWhenReady) {
    let done = false;
    let intervalId = null;
    let timeoutId = null;

    function finishWaitForJQuery() {
      if (done) return;
      done = true;
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
      resolveWhenReady();
    }

    function pollForJQuery() {
      if (window.$ || window.jQuery) finishWaitForJQuery();
    }

    intervalId = setInterval(pollForJQuery, 200);
    timeoutId = setTimeout(finishWaitForJQuery, 8000); // max 8s
  });
  await sleep(500);
  log("jQuery available:", !!window.$);

  // ── Fill address ──
  const addrEl = document.getElementById('withdrawal_address') ||
    document.querySelector('[name*="address" i]') ||
    document.querySelector('[id*="address" i]');

  if (!addrEl) { sendWdError("no-address-input"); return; }
  log("Address element tag:", addrEl.tagName, "id:", addrEl.id);

  addrEl.focus();
  // Use jQuery val() if available (works for both input and textarea)
  if (window.$ && $(addrEl).val) {
    $(addrEl).val(address).trigger('input').trigger('change');
  } else {
    // Native setter — handle both input and textarea
    const proto = addrEl instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(addrEl, address);
    else addrEl.value = address;
    addrEl.dispatchEvent(new Event("input",  { bubbles: true }));
    addrEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await sleep(500);
  log("Address filled:", addrEl.value);

  // ── Set max amount ──
  const maxBtn = document.getElementById('max_amount');
  if (maxBtn) {
    if (window.$) $('#max_amount').trigger('click');
    else maxBtn.click();
    await sleep(300);
    log("Clicked max_amount");
  }

  // ── Captcha — always wait on withdrawal page ──
  log("Waiting for withdrawal captcha…");
  chrome.runtime.sendMessage({ type: "focus-tab" });
  await sleep(400);
  setTimeout(tryClickCaptchaWidget, 1000);
  setTimeout(tryClickCaptchaWidget, 5000);
  const token = await waitForCaptchaToken();
  if (!token) { sendWdError("withdraw-captcha-timeout"); return; }
  log("Withdrawal captcha resolved");
  await sleep(800);

  // ── Submit ──
  const submitBtn =
    [...document.querySelectorAll("button")].find(b =>
      /withdraw|send|submit/i.test(b.textContent)
    ) ||
    document.querySelector('button[type="submit"]') ||
    document.querySelector('input[type="submit"]');

  if (!submitBtn) { sendWdError("no-submit-button"); return; }

  log("Submitting withdrawal:", submitBtn.textContent?.trim());
  submitBtn.click();

  await sleep(8000);
  log("Withdrawal done");
  
  // Add random delay before completing withdrawal
  const delay = randomDelay();
  log(`Withdrawal submitted, waiting ${(delay/1000).toFixed(1)}s before completion`);
  await sleep(delay);
  
  sendWdDone();
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log("[FaucetPlugin] Content script loaded on:", location.href);
  
  await sleep(1000); // let page and JS frameworks settle

  // GUARD: do nothing if the user opened this page manually
  console.log("[FaucetPlugin] Checking if this is a plugin tab...");
  const pluginTab = await isPluginTab();
  if (!pluginTab) {
    log("Not a plugin tab — standing by (manual visit)");
    return;
  }
  
  console.log("[FaucetPlugin] ✓ This is a plugin-opened tab!");

  // DiceBet page: user navigated here from faucet page after claim
  if (isDicebetPage()) {
    log("Detected dicebet page");
    const config = await getDicebetConfig();
    log(`DiceBet config: enabled=${config.enabled}, strategy=${config.strategy}, side=${config.side}, chance=${config.chance}%, wd_threshold=${config.wdThreshold}`);
    const shouldWithdraw = await runDicebet();
    if (shouldWithdraw) {
      log("DiceBet succeeded and balance reached threshold, proceeding to withdrawal");
      // Don't navigate here—let background handle it through normal flow
      // Instead, close the tab and let background know to proceed with withdrawal
      sendDone(readBalance());
    } else {
      log("DiceBet failed or threshold not met");
      sendError("dicebet-failed");
    }
    return;
  }

  // Withdraw tab: background already navigated us here after a successful claim
  const wdInfo = await getWithdrawInfo();
  if (wdInfo.isWithdrawTab) {
    log("Detected withdrawal tab");
    await runWithdraw(wdInfo.address);
    return;
  }

  console.log("[FaucetPlugin] Checking page type...");
  if (hasLoginForm()) {
    log("Detected login page");
    await runLogin();
  } else if (isFaucetPage()) {
    log("Detected faucet page");
    await runFaucet();
  } else {
    const tabState = await getCurrentTabState();
    const targetFaucetUrl = tabState?.faucetUrl;
    const canRecoverToFaucet =
      tabState?.phase === "faucet" &&
      !!targetFaucetUrl &&
      !isWithdrawPage() &&
      !isDicebetPage() &&
      !hasLoginForm();

    if (canRecoverToFaucet) {
      try {
        const target = new URL(targetFaucetUrl);
        if (target.hostname === location.hostname && location.href !== targetFaucetUrl) {
          log("Unrecognised page in faucet phase — redirecting back to faucet:", targetFaucetUrl);
          location.href = targetFaucetUrl;
          return;
        }
      } catch (_) {}
    }

    log("Unrecognised page — waiting for navigation:", location.href);
  }
}

console.log("[FaucetPlugin] Content script executing for:", window.location.hostname);
function handleMainError(err) {
  console.error("[FaucetPlugin] Unhandled error:", err);
  log("Unhandled error:", err);
  sendError(String(err));
}

main().catch(handleMainError);
