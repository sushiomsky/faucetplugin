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

    log("Bonus faucets claim loop completed");
  } catch (err) {
    log("ERROR in claimBonusFaucets:", err.message);
  }
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

  await sleep(2000);

  try {
    scrollToBottom();
    await sleep(1000);

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

    const delay = randomDelay();
    log(`Faucet cycle completed, waiting ${(delay/1000).toFixed(1)}s`);
    await sleep(delay);

    sendDone(balance);
  } finally {
    stopDiceHangWatchdog();
  }
}
