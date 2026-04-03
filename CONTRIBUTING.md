# Contributing to FaucetPick

Thank you for your interest in contributing to FaucetPick! This guide explains how to set up the development environment, understand the codebase, submit contributions, and work with the built-in AI agent system.

---

## 📋 Table of Contents
1. [Development Setup](#development-setup)
2. [Codebase Overview](#codebase-overview)
3. [Contribution Workflow](#contribution-workflow)
4. [Code Standards](#code-standards)
5. [AI Agent System](#ai-agent-system)
6. [Reporting Issues](#reporting-issues)

---

## 1. Development Setup

### Prerequisites
- Google Chrome (or any Chromium-based browser)
- Git
- A text editor (VS Code recommended)
- No Node.js, build tools, or package managers required — this is a pure JavaScript extension.

### Loading the Extension
1. Clone the repository:
   ```bash
   git clone https://github.com/sushiomsky/faucetplugin.git
   cd faucetplugin
   ```
2. Open Chrome → `chrome://extensions`
3. Enable **Developer Mode** (top-right toggle)
4. Click **"Load unpacked"** → select the repository root directory
5. The extension installs immediately with no compilation needed.

### Reloading After Changes
```bash
# No build step. In Chrome:
# chrome://extensions → Find "FaucetPick" → Click ↺ (Reload)
```

### Enabling Debug Logging
In `utils.js` (content script context):
```javascript
window.DEBUG = true; // line 28
```
In `background.js` (service worker context):
```javascript
const DEBUG = true; // line 4
```

---

## 2. Codebase Overview

See [README.md](README.md) for the full architecture overview, storage schema, and per-faucet configuration format.

**Key entry points:**
- `background.js` — Service worker, scheduler, message broker
- `content.js` — Content script orchestrator (runs on all pages)
- `constants.js` — Single source of truth for all faucet defaults and utilities

---

## 3. Contribution Workflow

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feature/my-feature-name
   ```
2. **Make changes** — keep diffs small and focused.
3. **Test manually** using the checklist in [README.md → Testing](README.md#-testing).
4. **Update documentation** — if you change behavior, update `README.md` and any relevant `.md` files.
5. **Open a Pull Request** with a clear description of what changed and why.

### PR Requirements
- [ ] Changes have been manually tested in Chrome
- [ ] `README.md` updated if behavior or configuration changed
- [ ] No new external dependencies introduced without discussion
- [ ] No hardcoded credentials or personal data in commits
- [ ] Commit messages are descriptive (e.g., `fix(selectors): update Turnstile iframe selector for Cloudflare v3`)

---

## 4. Code Standards

- **Vanilla JavaScript only** — no frameworks, no transpilation, no `npm`.
- **Single source of truth**: All faucet defaults live in `constants.js`. Never hardcode values in `background.js`, `popup.js`, etc.
- **Storage**: Always use `chrome.storage.local`. Never use `localStorage`, `sessionStorage`, or cookies.
- **Encryption**: Credentials must always be run through `CryptoUtils.encrypt()` before being saved to storage.
- **Selectors**: All CSS selectors must be registered in `selectors.js → SiteSelectors`. Never use `document.querySelector()` with hardcoded strings outside of `selectors.js`.
- **Error handling**: All async functions called from content scripts must have a `.catch()` handler that calls `sendError()` or `sendWdError()`.
- **No alerts/confirms**: Never use `window.alert()`, `window.confirm()`, or `window.prompt()`.
- **Logging**: Use the `log()` function (respects `DEBUG` flag). Never use `console.log()` for development traces — use `console.log()` only for permanent operational messages and `console.error()` for real errors.

---

## 5. AI Agent System

This repository includes a self-maintaining AI agent system located in the `.ai/` directory. It is designed to autonomously maintain documentation, assist with development tasks, and validate changes.

### Agent Overview

The system is defined in `.ai/agents.yaml` and includes five agents:

| Agent | Role | Primary Trigger |
|---|---|---|
| `doc-agent` | Keeps all Markdown documentation accurate | On every push to `main` |
| `dev-agent` | Implements features and refactors code | On demand / dry-mode in CI |
| `test-agent` | Validates coverage and test quality | On every Pull Request |
| `ops-agent` | Manages CI/CD pipelines and deployment | On `release/**` branches |
| `review-agent` | Validates PR quality and code consistency | On every Pull Request |

### How to Trigger Agents

**Via CI/CD (GitHub Actions)**:
The workflow at `.github/workflows/ai-maintenance.yml` triggers automatically. You can also trigger it manually from the GitHub Actions tab using `workflow_dispatch`.

**Via local shell scripts** (requires an `LLM_API_KEY` environment variable):
```bash
# Run any defined task (e.g., update-docs, detect-breaking-changes)
./.ai/run.sh update-docs

# Specifically sync documentation with the current codebase
./.ai/update_docs.sh

# Run a full dev cycle: analyze → test → document
./.ai/dev_cycle.sh
```

> **NOTE**: The shell scripts are abstract orchestrators. They read the repo, bundle context, and pass it to an LLM. Set `LLM_API_KEY` (OpenAI, Anthropic, or Google AI) and `LLM_MODEL` in your environment before running.

### How to Override Agents

Each agent has explicit **constraints** defined in `.ai/agents.yaml`. To override a constraint for a specific task:

1. Edit the relevant task in `.ai/tasks.yaml` and add an `overrides:` block.
2. Include an `AI_SKIP` directive in your commit message to skip the CI agent run:
   ```
   git commit -m "docs: manual update [AI_SKIP]"
   ```
3. To disable an agent permanently, set `enabled: false` in its block in `.ai/agents.yaml`.

### Agent Safety Rules

All agents operate under strict safety constraints (see `.ai/agents.yaml`):
- ✅ Agents **only** read and reference actual repository content.
- ✅ Agents **prefer minimal diffs** — they change only what is necessary.
- ❌ Agents **never invent** APIs, features, or configurations that don't exist in the code.
- ❌ Agents **never execute destructive actions** (file deletion, force pushes) without an explicit human-approved task.
- ❓ When uncertain, agents add `> NOTE:` or `> TODO:` blocks instead of guessing.

### Updating the Memory Context

The agent memory file at `.ai/memory.json` stores the current understanding of the repository. Update it whenever significant architectural changes are made:
```bash
# The doc-agent will also update this file when running update-docs
./.ai/run.sh repo-analysis
```

---

## 6. Reporting Issues

Please use [GitHub Issues](https://github.com/sushiomsky/faucetplugin/issues) to report bugs or request features. When reporting a bug, include:
- Chrome version
- Extension version (visible in `chrome://extensions`)
- Description of the problem
- Steps to reproduce
- Relevant output from the service worker console (`chrome://extensions` → "Inspect views: service worker")
