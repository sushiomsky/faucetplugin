// tests/constants.test.js
// Tests all PURE functions from constants.js (no Chrome API, no DOM).
// All inputs and expected outputs are derived strictly from the source code.
// Run via tests/index.html

describe('normalizeHost', () => {
  it('strips www. prefix and lowercases', () => {
    assertEqual(normalizeHost('www.LitePick.io'), 'litepick.io');
  });
  it('lowercases without www.', () => {
    assertEqual(normalizeHost('DOGEPICK.IO'), 'dogepick.io');
  });
  it('returns empty string for null/undefined', () => {
    assertEqual(normalizeHost(null), '');
    assertEqual(normalizeHost(undefined), '');
  });
  it('is idempotent', () => {
    assertEqual(normalizeHost('solpick.io'), 'solpick.io');
  });
});

describe('toFiniteNumber', () => {
  it('returns parsed number for valid string', () => {
    assertEqual(toFiniteNumber('42', 0), 42);
  });
  it('returns fallback for NaN string', () => {
    assertEqual(toFiniteNumber('abc', 99), 99);
  });
  it('returns fallback for Infinity', () => {
    assertEqual(toFiniteNumber(Infinity, 5), 5);
  });
  it('returns fallback for null', () => {
    assertEqual(toFiniteNumber(null, 7), 7);
  });
  it('returns 0 when 0 is valid', () => {
    assertEqual(toFiniteNumber('0', 10), 0);
  });
});

describe('clampNumber', () => {
  it('clamps below min', () => {
    assertEqual(clampNumber(-5, 0, 100), 0);
  });
  it('clamps above max', () => {
    assertEqual(clampNumber(200, 0, 100), 100);
  });
  it('passes value within range unchanged', () => {
    assertEqual(clampNumber(50, 0, 100), 50);
  });
  it('handles equal min/max', () => {
    assertEqual(clampNumber(999, 5, 5), 5);
  });
});

describe('normalizeDiceSide', () => {
  it('returns "lower" for lowercase input', () => {
    assertEqual(normalizeDiceSide('lower'), 'lower');
  });
  it('returns "lower" for uppercase input', () => {
    assertEqual(normalizeDiceSide('LOWER'), 'lower');
  });
  it('returns "higher" for anything else', () => {
    assertEqual(normalizeDiceSide('higher'), 'higher');
    assertEqual(normalizeDiceSide(''), 'higher');
    assertEqual(normalizeDiceSide(null), 'higher');
    assertEqual(normalizeDiceSide('invalid'), 'higher');
  });
});

describe('normalizeDbStrategy', () => {
  it('returns all-in-0.1 for valid identifier', () => {
    assertEqual(normalizeDbStrategy('all-in-0.1'), 'all-in-0.1');
  });
  it('returns combined-high-roller for valid identifier', () => {
    assertEqual(normalizeDbStrategy('combined-high-roller'), 'combined-high-roller');
  });
  it('returns default (all-in-0.1) for unknown strategy', () => {
    assertEqual(normalizeDbStrategy('unknown'), 'all-in-0.1');
    assertEqual(normalizeDbStrategy(''), 'all-in-0.1');
    assertEqual(normalizeDbStrategy(null), 'all-in-0.1');
  });
  it('is case-insensitive', () => {
    assertEqual(normalizeDbStrategy('ALL-IN-0.1'), 'all-in-0.1');
    assertEqual(normalizeDbStrategy('Combined-High-Roller'), 'combined-high-roller');
  });
});

describe('normalizeDbChance', () => {
  it('returns "1" as default for all-in-0.1 with non-finite input', () => {
    assertEqual(normalizeDbChance('abc', 'all-in-0.1'), '1');
  });
  it('returns "50" as default for combined-high-roller with non-finite input', () => {
    assertEqual(normalizeDbChance(null, 'combined-high-roller'), '50');
  });
  it('clamps to 0.01 minimum', () => {
    assertEqual(normalizeDbChance('0', 'all-in-0.1'), '0.01');
  });
  it('clamps to 99 maximum', () => {
    assertEqual(normalizeDbChance('100', 'all-in-0.1'), '99');
  });
  it('passes a mid-range value through as string', () => {
    assertEqual(normalizeDbChance('14', 'all-in-0.1'), '14');
  });
});

describe('getDefaultWdThresholdForUrl', () => {
  it('returns LTC threshold for litepick.io', () => {
    assertEqual(getDefaultWdThresholdForUrl('https://litepick.io/'), '0.05');
  });
  it('returns DOGE threshold for dogepick.io', () => {
    assertEqual(getDefaultWdThresholdForUrl('https://dogepick.io/'), '30');
  });
  it('returns SOL threshold for solpick.io', () => {
    assertEqual(getDefaultWdThresholdForUrl('https://solpick.io/'), '0.0325');
  });
  it('returns BNB threshold for bnbpick.io', () => {
    assertEqual(getDefaultWdThresholdForUrl('https://bnbpick.io/'), '0.009');
  });
  it('returns TRX threshold for tronpick.io', () => {
    assertEqual(getDefaultWdThresholdForUrl('https://tronpick.io/'), '40');
  });
  it('returns POL threshold for polpick.io', () => {
    assertEqual(getDefaultWdThresholdForUrl('https://polpick.io/'), '10');
  });
  it('returns "5" fallback for unknown URL', () => {
    assertEqual(getDefaultWdThresholdForUrl('https://unknown.io/faucet.php'), '5');
  });
  it('returns "5" fallback for invalid URL', () => {
    assertEqual(getDefaultWdThresholdForUrl('not-a-url'), '5');
  });
});

describe('normalizeWdThresholdForUrl', () => {
  it('returns stored threshold when valid', () => {
    assertEqual(normalizeWdThresholdForUrl('https://litepick.io/', '0.1'), '0.1');
  });
  it('returns fallback for non-numeric threshold', () => {
    assertEqual(normalizeWdThresholdForUrl('https://litepick.io/', 'abc'), '0.05');
  });
  it('returns fallback for zero threshold', () => {
    assertEqual(normalizeWdThresholdForUrl('https://litepick.io/', '0'), '0.05');
  });
  it('returns fallback for negative threshold', () => {
    assertEqual(normalizeWdThresholdForUrl('https://litepick.io/', '-1'), '0.05');
  });
});

describe('normalizeHighRollerConfig', () => {
  it('returns defaults for empty object', () => {
    const cfg = normalizeHighRollerConfig({});
    assertEqual(cfg.base_bet_fraction, 0.10);
    assertEqual(cfg.max_bet_fraction, 0.40);
    assertEqual(cfg.max_ladder_depth, 5);
    assertEqual(cfg.history_window, 10);
    assertEqual(cfg.streak_trigger, 1);
    assertEqual(cfg.volatility_trigger, 4);
  });
  it('clamps base_bet_fraction to minimum', () => {
    const cfg = normalizeHighRollerConfig({ base_bet_fraction: -1 });
    assert(cfg.base_bet_fraction > 0, 'base_bet_fraction should be > 0');
  });
  it('clamps max_ladder_depth to 1–10 range', () => {
    const cfg1 = normalizeHighRollerConfig({ max_ladder_depth: 0 });
    assertEqual(cfg1.max_ladder_depth, 1);
    const cfg2 = normalizeHighRollerConfig({ max_ladder_depth: 999 });
    assertEqual(cfg2.max_ladder_depth, 10);
  });
  it('clamps history_window to 1–200 range', () => {
    const cfg = normalizeHighRollerConfig({ history_window: 0 });
    assertEqual(cfg.history_window, 1);
  });
  it('handles null input gracefully', () => {
    const cfg = normalizeHighRollerConfig(null);
    assertEqual(cfg.base_bet_fraction, 0.10);
  });
});

describe('makeFaucetDefaults', () => {
  it('returns exactly 6 faucets', () => {
    const faucets = makeFaucetDefaults();
    assertEqual(faucets.length, 6);
  });
  it('all faucets start as inactive', () => {
    const faucets = makeFaucetDefaults();
    for (const f of faucets) {
      assertEqual(f.active, false, `${f.label} should start inactive`);
    }
  });
  it('all faucets have required fields', () => {
    const required = ['url', 'label', 'active', 'intervalMinutes', 'wdThreshold', 'dbStrategy', 'dbSide', 'dbChance'];
    const faucets = makeFaucetDefaults();
    for (const f of faucets) {
      for (const field of required) {
        assert(field in f, `${f.label} missing field: ${field}`);
      }
    }
  });
  it('litepick has correct URL and threshold', () => {
    const f = makeFaucetDefaults().find(f => f.label === 'litepick');
    assert(f, 'litepick faucet not found');
    assertEqual(f.url, 'https://litepick.io/');
    assertEqual(f.wdThreshold, '0.05');
  });
  it('all faucets have intervalMinutes of 61', () => {
    const faucets = makeFaucetDefaults();
    for (const f of faucets) {
      assertEqual(f.intervalMinutes, 61, `${f.label} intervalMinutes should be 61`);
    }
  });
  it('default dbStrategy is all-in-0.1', () => {
    const faucets = makeFaucetDefaults();
    for (const f of faucets) {
      assertEqual(f.dbStrategy, 'all-in-0.1', `${f.label} dbStrategy should be all-in-0.1`);
    }
  });
  it('all faucets have wdEnabled: true by default', () => {
    const faucets = makeFaucetDefaults();
    for (const f of faucets) {
      assertEqual(f.wdEnabled, true, `${f.label} wdEnabled should be true`);
    }
  });
});

describe('getPriceIdForHost', () => {
  it('returns litecoin for litepick.io', () => {
    assertEqual(getPriceIdForHost('litepick.io'), 'litecoin');
  });
  it('returns dogecoin for dogepick.io', () => {
    assertEqual(getPriceIdForHost('dogepick.io'), 'dogecoin');
  });
  it('strips www. prefix before lookup', () => {
    assertEqual(getPriceIdForHost('www.solpick.io'), 'solana');
  });
  it('returns null for unknown host', () => {
    assertEqual(getPriceIdForHost('unknown.io'), null);
  });
});
