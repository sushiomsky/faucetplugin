// ── dice.js ─────────────────────────────────────────────────────────────

/**
 * DiceAPI
 * Reliable interaction with the faucet game UI.
 */
class DiceAPI {
  constructor(logger = log) {
    this.logger = logger;
  }

  async getBalance(retries = 3) {
    return await readDicebetBalanceWithRetries(retries, 800);
  }

  async setBetAmount(amount) {
    const input = findDicebetAmountInput();
    if (!input) throw new Error("amount-input-not-found");
    await setDicebetInputValue(input, amount.toFixed(8));
    // Trigger site-specific update logic
    if (typeof window.set_bet_amount === "function") window.set_bet_amount();
    if (typeof window.change_bet_amount === "function") window.change_bet_amount();
  }

  async setChance(chance) {
    const input = findDicebetChanceInput();
    if (!input) throw new Error("chance-input-not-found");
    await setDicebetInputValue(input, chance.toFixed(2));
    if (typeof window.change_win_chance === "function") window.change_win_chance();
    if (typeof window.change_win_chance2 === "function") window.change_win_chance2(chance);
  }

  async setSide(side) {
    const normalized = normalizeDiceSide(side);
    applyDicebetSide(normalized);
  }

  async roll() {
    const ready = await waitForDicebetIdle(10000);
    if (!ready) {
      log("[Dice] Engine stuck — initiating Focus Reset");
      document.body.click(); // Click background to reset site focus
      await sleep(500);
    }
    
    // Turbo Buffer: Let the site's JS process the amount change
    await sleep(300); 

    const started = placeDicebetRound();
    if (!started) throw new Error("roll-failed-to-start");
    
    this.logger("[Turbo] Bet placed. Waiting for result...");

    const finished = await waitForDicebetIdle(120000);
    if (!finished) throw new Error("roll-timeout");
    
    return true;
  }
}

/**
 * WinStreakPyramidStrategy
 * Increases bet selectively on wins, partial reset on loss.
 */
class WinStreakPyramid {
  constructor(config, api, logger = log) {
    this.config = typeof normalizePyramidConfig === "function" ? normalizePyramidConfig(config) : config;
    this.api = api;
    this.logger = logger;
    this.level = 0;
    this.startBalance = 0;
    this.sessionProfit = 0;
    this.side = (config && config.side) ? config.side : "higher";
    this.chance = (config && config.chance) ? config.chance : 49.5;
    this.isInitialized = false;
  }

  async init() {
    this.startBalance = await this.api.getBalance();
    // If balance is 0 or null, throw a soft error so we can exit gracefully
    if (this.startBalance == null || this.startBalance <= 0) {
        throw new Error("empty-balance-stopping");
    }
    this.isInitialized = true;
    const initialBaseBet = this.calculateBaseBet(this.startBalance);
    this.logger(`[Pyramid] Initialized. Start Balance: ${this.startBalance.toFixed(8)} | Session Base Bet: ${initialBaseBet.toFixed(8)} (${this.config.base_bet_pct}%)`);
  }

  calculateBaseBet(currentBalance) {
    const raw = currentBalance * (this.config.base_bet_pct / 100);
    return Math.max(raw, 0.00000001); // Safety floor
  }

  async runRound() {
    if (!this.isInitialized) await this.init();

    const currentBalance = await this.api.getBalance();
    const profit = currentBalance - this.startBalance;
    const profitPct = (profit / this.startBalance) * 100;

    this.logger(`[Pyramid] Current Balance: ${currentBalance.toFixed(8)} | Profit: ${profit.toFixed(8)} (${profitPct.toFixed(2)}%)`);

    // Pyramid Logic
    const baseBet = this.calculateBaseBet(currentBalance);
    const currentBet = baseBet * Math.pow(this.config.multiplier, this.level);
    
    this.logger(`[Pyramid] Level: ${this.level} | Bet: ${currentBet.toFixed(8)} | Side: ${this.side}`);

    await this.api.setBetAmount(currentBet);
    await this.api.setChance(this.chance); 
    await this.api.setSide(this.side);

    const balanceBefore = await this.api.getBalance();
    await this.api.roll();
    
    // Wait for balance to settle (Turbo: 50ms polling)
    let balanceAfter = balanceBefore;
    for (let i = 0; i < 40; i++) {
        await sleep(50);
        balanceAfter = await this.api.getBalance();
        if (balanceAfter !== balanceBefore) break;
    }
    const win = balanceAfter > balanceBefore;

    if (win) {
      this.lossStreak = 0;
      if (this.level >= this.config.max_level) {
          this.logger(`[Pyramid] Max Level reached & won. Locking in profit and resetting.`);
          this.level = 0;
      } else {
          this.level++;
          this.logger(`[Pyramid] WIN! Moving to Level ${this.level}`);
      }
    } else {
      this.lossStreak = (this.lossStreak || 0) + 1;
      // Partial Reset
      this.level = Math.max(0, this.level - this.config.drop_levels);
      this.logger(`[Pyramid] LOSS (Streak: ${this.lossStreak}). Dropping to Level ${this.level}`);
      
      if (this.config.switch_on_loss) {
        this.side = this.side === "higher" ? "lower" : "higher";
      }

      // Optional: Pause after 5 consecutive losses
      if (this.lossStreak >= 5) {
          this.logger(`[Pyramid] High loss streak detected. Pausing for 30s...`);
          await sleep(30000);
          this.lossStreak = 0;
      }
    }

    return { stop: false };
  }
}

/**
 * TimeAccumulatorStrategy
 * Bets accumulated profit with increasing risk as the next claim approaches.
 */
class TimeAccumulatorStrategy {
  constructor(config = {}, api, intervalMinutes = 61, lastClaimedAt = 0, logger = log) {
    this.config = config || { ...DEFAULT_TIME_ACCUMULATOR_CONFIG };
    this.api = api;
    this.logger = logger;
    this.intervalMs = intervalMinutes * 60 * 1000;
    this.lastClaimedAt = lastClaimedAt;
    this.startBalance = 0;
    this.isInitialized = false;
  }

  async init() {
    this.startBalance = await this.api.getBalance();
    if (this.startBalance == null || this.startBalance <= 0) {
      throw new Error("empty-balance-stopping");
    }
    this.isInitialized = true;
    this.logger(`[TimeAccumulator] Initialized. Start Balance: ${this.startBalance.toFixed(8)}`);
  }

  async runRound() {
    if (!this.isInitialized) await this.init();

    const currentBalance = await this.api.getBalance();
    const accumulated = currentBalance - this.startBalance;
    const now = Date.now();
    const elapsed = now - this.lastClaimedAt;
    const progress = Math.min(1.0, Math.max(0, elapsed / this.intervalMs));
    
    // Risk lerp: from min_fraction to max_fraction based on time progress
    const minFrac = this.config.min_bet_fraction || 0.01;
    const maxFrac = this.config.max_bet_fraction || 0.90;
    const riskFactor = minFrac + (maxFrac - minFrac) * progress;

    let betAmount = 0;
    if (accumulated > 0) {
      betAmount = accumulated * riskFactor;
    } else {
      // Safety floor: if no profit, bet a tiny fraction of balance to seed the "accumulated" fund
      const safetyFloor = currentBalance * (this.config.safety_floor_pct / 100);
      betAmount = Math.max(safetyFloor, 0.00000001);
    }

    // Hard floor at 1 satoshi
    betAmount = Math.max(betAmount, 0.00000001);
    // Hard cap at current balance
    betAmount = Math.min(betAmount, currentBalance);

    this.logger(`[TimeAccumulator] Progress: ${(progress * 100).toFixed(1)}% | Risk: ${(riskFactor * 100).toFixed(1)}% | Accumulated: ${accumulated.toFixed(8)} | Bet: ${betAmount.toFixed(8)}`);

    await this.api.setBetAmount(betAmount);
    await this.api.setChance(this.config.chance || 50);
    await this.api.setSide(this.config.side || "higher");
    await this.api.roll();

    return { stop: false };
  }
}

// ── Legacy Strategy Support ───────────────────────────────────────────────────

class CombinedHighRollerStrategy {
  constructor(config = {}, logger = log) {
    this.config = normalizeHighRollerConfig(config);
    this.logger = typeof logger === "function" ? logger : () => {};
    this.side = (config && config.side) ? config.side : "higher";
    this.chance = (config && config.chance) ? config.chance : 49.5;
    this.initialize(0);
  }

  initialize(start_bankroll) {
    const bankroll = Math.max(0, toFiniteNumber(start_bankroll, 0));
    this.start_bankroll = bankroll;
    this.current_bankroll = bankroll;
    this.roll_history = [];
    this.win_streak = 0;
    this.loss_streak = 0;
    this.mode = "kelly_hybrid";
    this.ladder_step = 0;
    this.last_bet = 0;
    this.last_stop_reason = null;
    this.total_rolls = 0;
    this.log_state("initialize");
  }

  calculate_kelly_bet() {
    let fraction = this.config.base_bet_fraction;
    if (this.win_streak >= 3) {
      fraction = 0.18;
    } else if (this.win_streak >= 2) {
      fraction = 0.12;
    }
    return this.current_bankroll * fraction;
  }

  calculate_streak_harvester_bet() {
    const stepOneFraction = clampNumber(this.config.base_bet_fraction, 0.05, 0.10);
    const stepIndex = Math.min(this.ladder_step, this.config.max_ladder_depth - 1);
    const fraction = stepOneFraction * Math.pow(2, stepIndex);
    return this.current_bankroll * fraction;
  }

  calculate_breakout_bet() {
    const breakoutFractions = [0.10, 0.15, 0.22];
    const maxDepth = Math.max(1, Math.min(this.config.max_ladder_depth, breakoutFractions.length));
    const stepIndex = Math.min(this.ladder_step, maxDepth - 1);
    const fraction = breakoutFractions[stepIndex];
    return this.current_bankroll * fraction;
  }

  get_volatility_delta() {
    if (this.roll_history.length < this.config.history_window) return 0;
    const recent = this.roll_history.slice(-this.config.history_window);
    const wins = recent.filter(Boolean).length;
    const losses = recent.length - wins;
    return Math.abs(wins - losses);
  }

  update_mode() {
    if (this.mode === "streak_harvester" || this.mode === "volatility_breakout") {
      return this.mode;
    }

    const volatilityDelta = this.get_volatility_delta();
    let nextMode = "kelly_hybrid";
    if (volatilityDelta >= this.config.volatility_trigger) {
      nextMode = "volatility_breakout";
    } else if (this.win_streak >= this.config.streak_trigger) {
      nextMode = "streak_harvester";
    }

    if (nextMode !== this.mode) {
      this.mode = nextMode;
      this.ladder_step = 0;
      this.log_state("mode-switch");
    }

    return this.mode;
  }

  apply_bankroll_protection() {
    if (this.current_bankroll <= 0) {
      this.logger("[Dice] Bankroll reached zero. Waiting for next claim...");
      return { stop: false, reason: "bankroll-zero" };
    }
    return { stop: false, reason: null };
  }

  should_stop() {
    const protection = this.apply_bankroll_protection();
    this.last_stop_reason = protection.reason;
    return protection.stop;
  }

  get_stop_reason() {
    return this.last_stop_reason;
  }

  get_next_bet() {
    if (this.should_stop()) {
      this.last_bet = 0;
      this.log_state("halted");
      return 0;
    }

    this.update_mode();

    let bet = 0;
    if (this.mode === "streak_harvester") {
      bet = this.calculate_streak_harvester_bet();
    } else if (this.mode === "volatility_breakout") {
      bet = this.calculate_breakout_bet();
    } else {
      bet = this.calculate_kelly_bet();
    }

    const hardCap = this.current_bankroll * this.config.max_bet_fraction;
    bet = Math.min(toFiniteNumber(bet, 0), hardCap, this.current_bankroll);

    const startBalanceFloor = this.start_bankroll * (window.MIN_STARTING_BALANCE_BET_FRACTION || 0.01);
    if (this.current_bankroll <= startBalanceFloor) {
      bet = this.current_bankroll;
    } else {
      bet = Math.max(bet, startBalanceFloor);
    }

    if (bet > this.current_bankroll) {
      bet = this.current_bankroll;
    }

    bet = Math.floor(bet * 1e8) / 1e8;

    if (!Number.isFinite(bet) || bet <= 0) {
      this.last_bet = 0;
      this.log_state("bet-invalid");
      return 0;
    }

    this.last_bet = bet;
    this.log_state("next-bet");
    return bet;
  }

  on_roll_result(win, observedBankroll = null) {
    const didWin = !!win;
    const bet = this.last_bet;
    if (!Number.isFinite(bet) || bet <= 0) {
      this.log_state("result-without-bet", { result: didWin ? "win" : "loss" });
      return;
    }

    const observed = Number(observedBankroll);
    if (Number.isFinite(observed) && observed >= 0) {
      this.current_bankroll = observed;
    } else {
      const delta = didWin ? bet * (window.DICE_FIXED_MULTIPLIER - 1) : -bet;
      this.current_bankroll = Math.max(0, this.current_bankroll + delta);
    }
    this.total_rolls += 1;

    if (didWin) {
      this.win_streak += 1;
      this.loss_streak = 0;
    } else {
      this.loss_streak += 1;
      this.win_streak = 0;
    }

    this.roll_history.push(didWin);
    if (this.roll_history.length > this.config.history_window) {
      this.roll_history.shift();
    }

    if (this.mode === "streak_harvester" || this.mode === "volatility_breakout") {
      if (didWin) {
        const maxStepIndex = Math.max(0, this.config.max_ladder_depth - 1);
        if (this.ladder_step < maxStepIndex) {
          this.ladder_step += 1;
        } else {
          this.mode = "kelly_hybrid";
          this.ladder_step = 0;
        }
      } else {
        this.mode = "kelly_hybrid";
        this.ladder_step = 0;
      }
    }

    if (!didWin) {
      this.mode = "kelly_hybrid";
    }

    this.log_state("roll-result", {
      result: didWin ? "win" : "loss",
      ladderStep: this.ladder_step + 1
    });
  }

  log_state(event, extra = {}) {
    const ladderSummary = this.mode === "kelly_hybrid"
      ? "0/0"
      : `${this.ladder_step + 1}/${this.config.max_ladder_depth}`;
    const parts = [
      `[HighRoller] ${event}`,
      `mode=${this.mode}`,
      `bankroll=${this.current_bankroll.toFixed(8)}`,
      `bet=${this.last_bet.toFixed(8)}`,
      `streak=${this.win_streak}`,
      `ladder=${ladderSummary}`
    ];
    for (const [key, value] of Object.entries(extra)) {
      parts.push(`${key}=${value}`);
    }
    this.logger(parts.join(" | "));
  }
}

// ── Helpers & Entry Point ─────────────────────────────────────────────────────

async function getDicebetConfig() {
  const { settings, activeTabs = {}, claimHistory = {} } = await chrome.storage.local.get(["settings", "activeTabs", "claimHistory"]);
  const faucets = settings?.faucets || [];
  const faucet = faucets.find(f => {
    try { return new URL(f.url).hostname === location.hostname; } catch { return false; }
  });
  
  // Find current tab state to check for manual override
  const tabData = Object.values(activeTabs).find(t => sameHost(t.faucetUrl, location.href));
  const isManual = (location.hash === "#manual") || (tabData?.manualMode === true);
  
  const diceEnabled = isManual || (faucet?.dbEnabled === true);
  const strategy = normalizeDbStrategy(faucet?.dbStrategy || "pyramid", diceEnabled);
  
  if (isManual) log("[Dice] Manual Override Active (#manual): Engine forced to ENABLED.");
  
  let strategyConfig = {};
  if (strategy === DICE_STRATEGY_PYRAMID) {
    strategyConfig = { ...DEFAULT_PYRAMID_CONFIG, ...(faucet?.dbPyramidConfig || {}) };
  } else if (strategy === DICE_STRATEGY_TIME_ACCUMULATOR) {
    strategyConfig = { ...DEFAULT_TIME_ACCUMULATOR_CONFIG, ...(faucet?.dbTimeAccumulatorConfig || {}) };
  } else {
    strategyConfig = faucet?.dbStrategyConfig || getDefaultHighRollerConfig();
  }

  return {
    enabled: diceEnabled,
    side: normalizeDiceSide(faucet?.dbSide || "higher"),
    strategy,
    chance: toFiniteNumber(faucet?.dbChance, 49.5),
    wdThreshold: normalizeWdThresholdForUrl(faucet?.url, faucet?.wdThreshold),
    lastClaimedAt: claimHistory[faucet?.url || ""] || 0,
    intervalMinutes: faucet?.intervalMinutes || 61,
    strategyConfig: {
        ...strategyConfig,
        dbSide: normalizeDiceSide(faucet?.dbSide || "higher"),
        dbChance: toFiniteNumber(faucet?.dbChance, 49.5)
    },
    isManual
  };
}

async function setDicebetInputValue(input, value) {
  if (!input) return;
  input.focus();
  
  // Human-like typing delay
  const str = String(value);
  input.value = ""; 
  for (const char of str) {
    input.value += char;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(20); 
  }
  
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
  input.blur(); 
}

function findDicebetChanceInput() { return SiteSelectors.getFirstValid("diceChanceInput"); }
function findDicebetAmountInput() { return SiteSelectors.getFirstValid("diceAmountInput"); }
function findDicebetBetButton() { return SiteSelectors.getFirstValid("diceBetButton"); }

function applyDicebetSide(side) {
  if (typeof window.bet_on === "string") window.bet_on = side;
  if (typeof window.set_roll_to_win === "function") window.set_roll_to_win();
  const label = document.getElementById("roll_to_win_lb");
  if (label) label.textContent = side === "higher" ? "Roll over to win" : "Roll under to win";
}

function placeDicebetRound() {
  if (typeof window.process_bet_game_dice === "function") {
    try {
      window.process_bet_game_dice();
      return true;
    } catch (err) {
      log(`[Dice] Internal function failed: ${err.message}. Falling back to click.`);
    }
  }
  const btn = findDicebetBetButton();
  if (btn) {
    if (btn.disabled) {
      log("[Dice] Button is disabled — forcing enable");
      btn.disabled = false;
    }
    
    // Aggressive Event Dispatch
    btn.focus();
    const events = ["mousedown", "mouseup", "click", "pointerdown", "pointerup"];
    for (const type of events) {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }
  return false;
}

async function readDicebetBalanceWithRetries(maxRetries = 4, delayMs = 900) {
  for (let i = 0; i < maxRetries; i++) {
    const bal = readBalance();
    if (bal != null) return bal;
    await sleep(delayMs);
  }
  return null;
}

function isDicebetIdle() {
  const btn = findDicebetBetButton();
  if (btn && btn.disabled) return false;
  
  // Site-specific loaders
  const loaders = [
    ".loading", "#loading", ".spinner", ".progress", 
    "[class*='loading' i]", "[id*='loading' i]",
    ".btn-loading", "[disabled]"
  ];
  for (const sel of loaders) {
    try {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return false;
    } catch (_) {}
  }
  
  return true; 
}

async function waitForDicebetIdle(maxWaitMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (isDicebetIdle()) return true;
    await sleep(20);
  }
  log("[Dice] Idle wait timeout — proceeding anyway (Forced Mode)");
  return true; // Forced fallback
}

async function runDicebet() {
  window.auto_betting_status = "starting"; // Immediate lock
  await sleep(1000); // 1s stability delay
  
  log("[Turbo] MANUAL BOOTSTRAP INITIATED");
  await dicebetDiagnosticScan(); // Performance & Visibility Audit
  
  sendPhaseHeartbeat("dice-start");

  const config = await getDicebetConfig();
  const threshold = parseFloat(config.wdThreshold);
  const api = new DiceAPI(log);

  // Guard: If not enabled, just check if we need to withdraw and exit
  if (!config.enabled) {
    log("DiceBet disabled, performing threshold check only.");
    const bal = await api.getBalance();
    return bal != null && bal >= threshold;
  }

  // Guard: If no balance, exit immediately
  const startBal = await api.getBalance();
  if (startBal == null || startBal <= 0) {
    log("DiceBet: No balance found, skipping betting phase.");
    return false;
  }

  // Recovery Wrapper: Ensuring the bot NEVER stops due to errors
  while (true) {
    try {
      const currentBal = await api.getBalance();
      if (currentBal == null) {
        log(`[Dice] Waiting for balance to load...`);
        await sleep(5000);
        continue;
      }
      if (currentBal >= threshold) return true;

      // All-In Strategy
      if (config.strategy === DICE_STRATEGY_ALL_IN_001) {
        const allInCfg = config.allInConfig || {};
        log(`[All-In] Balance: ${currentBal.toFixed(8)} | Threshold: ${threshold}`);
        await api.setBetAmount(currentBal);
        await api.setChance(allInCfg.chance || 49.5);
        await api.setSide(allInCfg.side || "higher");
        await api.roll();
        await sleep(5000);
        continue;
      }

      // Win-Streak Pyramid Strategy
      if (config.strategy === DICE_STRATEGY_PYRAMID) {
        const pyramid = new WinStreakPyramid(config.pyramidConfig, api, log);
        while (true) {
          const res = await pyramid.runRound();
          await sleep(100); 
          const bal = await api.getBalance();
          if (bal >= threshold) return true;
        }
      }

      // Time-Accumulator Strategy
      if (config.strategy === DICE_STRATEGY_TIME_ACCUMULATOR) {
        const timeAcc = new TimeAccumulatorStrategy(config.strategyConfig, api, config.intervalMinutes, config.lastClaimedAt, log);
        while (true) {
          await timeAcc.runRound();
          await sleep(200); 
          const bal = await api.getBalance();
          if (bal >= threshold) return true;
        }
      }

      // Default / Combined High Roller Strategy
      const hrCfg = config.strategyConfig || {};
      const strategy = new CombinedHighRollerStrategy(hrCfg, log);
      strategy.initialize(currentBal);
      while (true) {
        const bal = await api.getBalance();
        if (bal >= threshold) return true;
        
        strategy.current_bankroll = bal || 0;
        const nextBet = strategy.get_next_bet();
        
        await api.setBetAmount(nextBet);
        await api.setChance(strategy.chance);
        await api.setSide(strategy.side);
        await api.roll();
        
        await sleep(2000);
        const balAfter = await api.getBalance();
        strategy.on_roll_result(balAfter > bal, balAfter);
      }
    } catch (err) {
      log(`[Dice] ENGINE CRASH DETECTED: ${err.message}. Rebooting in 5s...`);
      await sleep(5000);
    }
  }
}

async function dicebetDiagnosticScan() {
  console.group("🔍 [Dice] DOM DIAGNOSTIC SCAN");
  try {
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], a[role="button"]'));
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'));
    
    console.log("Buttons found:", buttons.length);
    buttons.forEach(b => {
      const rect = b.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(b).display !== 'none';
      console.log(`- [${visible ? 'VISIBLE' : 'HIDDEN'}] Text: "${b.innerText?.trim() || b.value}" | ID: #${b.id} | Class: .${b.className.split(' ').join('.')}`);
    });

    console.log("Inputs found:", inputs.length);
    inputs.forEach(i => {
      console.log(`- Name: "${i.name}" | ID: #${i.id} | Placeholder: "${i.placeholder}" | Value: "${i.value}"`);
    });

    const rollBtn = findDicebetBetButton();
    const amtInput = findDicebetAmountInput();
    console.log("Target Roll Button:", rollBtn ? "FOUND ✅" : "NOT FOUND ❌");
    console.log("Target Amount Input:", amtInput ? "FOUND ✅" : "NOT FOUND ❌");
    
    if (rollBtn) {
      const style = window.getComputedStyle(rollBtn);
      console.log("Roll Button Style:", { pointerEvents: style.pointerEvents, opacity: style.opacity, zIndex: style.zIndex });
    }
  } catch (err) {
    console.error("Diagnostic failed:", err);
  }
  console.groupEnd();
}
