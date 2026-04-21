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
    },
    remove(key, cb) {
      delete this._data[key];
      if (cb) cb();
      return Promise.resolve();
    }
  }
};

window.chrome.runtime = {
  sendMessage: () => {},
  lastError: null,
  getManifest: () => ({ version: '2.9.3' })
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
window.__tests = [];
window.__suites = [];
window.__results = { pass: 0, fail: 0, skip: 0 };

function describe(suiteName, fn) {
    window.__suites.push({ name: suiteName, fn });
}

function it(testName, fn) {
    window.__currentSuiteTests = window.__currentSuiteTests || [];
    window.__currentSuiteTests.push({ name: testName, fn, async: false });
}

function itAsync(testName, fn) {
    window.__currentSuiteTests = window.__currentSuiteTests || [];
    window.__currentSuiteTests.push({ name: testName, fn, async: true });
}

function skip(testName, reason) {
    window.__currentSuiteTests = window.__currentSuiteTests || [];
    window.__currentSuiteTests.push({ name: testName, skipped: true, reason });
}

async function runAllTests() {
    for (const suite of window.__suites) {
        window.__currentSuite = suite.name;
        window.__currentSuiteTests = [];
        suite.fn();
        
        for (const test of window.__currentSuiteTests) {
            const entry = { suite: suite.name, name: test.name, passed: false };
            if (test.skipped) {
                entry.skipped = true;
                entry.reason = test.reason;
                window.__results.skip++;
            } else {
                try {
                    if (test.async) {
                        await test.fn();
                    } else {
                        test.fn();
                    }
                    entry.passed = true;
                    window.__results.pass++;
                } catch (err) {
                    entry.error = err.message;
                    window.__results.fail++;
                }
            }
            window.__tests.push(entry);
        }
    }
    if (window.renderResults) window.renderResults();
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
