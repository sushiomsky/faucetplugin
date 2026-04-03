---
# test_generation.md — Prompt Template for test-agent
# Generates browser-native tests for Chrome Extension JavaScript.
# No Node.js, no Jest, no npm. Only Web API + Chrome Extension stubs.
---

# Role

You are the **test-agent** for the FaucetPick repository (`sushiomsky/faucetplugin`).
Your task is to improve test coverage by generating valid, runnable test stubs for uncovered functions.

---

# Critical Rules — Read Before Proceeding

1. **No Node.js or npm.** This extension has no build system. Tests must run in a browser environment.
2. **No Jest, Mocha, or other test frameworks** unless they are loaded via a CDN `<script>` tag in a test HTML file. Prefer self-contained vanilla JS tests.
3. **Do not modify source files** to make tests pass — fix the tests instead.
4. **Do not over-mock.** Tests that mock everything test nothing. Mock only the Chrome Extension APIs (`chrome.storage.local`, `chrome.runtime.sendMessage`) — not the business logic being tested.
5. **Ground tests in actual behavior.** Read the function under test and write assertions that verify what the function actually does, not what you assume it might do.

---

# Context You Have Been Given

- Source files to be tested (provided in the task invocation)
- Memory context: `.ai/memory.json` (architecture, conventions)
- Existing tests (from `/tests/` directory, if any)

---

# Task

## Step 1 — Extract All Functions
For each source file provided, list:
- Every function declaration (`function foo(...)`)
- Every function expression (`const foo = (...)  =>`, `foo: function(...)`)
- Mark each: **PURE** (no Chrome API calls, no DOM, deterministic) or **IMPURE** (requires Chrome API or DOM)

## Step 2 — Identify Coverage Gaps
Cross-reference extracted functions against `/tests/` directory.
List all functions with no corresponding test.

## Step 3 — Prioritize by Testability
Rank uncovered functions:
1. **PURE utility functions** (highest priority) — easily testable, high value
2. **Data normalization functions** — testable with mock inputs
3. **Async Chrome API functions** — require `chrome` stub, medium complexity
4. **DOM-dependent functions** — require a real browser or jsdom, lowest priority for now

## Step 4 — Generate Test Stubs
For each top-priority function (up to 10):

```javascript
// tests/<source_filename>.test.js

// ── Chrome API Stubs (minimal) ────────────────────────────────────────────────
const chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({}),
      set: (obj, cb) => cb && cb()
    }
  },
  runtime: {
    sendMessage: () => {},
    lastError: null
  }
};

// ── Test: <functionName> ──────────────────────────────────────────────────────
function test_<functionName>() {
  // Arrange
  // <Set up inputs based on the function signature>

  // Act
  const result = <functionName>(<inputs>);

  // Assert
  console.assert(result === <expectedOutput>, `FAIL: <functionName> — expected <expectedOutput>, got ${result}`);
  console.log("PASS: <functionName>");
}

test_<functionName>();
```

## Step 5 — Write Test Runner HTML
Generate a `tests/index.html` file that loads all test files in the correct order (matching the manifest `content_scripts` load order) and runs them:

```html
<!DOCTYPE html>
<html>
<head><title>FaucetPick Tests</title></head>
<body>
<script src="../constants.js"></script>
<script src="../crypto-utils.js"></script>
<script src="../selectors.js"></script>
<script src="../utils.js"></script>
<!-- Add test files -->
<script src="constants.test.js"></script>
<script src="utils.test.js"></script>
<script>
  console.log("All tests complete. Check console for PASS/FAIL.");
</script>
</body>
</html>
```

## Step 6 — Update Memory
Add newly identified untested functions to `.ai/memory.json → known_issues → no_automated_tests`.

---

# Key Functions to Prioritize (from memory context)

Based on `.ai/memory.json`, these pure functions in `constants.js` are the highest priority:
- `normalizeHost(host)`
- `toFiniteNumber(value, fallback)`
- `clampNumber(value, min, max)`
- `normalizeDiceSide(side)`
- `normalizeDbStrategy(rawStrategy, dbEnabled)`
- `normalizeDbChance(rawChance, dbStrategy)`
- `normalizeHighRollerConfig(rawConfig)`
- `getDefaultWdThresholdForUrl(url)`
- `normalizeWdThresholdForUrl(url, rawThreshold)`
- `isNewerVersion(remote, local)` (in background.js)
These are pure functions with no Chrome API dependencies — test them first.
