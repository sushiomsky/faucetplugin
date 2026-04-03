// tests/stubs/chrome.js
// Minimal Chrome Extension API stub for unit tests.
// Only stubs what the tested functions actually call.
// Does NOT stub the full API — tests that need real chrome should be E2E tests.

window.chrome = window.chrome || {};

window.chrome.storage = {
  local: {
    _data: {},
    get(keys, cb) {
      const result = {};
      if (typeof keys === 'string') keys = [keys];
      if (Array.isArray(keys)) {
        for (const k of keys) result[k] = this._data[k];
      } else if (keys === null || keys === undefined) {
        Object.assign(result, this._data);
      }
      if (cb) cb(result);
      return Promise.resolve(result);
    },
    set(obj, cb) {
      Object.assign(this._data, obj);
      if (cb) cb();
      return Promise.resolve();
    },
    clear(cb) {
      this._data = {};
      if (cb) cb();
      return Promise.resolve();
    }
  }
};

window.chrome.runtime = {
  sendMessage: () => {},
  lastError: null,
  getManifest: () => ({ version: '2.6.0', name: 'FaucetPick Test' })
};

window.chrome.alarms = {
  create: () => {},
  clear: () => Promise.resolve(),
  get: () => Promise.resolve(null)
};

window.chrome.tabs = {
  create: () => Promise.resolve({ id: 1 }),
  remove: () => Promise.resolve(),
  query: () => Promise.resolve([]),
  update: () => Promise.resolve()
};

// ── Test harness helpers ──────────────────────────────────────────────────────
window.__tests = window.__tests || [];
window.__results = window.__results || { pass: 0, fail: 0, skip: 0 };

function describe(suiteName, fn) {
  window.__currentSuite = suiteName;
  console.log(`\n── ${suiteName} ──`);
  fn();
}

function it(testName, fn) {
  const entry = { suite: window.__currentSuite, name: testName, passed: false };
  try {
    fn();
    entry.passed = true;
    window.__results.pass++;
    console.log(`  ✓ PASS | ${testName}`);
  } catch (err) {
    entry.error = err.message;
    window.__results.fail++;
    console.error(`  ✗ FAIL | ${testName}:`, err.message);
  }
  window.__tests.push(entry);
}

function skip(testName, reason) {
  window.__tests.push({ suite: window.__currentSuite, name: testName, skipped: true, reason });
  window.__results.skip++;
  console.log(`  ⏭ SKIP | ${testName} (${reason})`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertCloseTo(actual, expected, delta, message) {
  if (Math.abs(actual - expected) > delta) {
    throw new Error(`${message || 'assertCloseTo'}: expected ${expected} ±${delta}, got ${actual}`);
  }
}
