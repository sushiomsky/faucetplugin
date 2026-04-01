// ── content.js (Main Orchestrator) ──────────────────────────────────────────

async function main() {
  console.log("[FaucetPlugin] Content script loaded on:", location.href);
  
  // Load custom selectors before doing anything
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (typeof SiteSelectors !== "undefined" && settings.customFaucets) {
    SiteSelectors.injectCustom(settings.customFaucets);
  }

  await sleep(1000); // let page and JS frameworks settle

  // GUARD: do nothing if the user opened this page manually
  console.log("[FaucetPlugin] Checking if this is a plugin tab...");
  const pluginTab = await isPluginTab();
  if (!pluginTab) {
    log("Not a plugin tab — standing by (manual visit)");
    return;
  }
  
  console.log("[FaucetPlugin] ✓ This is a plugin-opened tab!");

  // DiceBet page: user navigated here from faucet page after claim
  if (isDicebetPage()) {
    log("Detected dicebet page");
    const config = await getDicebetConfig();
    log(`DiceBet config: enabled=${config.enabled}, strategy=${config.strategy}, side=${config.side}, chance=${config.chance}%, wd_threshold=${config.wdThreshold}`);
    const shouldWithdraw = await runDicebet();
    if (shouldWithdraw) {
      log("DiceBet succeeded and balance reached threshold, proceeding to withdrawal");
      sendDone(readBalance());
    } else {
      log("DiceBet failed or threshold not met");
    }
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
  console.error("[FaucetPlugin] Unhandled error:", err);
  log("Unhandled error:", err);
  sendError(String(err));
}

main().catch(handleMainError);
