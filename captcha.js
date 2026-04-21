// ── captcha.js ────────────────────────────────────────────────────────────

function getCaptchaToken() {
  const cfs = __FP_Selectors.getAllValid("captchaTokenCloudflare");
  for (const cf of cfs) if (cf.value) return cf.value;
  
  const ics = __FP_Selectors.getAllValid("captchaTokenIcon");
  for (const ic of ics) if (ic.value) return ic.value;
  
  if (__FP_Selectors.getFirstValid("captchaIconPassed")) return "iconcaptcha-passed";
  
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
  // 1. Try Turnstile Frames (Highest Priority)
  const turnstileFrames = __FP_Selectors.getAllValid("captchaFrames");
  for (const frame of turnstileFrames) {
    if (!isVisibleForClick(frame)) continue;
    
    // Safety check: Don't click if it's already solved or if it's explicitly "unsolved"
    // (Turnstile frames often have a name like 'cf-chl-widget-...')
    const resp = __FP_Selectors.getFirstValid("captchaTokenCloudflare");
    if (resp && resp.value && resp.value.length > 30) continue;
    
    if (clickElementRobust(frame, "Turnstile iframe")) return true;
  }

  // 2. Try Turnstile Checkboxes (if visible inside frame or via fallback)
  const turnstileCheckboxes = __FP_Selectors.getAllValid("captchaCheckboxes");
  for (const checkbox of turnstileCheckboxes) {
    if (checkbox.checked || !isVisibleForClick(checkbox)) continue;
    if (clickElementRobust(checkbox, "Turnstile checkbox")) return true;
  }

  // 3. Fallbacks (Generic/hCaptcha/Icon)
  let widget = __FP_Selectors.getFirstValid("captchaHCaptchaWidget");
  if (widget && isVisibleForClick(widget) && clickElementRobust(widget, "hCaptcha widget")) return true;

  widget = __FP_Selectors.getFirstValid("captchaIconWidget");
  if (widget && isVisibleForClick(widget) && clickElementRobust(widget, "IconCaptcha widget")) return true;

  widget = __FP_Selectors.getFirstValid("captchaPCaptchaWidget");
  if (widget && isVisibleForClick(widget) && clickElementRobust(widget, "pCaptcha widget")) return true;

  log("No valid captcha widget found to click (avoiding container-level clicks)");
  return false;
}

async function rotateCaptchaType() {
  const select = __FP_Selectors.getFirstValid("captchaSelect");
  if (!select) {
    log("Captcha rotation: No selection dropdown found");
    return false;
  }

  const options = Array.from(select.options).filter(o => !o.disabled && o.value);
  if (options.length <= 1) {
    log("Captcha rotation: Only one method available, cannot rotate");
    return false;
  }

  const currentIndex = select.selectedIndex;
  const nextPos = (currentIndex >= 0 && currentIndex < select.options.length - 1) ? currentIndex + 1 : 0;
  const nextOption = select.options[nextPos];

  if (nextOption.disabled || !nextOption.value) {
    // Try the first valid one
    for (let i = 0; i < select.options.length; i++) {
        if (!select.options[i].disabled && select.options[i].value) {
            select.selectedIndex = i;
            break;
        }
    }
  } else {
    select.selectedIndex = nextPos;
  }

  const newLabel = select.options[select.selectedIndex].text;
  log(`Captcha rotation: Switched to ${newLabel} (value: ${select.value})`);
  
  // Trigger change event
  select.dispatchEvent(new Event('change', { bubbles: true }));
  
  // Wait a bit for the page to update the UI
  await sleep(2000);
  return true;
}

function hasCaptchaWidget() {
  return !!(
    __FP_Selectors.getFirstValid("captchaTurnstileWidget") ||
    __FP_Selectors.getFirstValid("captchaHCaptchaWidget") ||
    __FP_Selectors.getFirstValid("captchaGenericWidget") ||
    __FP_Selectors.getFirstValid("captchaIconWidget") ||
    __FP_Selectors.getFirstValid("captchaFrames") ||
    __FP_Selectors.getFirstValid("captchaTokenCloudflare") ||
    __FP_Selectors.getFirstValid("captchaTokenIcon")
  );
}

function waitForCaptchaToken(timeoutMs = window.__FP_MAX_WAIT_MS) {
  return new Promise((resolve) => {
    const start = Date.now();
    let clickAttempts = 0;
    let lastClickTime = 0;
    let lastFocusTime = 0;
    const maxClickAttempts = Math.max(window.MAX_CAPTCHA_RETRIES, Math.ceil(timeoutMs / window.__FP_RETRY_MS));
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

      const readyToClick = (elapsed >= 1000);

      if (readyToClick && (now - lastClickTime >= window.__FP_RETRY_MS) && clickAttempts < maxClickAttempts) {
        console.log(`[FaucetPlugin] Triggering captcha interaction attempt ${clickAttempts + 1}...`);
        const clicked = tryClickCaptchaWidget();
        if (clicked) {
          lastClickTime = now;
          clickAttempts++;
          lastClickTime = now - (window.__FP_RETRY_MS / 2); 
        }
      }

      if (elapsed > timeoutMs) {
        finish(null);
      }
    }

    timer = setInterval(pollCaptchaToken, window.__FP_POLL_MS);
  });
}
