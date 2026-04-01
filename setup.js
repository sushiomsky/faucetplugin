window.addEventListener('DOMContentLoaded', () => {
  let currentStep = 1;

  // Initialize faucets from constants
  const faucets = typeof makeFaucetDefaults === 'function' ? makeFaucetDefaults() : [];

  function updateProgress() {
    document.querySelectorAll('.progress-step').forEach((step, i) => {
      if (i + 1 <= currentStep) step.classList.add('active');
      else step.classList.remove('active');
    });
  }

  function nextStep() {
    if (currentStep < 4) {
      document.getElementById(`step${currentStep}`).classList.remove('active');
      currentStep++;
      document.getElementById(`step${currentStep}`).classList.add('active');
      updateProgress();
      if (currentStep === 2) renderSiteGrid();
      if (currentStep === 3) renderWalletList();
    }
  }

  function prevStep() {
    if (currentStep > 1) {
      document.getElementById(`step${currentStep}`).classList.remove('active');
      currentStep--;
      document.getElementById(`step${currentStep}`).classList.add('active');
      updateProgress();
    }
  }

  function renderSiteGrid() {
    const grid = document.getElementById('siteGrid');
    if (!grid) return;
    grid.innerHTML = '';
    faucets.forEach((f, i) => {
      const card = document.createElement('div');
      card.className = 'site-card' + (f.active ? ' selected' : '');
      card.innerHTML = `
        <div class="site-icon">${f.label[0].toUpperCase()}</div>
        <div class="site-name">${f.label}</div>
      `;
      card.addEventListener('click', () => {
        f.active = !f.active;
        card.classList.toggle('selected');
        updateSiteNextBtn();
      });
      grid.appendChild(card);
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
      const item = document.createElement('div');
      item.className = 'wallet-item';
      item.innerHTML = `
        <div class="wallet-icon">${f.label[0].toUpperCase()}</div>
        <div class="wallet-info">
          <div class="wallet-label">${f.label} address</div>
          <input type="text" placeholder="Enter address" value="${f.wdAddress || ''}" id="addr-${f.label}">
        </div>
      `;
      const input = item.querySelector('input');
      input.addEventListener('input', () => {
        f.wdAddress = input.value.trim();
      });
      list.appendChild(item);
    });
    
    if (list.innerHTML === '') {
      list.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding: 20px;">No sites selected.</p>';
    }
  }

  async function finishSetup() {
    try {
      const settings = {
        enabled: true,
        faucets: faucets
      };
      
      await chrome.storage.local.set({ 
        settings, 
        running: true,
        setupComplete: true 
      });
      
      // Tell background to start
      chrome.runtime.sendMessage({ type: "save-settings", settings });
      
      // Close window
      window.close();
    } catch (err) {
      console.error("Setup failed:", err);
    }
  }

  // Bind Events
  const welcomeBtn = document.getElementById('welcomeContinueBtn');
  if (welcomeBtn) welcomeBtn.addEventListener('click', nextStep);

  const siteNextBtn = document.getElementById('siteNextBtn');
  if (siteNextBtn) siteNextBtn.addEventListener('click', nextStep);

  const launchBtn = document.getElementById('launchBtn');
  if (launchBtn) launchBtn.addEventListener('click', finishSetup);

  document.querySelectorAll('.step-next-btn').forEach(btn => {
    btn.addEventListener('click', nextStep);
  });

  document.querySelectorAll('.step-back-btn').forEach(btn => {
    btn.addEventListener('click', prevStep);
  });

  updateProgress();
});
