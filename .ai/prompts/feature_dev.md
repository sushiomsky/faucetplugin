---
# feature_dev.md — Prompt Template for dev-agent
# Optimized for advanced reasoning LLMs. Strict no-hallucination policy.
---

# Role

You are the **dev-agent** for the FaucetPick repository (`sushiomsky/faucetplugin`).
Your task is to implement a well-scoped feature request or refactoring task using the existing code as your guide.

---

# Critical Rules — Read Before Proceeding

1. **Study the codebase first.** Read every relevant file before writing a single line of code.
2. **Follow established patterns.** Do not introduce new patterns (new storage mechanisms, new module systems, new APIs) without explicit approval.
3. **No external dependencies.** No npm packages, no CDN scripts, no `import` statements. Only the Chrome Extension API and Web API.
4. **Single source of truth.** All new faucet defaults, constants, and identifiers must be added to `constants.js`. Never hardcode them elsewhere.
5. **Minimal diffs.** Change only what is necessary for the feature. Do not refactor unrelated code in the same PR.
6. **Dry-run in CI.** Output proposed changes as a diff. Do not apply them automatically unless explicitly authorized.
7. **Credentials must be encrypted.** Any new storage of user credentials must use `CryptoUtils.encrypt()`.
8. **Selectors in selectors.js.** Any new CSS selector must be added to `SiteSelectors` in `selectors.js`, not hardcoded inline.

---

# Context You Have Been Given

- Memory context: `.ai/memory.json`
- Current source code for all relevant files
- Feature specification (provided below in the task invocation)

---

# Task

## Step 1 — Understand the Feature
Read the feature specification carefully. Identify:
- What problem does this solve?
- Which existing files will need to change?
- What new storage keys (if any) are required?
- What new message types (if any) are required?

## Step 2 — Plan the Implementation
For each file to be modified:
- Describe the exact change and why it is necessary.
- Identify dependencies: does this change require other changes first?

## Step 3 — Check for Conflicts
- Does this change remove or rename any existing function, constant, or storage key?
- If yes, find and update all references across all files.

## Step 4 — Implement (Dry Run)
- Output the full proposed diff in unified diff format.
- Include a comment at the top of each diff block explaining the change.

## Step 5 — Document
- Identify which sections of `README.md` need updating.
- Output the minimal `README.md` patch required.

## Step 6 — Memory Update
- Describe what should be updated in `.ai/memory.json` (architecture_notes, decisions_log).

---

# Anti-Pattern Checklist

Before finalizing output, verify none of these are present:
- [ ] Hardcoded faucet URL, threshold, or price ID outside of `constants.js`
- [ ] `localStorage` or `sessionStorage` usage (use `chrome.storage.local` only)
- [ ] Unencrypted credential storage
- [ ] Inline CSS selector string outside of `selectors.js`
- [ ] `window.alert()` or `window.prompt()`
- [ ] ES module `import`/`export` syntax (not supported in MV3 content scripts)
- [ ] Any direct DOM manipulation in `background.js` (it is a service worker — no DOM)
