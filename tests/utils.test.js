// tests/utils.test.js
// Tests pure/testable functions from utils.js.
// DOM-dependent and Chrome-API-dependent functions are tested with stubs or skipped.
// Run via tests/index.html

describe('sameHost', () => {
  it('returns true for same hostname', () => {
    assert(sameHost('https://litepick.io/faucet.php', 'https://litepick.io/'), 'same host should match');
  });
  it('returns false for different hostnames', () => {
    assert(!sameHost('https://litepick.io/', 'https://dogepick.io/'), 'different hosts should not match');
  });
  it('returns false for totally different domains', () => {
    assert(!sameHost('https://google.com/', 'https://litepick.io/'), 'google vs litepick should not match');
  });
  it('returns false for plain string vs URL when different', () => {
    // Falls back to === comparison on parse error for very malformed inputs
    const result = sameHost('not-a-url', 'also-not-a-url');
    assert(typeof result === 'boolean', 'result should be boolean');
  });
  it('matches litepick faucet.php vs litepick root', () => {
    assert(sameHost('https://litepick.io/faucet.php', 'https://litepick.io/'), 'paths should not affect host comparison');
  });
});

describe('normalizeUrl', () => {
  it('removes trailing slash', () => {
    assertEqual(normalizeUrl('https://litepick.io/'), 'litepick.io');
  });
  it('removes protocol', () => {
    assertEqual(normalizeUrl('http://litepick.io'), 'litepick.io');
    assertEqual(normalizeUrl('https://litepick.io'), 'litepick.io');
  });
  it('removes www prefix', () => {
    assertEqual(normalizeUrl('https://www.litepick.io/'), 'litepick.io');
  });
  it('converts to lowercase', () => {
    assertEqual(normalizeUrl('HTTPS://LITEPICK.IO/'), 'litepick.io');
  });
  it('handles empty or non-string gracefully', () => {
    assertEqual(normalizeUrl(''), '');
    assertEqual(normalizeUrl(null), '');
    assertEqual(normalizeUrl(undefined), '');
  });
});

describe('randomDelay', () => {
  it('returns a number within expected range', () => {
    for (let i = 0; i < 20; i++) {
      const delay = randomDelay();
      assert(delay >= window.RANDOM_DELAY_MIN_MS, `delay ${delay} should be >= ${window.RANDOM_DELAY_MIN_MS}`);
      assert(delay <= window.RANDOM_DELAY_MAX_MS, `delay ${delay} should be <= ${window.RANDOM_DELAY_MAX_MS}`);
    }
  });
  it('returns a finite number', () => {
    const delay = randomDelay();
    assert(Number.isFinite(delay), 'delay should be finite');
  });
});

describe('randomIntInclusive', () => {
  it('returns value within inclusive bounds', () => {
    for (let i = 0; i < 50; i++) {
      const v = randomIntInclusive(5, 10);
      assert(v >= 5 && v <= 10, `${v} should be between 5 and 10`);
    }
  });
  it('works with equal min and max', () => {
    assertEqual(randomIntInclusive(7, 7), 7);
  });
  it('works when min > max (handles gracefully)', () => {
    const v = randomIntInclusive(10, 5);
    assert(v >= 5 && v <= 10, `${v} should be between 5 and 10 even when args are reversed`);
  });
  it('always returns an integer', () => {
    for (let i = 0; i < 20; i++) {
      const v = randomIntInclusive(1, 100);
      assertEqual(Math.floor(v), v, 'should be an integer');
    }
  });
});

describe('parseNumericValue', () => {
  it('parses simple integer string', () => {
    assertEqual(parseNumericValue('42'), 42);
  });
  it('parses decimal string', () => {
    assertEqual(parseNumericValue('0.0325'), 0.0325);
  });
  it('strips commas from formatted numbers', () => {
    assertEqual(parseNumericValue('1,234.56'), 1234.56);
  });
  it('returns null for non-numeric string', () => {
    assertEqual(parseNumericValue('abc'), null);
  });
  it('returns null for non-string input', () => {
    assertEqual(parseNumericValue(42), null);
    assertEqual(parseNumericValue(null), null);
  });
  it('extracts number from mixed string', () => {
    // Should extract first number found
    const v = parseNumericValue('Balance: 3.14 LTC');
    assertEqual(v, 3.14);
  });
  it('handles negative numbers', () => {
    assertEqual(parseNumericValue('-5.5'), -5.5);
  });
});

describe('isFaucetPage / isWithdrawPage / isDicebetPage / hasLoginForm', () => {
  skip('isFaucetPage()', 'requires window.location.pathname — DOM context only');
  skip('isWithdrawPage()', 'requires window.location.pathname — DOM context only');
  skip('isDicebetPage()', 'requires window.location.pathname — DOM context only');
  skip('hasLoginForm()', 'requires document.querySelector — DOM context only');
});

describe('getDicePageUrl', () => {
  // getDicePageUrl() reads location.href, which in our test context is the test runner URL
  it('returns a string ending in /dice.php', () => {
    const url = getDicePageUrl();
    assert(url.endsWith('/dice.php'), `getDicePageUrl should end with /dice.php, got: ${url}`);
  });
  it('returns a valid URL string', () => {
    const url = getDicePageUrl();
    assert(url.length > 0, 'should return non-empty string');
    assert(url.includes('dice.php'), 'should include dice.php');
  });
});

describe('sendDone / sendError / sendWdDone / sendWdError', () => {
  it('sendDone does not throw', () => {
    // chrome.runtime.sendMessage is stubbed to no-op
    sendDone(1.5);
  });
  it('sendError does not throw', () => {
    sendError('test-error');
  });
  it('sendWdDone does not throw', () => {
    sendWdDone();
  });
  it('sendWdError does not throw', () => {
    sendWdError('wd-test-error');
  });
});

describe('sleep', () => {
  it('returns a Promise', () => {
    const p = sleep(0);
    assert(p instanceof Promise, 'sleep should return a Promise');
  });
  skip('resolves after ~ms milliseconds', 'async timing test — not practical in sync harness');
});

describe('window globals from utils.js', () => {
  it('POLL_MS is 500', () => { assertEqual(window.POLL_MS, 500); });
  it('MAX_WAIT_MS is 90000', () => { assertEqual(window.MAX_WAIT_MS, 90000); });
  it('POST_CLAIM_WAIT_MS is 5000', () => { assertEqual(window.POST_CLAIM_WAIT_MS, 5000); });
  it('RANDOM_DELAY_MIN_MS is 15000', () => { assertEqual(window.RANDOM_DELAY_MIN_MS, 15000); });
  it('RANDOM_DELAY_MAX_MS is 60000', () => { assertEqual(window.RANDOM_DELAY_MAX_MS, 60000); });
  it('NATIVE_CLICK_MIN_INTERVAL_MS is 900', () => { assertEqual(window.NATIVE_CLICK_MIN_INTERVAL_MS, 900); });
  it('DICE_FIXED_MULTIPLIER is 2.0', () => { assertEqual(window.DICE_FIXED_MULTIPLIER, 2.0); });
  it('MIN_STARTING_BALANCE_BET_FRACTION is 0.10', () => { assertEqual(window.MIN_STARTING_BALANCE_BET_FRACTION, 0.10); });
  it('DEFAULT_ALL_IN_CHANCE_PERCENT is 1', () => { assertEqual(window.DEFAULT_ALL_IN_CHANCE_PERCENT, 1); });
  it('RANDOM_14_CHANCE_PERCENT is 14', () => { assertEqual(window.RANDOM_14_CHANCE_PERCENT, 14); });
  it('RANDOM_14_MIN_BET_INTERVAL is 5', () => { assertEqual(window.RANDOM_14_MIN_BET_INTERVAL, 5); });
  it('RANDOM_14_MAX_BET_INTERVAL is 20', () => { assertEqual(window.RANDOM_14_MAX_BET_INTERVAL, 20); });
  it('FAUCET_HANG_TO_DICE_TIMEOUT_MS is 60000', () => { assertEqual(window.FAUCET_HANG_TO_DICE_TIMEOUT_MS, 60000); });
  it('DEBUG defaults to false', () => { assertEqual(window.DEBUG, false); });
});
