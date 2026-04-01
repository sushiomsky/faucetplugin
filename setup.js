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
      const row = document.createElement('div');
      row.className = 'site-toggle-row';
      row.innerHTML = `
        <div class="site-info">
          <span class="site-ico">${f.label[0].toUpperCase()}</span>
          <span class="site-lbl">${f.label}</span>
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
      const field = document.createElement('div');
      field.style = "margin-bottom:15px;";
      field.innerHTML = `
        <div style="font-size:10px; font-weight:700; color:var(--text-dim); text-transform:uppercase; margin-bottom:6px; text-align:left; padding-left:10px;">${f.label} Deployment Address</div>
        <input type="text" class="input-field" style="margin-bottom:0;" placeholder="Enter address..." value="${f.wdAddress || ''}" id="addr-${f.label}">
      `;
      const input = field.querySelector('input');
      input.addEventListener('input', () => {
        f.wdAddress = input.value.trim();
      });
      list.appendChild(field);
    });
    
    if (list.innerHTML === '') {
      list.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding: 40px;">No networks activated.</p>';
    }
  }

  async function finishSetup() {
    try {
      const settings = {
        enabled: true,
        faucets: faucets,
        nodeName: "Astra-Node"
      };
      
      await chrome.storage.local.set({ 
        settings, 
        running: true,
        setupComplete: true 
      });
      
      chrome.runtime.sendMessage({ type: "save-settings", settings });
      window.close();
    } catch (err) {
      console.error("Critical: Onboarding failed", err);
    }
  }

  // Bind Events
  const welcomeBtn = document.getElementById('welcomeBtn');
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
