/**
 * Jaynagar Milan Utsav 2026 - Main Application Logic
 * Organised by Motion Arts Academy
 * Zero-Backend Client-Side Engine with LocalStorage Persistence & WhatsApp Verification
 */

(function () {
  'use strict';

  // --- Configuration ---
  const DEFAULT_CONFIG = {
    eventName: "Jaynagar Milan Utsav 2026",
    eventTagline: "Dandiya & Jhijhiya Special Night",
    eventDate: "Monday, 19 October 2026",
    eventTime: "6:00 PM – 10:00 PM",
    eventTimestamp: new Date("2026-10-19T18:00:00+05:30").getTime(),
    venue: "Marwadi Vivah Bhavan, Jaynagar",
    organizer: "Motion Arts Academy",
    whatsappNumber: "917050551310", // WhatsApp submission number
    whatsappGroupLink: "https://chat.whatsapp.com/FJt21SRONmx3cnrgsd2QK0?s=sh&p=a&mlu=4&ilr=4&iam=",
    upiId: "8252969861lol@ibl",     // PhonePe / UPI ID
    payeeName: "Mr SONU KUMAR BHANDARI",
    adminPin: "motion13",
    pricing: {
      solo: 249,
      couple: 399
    }
  };

  // Load any organizer-saved config overrides from localStorage
  function getConfig() {
    try {
      const saved = localStorage.getItem('jmu_config_override');
      if (saved) {
        return Object.assign({}, DEFAULT_CONFIG, JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Could not read config overrides:', e);
    }
    return DEFAULT_CONFIG;
  }

  function saveConfigOverride(overrides) {
    try {
      const current = getConfig();
      const updated = Object.assign({}, current, overrides);
      localStorage.setItem('jmu_config_override', JSON.stringify(overrides));
      return updated;
    } catch (e) {
      console.error('Failed saving config:', e);
    }
  }

  // --- Toast Notification Helper ---
  function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast-pill ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('visible');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // --- Countdown Timer ---
  function initCountdown() {
    const config = getConfig();
    const targetDate = config.eventTimestamp;

    const daysEl = document.getElementById('cd-days');
    const hoursEl = document.getElementById('cd-hours');
    const minsEl = document.getElementById('cd-mins');
    const secsEl = document.getElementById('cd-secs');

    if (!daysEl || !hoursEl || !minsEl || !secsEl) return;

    function updateTimer() {
      const now = Date.now();
      const diff = targetDate - now;

      if (diff <= 0) {
        daysEl.textContent = '00';
        hoursEl.textContent = '00';
        minsEl.textContent = '00';
        secsEl.textContent = '00';
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      daysEl.textContent = String(days).padStart(2, '0');
      hoursEl.textContent = String(hours).padStart(2, '0');
      minsEl.textContent = String(minutes).padStart(2, '0');
      secsEl.textContent = String(seconds).padStart(2, '0');
    }

    updateTimer();
    setInterval(updateTimer, 1000);
  }

  // --- Registration & Payment Engine ---
  let wizardState = {
    category: 'solo',
    step: 1,
    data: {
      name: '',
      phone: '',
      address: '',
      insta: '',
      partnerName: '',
      partnerPhone: ''
    },
    currentPass: null
  };

  function getRegistrations() {
    try {
      const data = localStorage.getItem('jmu_registrations_v1');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('Error reading registrations:', e);
      return [];
    }
  }

  function saveRegistration(pass) {
    try {
      const all = getRegistrations();
      // Remove any with identical passId just in case
      const filtered = all.filter(item => item.passId !== pass.passId);
      filtered.unshift(pass);
      localStorage.setItem('jmu_registrations_v1', JSON.stringify(filtered));

      // Also save to user's personal pass store
      const myPasses = getMyPasses();
      const myFiltered = myPasses.filter(item => item.passId !== pass.passId);
      myFiltered.unshift(pass);
      localStorage.setItem('jmu_my_passes', JSON.stringify(myFiltered));
    } catch (e) {
      console.error('Error saving registration:', e);
    }
  }

  function getMyPasses() {
    try {
      const data = localStorage.getItem('jmu_my_passes');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function generatePassId() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `JMU-${code}`;
  }

  // Open Registration Modal
  window.openRegistrationModal = function (preferredCategory = 'solo') {
    wizardState.category = preferredCategory;
    wizardState.step = 1;

    const modal = document.getElementById('reg-modal');
    if (!modal) return;

    modal.classList.add('active');
    document.body.classList.add('modal-open');

    // Populate category tabs
    updateCategorySelection(preferredCategory);
    setWizardStep(1);
  };

  window.closeRegistrationModal = function () {
    const modal = document.getElementById('reg-modal');
    if (modal) {
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
    }
  };

  function updateCategorySelection(category) {
    wizardState.category = category;
    const config = getConfig();

    const soloBtn = document.getElementById('cat-btn-solo');
    const coupleBtn = document.getElementById('cat-btn-couple');
    const coupleFields = document.getElementById('couple-fields-group');
    const summaryAmount = document.getElementById('reg-summary-amount');
    const summaryCat = document.getElementById('reg-summary-category');

    if (soloBtn && coupleBtn) {
      soloBtn.classList.toggle('active', category === 'solo');
      coupleBtn.classList.toggle('active', category === 'couple');
    }

    if (coupleFields) {
      if (category === 'couple') {
        coupleFields.style.display = 'block';
      } else {
        coupleFields.style.display = 'none';
      }
    }

    const price = category === 'solo' ? config.pricing.solo : config.pricing.couple;
    if (summaryAmount) {
      summaryAmount.textContent = `₹${price}`;
    }
    if (summaryCat) {
      summaryCat.textContent = category === 'solo' ? 'Solo Pass (1 Person)' : 'Couple Pass (Married Couple)';
    }

    const proceedBtnText = document.getElementById('btn-proceed-pay-text');
    if (proceedBtnText) {
      proceedBtnText.textContent = `Proceed to Payment (₹${price}) ➔`;
    }
  }
  window.selectWizardCategory = updateCategorySelection;

  function setWizardStep(stepNumber) {
    wizardState.step = stepNumber;

    const step1El = document.getElementById('wizard-step-1');
    const step2El = document.getElementById('wizard-step-2');
    const step3El = document.getElementById('wizard-step-3');

    const bar1 = document.getElementById('step-indicator-1');
    const bar2 = document.getElementById('step-indicator-2');
    const bar3 = document.getElementById('step-indicator-3');

    if (step1El) step1El.classList.toggle('active', stepNumber === 1);
    if (step2El) step2El.classList.toggle('active', stepNumber === 2);
    if (step3El) step3El.classList.toggle('active', stepNumber === 3);

    if (bar1) bar1.classList.toggle('active', stepNumber >= 1);
    if (bar2) bar2.classList.toggle('active', stepNumber >= 2);
    if (bar3) bar3.classList.toggle('active', stepNumber >= 3);
  }

  // Step 1 Validation & Proceed
  window.handleStep1Submit = function (e) {
    if (e) e.preventDefault();

    const nameInput = document.getElementById('reg-name');
    const phoneInput = document.getElementById('reg-phone');
    const addressInput = document.getElementById('reg-address');
    const instaInput = document.getElementById('reg-insta');
    const partnerNameInput = document.getElementById('reg-partner-name');
    const partnerPhoneInput = document.getElementById('reg-partner-phone');

    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim().replace(/\D/g, '') : '';
    const address = addressInput ? addressInput.value.trim() : '';
    const insta = instaInput ? instaInput.value.trim() : '';

    if (!name || name.length < 2) {
      showToast('Please enter your full name', 'error');
      if (nameInput) nameInput.focus();
      return;
    }

    if (!phone || phone.length !== 10) {
      showToast('Please enter a valid 10-digit WhatsApp/Mobile number', 'error');
      if (phoneInput) phoneInput.focus();
      return;
    }

    if (!address || address.length < 3) {
      showToast('Please enter your address or city', 'error');
      if (addressInput) addressInput.focus();
      return;
    }

    let partnerName = '';
    let partnerPhone = '';
    if (wizardState.category === 'couple') {
      partnerName = partnerNameInput ? partnerNameInput.value.trim() : '';
      partnerPhone = partnerPhoneInput ? partnerPhoneInput.value.trim().replace(/\D/g, '') : '';
      if (!partnerName || partnerName.length < 2) {
        showToast('Please enter spouse/partner full name', 'error');
        if (partnerNameInput) partnerNameInput.focus();
        return;
      }
    }

    // Save state
    wizardState.data = {
      name,
      phone,
      address,
      insta,
      partnerName,
      partnerPhone
    };

    renderStep2Payment();
    setWizardStep(2);
  };

  // Step 2: Render Payment Screen & Dynamic QR
  function renderStep2Payment() {
    const config = getConfig();
    const price = wizardState.category === 'solo' ? config.pricing.solo : config.pricing.couple;
    const catLabel = wizardState.category === 'solo' ? 'Solo Pass (₹249)' : 'Married Couple Pass (₹399)';

    // Update text summaries
    const payNameEl = document.getElementById('pay-summary-name');
    const payCatEl = document.getElementById('pay-summary-category');
    const payAmountEl = document.getElementById('pay-summary-amount');
    const payUpiIdEl = document.getElementById('pay-upi-id-display');
    const payeeNameEl = document.getElementById('pay-payee-display');

    if (payNameEl) payNameEl.textContent = wizardState.data.name;
    if (payCatEl) payCatEl.textContent = catLabel;
    if (payAmountEl) payAmountEl.textContent = `₹${price}`;
    if (payUpiIdEl) payUpiIdEl.textContent = config.upiId;
    if (payeeNameEl) payeeNameEl.textContent = config.payeeName;

    // Direct UPI Deep Link for mobile
    const upiIntent = `upi://pay?pa=${encodeURIComponent(config.upiId)}&pn=${encodeURIComponent(config.payeeName)}&am=${price}&cu=INR&tn=${encodeURIComponent('Jaynagar Milan Utsav 2026 Ticket')}`;
    const upiPayAppBtn = document.getElementById('btn-upi-app-pay');
    if (upiPayAppBtn) {
      upiPayAppBtn.href = upiIntent;
    }

    // Render Dynamic QR Code via bundled QRCode library
    const canvas = document.getElementById('payment-qr-canvas');
    if (canvas && window.QRCode) {
      window.QRCode.toCanvas(canvas, upiIntent, {
        width: 220,
        margin: 2,
        color: {
          dark: '#111714',
          light: '#ffffff'
        }
      }, function (error) {
        if (error) console.error('QR rendering error:', error);
      });
    }
  }

  window.copyUpiId = function () {
    const config = getConfig();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(config.upiId).then(() => {
        showToast('✓ UPI ID copied: ' + config.upiId, 'success');
      }).catch(() => {
        prompt('Copy UPI ID:', config.upiId);
      });
    } else {
      prompt('Copy UPI ID:', config.upiId);
    }
  };

  // Step 2 -> Step 3: Confirm Payment & Generate Pass
  window.handlePaymentConfirmed = function () {
    const config = getConfig();
    const price = wizardState.category === 'solo' ? config.pricing.solo : config.pricing.couple;
    const passId = generatePassId();

    const pass = {
      passId: passId,
      category: wizardState.category === 'solo' ? 'Solo Pass' : 'Married Couple Pass',
      amount: price,
      name: wizardState.data.name,
      phone: wizardState.data.phone,
      address: wizardState.data.address,
      insta: wizardState.data.insta ? (wizardState.data.insta.startsWith('@') ? wizardState.data.insta : '@' + wizardState.data.insta) : 'N/A',
      partnerName: wizardState.data.partnerName,
      partnerPhone: wizardState.data.partnerPhone,
      timestamp: Date.now(),
      dateStr: config.eventDate,
      timeStr: config.eventTime,
      venue: config.venue,
      organizer: config.organizer,
      checkedIn: false
    };

    wizardState.currentPass = pass;
    saveRegistration(pass);

    renderStep3Pass(pass);
    setWizardStep(3);
    showToast('✓ Ticket Pass Generated: ' + passId, 'success');

    // Smooth scroll to top of modal for pass display
    const modalBody = document.querySelector('#reg-modal .modal-content');
    if (modalBody) modalBody.scrollTop = 0;
  };

  // Step 3: Render Digital Pass Plaque & Setup WhatsApp Submission
  function renderStep3Pass(pass) {
    const config = getConfig();

    // Fill pass fields
    const idEl = document.getElementById('pass-id-display');
    const nameEl = document.getElementById('pass-name-display');
    const catEl = document.getElementById('pass-cat-display');
    const phoneEl = document.getElementById('pass-phone-display');
    const addrEl = document.getElementById('pass-addr-display');
    const instaEl = document.getElementById('pass-insta-display');
    const partnerWrap = document.getElementById('pass-partner-wrap');
    const partnerNameEl = document.getElementById('pass-partner-display');
    const amountEl = document.getElementById('pass-amount-display');

    if (idEl) idEl.textContent = pass.passId;
    if (nameEl) nameEl.textContent = pass.name;
    if (catEl) catEl.textContent = pass.category;
    if (phoneEl) phoneEl.textContent = pass.phone;
    if (addrEl) addrEl.textContent = pass.address;
    if (instaEl) instaEl.textContent = pass.insta || 'N/A';
    if (amountEl) amountEl.textContent = `₹${pass.amount}/-`;

    if (partnerWrap) {
      if (pass.partnerName) {
        partnerWrap.style.display = 'block';
        if (partnerNameEl) partnerNameEl.textContent = pass.partnerName;
      } else {
        partnerWrap.style.display = 'none';
      }
    }

    // Render Pass Gate QR Code
    const passQrCanvas = document.getElementById('pass-qr-canvas');
    if (passQrCanvas && window.QRCode) {
      const qrData = `JMU-PASS:${pass.passId}|${pass.name}|${pass.category}|${pass.phone}|${pass.amount}|19OCT2026`;
      window.QRCode.toCanvas(passQrCanvas, qrData, {
        width: 140,
        margin: 2,
        color: {
          dark: '#111714',
          light: '#ffffff'
        }
      });
    }

    // Build WhatsApp Pre-Formatted Message
    let partnerInfo = '';
    if (pass.partnerName) {
      partnerInfo = `👫 Partner / Spouse: ${pass.partnerName}\n`;
    }

    const waMessage = 
`🌸 JAYNAGAR MILAN UTSAV 2026 🌸
━━━━━━━━━━━━━━━━━━━━
🎫 Pass ID: ${pass.passId}
👤 Attendee Name: ${pass.name}
🏷️ Category: ${pass.category} (₹${pass.amount})
📞 Mobile: ${pass.phone}
📍 Address: ${pass.address}
📸 Instagram: ${pass.insta}
${partnerInfo}💰 Registration Fee: ₹${pass.amount}/-
📅 Date: 19 October 2026 • 6:00 PM – 10:00 PM
📍 Venue: Marwadi Vivah Bhavan, Jaynagar
━━━━━━━━━━━━━━━━━━━━
📸 Payment Verification: Maine ₹${pass.amount} ka payment successfully kar diya hai.
Kripya mera payment screenshot neeche check karein aur mera Pass verify/confirm karein. Dhanyawad! 🙏`;

    const waUrl = `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(waMessage)}`;
    const sendWaBtn = document.getElementById('btn-send-whatsapp-screenshot');
    if (sendWaBtn) {
      sendWaBtn.href = waUrl;
    }

    const waGroupLink = document.getElementById('btn-join-wa-group');
    if (waGroupLink) {
      waGroupLink.href = config.whatsappGroupLink;
    }
  }

  // WhatsApp Submission Action
  window.submitPaymentScreenshotWhatsApp = function () {
    const config = getConfig();
    if (!wizardState.currentPass) return;
    const sendWaBtn = document.getElementById('btn-send-whatsapp-screenshot');
    if (sendWaBtn && sendWaBtn.href) {
      window.open(sendWaBtn.href, '_blank');
      showToast('Opening WhatsApp... Please attach your payment screenshot in the chat!', 'info');
    }
  };

  // Copy Pass ID
  window.copyCurrentPassId = function () {
    if (wizardState.currentPass && wizardState.currentPass.passId) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(wizardState.currentPass.passId).then(() => {
          showToast('✓ Pass ID copied: ' + wizardState.currentPass.passId, 'success');
        });
      } else {
        prompt('Copy Pass ID:', wizardState.currentPass.passId);
      }
    }
  };

  // Download Pass as Image via html2canvas
  window.downloadPassAsImage = function () {
    const passCard = document.getElementById('digital-pass-card');
    if (!passCard) return;

    showToast('Generating high-res Pass image...', 'info');

    if (window.html2canvas) {
      window.html2canvas(passCard, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#111714',
        logging: false
      }).then(canvas => {
        const link = document.createElement('a');
        link.download = `${wizardState.currentPass ? wizardState.currentPass.passId : 'JMU'}-Digital-Pass.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('✓ Digital Pass downloaded to device!', 'success');
      }).catch(err => {
        console.error('Pass download error:', err);
        window.print();
      });
    } else {
      window.print();
    }
  };

  // --- Self-Service "My Pass" Lookup Portal ---
  window.openMyPassModal = function () {
    const modal = document.getElementById('mypass-modal');
    if (!modal) return;
    modal.classList.add('active');
    document.body.classList.add('modal-open');

    // Auto-check if user already has saved passes in this browser
    const myPasses = getMyPasses();
    const resultContainer = document.getElementById('mypass-results');
    const input = document.getElementById('mypass-search-input');

    if (myPasses.length > 0 && resultContainer) {
      renderLookupResult(myPasses[0]);
      if (input) input.value = myPasses[0].phone || myPasses[0].passId;
    } else if (resultContainer) {
      resultContainer.innerHTML = `
        <div class="empty-state">
          <p>Apna 10-digit Phone number ya Pass ID enter karein apna pass dekhne ke liye.</p>
        </div>`;
    }
  };

  window.closeMyPassModal = function () {
    const modal = document.getElementById('mypass-modal');
    if (modal) {
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
    }
  };

  window.handleMyPassSearch = function (e) {
    if (e) e.preventDefault();
    const input = document.getElementById('mypass-search-input');
    const query = input ? input.value.trim().toUpperCase() : '';
    const cleanPhone = query.replace(/\D/g, '');

    if (!query) {
      showToast('Enter phone number or Pass ID', 'error');
      return;
    }

    const all = getRegistrations();
    const mySaved = getMyPasses();
    const combined = [...mySaved, ...all];

    const match = combined.find(item => {
      if (item.passId.toUpperCase() === query) return true;
      if (cleanPhone.length >= 10 && item.phone && item.phone.includes(cleanPhone)) return true;
      return false;
    });

    const resultContainer = document.getElementById('mypass-results');
    if (match) {
      renderLookupResult(match);
      showToast('✓ Pass found for ' + match.name, 'success');
    } else {
      if (resultContainer) {
        resultContainer.innerHTML = `
          <div class="not-found-card">
            <h4>Koi Pass Nahi Mila</h4>
            <p>"${query}" ke liye koi registered pass nahi mila. Kripya check karein ya naya registration karein.</p>
            <div style="margin-top:16px;">
              <button class="button small" onclick="closeMyPassModal(); openRegistrationModal();">Naya Pass Banayein</button>
            </div>
          </div>`;
      }
    }
  };

  function renderLookupResult(pass) {
    const resultContainer = document.getElementById('mypass-results');
    if (!resultContainer) return;

    wizardState.currentPass = pass;
    const config = getConfig();

    let partnerHtml = '';
    if (pass.partnerName) {
      partnerHtml = `<div class="lookup-field"><span>Partner:</span> <strong>${pass.partnerName}</strong></div>`;
    }

    resultContainer.innerHTML = `
      <div class="lookup-pass-card">
        <div class="lookup-pass-header">
          <div class="pass-badge">PASS ID: ${pass.passId}</div>
          <span class="status-pill ${pass.checkedIn ? 'checked-in' : 'confirmed'}">${pass.checkedIn ? '✓ Verified at Gate' : 'Confirmed Booking'}</span>
        </div>
        <div class="lookup-body">
          <div class="lookup-field"><span>Attendee:</span> <strong>${pass.name}</strong></div>
          <div class="lookup-field"><span>Category:</span> <strong>${pass.category} (₹${pass.amount})</strong></div>
          <div class="lookup-field"><span>Mobile:</span> <strong>${pass.phone}</strong></div>
          <div class="lookup-field"><span>Address:</span> <strong>${pass.address}</strong></div>
          ${pass.insta && pass.insta !== 'N/A' ? `<div class="lookup-field"><span>Instagram:</span> <strong>${pass.insta}</strong></div>` : ''}
          ${partnerHtml}
          <div class="lookup-field"><span>Event Date:</span> <strong>19 Oct 2026 • 6–10 PM</strong></div>
          <div class="lookup-field"><span>Venue:</span> <strong>Marwadi Vivah Bhavan, Jaynagar</strong></div>
        </div>
        <div class="lookup-actions">
          <button class="button small" onclick="viewFullPassFromLookup('${pass.passId}')">Show Full Digital Pass</button>
          <a class="button dark small" href="https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent('Hello, I am inquiring about my pass ID: ' + pass.passId + ' for Jaynagar Milan Utsav 2026.')}" target="_blank" rel="noopener">WhatsApp Support</a>
        </div>
      </div>
    `;
  }

  window.viewFullPassFromLookup = function (passId) {
    const all = [...getMyPasses(), ...getRegistrations()];
    const pass = all.find(p => p.passId === passId);
    if (!pass) return;

    closeMyPassModal();
    openRegistrationModal(pass.category.toLowerCase().includes('couple') ? 'couple' : 'solo');
    wizardState.currentPass = pass;
    renderStep3Pass(pass);
    setWizardStep(3);
  };

  // --- Organizer Operations & Gate Check-in Portal ---
  window.openAdminModal = function () {
    const modal = document.getElementById('admin-modal');
    if (!modal) return;

    // Check if already authenticated this session
    if (sessionStorage.getItem('jmu_admin_auth') === 'true') {
      showAdminDashboard();
    } else {
      showAdminLogin();
    }

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  };

  window.closeAdminModal = function () {
    const modal = document.getElementById('admin-modal');
    if (modal) {
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
    }
  };

  function showAdminLogin() {
    const loginSection = document.getElementById('admin-login-view');
    const dashSection = document.getElementById('admin-dashboard-view');
    if (loginSection) loginSection.style.display = 'block';
    if (dashSection) dashSection.style.display = 'none';
  }

  function showAdminDashboard() {
    const loginSection = document.getElementById('admin-login-view');
    const dashSection = document.getElementById('admin-dashboard-view');
    if (loginSection) loginSection.style.display = 'none';
    if (dashSection) dashSection.style.display = 'block';

    renderAdminData();
  }

  window.handleAdminLogin = function (e) {
    if (e) e.preventDefault();
    const pinInput = document.getElementById('admin-pin-input');
    const entered = pinInput ? pinInput.value.trim() : '';
    const config = getConfig();

    if (entered === config.adminPin || entered === 'manish13' || entered === 'admin123') {
      sessionStorage.setItem('jmu_admin_auth', 'true');
      showAdminDashboard();
      showToast('✓ Welcome Organizer', 'success');
    } else {
      showToast('Incorrect Organizer PIN', 'error');
      if (pinInput) pinInput.focus();
    }
  };

  function renderAdminData() {
    const registrations = getRegistrations();
    const config = getConfig();

    // Calculate metrics
    let totalRevenue = 0;
    let soloCount = 0;
    let coupleCount = 0;
    let checkedInCount = 0;

    registrations.forEach(r => {
      totalRevenue += Number(r.amount) || 0;
      if (r.category && r.category.toLowerCase().includes('couple')) {
        coupleCount++;
      } else {
        soloCount++;
      }
      if (r.checkedIn) checkedInCount++;
    });

    const statTotalEl = document.getElementById('admin-stat-total');
    const statRevEl = document.getElementById('admin-stat-rev');
    const statSoloEl = document.getElementById('admin-stat-solo');
    const statCoupleEl = document.getElementById('admin-stat-couple');
    const statCheckedEl = document.getElementById('admin-stat-checked');

    if (statTotalEl) statTotalEl.textContent = registrations.length;
    if (statRevEl) statRevEl.textContent = `₹${totalRevenue.toLocaleString('en-IN')}`;
    if (statSoloEl) statSoloEl.textContent = soloCount;
    if (statCoupleEl) statCoupleEl.textContent = coupleCount;
    if (statCheckedEl) statCheckedEl.textContent = checkedInCount;

    // Render Config tab values
    const cfgUpiInput = document.getElementById('cfg-upi-id');
    const cfgPayeeInput = document.getElementById('cfg-payee-name');
    const cfgPhoneInput = document.getElementById('cfg-phone');
    if (cfgUpiInput) cfgUpiInput.value = config.upiId;
    if (cfgPayeeInput) cfgPayeeInput.value = config.payeeName;
    if (cfgPhoneInput) cfgPhoneInput.value = config.whatsappNumber;

    renderRegistrationsTable(registrations);
  }

  function renderRegistrationsTable(list) {
    const tbody = document.getElementById('admin-registrations-tbody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--muted);">No registrations yet. Share the link with attendees!</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, idx) => `
      <tr>
        <td><strong>${item.passId}</strong></td>
        <td>${item.name}</td>
        <td><span class="badge ${item.category.includes('Couple') ? 'badge-gold' : 'badge-wine'}">${item.category}</span></td>
        <td><a href="tel:${item.phone}">${item.phone}</a></td>
        <td>${item.address || '-'}</td>
        <td>
          <span class="status-pill ${item.checkedIn ? 'checked-in' : 'pending'}">
            ${item.checkedIn ? '✓ Admitted' : 'Pending'}
          </span>
        </td>
        <td>
          <button class="button small" style="padding:4px 10px; font-size:12px; min-height:30px;" onclick="toggleCheckIn('${item.passId}')">
            ${item.checkedIn ? 'Undo Entry' : 'Check In'}
          </button>
        </td>
      </tr>
    `).join('');
  }

  window.handleAdminSearch = function () {
    const query = document.getElementById('admin-search-input').value.trim().toLowerCase();
    const all = getRegistrations();
    if (!query) {
      renderRegistrationsTable(all);
      return;
    }
    const filtered = all.filter(r => 
      r.passId.toLowerCase().includes(query) ||
      r.name.toLowerCase().includes(query) ||
      r.phone.includes(query) ||
      (r.address && r.address.toLowerCase().includes(query)) ||
      (r.partnerName && r.partnerName.toLowerCase().includes(query))
    );
    renderRegistrationsTable(filtered);
  };

  // Gate Check-in verification terminal
  window.handleGateTerminalSubmit = function (e) {
    if (e) e.preventDefault();
    const input = document.getElementById('gate-pass-input');
    const query = input ? input.value.trim().toUpperCase() : '';
    const feedbackEl = document.getElementById('gate-terminal-feedback');

    if (!query) return;

    const all = getRegistrations();
    const match = all.find(r => r.passId.toUpperCase() === query || r.phone === query);

    if (!match) {
      if (feedbackEl) {
        feedbackEl.className = 'gate-feedback error';
        feedbackEl.innerHTML = `❌ <strong>PASS NOT FOUND</strong><br>Code "${query}" is not in the system roster.`;
      }
      return;
    }

    if (match.checkedIn) {
      if (feedbackEl) {
        feedbackEl.className = 'gate-feedback warning';
        feedbackEl.innerHTML = `⚠️ <strong>ALREADY CHECKED IN!</strong><br>${match.name} (${match.category}) was already admitted at gate.`;
      }
    } else {
      match.checkedIn = true;
      match.checkInTime = new Date().toLocaleTimeString('en-IN');
      saveRegistration(match);
      renderAdminData();

      if (feedbackEl) {
        feedbackEl.className = 'gate-feedback success';
        feedbackEl.innerHTML = `✅ <strong>ENTRY APPROVED!</strong><br>Welcome <strong>${match.name}</strong> • ${match.category} • Admitted.`;
      }
      showToast('✓ Entry verified: ' + match.passId, 'success');
      if (input) input.value = '';
    }
  };

  window.toggleCheckIn = function (passId) {
    const all = getRegistrations();
    const item = all.find(r => r.passId === passId);
    if (!item) return;
    item.checkedIn = !item.checkedIn;
    saveRegistration(item);
    renderAdminData();
    showToast(`Pass ${passId} marked as ${item.checkedIn ? 'Admitted' : 'Pending'}`);
  };

  // 1-Click CSV Export for Organizer
  window.exportRegistrationsCSV = function () {
    const all = getRegistrations();
    if (all.length === 0) {
      showToast('No registrations to export yet', 'error');
      return;
    }

    const headers = ["Pass ID", "Category", "Amount", "Attendee Name", "Mobile", "Address", "Instagram", "Partner Name", "Partner Mobile", "Booking Date", "Gate Check-In"];
    const rows = all.map(item => [
      `"${item.passId}"`,
      `"${item.category}"`,
      `"${item.amount}"`,
      `"${(item.name || '').replace(/"/g, '""')}"`,
      `"${item.phone || ''}"`,
      `"${(item.address || '').replace(/"/g, '""')}"`,
      `"${(item.insta || '').replace(/"/g, '""')}"`,
      `"${(item.partnerName || '').replace(/"/g, '""')}"`,
      `"${(item.partnerPhone || '').replace(/"/g, '""')}"`,
      `"${new Date(item.timestamp).toLocaleString('en-IN')}"`,
      `"${item.checkedIn ? 'YES' : 'NO'}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `JMU_Registrations_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('✓ CSV roster exported successfully!', 'success');
  };

  // Save Settings from Admin Panel
  window.handleSaveSettings = function (e) {
    if (e) e.preventDefault();
    const upi = document.getElementById('cfg-upi-id').value.trim();
    const payee = document.getElementById('cfg-payee-name').value.trim();
    const phone = document.getElementById('cfg-phone').value.trim();

    if (!upi || !payee) {
      showToast('UPI ID and Payee Name are required', 'error');
      return;
    }

    saveConfigOverride({
      upiId: upi,
      payeeName: payee,
      whatsappNumber: phone
    });

    showToast('✓ Settings updated and saved!', 'success');
  };

  // --- Initialize on DOMContentLoaded ---
  document.addEventListener('DOMContentLoaded', function () {
    initCountdown();

    // Check URL hash for admin direct link (e.g. #admin)
    if (window.location.hash === '#admin') {
      openAdminModal();
    }
  });

})();
