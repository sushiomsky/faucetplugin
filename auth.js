(function() {
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
  if (typeof __FP_Crypto !== 'undefined') {
    username = await __FP_Crypto.decrypt(username);
    password = await __FP_Crypto.decrypt(password);
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
      await window.sleep(200);
      if (pwdInput) pwdInput.focus();
      nudged = true;
    }

    await window.sleep(300);
  }

  return null;
}

function setupManualLoginCapture() {
  const forms = __FP_Selectors.getAllValid("loginForm");
  for (const form of forms) {
    if (!__FP_Selectors.getFirstValid("loginPassword", form)) continue; 
    
    async function onManualLoginSubmit() {
      const userInput = __FP_Selectors.getFirstValid("loginEmail", form);
      const pwdInput = __FP_Selectors.getFirstValid("loginPassword", form);
      
      const username = userInput?.value?.trim();
      const password = pwdInput?.value?.trim();
      
      if (username && password) {
        window.log(`Captured credentials from manual login: ${username}`);
        
        const faucetUrl = await window.getFaucetUrl();
        const { settings = {} } = await chrome.storage.local.get('settings');
        
        if (settings.faucets) {
          const faucet = settings.faucets.find(f => window.sameHost(f.url, faucetUrl));
          if (faucet) {
            let encUser = username;
            let encPass = password;
            if (typeof __FP_Crypto !== 'undefined') {
              encUser = await __FP_Crypto.encrypt(username);
              encPass = await __FP_Crypto.encrypt(password);
            }
            faucet.username = encUser;
            faucet.password = encPass;
            await chrome.storage.local.set({ settings });
            window.log(`✓ Stored and encrypted credentials for ${faucet.label}`);
          }
        }
      }
    }

    form.addEventListener('submit', onManualLoginSubmit, { once: true });
  }
}

window.runLogin = async function runLogin() {
  window.log("Login page:", location.href);

  await window.waitForRocketLoaderHandlers();
  await window.sleep(1500);

  window.scrollToBottom();
  await window.sleep(800);

  let form = null;
  let loginScope = null;
  let pwdInput = null;
  let attemptCount = 0;
  const maxAttempts = Math.ceil(window.LOGIN_FORM_WAIT_MS / 500);

  for (let i = 0; i < maxAttempts; i++) {
    const forms = __FP_Selectors.getAllValid("loginForm");
    form = forms.find(f => __FP_Selectors.getFirstValid("loginPassword", f));
    pwdInput = form ? __FP_Selectors.getFirstValid("loginPassword", form) : __FP_Selectors.getFirstValid("loginPassword");

    if (pwdInput) {
      loginScope = form || pwdInput.closest("form") || document;
      window.log(`✓ Login inputs found on attempt ${i + 1}/${maxAttempts}`);
      break;
    }
    attemptCount = i + 1;
    await window.sleep(500);
  }

  if (!pwdInput) {
    window.log(`✗ Password input not found`);
    window.sendError("no-password-input");
    return;
  }

  const userInput = __FP_Selectors.getFirstValid("loginEmail", loginScope) || __FP_Selectors.getFirstValid("loginEmail", document);

  const creds = await getCredentials();
  const hasStoredCreds = !!(creds.username && creds.password);

  if (hasStoredCreds) {
    window.log("✓ Found extension-stored credentials, filling...");
    if (userInput) {
      fillInput(userInput, creds.username);
      await window.sleep(window.INPUT_SETTLE_MS);
    }
    fillInput(pwdInput, creds.password);
    await window.sleep(window.INPUT_SETTLE_MS);
  } else {
    window.log("No extension credentials configured. Trying Chrome Password Manager autofill...");
    setupManualLoginCapture();

    const autofilled = await waitForPasswordManagerAutofill(userInput, pwdInput);
    if (!autofilled) {
      if (window.hasCaptchaWidget()) {
        chrome.runtime.sendMessage({ type: "focus-tab" });
        await window.sleep(400);
        window.tryClickCaptchaWidget();
      }
      window.log("No autofilled credentials detected — waiting for manual login");
      return;
    }

    window.log(`✓ Using Chrome Password Manager autofill`);
    triggerInputEvents(userInput);
    triggerInputEvents(pwdInput);
    await window.sleep(window.INPUT_SETTLE_MS);
  }

  await window.sleep(window.CAPTCHA_SETTLE_MS);

  if (window.hasCaptchaWidget()) {
    window.log("Captcha detected on login page");
    chrome.runtime.sendMessage({ type: "focus-tab" });
    await window.sleep(500);

    window.tryClickCaptchaWidget();
    await window.sleep(window.CAPTCHA_SETTLE_MS);

    const token = await window.waitForCaptchaToken(90000); 
    if (!token) {
      window.log("✗ Login captcha timeout");
      window.sendError("login-captcha-timeout");
      return;
    }
    window.log("✓ Login captcha resolved");
  }

  let submitBtn = __FP_Selectors.getFirstValid("loginSubmitBySelector", loginScope);
  if (!submitBtn) {
    const textBtns = __FP_Selectors.getAllValid("loginSubmitByText", loginScope);
    submitBtn = textBtns.find(el => !el.disabled && /login|log in|sign in|submit|continue/i.test((el.textContent || el.value || "").trim()));
  }

  if (!submitBtn) {
    window.sendError("no-submit-button");
    return;
  }

  window.log(`✓ Found submit button: "${submitBtn.textContent?.trim() || submitBtn.value || 'Submit'}"`);
  
  if (submitBtn.offsetParent === null) {
    submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    await window.sleep(500);
  }

  if (!clickElementRobust(submitBtn, "login submit button")) {
    try { submitBtn.click(); } catch (_) {}
  }
  
  const delay = window.randomDelay();
  await window.sleep(delay);
}
})();
