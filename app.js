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

  // --- Security: HTML Entity Sanitizer to Prevent DOM XSS ---
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- Toast Notification Helper (Safe textContent DOM injection) ---
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
    const span = document.createElement('span');
    span.textContent = message;
    toast.appendChild(span);
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

  function deleteLocalRegistration(passId) {
    try {
      const all = getRegistrations().filter(item => item.passId !== passId);
      localStorage.setItem('jmu_registrations_v1', JSON.stringify(all));

      const myPasses = getMyPasses().filter(item => item.passId !== passId);
      localStorage.setItem('jmu_my_passes', JSON.stringify(myPasses));
    } catch (e) {
      console.error('Error deleting local registration:', e);
    }
  }

  // Cloud sync to Neon Postgres database
  async function syncPassToCloud(pass) {
    if (!pass || !pass.passId) return false;
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pass)
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.success) {
          pass.synced = true;
          // Cache updated synced status in local storage
          const all = getRegistrations();
          const found = all.find(p => p.passId === pass.passId);
          if (found) {
            found.synced = true;
            localStorage.setItem('jmu_registrations_v1', JSON.stringify(all));
          }
          console.log('✓ Pass stored in cloud database:', pass.passId);
          return true;
        }
      }
    } catch (err) {
      console.warn('Could not sync pass to cloud immediately (stored locally):', err);
    }
    return false;
  }

  async function syncLocalRegistrationsToCloud() {
    try {
      const local = getRegistrations();
      if (!local || local.length === 0) return;
      for (const pass of local) {
        if (!pass.synced) {
          syncPassToCloud(pass);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  function generatePassId() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const timeSlice = (Date.now() % (chars.length * chars.length));
    const c1 = chars.charAt(Math.floor(timeSlice / chars.length));
    const c2 = chars.charAt(timeSlice % chars.length);
    let randomPart = '';
    for (let i = 0; i < 3; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `JMU-${c1}${c2}${randomPart}`;
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

    const indianPhoneRegex = /^[6-9]\d{9}$/;

    if (!name || name.length < 2) {
      showToast('Please enter your full name', 'error');
      if (nameInput) nameInput.focus();
      return;
    }

    if (!phone || !indianPhoneRegex.test(phone)) {
      showToast('Please enter a valid 10-digit Indian WhatsApp/Mobile number', 'error');
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
      if (partnerPhone && !indianPhoneRegex.test(partnerPhone)) {
        showToast('Please enter a valid 10-digit mobile number for spouse', 'error');
        if (partnerPhoneInput) partnerPhoneInput.focus();
        return;
      }
    }

    // Defensive capping of string lengths
    wizardState.data = {
      name: name.slice(0, 60),
      phone: phone,
      address: address.slice(0, 120),
      insta: insta ? insta.slice(0, 40) : '',
      partnerName: partnerName ? partnerName.slice(0, 60) : '',
      partnerPhone: partnerPhone
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
      insta: wizardState.data.insta && wizardState.data.insta.trim() ? (wizardState.data.insta.trim().startsWith('@') ? wizardState.data.insta.trim() : '@' + wizardState.data.insta.trim()) : '',
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
    syncPassToCloud(pass); // Save immediately to Neon Postgres cloud database

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
    const nameEl = document.getElementById('pass-name-display');
    const catEl = document.getElementById('pass-cat-display');
    const phoneEl = document.getElementById('pass-phone-display');
    const addrEl = document.getElementById('pass-addr-display');
    const instaEl = document.getElementById('pass-insta-display');
    const instaWrap = document.getElementById('pass-insta-wrap');
    const partnerWrap = document.getElementById('pass-partner-wrap');
    const partnerNameEl = document.getElementById('pass-partner-display');
    const amountEl = document.getElementById('pass-amount-display');

    if (nameEl) nameEl.textContent = pass.name;
    if (catEl) catEl.textContent = pass.category;
    if (phoneEl) phoneEl.textContent = pass.phone;
    if (addrEl) addrEl.textContent = pass.address;
    if (amountEl) amountEl.textContent = `₹${pass.amount}/-`;

    // Only display Instagram if user entered a value (omit if blank, never show N/A)
    if (instaWrap) {
      if (pass.insta && pass.insta.trim() !== '' && pass.insta !== 'N/A') {
        instaWrap.style.display = 'block';
        if (instaEl) instaEl.textContent = pass.insta;
      } else {
        instaWrap.style.display = 'none';
      }
    }

    if (partnerWrap) {
      if (pass.partnerName) {
        partnerWrap.style.display = 'block';
        if (partnerNameEl) partnerNameEl.textContent = pass.partnerName;
      } else {
        partnerWrap.style.display = 'none';
      }
    }

    const codeDisplayEl = document.getElementById('pass-code-display');
    if (codeDisplayEl) codeDisplayEl.textContent = pass.passId;

    // Build WhatsApp Pre-Formatted Message
    let partnerInfo = '';
    if (pass.partnerName) {
      partnerInfo = `👫 Partner / Spouse: ${pass.partnerName}\n`;
    }

    let instaInfo = '';
    if (pass.insta && pass.insta.trim() !== '' && pass.insta !== 'N/A') {
      instaInfo = `📸 Instagram: ${pass.insta}\n`;
    }

    const waMessage = 
`🌸 JAYNAGAR MILAN UTSAV 2026 🌸
━━━━━━━━━━━━━━━━━━━━
🎫 Pass ID: ${pass.passId}
👤 Attendee Name: ${pass.name}
🏷️ Category: ${pass.category} (₹${pass.amount})
📞 Mobile: ${pass.phone}
📍 Address: ${pass.address}
${instaInfo}${partnerInfo}💰 Registration Fee: ₹${pass.amount}/-
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
      if (input) input.value = myPasses[0].passId;
    } else if (resultContainer) {
      resultContainer.innerHTML = `
        <div class="empty-state">
          <p>Apna official Ticket ID (e.g. <code>JMU-7K29</code>) enter karein apna pass dekhne ke liye.</p>
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

  window.handleMyPassSearch = async function (e) {
    if (e) e.preventDefault();
    const input = document.getElementById('mypass-search-input');
    const query = input ? input.value.trim().toUpperCase() : '';

    if (!query) {
      showToast('Please enter your Ticket ID', 'error');
      return;
    }

    // Check if user entered phone number instead of Pass ID
    const isDigitsOnly = /^\d+$/.test(query.replace(/[\s-]/g, ''));
    if (isDigitsOnly) {
      showToast('Search by phone number is disabled for privacy. Please enter Ticket ID.', 'error');
      const resultContainer = document.getElementById('mypass-results');
      if (resultContainer) {
        resultContainer.innerHTML = `
          <div class="not-found-card">
            <h4>Ticket ID Required</h4>
            <p>Attendee privacy aur security ke liye phone number se search band kar diya gaya hai. Kripya booking ke baad generate hua apna official <strong>Ticket ID</strong> (e.g. <code>JMU-7K29</code>) enter karein.</p>
          </div>`;
      }
      return;
    }

    const resultContainer = document.getElementById('mypass-results');

    // 1. Check local device storage first
    const all = getRegistrations();
    const mySaved = getMyPasses();
    const combined = [...mySaved, ...all];
    const match = combined.find(item => item.passId && item.passId.toUpperCase() === query);

    if (match) {
      renderLookupResult(match);
      showToast('✓ Pass found: ' + match.passId, 'success');
      // Background refresh from cloud for latest gate checkin status
      fetch('/api/get-pass?id=' + encodeURIComponent(query))
        .then(res => res.json())
        .then(data => {
          if (data && data.success && data.pass) {
            saveRegistration(data.pass);
            renderLookupResult(data.pass);
          }
        }).catch(() => {});
      return;
    }

    // 2. Not in local storage? Search cloud database via /api/get-pass
    if (resultContainer) {
      resultContainer.innerHTML = `
        <div style="text-align:center; padding:32px 16px; color:var(--gold);">
          <div style="display:inline-block; width:28px; height:28px; border:3px solid rgba(230,188,112,0.3); border-top-color:var(--gold); border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:12px;"></div>
          <div style="font-size:14.5px; font-weight:600;">Searching cloud database for ${escapeHtml(query)}...</div>
          <div style="font-size:12px; color:var(--muted); margin-top:4px;">Official database records check kiye jaa rahe hain</div>
        </div>`;
    }

    try {
      const response = await fetch('/api/get-pass?id=' + encodeURIComponent(query));
      if (response.ok) {
        const data = await response.json();
        if (data && data.success && data.pass) {
          const pass = data.pass;
          // Save to local device so future lookups are instant
          saveRegistration(pass);
          renderLookupResult(pass);
          showToast('✓ Pass retrieved from cloud: ' + pass.passId, 'success');
          return;
        }
      }
    } catch (err) {
      console.warn('Cloud pass lookup error:', err);
    }

    // 3. Not found in local storage OR cloud database
    if (resultContainer) {
      resultContainer.innerHTML = `
        <div class="not-found-card">
          <h4>Ticket ID Nahi Mila</h4>
          <p>"${escapeHtml(query)}" ke liye koi registered pass nahi mila. Kripya apna valid Ticket ID check karein ya naya registration karein.</p>
          <div style="margin-top:16px;">
            <button class="button small" onclick="closeMyPassModal(); openRegistrationModal();">Book New Pass</button>
          </div>
        </div>`;
    }
  };

  function renderLookupResult(pass) {
    const resultContainer = document.getElementById('mypass-results');
    if (!resultContainer) return;

    wizardState.currentPass = pass;
    const config = getConfig();

    let partnerHtml = '';
    if (pass.partnerName) {
      partnerHtml = `<div class="lookup-field"><span>Partner:</span> <strong>${escapeHtml(pass.partnerName)}</strong></div>`;
    }

    const isApproved = pass.status === 'approved';
    const statusBadge = isApproved
      ? `<span class="badge badge-success" style="font-size:12px; padding:4px 8px;">✓ Payment Verified &amp; Approved</span>`
      : `<span class="badge badge-warning" style="font-size:12px; padding:4px 8px;">⏳ Verification Pending (Screenshot Required)</span>`;

    const gateBadge = pass.checkedIn
      ? `<span class="status-pill checked-in" style="margin-left:6px;">🚪 Admitted at Gate</span>`
      : '';

    resultContainer.innerHTML = `
      <div class="lookup-pass-card">
        <div class="lookup-pass-header">
          <div class="pass-badge">PASS ID: ${escapeHtml(pass.passId)}</div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${statusBadge}
            ${gateBadge}
          </div>
        </div>
        <div class="lookup-body">
          <div class="lookup-field"><span>Attendee:</span> <strong>${escapeHtml(pass.name)}</strong></div>
          <div class="lookup-field"><span>Category:</span> <strong>${escapeHtml(pass.category)} (₹${escapeHtml(pass.amount)})</strong></div>
          <div class="lookup-field"><span>Mobile:</span> <strong>${escapeHtml(pass.phone)}</strong></div>
          <div class="lookup-field"><span>Address:</span> <strong>${escapeHtml(pass.address)}</strong></div>
          ${pass.insta && pass.insta.trim() !== '' && pass.insta !== 'N/A' ? `<div class="lookup-field"><span>Instagram:</span> <strong>${escapeHtml(pass.insta)}</strong></div>` : ''}
          ${partnerHtml}
          <div class="lookup-field"><span>Event Date:</span> <strong>19 October 2026 • 6:00–10:00 PM</strong></div>
          <div class="lookup-field"><span>Venue:</span> <strong>Marwadi Vivah Bhavan, Jaynagar</strong></div>
        </div>
        <div class="lookup-actions">
          <button class="button small" onclick="viewFullPassFromLookup('${escapeHtml(pass.passId)}')">Show Full Digital Pass</button>
          <a class="button dark small" href="https://wa.me/${encodeURIComponent(config.whatsappNumber)}?text=${encodeURIComponent('Hello, I am inquiring about my pass ID: ' + pass.passId + ' for Jaynagar Milan Utsav 2026.')}" target="_blank" rel="noopener noreferrer">WhatsApp Support</a>
        </div>
      </div>
    `;
  }

  window.viewFullPassFromLookup = function (passId) {
    const all = [...getMyPasses(), ...getRegistrations()];
    let pass = all.find(p => p.passId === passId);
    if (!pass && wizardState.currentPass && wizardState.currentPass.passId === passId) {
      pass = wizardState.currentPass;
    }
    if (!pass) return;

    closeMyPassModal();
    openRegistrationModal(pass.category.toLowerCase().includes('couple') ? 'couple' : 'solo');
    wizardState.currentPass = pass;
    renderStep3Pass(pass);
    setWizardStep(3);
  };

  // --- Organizer Operations & Gate Check-in Portal ---
  let adminLockUntil = 0;
  let adminFailedAttempts = 0;
  let adminPassesCache = [];
  let activeAdminFilter = 'all';

  window.openAdminModal = function () {
    const modal = document.getElementById('admin-modal');
    if (!modal) return;

    // Check session validity (30-minute auto timeout)
    const authTime = Number(sessionStorage.getItem('jmu_admin_auth_time') || 0);
    const isAuth = sessionStorage.getItem('jmu_admin_auth') === 'true';
    if (isAuth && (Date.now() - authTime < 30 * 60 * 1000)) {
      showAdminDashboard();
    } else {
      sessionStorage.removeItem('jmu_admin_auth');
      sessionStorage.removeItem('jmu_admin_auth_time');
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
      const pinInput = document.getElementById('admin-pin-input');
      if (pinInput && sessionStorage.getItem('jmu_admin_auth') !== 'true') {
        pinInput.value = '';
      }
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

    // Populate Settings tab values
    const config = getConfig();
    const cfgUpiInput = document.getElementById('cfg-upi-id');
    const cfgPayeeInput = document.getElementById('cfg-payee-name');
    const cfgPhoneInput = document.getElementById('cfg-phone');
    if (cfgUpiInput) cfgUpiInput.value = config.upiId;
    if (cfgPayeeInput) cfgPayeeInput.value = config.payeeName;
    if (cfgPhoneInput) cfgPhoneInput.value = config.whatsappNumber;

    // Render local cache first for instant feedback, then fetch latest from cloud
    adminPassesCache = getRegistrations();
    renderAdminData();
    fetchCloudPassesForAdmin(false);
  }

  window.handleAdminLogin = function (e) {
    if (e) e.preventDefault();
    const pinInput = document.getElementById('admin-pin-input');
    const entered = pinInput ? pinInput.value.trim() : '';
    const config = getConfig();

    // Brute-force rate limiting protection
    if (Date.now() < adminLockUntil) {
      const waitSeconds = Math.ceil((adminLockUntil - Date.now()) / 1000);
      showToast(`Security Lockout: Too many failed attempts. Try again in ${waitSeconds}s`, 'error');
      return;
    }

    if (entered === config.adminPin) {
      adminFailedAttempts = 0;
      sessionStorage.setItem('jmu_admin_auth', 'true');
      sessionStorage.setItem('jmu_admin_auth_time', String(Date.now()));
      showAdminDashboard();
      showToast('✓ Welcome Organizer', 'success');
    } else {
      adminFailedAttempts++;
      if (adminFailedAttempts >= 5) {
        adminLockUntil = Date.now() + 5 * 60 * 1000; // 5-minute lockout
        showToast('Security alert: Account locked for 5 minutes due to 5 failed attempts', 'error');
      } else {
        showToast(`Incorrect PIN. ${5 - adminFailedAttempts} attempt(s) remaining.`, 'error');
      }
      if (pinInput) {
        pinInput.value = '';
        pinInput.focus();
      }
    }
  };

  async function fetchCloudPassesForAdmin(isManual = false) {
    const config = getConfig();
    try {
      const response = await fetch('/api/all-passes', {
        headers: {
          'x-admin-pin': config.adminPin
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.success && Array.isArray(data.passes)) {
          adminPassesCache = data.passes;
          // Synchronize locally so offline fallback has latest cloud data
          localStorage.setItem('jmu_registrations_v1', JSON.stringify(data.passes));
          renderAdminData();
          if (isManual) {
            showToast(`✓ Cloud database synced (${data.passes.length} attendees)`, 'success');
          }
          return;
        }
      }
    } catch (err) {
      console.warn('Failed to fetch passes from cloud database:', err);
    }
    if (isManual) {
      showToast('Offline or network error: using local records', 'info');
    }
  }

  window.refreshAdminDataFromCloud = function () {
    fetchCloudPassesForAdmin(true);
  };

  window.setAdminFilter = function (filter) {
    activeAdminFilter = filter || 'all';
    document.querySelectorAll('.admin-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === activeAdminFilter);
    });
    renderAdminData();
  };

  function renderAdminData() {
    const all = (adminPassesCache && adminPassesCache.length > 0) ? adminPassesCache : getRegistrations();

    // Calculate metrics across ALL registered passes
    let totalRevenue = 0;
    let approvedCount = 0;
    let pendingCount = 0;
    let checkedInCount = 0;

    all.forEach(r => {
      totalRevenue += Number(r.amount) || 0;
      if (r.status === 'approved') {
        approvedCount++;
      } else {
        pendingCount++;
      }
      if (r.checkedIn) checkedInCount++;
    });

    const statTotalEl = document.getElementById('admin-stat-total');
    const statRevEl = document.getElementById('admin-stat-rev');
    const statApprovedEl = document.getElementById('admin-stat-approved');
    const statPendingEl = document.getElementById('admin-stat-pending');
    const statCheckedEl = document.getElementById('admin-stat-checked');

    if (statTotalEl) statTotalEl.textContent = all.length;
    if (statRevEl) statRevEl.textContent = `₹${totalRevenue.toLocaleString('en-IN')}`;
    if (statApprovedEl) statApprovedEl.textContent = approvedCount;
    if (statPendingEl) statPendingEl.textContent = pendingCount;
    if (statCheckedEl) statCheckedEl.textContent = checkedInCount;

    // Update filter tab counts
    const fAll = document.getElementById('filter-count-all');
    const fPending = document.getElementById('filter-count-pending');
    const fApproved = document.getElementById('filter-count-approved');
    const fChecked = document.getElementById('filter-count-checked');
    if (fAll) fAll.textContent = all.length;
    if (fPending) fPending.textContent = pendingCount;
    if (fApproved) fApproved.textContent = approvedCount;
    if (fChecked) fChecked.textContent = checkedInCount;

    // Apply active filter
    let list = all;
    if (activeAdminFilter === 'pending') {
      list = all.filter(r => r.status !== 'approved');
    } else if (activeAdminFilter === 'approved') {
      list = all.filter(r => r.status === 'approved');
    } else if (activeAdminFilter === 'checkedin') {
      list = all.filter(r => r.checkedIn);
    }

    // Apply live search query if present
    const searchInput = document.getElementById('admin-search-input');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (query) {
      list = list.filter(r => 
        (r.passId && r.passId.toLowerCase().includes(query)) ||
        (r.name && r.name.toLowerCase().includes(query)) ||
        (r.phone && r.phone.includes(query)) ||
        (r.address && r.address.toLowerCase().includes(query)) ||
        (r.partnerName && r.partnerName.toLowerCase().includes(query))
      );
    }

    const showingCountEl = document.getElementById('admin-showing-count');
    if (showingCountEl) {
      showingCountEl.textContent = `Showing ${list.length} of ${all.length} attendees`;
    }

    renderRegistrationsTable(list);
  }

  function renderRegistrationsTable(list) {
    const tbody = document.getElementById('admin-registrations-tbody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:28px 16px; color:var(--muted);">No attendees match this filter or search query.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item) => {
      const isApproved = item.status === 'approved';
      const cleanPhone = String(item.phone || '').replace(/[^0-9]/g, '');
      const waMsg = encodeURIComponent(`Namaste ${item.name}, Jaynagar Milan Utsav 2026 ke ticket (Pass ID: ${item.passId}) payment verification ke sambandh mein:`);
      
      return `
        <tr>
          <td>
            <strong style="font-family:var(--font-mono); color:var(--gold); font-size:13.5px;">${escapeHtml(item.passId)}</strong>
          </td>
          <td>
            <strong style="color:#fff;">${escapeHtml(item.name)}</strong>
            ${item.partnerName ? `<div style="font-size:12px; color:var(--gold); margin-top:2px;">+ ${escapeHtml(item.partnerName)}</div>` : ''}
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">${escapeHtml(item.address || '-')}</div>
          </td>
          <td>
            <span class="badge ${item.category && item.category.includes('Couple') ? 'badge-gold' : 'badge-wine'}">${escapeHtml(item.category || 'Solo')}</span>
            <div style="font-size:12px; font-weight:600; color:var(--gold); margin-top:3px;">₹${escapeHtml(item.amount || '199')}</div>
          </td>
          <td>
            <a href="tel:${escapeHtml(item.phone)}" style="font-weight:600; color:var(--snow); text-decoration:none;">${escapeHtml(item.phone)}</a>
            ${cleanPhone ? `
              <div>
                <a href="https://wa.me/91${cleanPhone}?text=${waMsg}" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:#25D366; text-decoration:none; margin-top:3px;">
                  💬 WhatsApp
                </a>
              </div>
            ` : ''}
          </td>
          <td>
            ${isApproved
              ? `<span class="badge badge-success">✓ Approved</span>`
              : `<span class="badge badge-warning">⏳ Pending</span>`}
          </td>
          <td>
            <span class="status-pill ${item.checkedIn ? 'checked-in' : 'pending'}">
              ${item.checkedIn ? '🚪 Admitted' : 'Pending'}
            </span>
            ${item.checkedIn && item.checkInTime ? `<div style="font-size:10px; color:var(--muted); margin-top:2px;">${escapeHtml(item.checkInTime)}</div>` : ''}
          </td>
          <td>
            <div class="admin-actions-cell">
              ${isApproved
                ? `<button type="button" class="button outline small" style="padding:4px 8px; font-size:11px; min-height:28px;" onclick="adminMarkPendingPass('${escapeHtml(item.passId)}')">Undo Appr</button>`
                : `<button type="button" class="button small" style="padding:4px 8px; font-size:11px; min-height:28px; background:#10b981; border-color:#10b981; color:#fff;" onclick="adminApprovePass('${escapeHtml(item.passId)}')">✓ Approve</button>`
              }
              <button type="button" class="button small" style="padding:4px 8px; font-size:11px; min-height:28px; background:var(--ink-2);" onclick="toggleCheckIn('${escapeHtml(item.passId)}')">
                ${item.checkedIn ? 'Undo Entry' : '🚪 Admit'}
              </button>
              <button type="button" class="button small" style="padding:4px 8px; font-size:11px; min-height:28px; background:#ef4444; border-color:#ef4444; color:#fff;" onclick="adminDeletePass('${escapeHtml(item.passId)}', '${escapeHtml(item.name)}')">
                🗑️ Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.handleAdminSearch = function () {
    renderAdminData();
  };

  // Admin Approve Action
  window.adminApprovePass = async function (passId) {
    const config = getConfig();
    const item = adminPassesCache.find(r => r.passId === passId) || getRegistrations().find(r => r.passId === passId);
    if (item) {
      item.status = 'approved';
      saveRegistration(item);
    }
    renderAdminData();
    showToast(`✓ Pass ${passId} Approved & Verified!`, 'success');

    try {
      await fetch('/api/all-passes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': config.adminPin
        },
        body: JSON.stringify({ action: 'approve', passId })
      });
    } catch (err) {
      console.warn('Cloud approve error (saved locally):', err);
    }
  };

  // Admin Revert to Pending Action
  window.adminMarkPendingPass = async function (passId) {
    const config = getConfig();
    const item = adminPassesCache.find(r => r.passId === passId) || getRegistrations().find(r => r.passId === passId);
    if (item) {
      item.status = 'pending';
      saveRegistration(item);
    }
    renderAdminData();
    showToast(`Pass ${passId} reverted to Pending`, 'info');

    try {
      await fetch('/api/all-passes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': config.adminPin
        },
        body: JSON.stringify({ action: 'pending', passId })
      });
    } catch (err) {
      console.warn('Cloud pending status update error (saved locally):', err);
    }
  };

  // Admin Delete Pass Action
  window.adminDeletePass = async function (passId, attendeeName) {
    const config = getConfig();
    const confirmed = confirm(`⚠️ Are you sure you want to PERMANENTLY DELETE attendee "${attendeeName || passId}" (${passId})?\n\nThis will remove them from the database roster and they will no longer be able to retrieve this pass.`);
    if (!confirmed) return;

    // Optimistic removal from cache & local storage
    adminPassesCache = adminPassesCache.filter(r => r.passId !== passId);
    deleteLocalRegistration(passId);
    renderAdminData();
    showToast(`🗑️ Attendee ${passId} removed`, 'success');

    try {
      const res = await fetch('/api/all-passes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': config.adminPin
        },
        body: JSON.stringify({ action: 'delete', passId })
      });
      if (res.ok) {
        showToast(`✓ Pass ${passId} deleted permanently from cloud database`, 'success');
      }
    } catch (err) {
      console.warn('Cloud delete error:', err);
    }
  };

  // Gate Check-in verification terminal
  window.handleGateTerminalSubmit = async function (e) {
    if (e) e.preventDefault();
    const input = document.getElementById('gate-pass-input');
    const query = input ? input.value.trim().toUpperCase() : '';
    const feedbackEl = document.getElementById('gate-terminal-feedback');
    const config = getConfig();

    if (!query) return;

    let match = adminPassesCache.find(r => (r.passId && r.passId.toUpperCase() === query) || r.phone === query);
    if (!match) {
      match = getRegistrations().find(r => (r.passId && r.passId.toUpperCase() === query) || r.phone === query);
    }

    // If not found in memory, query cloud endpoint directly
    if (!match) {
      try {
        const resp = await fetch('/api/get-pass?id=' + encodeURIComponent(query));
        if (resp.ok) {
          const cData = await resp.json();
          if (cData && cData.success && cData.pass) {
            match = cData.pass;
            adminPassesCache.unshift(match);
            saveRegistration(match);
          }
        }
      } catch (err) {
        // ignore
      }
    }

    if (!match) {
      if (feedbackEl) {
        feedbackEl.className = 'gate-feedback error';
        feedbackEl.innerHTML = `❌ <strong>PASS NOT FOUND</strong><br>Code "${escapeHtml(query)}" is not in the system roster.`;
      }
      return;
    }

    if (match.checkedIn) {
      if (feedbackEl) {
        feedbackEl.className = 'gate-feedback warning';
        feedbackEl.innerHTML = `⚠️ <strong>ALREADY CHECKED IN!</strong><br>${escapeHtml(match.name)} (${escapeHtml(match.category)}) was already admitted at gate.`;
      }
    } else {
      match.checkedIn = true;
      match.checkInTime = new Date().toLocaleTimeString('en-IN');
      saveRegistration(match);
      renderAdminData();

      if (feedbackEl) {
        feedbackEl.className = 'gate-feedback success';
        feedbackEl.innerHTML = `✅ <strong>ENTRY APPROVED!</strong><br>Welcome <strong>${escapeHtml(match.name)}</strong> • ${escapeHtml(match.category)} • Admitted.`;
      }
      showToast('✓ Entry verified: ' + match.passId, 'success');
      if (input) input.value = '';

      try {
        await fetch('/api/all-passes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-pin': config.adminPin
          },
          body: JSON.stringify({ action: 'checkin', passId: match.passId, checkedIn: true })
        });
      } catch (err) {
        // ignore
      }
    }
  };

  window.toggleCheckIn = async function (passId) {
    const config = getConfig();
    let item = adminPassesCache.find(r => r.passId === passId);
    if (!item) item = getRegistrations().find(r => r.passId === passId);
    if (!item) return;

    item.checkedIn = !item.checkedIn;
    if (item.checkedIn) {
      item.checkInTime = new Date().toLocaleTimeString('en-IN');
    } else {
      item.checkInTime = null;
    }
    saveRegistration(item);
    renderAdminData();
    showToast(`Pass ${passId} marked as ${item.checkedIn ? 'Admitted' : 'Pending Entry'}`);

    try {
      await fetch('/api/all-passes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': config.adminPin
        },
        body: JSON.stringify({ action: 'checkin', passId, checkedIn: item.checkedIn })
      });
    } catch (err) {
      console.warn('Cloud checkin sync error:', err);
    }
  };

  // 1-Click CSV Export for Organizer
  window.exportRegistrationsCSV = function () {
    const all = (adminPassesCache && adminPassesCache.length > 0) ? adminPassesCache : getRegistrations();
    if (all.length === 0) {
      showToast('No registrations to export yet', 'error');
      return;
    }

    function safeCsvCell(val) {
      let str = String(val === undefined || val === null ? '' : val);
      if (/^[=\+\-@\t\r]/.test(str)) {
        str = "'" + str; // neutralize CSV formula execution
      }
      return `"${str.replace(/"/g, '""')}"`;
    }

    const headers = [
      "Pass ID",
      "Status",
      "Category",
      "Amount",
      "Attendee Name",
      "Mobile",
      "Address",
      "Instagram",
      "Partner Name",
      "Partner Mobile",
      "Booking Date",
      "Gate Check-In",
      "Check-In Time"
    ];

    const rows = all.map(item => [
      safeCsvCell(item.passId),
      safeCsvCell(item.status === 'approved' ? 'Approved' : 'Pending'),
      safeCsvCell(item.category),
      safeCsvCell(item.amount),
      safeCsvCell(item.name),
      safeCsvCell(item.phone),
      safeCsvCell(item.address),
      safeCsvCell(item.insta),
      safeCsvCell(item.partnerName),
      safeCsvCell(item.partnerPhone),
      safeCsvCell(item.timestamp ? new Date(item.timestamp).toLocaleString('en-IN') : ''),
      safeCsvCell(item.checkedIn ? 'YES' : 'NO'),
      safeCsvCell(item.checkInTime || '')
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.map(safeCsvCell).join(','), ...rows.map(e => e.join(','))].join('\n');
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

    // Sync any unsynced offline/local registrations to the cloud database
    syncLocalRegistrationsToCloud();

    // Check URL hash for admin direct link (e.g. #admin)
    if (window.location.hash === '#admin') {
      openAdminModal();
    }
  });

})();
