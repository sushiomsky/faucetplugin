window.addEventListener('DOMContentLoaded', () => {
  let currentStep = 1;

  // Initialize faucets from constants
  const faucets = typeof makeFaucetDefaults === 'function' ? makeFaucetDefaults() : [];

  function updateProgress() {
    document.querySelectorAll('.wizard-dot').forEach((dot, i) => {
      dot.classList.remove('active', 'completed');
      if (i + 1 < currentStep) dot.classList.add('completed');
      if (i + 1 === currentStep) dot.classList.add('active');
    });
  }

  function nextStep() {
    if (currentStep < 5) {
      document.getElementById(`step${currentStep}`).classList.remove('active');
      currentStep++;
      document.getElementById(`step${currentStep}`).classList.add('active');
      updateProgress();
      if (currentStep === 2) renderSiteGrid();
      if (currentStep === 3) renderWalletList();
      if (currentStep === 4) renderVerificationList();
    }
  }

  function renderSiteGrid() {
    const grid = document.getElementById('siteGrid');
    if (!grid) return;
    grid.innerHTML = '';
    faucets.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'site-toggle-row';
      row.innerHTML = `
        <div class="site-info">
          <span class="site-ico">${(f.coin || f.label)[0].toUpperCase()}</span>
          <span class="site-lbl">${f.coin || f.label.toUpperCase()}</span>
        </div>
        <label class="switch">
          <input type="checkbox" ${f.active ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      `;
      const input = row.querySelector('input');
      input.addEventListener('change', () => {
        f.active = input.checked;
        updateSiteNextBtn();
      });
      grid.appendChild(row);
    });
    updateSiteNextBtn();
  }

  function updateSiteNextBtn() {
    const btn = document.getElementById('siteNextBtn');
    if (btn) {
      const anySelected = faucets.some(f => f.active);
      btn.disabled = !anySelected;
    }
  }


  function renderWalletList() {
    const list = document.getElementById('walletList');
    if (!list) return;
    list.innerHTML = '';
    faucets.filter(f => f.active).forEach((f, i) => {
      const coin = f.coin || f.label.toUpperCase();
      const item = document.createElement('div');
      item.style = "margin-bottom:15px;";
      item.innerHTML = `
        <div style="font-size:10px; font-weight:700; color:var(--text-dim); text-transform:uppercase; margin-bottom:5px; text-align:left; padding-left:10px;">${coin} Wallet Address</div>
        <input type="text" class="input-field" placeholder="Enter your ${coin} address..." value="${f.wdAddress || ''}" id="addr-${f.label}">
      `;
      const input = item.querySelector('input');
      input.addEventListener('input', () => {
        f.wdAddress = input.value.trim();
      });
      list.appendChild(item);
    });
    
    if (faucets.filter(f => f.active).length === 0) {
      list.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding: 40px;">No faucets selected.</p>';
    }
  }

  async function checkLoginStatus(faucet) {
    try {
      // Direct request to faucet.php as per user instruction
      const baseUrl = faucet.url.replace(/\/$/, '');
      const testUrl = `${baseUrl}/faucet.php?_t=${Date.now()}`;
      
      const resp = await fetch(testUrl, { 
        credentials: 'include', 
        redirect: 'follow',
        cache: 'no-cache'
      });
      
      const finalUrl = resp.url.toLowerCase();
      
      // If we are still on faucet.php (or a variant like index.php?page=faucet), we are logged in.
      // If we got booted to login, signup, or the landing page, we are logged out.
      const isLoggedOut = finalUrl.includes('login') || 
                          finalUrl.includes('signup') || 
                          finalUrl.includes('index.php') && !finalUrl.includes('faucet') ||
                          finalUrl === baseUrl.toLowerCase() ||
                          finalUrl === (baseUrl + '/').toLowerCase();

      return !isLoggedOut;
    } catch (e) {
      return false;
    }
  }

  async function renderVerificationList() {
    const list = document.getElementById('verificationList');
    const nextBtn = document.getElementById('verifyNextBtn');
    if (!list || !nextBtn) return;
    
    // Determine which faucets are active
    const activeFaucets = faucets.filter(f => f.active);
    if (activeFaucets.length === 0) {
      list.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding: 40px;">No faucets selected.</p>';
      nextBtn.disabled = false;
      nextBtn.textContent = 'Continue ➔';
      return;
    }

    // Initial render of the rows if list is empty or doesn't match active count
    if (list.children.length !== activeFaucets.length || list.querySelector('.loading-placeholder')) {
      list.innerHTML = '';
      activeFaucets.forEach(f => {
        const row = document.createElement('div');
        row.className = 'site-toggle-row';
        row.id = `verify-row-${f.label}`;
        row.style.justifyContent = 'space-between';
        row.innerHTML = `
          <div class="site-info">
            <span class="site-ico">${(f.coin || f.label)[0].toUpperCase()}</span>
            <span class="site-lbl">${f.coin || f.label.toUpperCase()}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="status-lbl" style="font-size:11px; font-weight:700; color: var(--text-dim)">CHECKING...</span>
            <button class="verify-btn" style="background:var(--glass-border); border:none; color:#fff; padding:6px 12px; border-radius:8px; font-size:10px; cursor:pointer;">Go to Site</button>
          </div>
        `;
        row.querySelector('.verify-btn').addEventListener('click', () => {
          const refUrl = f.referralId ? `${f.url.replace(/\/$/, '')}/signup.php?ref=${f.referralId}` : f.url;
          window.open(refUrl, '_blank');
        });
        list.appendChild(row);
      });
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Verifying...';

    const verificationStates = await Promise.all(activeFaucets.map(async f => {
      const loggedIn = await checkLoginStatus(f);
      // Update UI for this specific row
      const row = document.getElementById(`verify-row-${f.label}`);
      if (row) {
        const statusEl = row.querySelector('.status-lbl');
        statusEl.textContent = loggedIn ? 'LOGGED IN ✓' : 'LOGIN REQ.';
        statusEl.style.color = loggedIn ? 'var(--status-ok)' : '#ff4b4b';
      }
      return { faucet: f, loggedIn };
    }));

    const allVerified = verificationStates.every(s => s.loggedIn);
    if (allVerified) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'All Verified ➔';
    } else {
      nextBtn.disabled = true;
      nextBtn.textContent = 'Verify All to Proceed';
      // Periodically re-check when user comes back
      if (window._verifyTimer) clearTimeout(window._verifyTimer);
      window._verifyTimer = setTimeout(renderVerificationList, 3000);
    }
  }

  async function finishSetup() {
    try {
      const settings = {
        enabled: true,
        faucets: faucets,
        botName: "FaucetPick Bot"
      };
      
      await chrome.storage.local.set({ 
        settings, 
        running: true,
        setupComplete: true 
      });
      
      chrome.runtime.sendMessage({ type: "save-settings", settings });
      window.location.href = "popup.html";
    } catch (err) {
      console.error("Setup failed:", err);
    }
  }

  async function skipSetup() {
    try {
      const settings = {
        enabled: false,
        faucets: faucets,
        botName: "Faucet Bot"
      };
      
      await chrome.storage.local.set({ 
        settings, 
        running: false,
        setupComplete: true 
      });
      
      window.location.href = "popup.html";
    } catch (err) {
      console.error("Skip setup failed:", err);
    }
  }

  // Bind Events
  const welcomeBtn = document.getElementById('welcomeBtn');
  if (welcomeBtn) welcomeBtn.addEventListener('click', nextStep);

  const skipBtn = document.getElementById('skipBtn');
  if (skipBtn) skipBtn.addEventListener('click', skipSetup);

  const siteNextBtn = document.getElementById('siteNextBtn');
  if (siteNextBtn) siteNextBtn.addEventListener('click', nextStep);

  const walletNextBtn = document.getElementById('walletNextBtn');
  if (walletNextBtn) walletNextBtn.addEventListener('click', nextStep);

  const verifyNextBtn = document.getElementById('verifyNextBtn');
  if (verifyNextBtn) verifyNextBtn.addEventListener('click', nextStep);

  const launchBtn = document.getElementById('launchBtn');
  if (launchBtn) launchBtn.addEventListener('click', finishSetup);

  updateProgress();
});
