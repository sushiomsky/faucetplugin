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

async function runFaucet() {
  log("Faucet page:", location.href);

  const dbConfig = await getDicebetConfig();
  const stopDiceHangWatchdog = startDiceHangWatchdog(dbConfig.enabled);

  await sleep(2000);

  try {
    scrollToBottom();
    await sleep(1000);
    scrollToBottom();

    let captchaResolved = false;
    let captchaAttempts = 0;
    const maxCaptchaAttempts = 4;

    while (captchaAttempts < maxCaptchaAttempts) {
      const hasCaptcha = hasCaptchaWidget();
      if (!hasCaptcha) {
        log("No captcha detected — proceeding.");
        captchaResolved = true;
        break;
      }

      log(`Captcha attempt ${captchaAttempts + 1}/${maxCaptchaAttempts}...`);
      chrome.runtime.sendMessage({ type: "focus-tab" });
      await sleep(2500); // Wait for widget to settle

      tryClickCaptchaWidget();
      const token = await waitForCaptchaToken(40000); // 40s per method

      if (token) {
        log("✓ Captcha resolved");
        captchaResolved = true;
        break;
      }

      log(`✗ Captcha timeout on attempt ${captchaAttempts + 1}`);
      const rotated = await rotateCaptchaType();
      if (!rotated) {
        log("No more captcha methods to try.");
        break;
      }
      captchaAttempts++;
    }

    if (!captchaResolved) {
      log("ERROR: All captcha attempts failed.");
      sendError("captcha-failed-all-methods");
      return;
    }

    const claimKeywords = ["claim", "collect", "roll", "submit", "get"];
    const selectors = SiteSelectors.get("faucetClaimBtnPrimary");
    let btn = null;
    outer: for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      log(`Searching with selector "${sel}" — found ${elements.length} element(s)`);
      for (const el of elements) {
        if (!el.offsetParent) continue; 
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

    await sleep(window.POST_CLAIM_WAIT_MS);

    await claimBonusFaucets();

    const balance = readBalance();
    log("Balance after claim:", balance);

    if (dbConfig.enabled && balance != null && balance > 0) {
      const diceUrl = getDicePageUrl();
      log(`DiceBet enabled, navigating to dice page: ${diceUrl}`);
      window.location.href = diceUrl;
      return;
    }

    const delay = randomDelay();
    log(`Claim completed, waiting ${(delay/1000).toFixed(1)}s before next action`);
    await sleep(delay);

    sendDone(balance);
  } finally {
    stopDiceHangWatchdog();
  }
}
