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

  const selectors = SiteSelectors.get("withdrawMinAmountText");
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
      if (window.$ || window.jQuery) {
        log("✓ jQuery/Zepto detected in window");
        finishWaitForJQuery();
      }
    }

    intervalId = setInterval(pollForJQuery, 500); // 500ms conservative poll
    timeoutId = setTimeout(() => {
        log("⚠️ Timed out waiting for jQuery - proceeding with vanilla JS");
        finishWaitForJQuery();
    }, 12000); // max 12s
  });
  await sleep(1000); 
  log("Environment ready. Identifying elements...");

  const minWd = scrapeMinimumWithdrawal();
  if (minWd) {
    chrome.runtime.sendMessage({ type: "scraped-min-wd", url: location.href, value: minWd });
  }

  const addrEl = SiteSelectors.getFirstValid("withdrawAddressInput");

  if (!addrEl) { sendWdError("no-address-input"); return; }
  log(`Filling address in ${addrEl.tagName}#${addrEl.id}`);

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
  log("Address filled:", addrEl.value);

  const maxBtn = SiteSelectors.getFirstValid("withdrawMaxBtn");
  if (maxBtn) {
    if (window.$) $('#max_amount').trigger('click');
    else maxBtn.click();
    await sleep(500);
    log("Clicked max_amount");
  }

  log("Preparing viewport: scrolling 150px down...");
  window.scrollBy({ top: 150, behavior: "smooth" });
  await sleep(1000); 

  log("Waiting for withdrawal captcha…");
  chrome.runtime.sendMessage({ type: "focus-tab" });
  await sleep(3000); // Initial settlement period
  const token = await waitForCaptchaToken();
  if (!token) { sendWdError("withdraw-captcha-timeout"); return; }
  log("Withdrawal captcha resolved");
  await sleep(1000);

  let submitBtn = SiteSelectors.getAllValid("withdrawSubmitBtnFallback").find(b =>
      /withdraw|send|submit/i.test(b.textContent)
  );
  if (!submitBtn) {
    submitBtn = SiteSelectors.getFirstValid("withdrawSubmitBtn");
  }

  if (!submitBtn) { sendWdError("no-submit-button"); return; }

  // FINAL VISIBILITY SYNC: ensure button is in view before clicking
  log("Ensuring button is visible in viewport...");
  submitBtn.scrollIntoView({ behavior: "smooth", block: "nearest" });
  await sleep(1000);

  // FINAL SYNC: Wait for Rocket Loader to "unblock" the button's onclick handler
  log("Final synchronization: waiting for Rocket Loader...");
  await waitForRocketLoaderHandlers();

  log("Submitting withdrawal:", submitBtn.textContent?.trim() || "submit-btn");

  if (window.$) {
    $(submitBtn).trigger('mousedown').trigger('click').trigger('mouseup');
  } else {
    submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
    submitBtn.click();
    submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
  }

  await sleep(10000); // 10s wait for final validation
  log("Withdrawal execution cycle complete");
  
  const delay = randomDelay();
  log(`Withdrawal submitted, waiting ${(delay/1000).toFixed(1)}s before completion`);
  await sleep(delay);
  
  sendWdDone();
}
