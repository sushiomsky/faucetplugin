// ── withdraw.js ─────────────────────────────────────────────────────────────

function scrapeMinimumWithdrawal() {
  const textContent = document.body.innerText;
  const patterns = [
    /minimum\s+(?:withdrawal|withdraw|amount)[:\s]+([\d.]+)/i,
    /min[:\s]+([\d.]+)/i,
    /withdraw\s+min[:\s]+([\d.]+)/i,
    /least[:\s]+([\d.]+)\s+\w+\s+to\s+withdraw/i
  ];

  for (const pattern of patterns) {
    const match = textContent.match(pattern);
    if (match && match[1]) {
      const val = parseFloat(match[1]);
      if (Number.isFinite(val) && val > 0) {
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

  const minWd = scrapeMinimumWithdrawal();
  if (minWd) {
    chrome.runtime.sendMessage({ type: "scraped-min-wd", url: location.href, value: minWd });
  }

  const addrEl = SiteSelectors.getFirstValid("withdrawAddressInput");

  if (!addrEl) { sendWdError("no-address-input"); return; }
  log("Address element tag:", addrEl.tagName, "id:", addrEl.id);

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
  await sleep(1000); 
  log("Address filled:", addrEl.value);

  const maxBtn = SiteSelectors.getFirstValid("withdrawMaxBtn");
  if (maxBtn) {
    if (window.$) $('#max_amount').trigger('click');
    else maxBtn.click();
    await sleep(300);
    log("Clicked max_amount");
  }

  log("Waiting for withdrawal captcha…");
  chrome.runtime.sendMessage({ type: "focus-tab" });
  await sleep(400);
  setTimeout(tryClickCaptchaWidget, 1000);
  setTimeout(tryClickCaptchaWidget, 5000);
  const token = await waitForCaptchaToken();
  if (!token) { sendWdError("withdraw-captcha-timeout"); return; }
  log("Withdrawal captcha resolved");
  await sleep(800);

  let submitBtn = SiteSelectors.getAllValid("withdrawSubmitBtnFallback").find(b =>
      /withdraw|send|submit/i.test(b.textContent)
  );
  if (!submitBtn) {
    submitBtn = SiteSelectors.getFirstValid("withdrawSubmitBtn");
  }

  if (!submitBtn) { sendWdError("no-submit-button"); return; }

  log("Submitting withdrawal:", submitBtn.textContent?.trim());
  submitBtn.click();

  await sleep(8000);
  log("Withdrawal done");
  
  const delay = randomDelay();
  log(`Withdrawal submitted, waiting ${(delay/1000).toFixed(1)}s before completion`);
  await sleep(delay);
  
  sendWdDone();
}
