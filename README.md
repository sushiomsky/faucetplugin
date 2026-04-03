# 🚰 FaucetPick v2.6.0
### The Gold Standard in Faucet Automation

**FaucetPick** is a premium Chrome browser extension (Manifest V3) that automates "pick-style" cryptocurrency faucets (like Litepick, Dogepick, etc.). It operates as a fully local, "set-and-forget" automation engine with an advanced anti-detection layer, automatic withdrawals, and real-time Telegram alerts.

---

## ✨ Key Features

### 🤖 Smart Automation Engine
- **Sequential Queue Scheduler**: Enabled faucets are processed one-at-a-time via a robust queue managed by the service worker. New tabs are opened in an inactive state to avoid disturbing the user.
- **Human-Like Behavior**: Randomized delays between claims (15–60 seconds configurable). "Long Breaks" (65–80 minutes, configurable) are triggered every N claims to reduce pattern detection.
- **Stale Tab Recovery**: The background worker automatically prunes tabs that time out (> 20 minutes per phase) and re-queues their faucets.
- **Native Click Emulation**: Uses the Chrome DevTools Protocol (`debugger` API) to dispatch hardware-level `mousePressed` / `mouseReleased` events, bypassing JS-layer click detection.

### 🌐 Supported Platforms
All six platforms are configured in `constants.js` and map to real CoinGecko price IDs for live USD balance tracking.

| Platform | Coin | CoinGecko ID |
|---|---|---|
| **Litepick** (`litepick.io`) | LTC | `litecoin` |
| **Dogepick** (`dogepick.io`) | DOGE | `dogecoin` |
| **Solpick** (`solpick.io`) | SOL | `solana` |
| **Bnbpick** (`bnbpick.io`) | BNB | `binancecoin` |
| **Tronpick** (`tronpick.io`) | TRX | `tron` |
| **Polpick** (`polpick.io`) | POL/MATIC | `matic-network` |

### 💰 Professional Tools
- **Auto-Withdrawal**: When your balance exceeds the configured threshold, the bot navigates to `/withdraw.php`, fills in your wallet address (using `max` amount), solves the captcha, and submits — automatically.
- **DiceBet Integration**: After a successful faucet claim, the bot can navigate to `/dice.php` and execute a configurable betting strategy before withdrawing.
- **Telegram Yield Alerts**: Sends real-time Markdown-formatted notifications via the Telegram Bot API for successful withdrawals and errors.
- **Live Price Tracking**: Fetches cryptocurrency USD prices from the CoinGecko API every 15 minutes.
- **Auto-Update Check**: Every 12 hours the extension checks `version.json` on GitHub and notifies you via Telegram if a new version is available.

---

## 🚀 Getting Started

### For End Users
1. **Install** the extension via the Chrome Web Store (or load it unpacked — see Developer below).
2. On first install, the **Setup Wizard** (`setup.html`) launches automatically.
3. Complete the 3-step wizard: select your faucets, enter your wallet addresses, and optionally configure Telegram alerts.
4. Click **"Start Automation"** — the extension does the rest.

---

## 📁 Project Structure

```
faucetplugin/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker — scheduler, alarm, message broker
├── content.js             # Content script orchestrator (runs on all pages)
├── constants.js           # Single source of truth: faucet list, defaults, utilities
├── utils.js               # Content-script runtime helpers, page detection, messaging
├── selectors.js           # CSS selector registry for all page interactions
├── auth.js                # Login automation (stores encrypted credentials)
├── captcha.js             # Cloudflare Turnstile / hCaptcha detection & resolution
├── faucet.js              # Main faucet claim flow (including bonus rounds)
├── dice.js                # DiceBet strategy engine
├── withdraw.js            # Withdrawal automation flow
├── crypto-utils.js        # AES-GCM 256-bit encryption for chrome.storage.local
├── popup.html/.js/.css    # Extension popup dashboard UI
├── setup.html/.js         # First-run setup wizard
├── version.json           # Remote version manifest (checked by auto-update)
├── icons/                 # Extension icons (16, 48, 128px)
├── branding/              # Source branding assets
├── cws_assets/            # Chrome Web Store screenshots
└── cws_submission_assets/ # CWS submission screenshots
```

---

## ⚙️ Architecture

### Content Script Load Order
Scripts are injected in order by `manifest.json` via `content_scripts`:
```
constants.js → crypto-utils.js → selectors.js → utils.js → captcha.js → auth.js → dice.js → faucet.js → withdraw.js → content.js
```
`content.js` is the orchestrator that calls `runLogin()`, `runFaucet()`, `runDicebet()`, or `runWithdraw()` depending on the current page type.

### Storage Keys (`chrome.storage.local`)
| Key | Type | Description |
|---|---|---|
| `settings` | Object | All user configuration (faucets array, telegram, long-break settings) |
| `activeTabs` | Object | `{[tabId]: {faucetUrl, phase, wdAddress, startedAt}}` |
| `claimHistory` | Object | `{[faucetUrl]: lastClaimTimestamp}` |
| `claimQueue` | Array | Ordered list of faucet URLs pending execution |
| `claimCounts` | Object | `{[faucetUrl]: totalClaimCount}` — used to trigger Long Breaks |
| `activityLog` | Array | Last 30 log entries (status, reason, balance, ts) |
| `cryptoPrices` | Object | `{data: {...}, ts: timestamp}` — CoinGecko cache |
| `running` | Boolean | Whether the scheduler is active |
| `updateAvailable` | Boolean | Whether a newer version exists on GitHub |
| `setupComplete` | Boolean | Whether the first-run wizard has been completed |
| `diceRandom14State` | Object | `{[hostname]: {settledBetCount, nextRandom14BetAt, updatedAt}}` — per-host schedule for the DiceBet 14%-chance injection system |
| `minWdThresholds` | Object | `{[hostname]: number}` — minimum withdrawal values scraped from `/withdraw.php` pages |
| `_extension_key` | Array | Raw AES-GCM key bytes (serialized `Uint8Array`). **Clearing extension data permanently invalidates all stored credentials.** |

### Primary Chrome API Permissions
| Permission | Usage |
|---|---|
| `tabs` | Open faucet tabs (inactive), focus tabs for captcha, close tabs after claim |
| `alarms` | `faucet-tick` every 1 min, `price-update` every 15 min, `protocol-sync` every 12 hours |
| `storage` | All settings, state, and encrypted credentials stored in `storage.local` |
| `scripting` | Not used directly by MV3; `content_scripts` in manifest handles injection |
| `debugger` | `Input.dispatchMouseEvent` via DevTools Protocol for native click emulation |
| `<all_urls>` | Required to run content scripts on the configured faucet sites |

---

## 🛠️ Developer Guide

### Prerequisites
- Google Chrome (or Chromium-based browser)
- No build step required — the extension runs as raw JavaScript.

### Loading the Extension (Developer Mode)
1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer Mode** (toggle in the top right).
4. Click **"Load unpacked"** and select the root directory of this repository.
5. The extension will appear with a 🚰 icon in your toolbar.

### Reloading After Code Changes
After modifying any `.js` or `.json` file:
```bash
# No build needed. In Chrome:
# chrome://extensions → Find "FaucetPick" → Click the ↺ Reload icon
```
> **NOTE**: After reloading, any open faucet tabs managed by the old service worker will be orphaned. Close them manually before testing.

### Enabling Debug Logs
Two `DEBUG` flags exist — one in the background service worker and one in the content script context:

**Content scripts** (`utils.js`):
```javascript
// Set to true in utils.js line 28
window.DEBUG = true;
```

**Background service worker** (`background.js`):
```javascript
// Set to true in background.js line 4
const DEBUG = true;
```
All debug output will appear in the respective DevTools console (Inspect → service worker for background; F12 for content script).

### Per-Faucet Configuration Object
Each faucet entry in `settings.faucets` has this shape (sourced from `constants.js → makeFaucetDefaults()`):
```javascript
{
  url:              "https://litepick.io/",
  label:            "litepick",
  active:           false,       // Master on/off switch
  referralId:       "frankgoosen",
  intervalMinutes:  61,          // Base claim interval
  minRandomMinutes: 0,           // Min random jitter added to interval
  maxRandomMinutes: 5,           // Max random jitter added to interval
  username:         "",          // Encrypted via CryptoUtils.encrypt()
  password:         "",          // Encrypted via CryptoUtils.encrypt()
  wdEnabled:        true,        // Auto-withdrawal on/off
  wdThreshold:      "0.05",      // Balance threshold to trigger withdrawal (in coin units)
  wdAddress:        "",          // Destination wallet address
  dbEnabled:        false,       // DiceBet on/off
  dbChance:         "1",         // Dice win chance percentage
  dbSide:           "higher",    // "higher" or "lower"
  dbStrategy:       "all-in-0.1", // Strategy identifier (see dice.js)
  dbStrategyConfig: { ... }      // High-roller strategy config object
}
```

### Default Withdrawal Thresholds (≈ $5 USD equivalent)
Defined in `constants.js → DEFAULT_USD5_WD_THRESHOLD_BY_HOST`:
```javascript
"litepick.io":  "0.05"   // LTC
"dogepick.io":  "30"     // DOGE
"solpick.io":   "0.0325" // SOL
"bnbpick.io":   "0.009"  // BNB
"tronpick.io":  "40"     // TRX
"polpick.io":   "10"     // POL
```

### Dice Strategies
Two strategies are defined in `constants.js` and implemented in `dice.js`:
- **`all-in-0.1`** (`DICE_STRATEGY_ALL_IN_001`): Default. A single all-in bet of the full balance at the configured win-chance percentage. Returns immediately after one roll.
- **`combined-high-roller`** (`DICE_STRATEGY_COMBINED_HIGH_ROLLER`): Multi-round adaptive class (`CombinedHighRollerStrategy`). Three operating modes: `kelly_hybrid` (base), `streak_harvester` (after N consecutive wins ≥ `streak_trigger`), `volatility_breakout` (after volatility delta ≥ `volatility_trigger`). Injects a random 14% chance bet every 5–20 rounds (the **RANDOM_14 system**, persisted per-host in `diceRandom14State`). Configurable via `dbStrategyConfig`:

  | Field | Default | Range | Description |
  |---|---|---|---|
  | `base_bet_fraction` | `0.10` | `0.00000001`–`0.95` | Base fraction of bankroll per bet |
  | `max_bet_fraction` | `0.40` | `base_bet_fraction`–`1.0` | Hard cap per bet |
  | `max_ladder_depth` | `5` | `1`–`10` | Max ladder steps in harvest/breakout modes |
  | `history_window` | `10` | `1`–`200` | Rolling history size for volatility calculation |
  | `streak_trigger` | `1` | `1`–`50` | Consecutive wins to enter streak_harvester mode |
  | `volatility_trigger` | `4` | `1`–`history_window` | Win/loss delta to enter volatility_breakout mode |

> **NOTE**: DiceBet configuration (`dbEnabled`, `dbChance`, `dbSide`, `dbStrategy`, `dbStrategyConfig`) is **not currently exposed in the popup UI**. These fields exist in `settings.faucets` and are fully processed by the engine, but `popup.js → renderConfigForSite()` only shows interval, withdrawal, and address fields. DiceBet settings must be set programmatically or via the setup wizard.

### Adding a New Faucet Site
1. Add an entry to `makeFaucetDefaults()` in `constants.js`.
2. Add the CoinGecko price ID mapping to `CRYPTO_PRICE_IDS` in `constants.js`.
3. Add the default USD threshold to `DEFAULT_USD5_WD_THRESHOLD_BY_HOST` in `constants.js`.
4. If the site uses non-standard HTML, add site-specific CSS selectors to `SiteSelectors` in `selectors.js`.
5. Reload the extension.

---

## 🧪 Testing

> **NOTE**: There is currently no automated test suite. All testing is manual.

### Manual Testing Checklist
- [ ] Load extension unpacked in Chrome with `Developer Mode` enabled.
- [ ] Open the setup wizard and complete all 3 steps.
- [ ] Enable one faucet site and verify a claim cycle completes (watch the service worker console).
- [ ] Test login automation by setting credentials and verifying `CryptoUtils.encrypt()` output in `chrome.storage.local`.
- [ ] Verify withdrawal triggers when balance meets the configured threshold.
- [ ] Enable `window.DEBUG = true` in `utils.js` to trace the full content-script flow.

> **TODO**: Add Playwright or Puppeteer E2E tests to simulate a full claim cycle in a controlled browser environment.

---

## 📦 Deployment (Chrome Web Store)

1. Ensure `manifest.json` version is updated.
2. Update `version.json` with the new version and a `download_url` pointing to the new release zip.
3. Zip the extension root (exclude `.git`, `.ai`, `branding/`, `cws_assets/`, `cws_submission_assets/`, `*.md`):
   ```bash
   cd "faucetplugin 2"
   zip -r faucet-pro-v2.6.0.zip . \
     --exclude "*.git*" \
     --exclude ".ai/*" \
     --exclude "branding/*" \
     --exclude "cws_assets/*" \
     --exclude "cws_submission_assets/*" \
     --exclude "*.md" \
     --exclude "implementation_plan.md"
   ```
4. Upload the zip to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## 🔧 Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Extension doesn't open any tabs | `settings.enabled` is `false` | Click "Start" in the popup |
| Tab opens but claim fails | Login not configured | Enter credentials in the site's settings panel |
| "PERMISSION DENIED" in service worker console | `<all_urls>` permission not granted | `chrome://extensions` → Details → Allow access to all sites |
| Captcha loop doesn't resolve | Cloudflare Turnstile widget not found | Check `selectors.js → captchaFrames` for updated selectors |
| Balance shows 0 or null | Balance selector mismatch | Open DevTools on faucet page, inspect balance element, update `selectors.js` |
| Telegram alerts not sending | Missing Bot Token or Chat ID | Verify in Settings → Telegram section |
| Extension resets every browser restart | Service worker crashed | Check `chrome://extensions` → service worker Errors |

---

## 🛡️ Safety & Privacy

- **100% Local**: All settings and sensitive data are stored exclusively in `chrome.storage.local`. Nothing is uploaded to any server.
- **AES-GCM 256-bit Encryption**: Credentials (usernames and passwords) are encrypted using the Web Crypto API before being stored. The encryption key is itself stored locally in `_extension_key`.
- **No Tracking**: No analytics, telemetry, or third-party data collection of any kind.
- **External Calls**: The extension makes outbound requests to: Telegram Bot API (if alerts enabled), CoinGecko API (price data), and GitHub (version check). All are described in `PRIVACY_POLICY.md`.

---

## ⚖️ Disclaimer

*FaucetPick is intended for personal automation and research purposes. Please ensure you comply with the terms of service of the sites you use. The developers are not responsible for account-related issues or financial losses.*

---

**© 2026 FaucetPick Labs. Precision. Security. Automation.**
`sushiomsky/faucetplugin` • [GitHub](https://github.com/sushiomsky/faucetplugin)
