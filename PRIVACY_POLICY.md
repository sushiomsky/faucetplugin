# Privacy Policy for Faucet Pro

**Last Updated: April 3, 2026**

Faucet Pro ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and handle your information when you use our browser extension.

## 1. Information Collection and Storage
Faucet Pro is designed to run entirely on your local machine. 

*   **No Personal Data Uploads**: We do **not** collect, store, or transmit any personal data (such as your name, email, or wallet addresses) to our servers.
*   **Local Storage**: All settings, faucet configurations, and wallet addresses are stored locally using the Chrome `storage.local` API. This information never leaves your browser unless you manually export it.
*   **Encryption**: Sensitive information (such as usernames and passwords for automated login) is encrypted within the extension's local storage for your protection.

## 2. Third-Party Services
Our extension interacts with the following third-party services to provide core functionality:

*   **Faucet Websites**: The extension automates claims on the sites you choose to enable. This interaction is identical to you visiting the site manually.
*   **Telegram API**: If you enable Telegram alerts, the extension will send messages to the Telegram bot and chat ID you provide. This data is sent directly to Telegram's servers.
*   **CoinGecko API**: We use the CoinGecko API to fetch real-time cryptocurrency prices for balance tracking. This is an anonymous request and does not include any of your personal information.
*   **GitHub**: The extension may check for updates against our official GitHub repository.

## 3. Permissions Usage
Faucet Pro requires specific permissions to function correctly:
*   `storage`: To save your settings and site configurations locally.
*   `tabs`: To monitor the progress of automated claims and manage the dashboard.
*   `alarms`: To schedule automated claim intervals.
*   `scripting`: To interact with faucet websites on your behalf.
*   `debugger`: To simulate "Native Click" interactions for better anti-detection.
*   `<all_urls>`: To allow automation on the specific faucet sites you choose to use.

## 4. Changes to This Policy
We may update our Privacy Policy from time to time. Any changes will be reflected in a new version of the extension and updated in this document.

## 5. Contact Us
If you have any questions about this Privacy Policy, please contact us via our GitHub support page or our community Telegram group.

---
**Faucet Pro Labs**
