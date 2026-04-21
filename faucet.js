// ── faucet.js ─────────────────────────────────────────────────────────────

function startDiceHangWatchdog(diceEnabled) {
  if (!diceEnabled) return () => {};

  let active = true;
  const timerId = setTimeout(async () => {
    if (!active) return;
    if (!isFaucetPage() || isDicebetPage() || isWithdrawPage()) return;

    const pluginTab = await isPluginTab();
    if (!pluginTab) return;

    const diceUrl = getDicePageUrl();
    log(`Faucet flow exceeded ${(window.FAUCET_HANG_TO_DICE_TIMEOUT_MS / 1000).toFixed(0)}s — forcing DiceBet load: ${diceUrl}`);
    sendPhaseHeartbeat("faucet-hang-timeout-to-dice");
    window.location.href = diceUrl;
  }, window.FAUCET_HANG_TO_DICE_TIMEOUT_MS);

  return () => {
    active = false;
    clearTimeout(timerId);
  };
}

const NO_MORE_PATTERNS = /no more|no bonus|all claimed|come back|no free|exhausted|used up|no spins|0 spins/i;

function bonusExhausted() {
  const badge = SiteSelectors.getFirstValid('faucetBonusBadge');
  if (badge && parseInt(badge.textContent) <= 0) {
    log("Bonus exhausted: free_spins badge = 0");
    return true;
  }
  
  const msgEls = SiteSelectors.getAllValid('faucetBonusMessages');
  for (const el of msgEls) {
    if (!el.offsetParent) continue;
    if (el.children.length > 3) continue; 
    if (NO_MORE_PATTERNS.test(el.textContent)) {
      log(`Bonus exhausted: found message "${el.textContent.trim().substring(0, 50)}"`);
      return true;
    }
  }
  return false;
}

const CLAIM_KEYWORDS = ["claim", "collect", "roll", "submit", "get", "spin"];

function findBonusTab() {
  const el = SiteSelectors.getFirstValid("faucetBonusTab");
  if (el) {
    log(`Found bonus tab with selector`);
    return el;
  }
  
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (el.offsetParent === null) continue; 
    if (el.children.length > 5) continue; 
    const text = el.textContent?.trim().toLowerCase() || '';
    if ((text === 'bonus' || text === 'bonus roll' || text === 'bonus faucet') && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
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

function findClaimButtonInContext(context = document) {
  for (const el of SiteSelectors.getAllValid('faucetClaimBtnContext', context)) {
    if (!el.offsetParent) continue; 
    if (el.disabled) continue;
    
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
  
  const btnByAttr = SiteSelectors.getFirstValid('faucetClaimBtnContextAttr', context);
  if (btnByAttr) {
    const onclick = btnByAttr.getAttribute('onclick') || '';
    if (!onclick.includes('dice')) {
      log(`Found claim button in context by attribute/class`);
      return btnByAttr;
    }
  }
  return null;
}

function findClaimButton() {
  return findClaimButtonInContext(document);
}

async function claimBonusFaucets() {
  try {
    const bonusTab = findBonusTab();
    if (!bonusTab) {
      log("No bonus faucet tab found — skipping bonus round");
      return;
    }

    const spinsEl = bonusTab.querySelector('#free_spins, .badge');
    const spins = spinsEl ? parseInt(spinsEl.textContent) : NaN;
    if (!isNaN(spins) && spins <= 0) {
      log("Bonus faucet: 0 spins remaining — skipping");
      return;
    }

    log(`Clicking bonus tab: "${bonusTab.textContent.trim()}"`);
    bonusTab.click();
    await sleep(800);
    bonusTab.click(); 
    await sleep(3000); 

    let bonusContent = SiteSelectors.getFirstValid('faucetBonusContent');
    if (!bonusContent) {
      bonusContent = document.body; 
    }
    log(`Bonus content container identified`);

    let consecutiveNoButton = 0;
    for (let round = 1; round <= 30; round++) {
      await sleep(round === 1 ? 1000 : 2500);

      if (bonusExhausted()) {
        log(`Bonus round ${round}: exhausted (badge check) — done`);
        break;
      }

      scrollToBottom();
      await sleep(600);

      if (hasCaptchaWidget()) {
        log(`Bonus round ${round}: waiting for captcha…`);
        chrome.runtime.sendMessage({ type: "focus-tab" });
        await sleep(1000);
        
        let captchaResolved = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          setTimeout(tryClickCaptchaWidget, 1500);
          const token = await Promise.race([
            waitForCaptchaToken(20000), 
            sleep(25000).then(() => null)
          ]);
          if (token) {
            log(`Bonus captcha resolved on attempt ${attempt + 1}`);
            captchaResolved = true;
            break;
          }
          log(`Bonus captcha timeout on attempt ${attempt + 1}, rotating…`);
          const rotated = await rotateCaptchaType();
          if (!rotated) break;
        }

        if (!captchaResolved) { 
          log("Bonus captcha failed all attempts — stopping bonus loop"); 
          break; 
        }
        await sleep(1500);
      }

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
      await sleep(window.POST_CLAIM_WAIT_MS + 1000); 

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

function detectCooldown() {
  const timer = SiteSelectors.getFirstValid("faucetCooldownTimer");
  if (!timer) return null;

  const text = timer.innerText.trim();
  if (!text) return null;

  log(`Detected timer text: "${text}"`);
  
  // Parse MM:SS or HH:MM:SS
  const matches = text.match(/(\d+):(\d+)(?::(\d+))?/);
  if (matches) {
    const h = matches[3] ? parseInt(matches[1], 10) : 0;
    const m = matches[3] ? parseInt(matches[2], 10) : parseInt(matches[1], 10);
    const s = matches[3] ? parseInt(matches[3], 10) : parseInt(matches[2], 10);
    return (h * 60) + m + (s / 60);
  }

  // Parse "X minutes"
  const minMatch = text.match(/(\d+)\s*(min|minute)/i);
  if (minMatch) return parseInt(minMatch[1], 10);

  // If we found a clock but can't parse it, default to a safe 60 min loop if it looks active
  if (text.length > 0) return 60; 

  return null;
}

async function tryClaimHourlyFaucet() {
  const claimKeywords = ["claim", "collect", "roll", "submit", "get"];
  const selectors = SiteSelectors.get("faucetClaimBtnPrimary");
  let btn = null;
  outer: for (const sel of selectors) {
    const elements = document.querySelectorAll(sel);
    for (const el of elements) {
      if (!el.offsetParent) continue;
      const text = (el.textContent || el.value || "").trim().toLowerCase();
      if (claimKeywords.some(k => text.includes(k))) {
        btn = el;
        break outer;
      }
    }
  }

  if (!btn) {
    log("No hourly claim button found with keywords — trying fallback");
    btn = document.querySelector('button[type="submit"], input[type="submit"]');
  }

  if (btn) {
    if (hasLoginForm()) {
      log("ERROR: Login form detected. Aborting hourly claim.");
      return false;
    }
    log("Clicking hourly claim button:", btn.textContent?.trim() || btn.value);
    btn.click();
    await sleep(2000); // Give it a moment to start the request
    return true;
  }

  log("Hourly faucet seems to be on cooldown or button is missing.");
  return false;
}

async function runFaucet() {
  log("Faucet page:", location.href);

  const dbConfig = await getDicebetConfig();
  const stopDiceHangWatchdog = startDiceHangWatchdog(dbConfig.enabled);

  try {
    scrollToBottom();

    // 0. Check for cooldown immediately to save time/captchas
    const cooldownReadTime = Date.now();
    const initialWait = detectCooldown();
    if (initialWait !== null) {
      if (initialWait > 2.5) {
        log(`Faucet is on long cooldown: ${initialWait} min. Reporting and aborting.`);
        chrome.runtime.sendMessage({ type: "faucet-cooldown", waitMinutes: initialWait });
        return;
      } else {
        log(`Faucet cooldown is short (${initialWait} min). Staying on page to prepare early.`);
      }
    }

    // 1. Solve Captcha if present (required for both hourly and some bonus claim types)
    let captchaResolved = false;
    if (hasCaptchaWidget()) {
      let captchaAttempts = 0;
      const maxCaptchaAttempts = 4;
      while (captchaAttempts < maxCaptchaAttempts) {
        log(`Captcha attempt ${captchaAttempts + 1}/${maxCaptchaAttempts}...`);
        chrome.runtime.sendMessage({ type: "focus-tab" });
        await sleep(2500);
        tryClickCaptchaWidget();
        const token = await waitForCaptchaToken(40000);
        if (token) {
          log("✓ Captcha resolved");
          captchaResolved = true;
          break;
        }
        log(`✗ Captcha timeout on attempt ${captchaAttempts + 1}`);
        const rotated = await rotateCaptchaType();
        if (!rotated) break;
        captchaAttempts++;
      }
    } else {
      log("No captcha detected — proceeding.");
      captchaResolved = true;
    }

    // 1.5 Wait for precise timer using robust system clock (avoids frozen DOM clock in background)
    if (initialWait !== null && initialWait <= 2.5) {
      const waitMs = initialWait * 60 * 1000;
      const targetTime = cooldownReadTime + waitMs;
      
      log(`Waiting for exact expiration at system time... (${(waitMs/1000).toFixed(1)}s total)`);
      while (true) {
        const remaining = targetTime - Date.now();
        if (remaining <= 0) break;
        
        if (remaining > 10000) {
          chrome.runtime.sendMessage({ type: "phase-heartbeat" });
          await sleep(5000);
        } else {
          await sleep(Math.max(10, remaining));
          break;
        }
      }
      log("Exact cooldown has been reached! Claiming...");
    }

    // 2. Attempt Hourly Faucet
    const hourlyClaimed = await tryClaimHourlyFaucet();
    if (hourlyClaimed) {
      log("Hourly faucet claim submitted. Waiting...");
      await sleep(window.POST_CLAIM_WAIT_MS);
    }

    // 3. Attempt Bonus Faucets (always check)
    await claimBonusFaucets();

    const balance = readBalance();
    log("Final balance check:", balance);

    if (dbConfig.enabled && balance != null && balance > 0) {
      const diceUrl = getDicePageUrl();
      log(`DiceBet enabled, navigating to dice page: ${diceUrl}`);
      window.location.href = diceUrl;
      return;
    }

    log(`Faucet cycle completed.`);

    sendDone(balance);
  } finally {
    stopDiceHangWatchdog();
  }
}
