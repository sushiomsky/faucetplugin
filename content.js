(function() {
// ── content.js (Main Orchestrator) ──────────────────────────────────────────

async function main() {
  const isWithdraw = /withdraw/i.test(location.pathname);
  
  if (isWithdraw) {
    console.log("[FaucetPlugin] 🛡️ Withdrawal page detected. Entering 8s Silent Settling...");
    await sleep(8000);
  } else {
    await sleep(1000); 
  }

  // BEGIN INITIALIZATION (Late-execution)
  console.log("[FaucetPlugin] 🚀 Silent period ended. Initializing...");

  // Load custom selectors (Moved here to avoid early storage contention)
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (typeof __FP_Selectors !== "undefined" && settings.customFaucets) {
    __FP_Selectors.injectCustom(settings.customFaucets);
  }

  // GUARD: do nothing if the user opened this page manually
  console.log("[FaucetPlugin] Verifying plugin-tab status...");
  const pluginTab = await isPluginTab();
  
  if (!pluginTab) {
    console.warn("[FaucetPlugin] ✘ Plugin Tab Verified: NO. Standing by (manual visit).");
    return;
  }
  
  console.log("[FaucetPlugin] ✓ Plugin Tab Verified: YES!");

  // DiceBet page: user navigated here from faucet page after claim
  if (isDicebetPage()) {
    log("Detected dicebet page");
    const config = await getDicebetConfig();
    log(`DiceBet config: enabled=${config.enabled}, strategy=${config.strategy}, side=${config.side}, chance=${config.chance}%, wd_threshold=${config.wdThreshold}`);
    
    // runDicebet returns true if current balance >= wdThreshold
    const meetThreshold = await runDicebet();
    const finalBalance = readBalance();

    if (meetThreshold) {
      log("DiceBet phase ended and balance reached threshold, proceeding to withdrawal integration");
    } else {
      log("DiceBet phase ended, threshold not met or balance zero");
    }

    // Always inform background we are done with this cycle/phase
    sendDone(finalBalance);
    return;
  }

  // Withdraw tab: background already navigated us here after a successful claim
  const wdInfo = await getWithdrawInfo();
  if (wdInfo.isWithdrawTab) {
    log("Detected withdrawal tab");
    await runWithdraw(wdInfo.address);
    return;
  }

  console.log("[FaucetPlugin] Checking page type...");
  if (hasLoginForm()) {
    log("Detected login page");
    await runLogin();
  } else if (isFaucetPage()) {
    log("Detected faucet page");
    await runFaucet();
  } else {
    const tabState = await getCurrentTabState();
    const targetFaucetUrl = tabState?.faucetUrl;
    const canRecoverToFaucet =
      tabState?.phase === "faucet" &&
      !!targetFaucetUrl &&
      !isWithdrawPage() &&
      !isDicebetPage() &&
      !hasLoginForm();

    if (canRecoverToFaucet) {
      try {
        const target = new URL(targetFaucetUrl);
        if (target.hostname === location.hostname && location.href !== targetFaucetUrl) {
          log("Unrecognised page in faucet phase — redirecting back to faucet:", targetFaucetUrl);
          location.href = targetFaucetUrl;
          return;
        }
      } catch (_) {}
    }

    if (location.pathname === "/" || location.pathname === "") {
      const host = location.hostname.toLowerCase();
      if (host.includes("pick.io")) {
        log("Landed on home page (ref link) — redirecting to faucet.php in 2s...");
        await sleep(2000); 
        location.href = location.origin + "/faucet.php";
        return;
      }
    }

    log("Unrecognised page — waiting for navigation:", location.href);
  }
}

console.log("[FaucetPlugin] Content script executing for:", window.location.hostname);
function handleMainError(err) {
  console.error("[FaucetPlugin] CRITICAL BOOTSTRAP ERROR:", err);
  log("Unhandled error:", err);
  sendError(String(err));
}

main().catch(handleMainError);
})();
