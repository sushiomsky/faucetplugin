---
# repo_analysis.md — Prompt Template for doc-agent / ops-agent
# Full repository analysis task. Produces a comprehensive technical snapshot.
---

# Role

You are performing a **full repository analysis** for the FaucetPick Chrome Extension (`sushiomsky/faucetplugin`).
Your output will be written to `.ai/memory.json` and used by all other agents as their foundational context.

---

# Critical Rules — Read Before Proceeding

1. **Only report what is in the code.** Do not describe features that are not implemented.
2. **Be precise.** Use exact function names, storage key names, message type strings, and file paths from the source.
3. **Note uncertainties.** If something is unclear from the code, mark it as `"status": "uncertain"`.
4. **Do not evaluate.** This is a factual analysis, not a code review. Save opinions for the refactor agent.

---

# Files to Read

Read ALL of the following files before writing any output:
1. `manifest.json`
2. `version.json`
3. `constants.js`
4. `background.js`
5. `content.js`
6. `utils.js`
7. `selectors.js`
8. `auth.js`
9. `crypto-utils.js`
10. `captcha.js`
11. `faucet.js`
12. `dice.js`
13. `withdraw.js`
14. `popup.js`
15. `setup.js`
16. `popup.html`
17. `setup.html`

---

# Task — Analysis Steps

## Step 1 — Extension Metadata
From `manifest.json`:
- Name, version, manifest_version
- All permissions listed
- All host_permissions listed
- content_scripts load order (exact file list and run_at timing)
- Background service worker file
- Default popup file

## Step 2 — Faucet Configuration
From `constants.js → makeFaucetDefaults()`:
- List all supported faucets (url, label)
- Map each to its CoinGecko ID and default withdrawal threshold
- List all dice strategies and their identifiers
- List all configurable per-faucet fields with types and defaults

## Step 3 — Background Scheduler
From `background.js`:
- List all alarm names and their periods
- Describe the scheduler loop (checkAndRun) in 3–5 sentences
- List all message types handled by `handleMessage()`
- List all chrome.storage.local keys read and written

## Step 4 — Content Script Flow
From `content.js`, `utils.js`, `faucet.js`, `auth.js`, `withdraw.js`, `dice.js`:
- Describe the page-type detection logic
- Describe the claim flow (faucet → optional dice → optional withdraw)
- List all window.* global variables set by utils.js with their default values
- List all message types sent TO the background

## Step 5 — Selector Registry
From `selectors.js`:
- List all selector keys defined in `SiteSelectors.generic`
- List any host-specific overrides
- Describe the `injectCustom()` mechanism for user-defined faucets

## Step 6 — Security & Encryption
From `crypto-utils.js`:
- Describe the encryption algorithm, key size, and IV strategy
- Describe how the key is persisted
- Note the `ENC:` prefix convention for detecting already-encrypted values

## Step 7 — External API Calls
From `background.js`:
- List every `fetch()` call with URL template, purpose, and frequency

## Step 8 — Output to memory.json
Write the analysis as a structured JSON update to `.ai/memory.json` matching the existing schema:
- `repo_summary`
- `architecture_notes`
- `conventions`
- `known_issues`

Do not overwrite the `decisions_log` array — append to it if new decisions are identified.

---

# Output Format

Return:
1. The full updated content of `.ai/memory.json`
2. A brief (< 200 word) plain-English summary for the human operator
