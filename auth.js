// ── auth.js ─────────────────────────────────────────────────────────────

async function getCredentials() {
  const { settings } = await chrome.storage.local.get("settings");
  const faucets = settings?.faucets || [];
  const faucet = faucets.find(f => {
    try { return new URL(f.url).hostname === location.hostname; } catch { return false; }
  });
  
  if (!faucet) return { username: "", password: "" };

  let username = faucet.username || "";
  let password = faucet.password || "";

  // Decrypt if necessary. We assume crypto-utils.js is loaded in the same context.
  if (typeof CryptoUtils !== 'undefined') {
    username = await CryptoUtils.decrypt(username);
    password = await CryptoUtils.decrypt(password);
  }

  return { username, password };
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

function setupManualLoginCapture() {
  const forms = SiteSelectors.getAllValid("loginForm");
  for (const form of forms) {
    if (!SiteSelectors.getFirstValid("loginPassword", form)) continue; 
    
    async function onManualLoginSubmit() {
      const userInput = SiteSelectors.getFirstValid("loginEmail", form);
      const pwdInput = SiteSelectors.getFirstValid("loginPassword", form);
      
      const username = userInput?.value?.trim();
      const password = pwdInput?.value?.trim();
      
      if (username && password) {
        log(`Captured credentials from manual login: ${username}`);
        
        const faucetUrl = await getFaucetUrl();
        const { settings = {} } = await chrome.storage.local.get('settings');
        
        if (settings.faucets) {
          const faucet = settings.faucets.find(f => sameHost(f.url, faucetUrl));
          if (faucet) {
            let encUser = username;
            let encPass = password;
            if (typeof CryptoUtils !== 'undefined') {
              encUser = await CryptoUtils.encrypt(username);
              encPass = await CryptoUtils.encrypt(password);
            }
            faucet.username = encUser;
            faucet.password = encPass;
            await chrome.storage.local.set({ settings });
            log(`✓ Stored and encrypted credentials for ${faucet.label}`);
          }
        }
      }
    }

    form.addEventListener('submit', onManualLoginSubmit, { once: true });
  }
}

async function runLogin() {
  log("Login page:", location.href);

  await sleep(1500);
  scrollToBottom();
  await sleep(800);

  let form = null;
  let loginScope = null;
  let pwdInput = null;
  let attemptCount = 0;
  const maxAttempts = Math.ceil(window.LOGIN_FORM_WAIT_MS / 500);

  for (let i = 0; i < maxAttempts; i++) {
    const forms = SiteSelectors.getAllValid("loginForm");
    form = forms.find(f => SiteSelectors.getFirstValid("loginPassword", f));
    pwdInput = form ? SiteSelectors.getFirstValid("loginPassword", form) : SiteSelectors.getFirstValid("loginPassword");

    if (pwdInput) {
      loginScope = form || pwdInput.closest("form") || document;
      log(`✓ Login inputs found on attempt ${i + 1}/${maxAttempts}`);
      break;
    }
    attemptCount = i + 1;
    await sleep(500);
  }

  if (!pwdInput) {
    log(`✗ Password input not found`);
    sendError("no-password-input");
    return;
  }

  const userInput = SiteSelectors.getFirstValid("loginEmail", loginScope) || SiteSelectors.getFirstValid("loginEmail", document);

  const creds = await getCredentials();
  const hasStoredCreds = !!(creds.username && creds.password);

  if (hasStoredCreds) {
    log("✓ Found extension-stored credentials, filling...");
    if (userInput) {
      fillInput(userInput, creds.username);
      await sleep(window.INPUT_SETTLE_MS);
    }
    fillInput(pwdInput, creds.password);
    await sleep(window.INPUT_SETTLE_MS);
  } else {
    log("No extension credentials configured. Trying Chrome Password Manager autofill...");
    setupManualLoginCapture();

    const autofilled = await waitForPasswordManagerAutofill(userInput, pwdInput);
    if (!autofilled) {
      if (hasCaptchaWidget()) {
        chrome.runtime.sendMessage({ type: "focus-tab" });
        await sleep(400);
        tryClickCaptchaWidget();
      }
      log("No autofilled credentials detected — waiting for manual login");
      return;
    }

    log(`✓ Using Chrome Password Manager autofill`);
    triggerInputEvents(userInput);
    triggerInputEvents(pwdInput);
    await sleep(window.INPUT_SETTLE_MS);
  }

  await sleep(window.CAPTCHA_SETTLE_MS);

  if (hasCaptchaWidget()) {
    log("Captcha detected on login page");
    chrome.runtime.sendMessage({ type: "focus-tab" });
    await sleep(500);

    tryClickCaptchaWidget();
    await sleep(window.CAPTCHA_SETTLE_MS);

    const token = await waitForCaptchaToken(90000); 
    if (!token) {
      log("✗ Login captcha timeout");
      sendError("login-captcha-timeout");
      return;
    }
    log("✓ Login captcha resolved");
  }

  let submitBtn = SiteSelectors.getFirstValid("loginSubmitBySelector", loginScope);
  if (!submitBtn) {
    const textBtns = SiteSelectors.getAllValid("loginSubmitByText", loginScope);
    submitBtn = textBtns.find(el => !el.disabled && /login|log in|sign in|submit|continue/i.test((el.textContent || el.value || "").trim()));
  }

  if (!submitBtn) {
    sendError("no-submit-button");
    return;
  }

  log(`✓ Found submit button: "${submitBtn.textContent?.trim() || submitBtn.value || 'Submit'}"`);
  
  if (submitBtn.offsetParent === null) {
    submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(500);
  }

  if (!clickElementRobust(submitBtn, "login submit button")) {
    try { submitBtn.click(); } catch (_) {}
  }
  
  const delay = randomDelay();
  await sleep(delay);
}
