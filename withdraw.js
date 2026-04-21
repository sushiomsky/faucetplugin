// ── withdraw.js ─────────────────────────────────────────────────────────────

function scrapeMinimumWithdrawal() {
  const textContent = document.body.innerText;
  const patterns = SCRAPE_WD_MIN_PATTERNS;

  for (const pattern of patterns) {
    const match = textContent.match(pattern);
    if (match && match[1]) {
      const val = parseNumericValue(match[1]);
      if (val != null && val > 0) {
        log(`✓ Scraped minimum withdrawal: ${val}`);
        return val;
      }
    }
  }

  const selectors = __FP_Selectors.get("withdrawMinAmountText");
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const val = parseNumericValue(el.textContent);
    if (val != null && val > 0 && /min|least/i.test(el.textContent)) {
      log(`✓ Scraped minimum withdrawal from ${sel}: ${val}`);
      return val;
    }
  }

  return null;
}

async function waitForRocketLoaderHandlers() {
  return new Promise(resolve => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (window.__cfRLUnblockHandlers || attempts > 20) {
        if (window.__cfRLUnblockHandlers) log("✓ Rocket Loader handlers UNBLOCKED");
        else log("⚠️ Rocket Loader unblock timeout - attempting click anyway");
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

async function runWithdraw(address) {
  console.log("[FaucetPlugin] 🚀 Withdrawal sequence started for:", location.href, "address:", address);

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
      if (window.$ || window.jQuery) {
        console.log("[FaucetPlugin] ✓ jQuery/Zepto detected in window");
        finishWaitForJQuery();
      }
    }

    intervalId = setInterval(pollForJQuery, 500); 
    timeoutId = setTimeout(() => {
        console.warn("[FaucetPlugin] ⚠️ Timed out waiting for jQuery - proceeding with vanilla JS");
        finishWaitForJQuery();
    }, 12000); 
  });
  await sleep(1000); 
  console.log("[FaucetPlugin] Environment ready. Scoping minimum withdrawal...");

  const minWd = scrapeMinimumWithdrawal();
  if (minWd) {
    chrome.runtime.sendMessage({ type: "scraped-min-wd", url: location.href, value: minWd });
  }

  const addrEl = __FP_Selectors.getFirstValid("withdrawAddressInput");
  if (!addrEl) { sendWdError("no-address-input"); return; }
  console.log(`[FaucetPlugin] Filling address in <${addrEl.tagName} id="${addrEl.id}">`);

  addrEl.focus();
  if (window.$ && $(addrEl).val) {
    $(addrEl).val(address).trigger('input').trigger('change');
  } else {
    const proto = addrEl instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(addrEl, address);
    else addrEl.value = address;
    addrEl.dispatchEvent(new Event("input",  { bubbles: true }));
    addrEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await sleep(1500); 

  const maxBtn = __FP_Selectors.getFirstValid("withdrawMaxBtn");
  if (maxBtn) {
    console.log("[FaucetPlugin] Triggering max balance...");
    if (window.$) $('#max_amount').trigger('click');
    else maxBtn.click();
    await sleep(500);
  }

  console.log("[FaucetPlugin] Preparing viewport: scrolling 170px down...");
  window.scrollBy({ top: 170, behavior: "smooth" });
  await sleep(1000); 

  console.log("[FaucetPlugin] Waiting for withdrawal captcha…");
  chrome.runtime.sendMessage({ type: "focus-tab" });
  await sleep(3000); 
  const token = await waitForCaptchaToken();
  if (!token) { sendWdError("withdraw-captcha-timeout"); return; }
  console.log("[FaucetPlugin] ✓ Withdrawal captcha resolved");
  await sleep(1000);

  let submitBtn = __FP_Selectors.getAllValid("withdrawSubmitBtnFallback").find(b =>
      /withdraw|send|submit/i.test(b.textContent)
  );
  if (!submitBtn) {
    submitBtn = __FP_Selectors.getFirstValid("withdrawSubmitBtn");
  }

  if (!submitBtn) {
    console.error("[FaucetPlugin] ✘ Could not identify withdrawal submit button.");
    sendWdError("no-submit-button"); 
    return; 
  }

  // FINAL VISIBILITY SYNC
  console.log(`[FaucetPlugin] Target found: <${submitBtn.tagName} id="${submitBtn.id}"> "${submitBtn.innerText.trim()}"`);
  console.log("[FaucetPlugin] Ensuring button is visible in viewport...");
  submitBtn.scrollIntoView({ behavior: "smooth", block: "nearest" });
  await sleep(1000);

  // FINAL SYNC
  console.log("[FaucetPlugin] Final synchronization: waiting for Rocket Loader...");
  await waitForRocketLoaderHandlers();

  console.log("[FaucetPlugin] 🚀 Clicking withdrawal button now...");
  
  if (window.$) {
    const jSub = $(submitBtn);
    jSub.trigger('mousedown');
    await sleep(200);
    jSub.trigger('click').trigger('mouseup');
  } else {
    submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
    await sleep(200);
    submitBtn.click();
    submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
  }

  await sleep(10000); 
  console.log("[FaucetPlugin] Withdrawal execution cycle complete.");
  
  const delay = randomDelay();
  log(`Withdrawal submitted, waiting ${(delay/1000).toFixed(1)}s before completion`);
  await sleep(delay);
  
  sendWdDone();
}
