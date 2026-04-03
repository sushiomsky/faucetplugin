// ── Shared constants and utilities ──────────────────────────────────────────
// Single source of truth for values used across background.js, content.js,
// and popup.js. Loaded via importScripts() in the service worker, as the
// first content_script, and as the first <script> in popup.html.

// ── Dice strategy identifiers ─────────────────────────────────────────────────
const DICE_STRATEGY_ALL_IN_001             = "all-in-0.1";
const DICE_STRATEGY_COMBINED_HIGH_ROLLER   = "combined-high-roller";
const DEFAULT_DB_STRATEGY                  = DICE_STRATEGY_ALL_IN_001;
const DEFAULT_DB_SIDE                      = "higher";
const DEFAULT_DB_CHANCE                    = "1";

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

const DEFAULT_HIGH_ROLLER_CONFIG = Object.freeze({
  base_bet_fraction:  0.10,
  max_bet_fraction:   0.40,
  max_ladder_depth:   5,
  history_window:     10,
  streak_trigger:     1,
  volatility_trigger: 4
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

function toFiniteNumber(value, fallback) {
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

// ── Default faucet list (single source of truth) ──────────────────────────────
// background.js and popup.js both use this to initialise / reset settings.
function makeFaucetDefaults() {
  return [
    { url: "https://litepick.io/",    coin: "LTC",  label: "litepick",  active: false, referralId: "frankgoosen",    intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "0.05",   wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig() },
    { url: "https://dogepick.io/",    coin: "DOGE", label: "dogepick",  active: false, referralId: "schnickfitzel2", intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "30",     wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig() },
    { url: "https://solpick.io/",     coin: "SOL",  label: "solpick",   active: false, referralId: "tstehg",         intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "0.0325", wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig() },
    { url: "https://bnbpick.io/",     coin: "BNB",  label: "bnbpick",   active: false, referralId: "schnickfitzel",   intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "0.009",  wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig() },
    { url: "https://tronpick.io/",    coin: "TRX",  label: "tronpick",  active: false, referralId: "schnickfitzel",   intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "40",     wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig() },
    { url: "https://polpick.io/",     coin: "POL",  label: "polpick",   active: false, referralId: "schnickfitzel",   intervalMinutes: 61, minRandomMinutes: DEFAULT_RANDOM_MIN, maxRandomMinutes: DEFAULT_RANDOM_MAX, username: "", password: "", wdEnabled: true, wdThreshold: "10",     wdAddress: "", dbEnabled: false, dbChance: DEFAULT_DB_CHANCE, dbSide: DEFAULT_DB_SIDE, dbStrategy: DEFAULT_DB_STRATEGY, dbStrategyConfig: getDefaultHighRollerConfig() }
  ];
}
