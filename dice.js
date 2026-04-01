// ── dice.js ─────────────────────────────────────────────────────────────

function normalizeDiceChance(rawChance, dbStrategy) {
  const parsed = parseFloat(rawChance);
  if (!Number.isFinite(parsed)) {
    return dbStrategy === DICE_STRATEGY_ALL_IN_001 ? window.DEFAULT_ALL_IN_CHANCE_PERCENT : 48.5;
  }
  return clampNumber(parsed, 0.01, 99);
}

async function loadRandom14Schedule(hostname) {
  const hostKey = normalizeHost(hostname || location.hostname);
  const stored = await chrome.storage.local.get(window.RANDOM_14_STATE_STORAGE_KEY);
  const allState = stored?.[window.RANDOM_14_STATE_STORAGE_KEY];
  const hostState = allState && typeof allState === "object" ? allState[hostKey] : null;

  const settledBetCount = Math.max(0, Math.round(Number(hostState?.settledBetCount) || 0));
  const parsedNext = Number(hostState?.nextRandom14BetAt);
  let nextRandom14BetAt = Number.isFinite(parsedNext) && parsedNext > 0
    ? Math.max(1, Math.round(parsedNext))
    : 0;
  if (nextRandom14BetAt <= settledBetCount) {
    nextRandom14BetAt = settledBetCount + randomIntInclusive(window.RANDOM_14_MIN_BET_INTERVAL, window.RANDOM_14_MAX_BET_INTERVAL);
  }

  return { hostKey, settledBetCount, nextRandom14BetAt };
}

async function persistRandom14Schedule(hostKey, settledBetCount, nextRandom14BetAt) {
  const stored = await chrome.storage.local.get(window.RANDOM_14_STATE_STORAGE_KEY);
  const currentState = stored?.[window.RANDOM_14_STATE_STORAGE_KEY];
  const allState = currentState && typeof currentState === "object" ? { ...currentState } : {};
  allState[hostKey] = {
    settledBetCount: Math.max(0, Math.round(Number(settledBetCount) || 0)),
    nextRandom14BetAt: Math.max(1, Math.round(Number(nextRandom14BetAt) || 1)),
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ [window.RANDOM_14_STATE_STORAGE_KEY]: allState });
}

class CombinedHighRollerStrategy {
  constructor(config = {}, logger = log) {
    this.config = normalizeHighRollerConfig(config);
    this.logger = typeof logger === "function" ? logger : () => {};
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
      return { stop: true, reason: "bankroll-zero" };
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

    const startBalanceFloor = this.start_bankroll * window.MIN_STARTING_BALANCE_BET_FRACTION;
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

async function getDicebetConfig() {
  const { settings } = await chrome.storage.local.get("settings");
  const faucets = settings?.faucets || [];
  const faucet = faucets.find(f => {
    try { return new URL(f.url).hostname === location.hostname; } catch { return false; }
  });
  const diceEnabled = faucet?.dbEnabled === true;
  const strategy = normalizeDbStrategy(faucet?.dbStrategy, diceEnabled);
  const parsedChance = parseFloat(faucet?.dbChance || "");
  const normalizedThreshold = normalizeWdThresholdForHost(location.hostname, faucet?.wdThreshold);
  const rawStrategyConfig = faucet?.dbStrategyConfig && typeof faucet.dbStrategyConfig === "object"
    ? faucet.dbStrategyConfig
    : (faucet?.dbStrategy && typeof faucet.dbStrategy === "object" ? faucet.dbStrategy : {});

  return {
    enabled: diceEnabled,
    side: normalizeDiceSide(faucet?.dbSide || "higher"),
    strategy,
    chance: normalizeDiceChance(parsedChance, strategy),
    wdThreshold: normalizedThreshold,
    strategyConfig: rawStrategyConfig
  };
}

function setDicebetInputValue(input, value) {
  if (!input) return;
  input.focus();
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
}

function findDicebetChanceInput() {
  const el = SiteSelectors.getFirstValid("diceChanceInput");
  if (el) log(`✓ Found chance input`);
  return el;
}

function findDicebetBetButton() {
  const selectors = SiteSelectors.get("diceBetButton");
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      if (!el.offsetParent) continue; 
      const text = (el.textContent || el.value || '').toLowerCase();
      if (text.includes('roll') || text.includes('bet') || text.includes('play')) {
        log(`✓ Found bet button with selector: ${sel}, text: "${text}"`);
        return el;
      }
    }
  }
  return null;
}

function findDicebetAmountInput() {
  return SiteSelectors.getFirstValid("diceAmountInput");
}

function findDicebetMultiplierInput() {
  return SiteSelectors.getFirstValid("diceMultiplierInput");
}

function applyDicebetSide(side) {
  const normalized = normalizeDiceSide(side);
  if (typeof window.bet_on === "string") {
    window.bet_on = normalized;
  }
  if (typeof window.set_roll_to_win === "function") {
    window.set_roll_to_win();
  }
  if (typeof window.set_slide_bar === "function") {
    window.set_slide_bar();
  }
  const label = document.getElementById("roll_to_win_lb");
  if (label) {
    label.textContent = normalized === "higher" ? "Roll over to win" : "Roll under to win";
  }
}

function readNumericInputById(id) {
  const input = document.getElementById(id);
  if (!input) return null;
  const parsed = parseFloat(String(input.value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function applyDicebetTargets(chance) {
  const chanceInput = findDicebetChanceInput();
  if (chanceInput && Number.isFinite(chance)) {
    setDicebetInputValue(chanceInput, chance.toFixed(2));
    if (typeof window.change_win_chance === "function") {
      window.change_win_chance();
    } else if (typeof window.change_win_chance2 === "function") {
      window.change_win_chance2(chance);
    }
  }

  return {
    appliedChance: readNumericInputById("win_chance"),
    appliedMultiplier: readNumericInputById("multiplier")
  };
}

async function readDicebetBalanceWithRetries(maxRetries = 4, delayMs = 900) {
  let balance = readBalance();
  let attempt = 0;
  while (balance == null && attempt < maxRetries) {
    attempt += 1;
    await sleep(delayMs);
    balance = readBalance();
  }
  return balance;
}

async function waitForDicebetIdle(maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    sendPhaseHeartbeat("dice-wait");
    const autoStatus = typeof window.auto_betting_status === "string" ? window.auto_betting_status : "stopped";
    if (autoStatus !== "running") return true;
    await sleep(250);
  }
  return false;
}

function placeDicebetRound(side) {
  applyDicebetSide(side);

  if (typeof window.process_bet_game_dice === "function") {
    window.process_bet_game_dice();
    return true;
  }

  const betButton = findDicebetBetButton();
  if (!betButton) return false;
  betButton.focus();
  betButton.click();
  return true;
}

async function runAllIn001Dicebet(side, threshold, chance) {
  const allInChance = clampNumber(toFiniteNumber(chance, window.DEFAULT_ALL_IN_CHANCE_PERCENT), 0.01, 99);
  log(`Running DiceBet strategy ${DICE_STRATEGY_ALL_IN_001}: single all-in shot at ${allInChance}%`);

  for (let attempt = 0; attempt < 5; attempt++) {
    const chanceInput = findDicebetChanceInput();
    const amountInput = findDicebetAmountInput();
    const betButton = findDicebetBetButton();
    if (chanceInput && amountInput && betButton) {
      log(`✓ DiceBet page ready on attempt ${attempt + 1}`);
      break;
    }
    if (attempt === 4) {
      sendError("dicebet-page-not-ready");
      return false;
    }
    await sleep(1000);
  }

  const balanceBefore = await readDicebetBalanceWithRetries(4, 750);
  if (balanceBefore == null) {
    sendError("dicebet-balance-read-failed");
    return false;
  }
  if (balanceBefore <= 0) {
    sendError("dicebet-no-balance-before-bet");
    return false;
  }
  if (balanceBefore >= threshold) return true;

  const readyToBet = await waitForDicebetIdle(120000);
  if (!readyToBet) {
    sendError("dicebet-stuck-running-before");
    return false;
  }

  const amountInput = findDicebetAmountInput();
  if (!amountInput) {
    sendError("dicebet-no-amount-input");
    return false;
  }

  const targetSnapshot = applyDicebetTargets(allInChance);
  applyDicebetSide(side);
  setDicebetInputValue(amountInput, balanceBefore.toFixed(8));
  if (typeof window.change_bet_amount === "function") {
    window.change_bet_amount();
  }

  const started = placeDicebetRound(side);
  if (!started) {
    sendError("dicebet-round-not-started");
    return false;
  }

  const finishedRound = await waitForDicebetIdle(180000);
  if (!finishedRound) {
    sendError("dicebet-stuck-running-after");
    return false;
  }

  await sleep(500);
  const balanceAfter = await readDicebetBalanceWithRetries(4, 900);
  if (balanceAfter == null) {
    sendError("dicebet-balance-read-failed-after");
    return false;
  }

  const won = balanceAfter > balanceBefore;
  if (balanceAfter >= threshold) return true;

  if (balanceAfter <= 0 || !won) {
    sendError("dicebet-allin-loss");
    return false;
  }

  sendError("dicebet-allin-not-hit");
  return false;
}

async function runDicebet() {
  log("Starting DiceBet");
  sendPhaseHeartbeat("dice-start");

  const config = await getDicebetConfig();
  if (!config.enabled) return false;

  const threshold = toFiniteNumber(config.wdThreshold, 0);
  if (threshold <= 0) {
    sendError("dicebet-invalid-threshold");
    return false;
  }

  const side = normalizeDiceSide(config.side);
  const strategyType = normalizeDbStrategy(config.strategy, true);
  if (strategyType === DICE_STRATEGY_ALL_IN_001) {
    return runAllIn001Dicebet(side, threshold, config.chance);
  }

  const chance = clampNumber(toFiniteNumber(config.chance, 48.5), 0.01, 99);
  const strategy = new CombinedHighRollerStrategy(config.strategyConfig, log);
  const random14Schedule = await loadRandom14Schedule(location.hostname);
  const random14HostKey = random14Schedule.hostKey;
  let settledBetCount = random14Schedule.settledBetCount;
  let nextRandom14BetAt = random14Schedule.nextRandom14BetAt;

  for (let attempt = 0; attempt < 5; attempt++) {
    const chanceInput = findDicebetChanceInput();
    const amountInput = findDicebetAmountInput();
    const betButton = findDicebetBetButton();
    if (chanceInput && amountInput && betButton) break;
    if (attempt === 4) {
      sendError("dicebet-page-not-ready");
      return false;
    }
    await sleep(1000);
  }

  const startBalance = await readDicebetBalanceWithRetries(4, 750);
  if (startBalance == null) {
    sendError("dicebet-balance-read-failed");
    return false;
  }
  if (startBalance <= 0) {
    sendError("dicebet-no-balance-before-bet");
    return false;
  }

  strategy.initialize(startBalance);
  let round = 0;

  while (true) {
    round += 1;
    sendPhaseHeartbeat(`dice-round-${round}`);

    const balanceBefore = await readDicebetBalanceWithRetries(3, 700);
    if (balanceBefore == null) { sendError("dicebet-balance-read-failed"); return false; }
    if (balanceBefore <= 0) { sendError("dicebet-no-balance-before-bet"); return false; }
    if (balanceBefore >= threshold) return true;

    if (strategy.should_stop()) {
      sendError(`dicebet-${strategy.get_stop_reason() || "stopped"}`);
      return false;
    }

    const amountInput = findDicebetAmountInput();
    if (!amountInput) { sendError("dicebet-no-amount-input"); return false; }

    strategy.current_bankroll = balanceBefore;
    const nextBet = strategy.get_next_bet();
    if (!Number.isFinite(nextBet) || nextBet <= 0) {
      sendError(`dicebet-${strategy.get_stop_reason() || "invalid-bet"}`);
      return false;
    }

    const upcomingBetNumber = settledBetCount + 1;
    const isRandom14Round = upcomingBetNumber >= nextRandom14BetAt;
    const activeChance = isRandom14Round ? window.RANDOM_14_CHANCE_PERCENT : chance;

    const readyToBet = await waitForDicebetIdle(120000);
    if (!readyToBet) {
      await sleep(1200);
      continue;
    }

    const activeAmountInput = findDicebetAmountInput() || amountInput;
    if (!activeAmountInput) { sendError("dicebet-no-amount-input"); return false; }
    
    applyDicebetTargets(activeChance);
    applyDicebetSide(side);
    setDicebetInputValue(activeAmountInput, nextBet.toFixed(8));
    if (typeof window.change_bet_amount === "function") window.change_bet_amount();

    const started = placeDicebetRound(side);
    if (!started) {
      await sleep(2000);
      continue;
    }

    const finishedRound = await waitForDicebetIdle(180000);
    if (!finishedRound) {
      await sleep(1200);
      continue;
    }
    await sleep(500);

    const balanceAfter = await readDicebetBalanceWithRetries(4, 900);
    if (balanceAfter == null) { sendError("dicebet-balance-read-failed-after"); return false; }

    const win = balanceAfter > balanceBefore;
    strategy.on_roll_result(win, balanceAfter);
    settledBetCount += 1;
    if (isRandom14Round) {
      nextRandom14BetAt = settledBetCount + randomIntInclusive(window.RANDOM_14_MIN_BET_INTERVAL, window.RANDOM_14_MAX_BET_INTERVAL);
    }
    await persistRandom14Schedule(random14HostKey, settledBetCount, nextRandom14BetAt);

    if (balanceAfter >= threshold) return true;
    if (balanceAfter <= 0) { sendError("dicebet-no-balance-left"); return false; }

    if (strategy.should_stop()) {
      sendError(`dicebet-${strategy.get_stop_reason() || "stopped"}`);
      return false;
    }

    await sleep(1200);
  }
}
