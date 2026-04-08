// ── selectors.js ─────────────────────────────────────────────────────────────

const SiteSelectors = {
  get(key) {
    if (!key) return [];
    const host = window.location.hostname.replace('www.', '');
    const specific = this[host]?.[key];
    if (specific) {
      if (Array.isArray(specific) && specific.length > 0) return specific;
      if (typeof specific === 'string') return [specific];
    }
    const fallback = this.generic[key];
    if (Array.isArray(fallback)) return fallback;
    if (typeof fallback === 'string') return [fallback];
    return [];
  },

  getFirstValid(key, context = document) {
    const list = this.get(key);
    for (const sel of list) {
      if (!sel) continue;
      const el = context.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  },

  getAllValid(key, context = document) {
    const list = this.get(key);
    const results = [];
    for (const sel of list) {
      if (!sel) continue;
      const nodes = context.querySelectorAll(sel);
      for (const node of nodes) {
        if (node.offsetParent !== null) results.push(node);
      }
    }
    return results;
  },

  injectCustom(customFaucets = []) {
    if (!Array.isArray(customFaucets)) return;
    for (const f of customFaucets) {
      if (!f.url || !f.selectors) continue;
      try {
        const host = new URL(f.url).hostname.replace('www.', '');
        if (!this[host]) this[host] = {};
        for (const [key, val] of Object.entries(f.selectors)) {
          this[host][key] = val;
        }
      } catch (err) {}
    }
  },

  "litepick.io": {
    balance: [".user_balance", ".header-balance"]
  },

  "generic": {
    // ── Global ──
    balancePrimary: [
      "#game_dice .user_balance", ".user_balance",
      "#game_dice [class*='balance' i]", "#game_dice [id*='balance' i]",
      ".balance-value", "#balance", ".bal-amt"
    ],
    balanceFallback: [
      '[class*="balance"]', '[id*="balance"]', '[class*="wallet"]', '[id*="wallet"]',
      '[class*="amount"]', '[id*="amount"]', '.bal', '#bal', '.user-info b', '.navbar-text b'
    ],

    // ── Auth ──
    loginForm: ['form'],
    loginPassword: ['input[type="password"]'],
    loginEmail: [
      'input[type="email"]',
      'input[name*="user" i]',
      'input[name*="email" i]',
      'input[name*="login" i]',
      'input[name*="account" i]',
      'input[name*="username" i]',
      'input[autocomplete="username" i]',
      'input[type="text"][name]:not([readonly])',
      'input[type="text"]'
    ],
    loginSubmitBySelector: [
      'button[type="submit"]:not([disabled])',
      'button[type="submit"]',
      'input[type="submit"]:not([disabled])',
      'input[type="submit"]',
      'button:not([disabled])'
    ],
    loginSubmitByText: [
      'button', 'input[type="submit"]', 'input[type="button"]', 'a[role="button"]'
    ],

    // ── Captcha ──
    captchaFrames: [
      'iframe[src*="challenges.cloudflare.com"][src*="turnstile"]',
      'iframe[src*="challenges.cloudflare.com"]',
      'iframe[src*="turnstile"]',
      'iframe[src*="captcha"]',
      'iframe[title*="turnstile" i]',
      'iframe[src*="hcaptcha.com"]'
    ],
    captchaCheckboxes: [
      '.cf-turnstile input[type="checkbox"]',
      'input[type="checkbox"][name*="turnstile" i]'
    ],
    captchaTurnstileWidget: ['.cf-turnstile', '[id*="turnstile" i]', '[class*="turnstile" i]', '[data-turnstile-callback]'],
    captchaHCaptchaWidget: ['.h-captcha', '#hCaptchaBox'],
    captchaGenericWidget: ['[data-sitekey]'],
    captchaIconWidget: ['.iconcaptcha-holder', '.iconcaptcha-widget'],
    captchaPCaptchaWidget: ['#pCaptcha', '.captcha-container'],
    captchaSelect: ['#select_captcha', 'select[name*="captcha" i]'],
    captchaTokenCloudflare: ['input[name="cf-turnstile-response"]', 'input[name="h-captcha-response"]', 'input[name="g-recaptcha-response"]'],
    captchaTokenIcon: ['input[name="iconcaptcha-token"]', 'input[name="ic-token"]', '.iconcaptcha-token'],
    captchaIconPassed: ['.iconcaptcha-holder.iconcaptcha-passed', '.iconcaptcha-holder[data-completed="true"]'],

    // ── Withdraw ──
    withdrawMinAmountText: ['.min_withdraw', '#min_withdraw', '.withdrawal_min', '.alert-info', '.text-muted', '.form-wrapper__main p b'],
    withdrawAddressInput: ['#withdrawal_address', '[name*="address" i]', '[id*="address" i]'],
    withdrawMaxBtn: ['#max_amount'],
    withdrawSubmitBtn: ['button[type="submit"]', 'input[type="submit"]'],
    withdrawSubmitBtnFallback: ['button'],

    // ── Faucet ──
    faucetBonusBadge: ['#free_spins', '.badge'],
    faucetBonusMessages: ['.alert', '.message', '.msg', '.info', '.notice', '[class*="alert"]', '[class*="message"]', '[class*="result"]', 'p', 'span', 'div'],
    faucetBonusTab: [
      '[data-type="bonus"].faucet-tab', '[data-type="bonus"]', 'div[data-type="bonus"]',
      'a[data-type="bonus"]', '.faucet-tab[data-type="bonus"]', '[data-tab="bonus"]',
      'button[data-tab="bonus"]', '#bonus-tab', '.bonus-tab', 'li[data-type="bonus"]',
      '[class*="bonus"][class*="tab"]'
    ],
    faucetBonusContent: [
      '[data-type="bonus"][class*="content"]', '[data-tab="bonus"][class*="content"]',
      '.bonus-content', '[aria-labelledby*="bonus"]', '[class*="tab-pane"]', 
      '[class*="tab-content"]', '.content', '[role="tabpanel"]'
    ],
    faucetClaimBtnPrimary: [
      'button[type="submit"]', 'input[type="submit"]',
      'button.btn-claim', 'button.claim', '#claim',
      'button[onclick*="claim" i]', 'button[onclick*="roll" i]',
      'button[class*="claim"]', 'button[class*="submit"]',
      'a[onclick*="claim" i]', 'a[onclick*="roll" i]',
      'input[value*="claim" i]', 'input[value*="roll" i]',
      'button', 'input[type="button"]'
    ],
    faucetClaimBtnContext: ['button', 'input[type="submit"]', 'input[type="button"]', 'a[onclick]'],
    faucetClaimBtnContextAttr: ['[onclick*="claim" i]', '[onclick*="roll" i]', '[onclick*="submit" i]', '[class*="claim" i]', '[class*="roll" i]'],

    // ── Dice ──
    diceChanceInput: [
      '#win_chance',
      'input[id*="chance" i]', 'input[name*="chance" i]',
      'input[id*="percent" i]', 'input[name*="percent" i]',
      'input[id*="payout" i]', 'input[name*="payout" i]',
      'input[placeholder*="chance" i]', 'input[placeholder*="percent" i]'
    ],
    diceBetButton: [
      '#roll_dice',
      'button[onclick*="bet" i]', 'button[onclick*="play" i]', 'button[onclick*="roll" i]',
      'button[class*="bet" i]', 'button[class*="play" i]',
      'button[id*="bet" i]', 'button[id*="play" i]', 'button[id*="roll" i]',
      'input[type="button"][value*="Bet" i]', 'input[type="button"][value*="Roll" i]',
      'button[type="submit"]'
    ],
    diceAmountInput: [
      '#bet_amount', 'input[name="bet_amount"]',
      'input[id*="amount" i]', 'input[id*="stake" i]',
      'input[name*="amount" i]', 'input[name*="stake" i]', 'input[name*="bet" i]',
      'input[placeholder*="amount" i]', 'input[placeholder*="stake" i]',
      'input[type="number"]'
    ],
    diceMultiplierInput: [
      '#multiplier', 'input[name="multiplier"]',
      'input[id*="multiplier" i]', 'input[id*="payout" i]', 'input[name*="payout" i]'
    ]
  }
};
