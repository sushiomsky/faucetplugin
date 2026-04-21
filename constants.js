// ── Shared constants and utilities ──────────────────────────────────────────
// Single source of truth for values used across background.js, content.js,
// and popup.js. Loaded via importScripts() in the service worker, as the
// first content_script, and as the first <script> in popup.html.

// ── Dice strategy identifiers ─────────────────────────────────────────────────
const DICE_STRATEGY_ALL_IN_001             = "all-in-0.1";
const DICE_STRATEGY_COMBINED_HIGH_ROLLER   = "combined-high-roller";
const DICE_STRATEGY_PYRAMID                = "win-streak-pyramid";
const DICE_STRATEGY_TIME_ACCUMULATOR       = "time-accumulator";
const DICE_STRATEGY_MOMENTUM_40            = "momentum-40";
const DEFAULT_DB_STRATEGY                  = DICE_STRATEGY_ALL_IN_001;
const DEFAULT_DB_SIDE                      = "higher";
const DEFAULT_DB_CHANCE                    = "1";
const SCRAPE_WD_MIN_PATTERNS               = [
  /minimum\s+(?:withdrawal|withdraw|amount)(?:\s+amount)?[:\s\-]+([\d,.]+)/i,
  /min[:\s\-]+([\d,.]+)/i,
  /withdraw\s+min[:\s\-]+([\d,.]+)/i,
  /(?:at least|minimum of)[:\s]+([\d,.]+)\s*[A-Z]{3,}/i,
  /Minimum\s+withdrawal\s+amount[:\s]+<b>([\d,.]+).*?<\/b>/i,
  /Minimum\s+Withdrawal[\s:]+([\d,.]+)/i
];

// ── Per-host withdrawal thresholds (≈ $5 USD equivalent) ─────────────────────
const DEFAULT_USD5_WD_THRESHOLD_BY_HOST = Object.freeze({
  "litepick.io": "0.05",
  "dogepick.io": "30",
  "solpick.io":  "0.0325",
  "bnbpick.io":  "0.009",
  "tronpick.io": "40",
  "polpick.io":  "10"
});

// ── CoinGecko Price IDs ───────────────────────────────────────────────────────
const CRYPTO_PRICE_IDS = Object.freeze({
  "litepick.io": "litecoin",
  "dogepick.io": "dogecoin",
  "solpick.io":  "solana",
  "bnbpick.io":  "binancecoin",
  "tronpick.io": "tron",
  "polpick.io":  "matic-network" // POL/MATIC
});


// ── Random timing defaults ───────────────────────────────────────────────────
const DEFAULT_RANDOM_MIN = 0;
const DEFAULT_RANDOM_MAX = 5;
const DICE_CLAIM_BUFFER_MS = 2 * 60 * 1000; // 2 minute safety window

const STRATEGY_DEFAULTS = Object.freeze({
  [DICE_STRATEGY_PYRAMID]: {
    chance: 49.5,
    side: 'higher',
    base_bet_pct: 0.05,
    multiplier: 2.0,
    max_level: 5,
    drop_levels: 2,
    switch_on_loss: true
  },
  [DICE_STRATEGY_COMBINED_HIGH_ROLLER]: {
    chance: 49.5,
    side: 'higher',
    base_bet_fraction: 0.10,
    max_bet_fraction: 0.60,
    max_ladder_depth: 5,
    history_window: 10,
    streak_trigger: 1,
    volatility_trigger: 4
  },
  [DICE_STRATEGY_MOMENTUM_40]: {
    chance: 40.0,
    side: 'higher',
    base_bet_pct: 2.0,
    multiplier: 1.25,
    max_increases: 3
  }
});

const DEFAULT_PYRAMID_CONFIG = Object.freeze({
  base_bet_pct:      0.05, // 0.05%
  multiplier:        2.0,
  max_level:         5,
  drop_levels:       2,
  switch_on_loss:    true,
  min_bet:           0.00000001
});

const DEFAULT_HIGH_ROLLER_CONFIG = Object.freeze({
  base_bet_fraction: 0.10,
  max_bet_fraction: 0.40,
  max_ladder_depth: 5,
  history_window: 10,
  streak_trigger: 1,
  volatility_trigger: 4,
  min_bet: 0.00000001
});

const DEFAULT_TIME_ACCUMULATOR_CONFIG = Object.freeze({
  chance: 50,
  min_bet_fraction: 0.01,
  max_bet_fraction: 0.90,
  safety_floor_pct: 0.05,
  min_bet: 0.00000001
});

const DEFAULT_MOMENTUM_40_CONFIG = Object.freeze({
  chance: 40.0,
  base_bet_pct: 2.0,
  multiplier: 1.25,
  max_increases: 3,
  lottery_enabled: false,
  lottery_frequency: 100,
  lottery_win_chance: 0.5,
  lottery_safe_mode: true,
  min_bet: 0.00000001
});

// ── Anti-Detection & Timing Defaults ─────────────────────────────────────────
const DEFAULT_LONG_BREAK_ENABLED   = false;
const DEFAULT_LONG_BREAK_FREQUENCY = 5; // Every 5 claims
const DEFAULT_LONG_BREAK_MIN       = 65;
const DEFAULT_LONG_BREAK_MAX       = 80;
const DEFAULT_BOT_NAME            = "FaucetPick Bot";

// ── Pure utility functions ────────────────────────────────────────────────────

function normalizeHost(host) {
  return String(host || "").replace(/^www\./i, "").toLowerCase();
}

/**
 * Standardizes a URL for dictionary lookup by removing protocol, www and trailing slash.
 */
function normalizeUrl(u) {
  if (!u || typeof u !== 'string') return "";
  return u.replace(/\/$/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
}

function toFiniteNumber(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDiceSide(side) {
  return String(side || "").toLowerCase() === "lower" ? "lower" : "higher";
}

// Get price ID for host
function getPriceIdForHost(host) {
  return CRYPTO_PRICE_IDS[normalizeHost(host)] || null;
}

// dbEnabled param is accepted for call-site compatibility but not used.
function normalizeDbStrategy(rawStrategy, dbEnabled = false) {
  const normalized = String(rawStrategy || "").toLowerCase();
  if (normalized === DICE_STRATEGY_ALL_IN_001) return DICE_STRATEGY_ALL_IN_001;
  if (normalized === DICE_STRATEGY_COMBINED_HIGH_ROLLER) return DICE_STRATEGY_COMBINED_HIGH_ROLLER;
  if (normalized === DICE_STRATEGY_PYRAMID) return DICE_STRATEGY_PYRAMID;
  if (normalized === DICE_STRATEGY_TIME_ACCUMULATOR) return DICE_STRATEGY_TIME_ACCUMULATOR;
  if (normalized === DICE_STRATEGY_MOMENTUM_40) return DICE_STRATEGY_MOMENTUM_40;
  return DEFAULT_DB_STRATEGY;
}

// Returns the chance as a string (suitable for storage and display).
function normalizeDbChance(rawChance, dbStrategy) {
  const parsed = parseFloat(rawChance);
  if (!Number.isFinite(parsed)) {
    return dbStrategy === DICE_STRATEGY_ALL_IN_001 ? DEFAULT_DB_CHANCE : "50";
  }
  return String(clampNumber(parsed, 0.01, 99));
}

function getDefaultHighRollerConfig() {
  return { ...DEFAULT_HIGH_ROLLER_CONFIG };
}

function getDefaultPyramidConfig() {
  return normalizePyramidConfig(DEFAULT_PYRAMID_CONFIG);
}

function getDefaultTimeAccumulatorConfig() {
  return { ...DEFAULT_TIME_ACCUMULATOR_CONFIG };
}

// Returns the per-host default WD threshold string for a faucet URL.
function getDefaultWdThresholdForUrl(url) {
  try {
    const host = normalizeHost(new URL(url).hostname);
    return DEFAULT_USD5_WD_THRESHOLD_BY_HOST[host] || "5";
  } catch {
    return "5";
  }
}

// Normalises a stored WD threshold string.
function normalizeWdThresholdForUrl(url, rawThreshold) {
  const fallback = getDefaultWdThresholdForUrl(url);
  const parsed = parseFloat(rawThreshold);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return String(rawThreshold).trim();
}

// Validates and clamps every field of a high-roller strategy config object.
function normalizeHighRollerConfig(rawConfig = {}) {
  const cfg = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const base_bet_fraction = clampNumber(
    toFiniteNumber(cfg.base_bet_fraction, DEFAULT_HIGH_ROLLER_CONFIG.base_bet_fraction),
    0.00000001, 0.95
  );
  const max_bet_fraction = clampNumber(
    toFiniteNumber(cfg.max_bet_fraction, DEFAULT_HIGH_ROLLER_CONFIG.max_bet_fraction),
    base_bet_fraction, 1
  );
  const max_ladder_depth = clampNumber(
    Math.round(toFiniteNumber(cfg.max_ladder_depth, DEFAULT_HIGH_ROLLER_CONFIG.max_ladder_depth)),
    1, 10
  );
  const history_window = clampNumber(
    Math.round(toFiniteNumber(cfg.history_window, DEFAULT_HIGH_ROLLER_CONFIG.history_window)),
    1, 200
  );
  const streak_trigger = clampNumber(
    Math.round(toFiniteNumber(cfg.streak_trigger, DEFAULT_HIGH_ROLLER_CONFIG.streak_trigger)),
    1, 50
  );
  const volatility_trigger = clampNumber(
    Math.round(toFiniteNumber(cfg.volatility_trigger, DEFAULT_HIGH_ROLLER_CONFIG.volatility_trigger)),
    1, history_window
  );
  return { base_bet_fraction, max_bet_fraction, max_ladder_depth, history_window, streak_trigger, volatility_trigger };
}

// Validates and clamps every field of a pyramid strategy config object.
function normalizePyramidConfig(rawConfig = {}) {
  const cfg = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const base_bet_pct = clampNumber(
    toFiniteNumber(cfg.base_bet_pct, DEFAULT_PYRAMID_CONFIG.base_bet_pct),
    0.00001, 50
  );
  const multiplier = clampNumber(
    toFiniteNumber(cfg.multiplier, DEFAULT_PYRAMID_CONFIG.multiplier),
    1.01, 10
  );
  const max_level = clampNumber(
    Math.round(toFiniteNumber(cfg.max_level, DEFAULT_PYRAMID_CONFIG.max_level)),
    1, 20
  );
  const drop_levels = clampNumber(
    Math.round(toFiniteNumber(cfg.drop_levels, DEFAULT_PYRAMID_CONFIG.drop_levels)),
    1, max_level
  );
  const switch_on_loss = cfg.switch_on_loss !== false;
  
  return { base_bet_pct, multiplier, max_level, drop_levels, switch_on_loss };
}

// ── Default faucet list (single source of truth) ──────────────────────────────
// background.js and popup.js both use this to initialise / reset settings.
function makeFaucetDefaults() {
  return [
    { url: "https://litepick.io/",    coin: "LTC",  label: "litepick",  active: false, referralId: "frankgoosen",    intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "0.05",   wdThresholdIsManual: false, wdMinDetected: "0", wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig(), dbPyramidConfig: getDefaultPyramidConfig(), dbMomentumConfig: DEFAULT_MOMENTUM_40_CONFIG },
    { url: "https://dogepick.io/",    coin: "DOGE", label: "dogepick",  active: false, referralId: "schnickfitzel2", intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "30",     wdThresholdIsManual: false, wdMinDetected: "0", wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig(), dbPyramidConfig: getDefaultPyramidConfig(), dbMomentumConfig: DEFAULT_MOMENTUM_40_CONFIG },
    { url: "https://solpick.io/",     coin: "SOL",  label: "solpick",   active: false, referralId: "tstehg",         intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "0.0325", wdThresholdIsManual: false, wdMinDetected: "0", wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig(), dbPyramidConfig: getDefaultPyramidConfig(), dbMomentumConfig: DEFAULT_MOMENTUM_40_CONFIG },
    { url: "https://bnbpick.io/",     coin: "BNB",  label: "bnbpick",   active: false, referralId: "schnickfitzel",   intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "0.009",  wdThresholdIsManual: false, wdMinDetected: "0", wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig(), dbPyramidConfig: getDefaultPyramidConfig(), dbMomentumConfig: DEFAULT_MOMENTUM_40_CONFIG },
    { url: "https://tronpick.io/",    coin: "TRX",  label: "tronpick",  active: false, referralId: "schnickfitzel",   intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "40",     wdThresholdIsManual: false, wdMinDetected: "0", wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig(), dbPyramidConfig: getDefaultPyramidConfig(), dbMomentumConfig: DEFAULT_MOMENTUM_40_CONFIG },
    { url: "https://polpick.io/",     coin: "POL",  label: "polpick",   active: false, referralId: "schnickfitzel",   intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "10",     wdThresholdIsManual: false, wdMinDetected: "0", wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig(), dbPyramidConfig: getDefaultPyramidConfig(), dbMomentumConfig: DEFAULT_MOMENTUM_40_CONFIG }
  ];
}
