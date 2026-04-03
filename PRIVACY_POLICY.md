# Privacy Policy for FaucetPick

**Last Updated: April 3, 2026**
**Extension Version: 2.6.0**

FaucetPick ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and handle your information when you use our browser extension.

---

## 1. Information Collection and Storage

FaucetPick is designed to run entirely on your local machine.

- **No Personal Data Uploads**: We do **not** collect, store, or transmit any personal data (such as your name, email, or wallet addresses) to our servers.
- **Local Storage Only**: All settings, faucet configurations, wallet addresses, and activity logs are stored locally using the Chrome `storage.local` API. This information never leaves your browser unless you manually export it.
- **AES-GCM Encryption**: Sensitive information (usernames and passwords configured for automated login) is encrypted using AES-GCM 256-bit encryption via the browser's native Web Crypto API before being written to `chrome.storage.local`. The encryption key is also stored locally and never transmitted.

---

## 2. Third-Party Services

Our extension interacts with the following third-party services to provide core functionality. No personally identifiable information is included in any of these requests.

- **Faucet Websites**: The extension automates claims on the faucet sites you choose to enable. This interaction is functionally identical to you visiting the site manually in a browser tab.
- **Telegram API** (`api.telegram.org`): If you enable Telegram alerts, the extension will send formatted status messages to the Telegram bot token and chat ID **you provide**. This data is sent directly to Telegram's servers and is governed by [Telegram's Privacy Policy](https://telegram.org/privacy). We do not store, log, or forward your bot token.
- **CoinGecko API** (`api.coingecko.com`): The extension fetches real-time cryptocurrency prices every 15 minutes for portfolio value display. This is an anonymous, unauthenticated request that contains no personal information.
- **GitHub** (`raw.githubusercontent.com`): The extension checks every 12 hours for available updates by fetching `version.json` from the public repository (`sushiomsky/faucetplugin`). This is an anonymous HTTP GET request.

---

## 3. Permissions Usage

FaucetPick requires specific browser permissions to function correctly. Here is an explanation of why each permission is needed:

| Permission | Why It's Needed |
|---|---|
| `storage` | To save your settings, wallet addresses, claim history, and encrypted login credentials locally on your device. |
| `tabs` | To open faucet site tabs in the background (inactive), focus tabs when a captcha requires user interaction, and close tabs when a claim or withdrawal cycle is complete. |
| `alarms` | To schedule recurring tasks: the 1-minute scheduler tick, the 15-minute price update, and the 12-hour update check. |
| `scripting` | Declared in the manifest for Manifest V3 compatibility. Content scripts are injected via the `content_scripts` manifest key. |
| `debugger` | To dispatch hardware-level mouse events (`Input.dispatchMouseEvent`) via the Chrome DevTools Protocol. This is used for the "Native Click" feature, which simulates a real mouse click to bypass client-side bot detection on some captcha systems. |
| `<all_urls>` | Required to allow the content scripts to run on the faucet websites you choose to enable. Without this, the extension cannot interact with any site. |

---

## 4. Data Retention

All data is user-controlled and stored locally. You can clear all extension data at any time by navigating to `chrome://extensions` → Find "FaucetPick" → Click "Details" → "Clear data". The activity log stores a maximum of the last 30 claim events.

---

## 5. Changes to This Policy

We may update our Privacy Policy from time to time to reflect changes in functionality or legal requirements. Any changes will be reflected in an updated version of this document and announced via the extension's changelog.

---

## 6. Contact Us

If you have any questions about this Privacy Policy, please open an issue on our public GitHub repository:
[https://github.com/sushiomsky/faucetplugin](https://github.com/sushiomsky/faucetplugin)

---

**FaucetPick Labs**
