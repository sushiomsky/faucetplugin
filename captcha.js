// ── captcha.js ────────────────────────────────────────────────────────────

function getCaptchaToken() {
  const cfs = SiteSelectors.getAllValid("captchaTokenCloudflare");
  for (const cf of cfs) if (cf.value) return cf.value;
  
  const ics = SiteSelectors.getAllValid("captchaTokenIcon");
  for (const ic of ics) if (ic.value) return ic.value;
  
  if (SiteSelectors.getFirstValid("captchaIconPassed")) return "iconcaptcha-passed";
  
  return null;
}

function isVisibleForClick(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function dispatchMouseEvent(el, type, x, y) {
  const EventCtor = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  const payload = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
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
  if (now - window.lastNativeClickAt < window.NATIVE_CLICK_MIN_INTERVAL_MS) return;
  window.lastNativeClickAt = now;

  chrome.runtime.sendMessage(
    { type: "native-click", x: Math.round(x), y: Math.round(y), label },
    (resp) => {
      if (chrome.runtime.lastError) log(`Native click failed: ${chrome.runtime.lastError.message}`);
      else if (resp?.ok) log(`Native click dispatched for ${label}`);
      else if (resp?.error) log(`Native click error: ${resp.error}`);
    }
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
  const turnstileFrames = SiteSelectors.getAllValid("captchaFrames");
  for (const frame of turnstileFrames) {
    if (clickElementRobust(frame, "Turnstile iframe")) return true;
  }

  const turnstileCheckboxes = SiteSelectors.getAllValid("captchaCheckboxes");
  for (const checkbox of turnstileCheckboxes) {
    if (checkbox.checked) continue;
    if (clickElementRobust(checkbox, "Turnstile checkbox")) return true;
  }

  let widget = SiteSelectors.getFirstValid("captchaTurnstileWidget");
  if (widget && clickElementRobust(widget, "Turnstile container")) return true;

  widget = SiteSelectors.getFirstValid("captchaHCaptchaWidget");
  if (widget && clickElementRobust(widget, "hCaptcha widget")) return true;

  widget = SiteSelectors.getFirstValid("captchaGenericWidget");
  if (widget && clickElementRobust(widget, "generic captcha container")) return true;

  widget = SiteSelectors.getFirstValid("captchaIconWidget");
  if (widget && clickElementRobust(widget, "IconCaptcha widget")) return true;

  log("No captcha widget found to click");
  return false;
}

function hasCaptchaWidget() {
  return !!(
    SiteSelectors.getFirstValid("captchaTurnstileWidget") ||
    SiteSelectors.getFirstValid("captchaHCaptchaWidget") ||
    SiteSelectors.getFirstValid("captchaGenericWidget") ||
    SiteSelectors.getFirstValid("captchaIconWidget") ||
    SiteSelectors.getFirstValid("captchaFrames") ||
    SiteSelectors.getFirstValid("captchaTokenCloudflare") ||
    SiteSelectors.getFirstValid("captchaTokenIcon")
  );
}

function waitForCaptchaToken(timeoutMs = window.MAX_WAIT_MS) {
  return new Promise((resolve) => {
    const start = Date.now();
    let clickAttempts = 0;
    let lastClickTime = 0;
    let lastFocusTime = 0;
    const maxClickAttempts = Math.max(window.MAX_CAPTCHA_RETRIES, Math.ceil(timeoutMs / window.CAPTCHA_RETRY_MS));
    let timer = null;

    log(`Waiting for captcha token (timeout: ${timeoutMs}ms)...`);

    // Use a MutationObserver to instantly resolve if token is written, falling back to gentle polling
    const targetNode = document.body;
    const config = { attributes: true, childList: true, subtree: true };
    const observer = new MutationObserver(() => {
      const t = getCaptchaToken();
      if (t) {
        finish(t);
      }
    });
    observer.observe(targetNode, config);

    function finish(token) {
      if (timer) clearInterval(timer);
      observer.disconnect();
      if (token) log(`✓ Captcha resolved after ${Date.now() - start}ms`);
      else log(`✗ Captcha timeout after ${Date.now() - start}ms`);
      resolve(token);
    }

    function pollCaptchaToken() {
      const token = getCaptchaToken();
      if (token) {
        finish(token);
        return;
      }

      const elapsed = Date.now() - start;
      const now = Date.now();

      if (now - lastFocusTime >= 10000) {
        chrome.runtime.sendMessage({ type: "focus-tab" });
        lastFocusTime = now;
      }

      if (now - lastClickTime >= window.CAPTCHA_RETRY_MS && clickAttempts < maxClickAttempts) {
        const clicked = tryClickCaptchaWidget();
        if (clicked) {
          lastClickTime = now;
          clickAttempts++;
        }
      }

      if (elapsed > timeoutMs) {
        finish(null);
      }
    }

    timer = setInterval(pollCaptchaToken, window.POLL_MS);
  });
}
