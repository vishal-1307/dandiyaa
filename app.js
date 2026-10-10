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
    whatsappNumber: "917050551310",
    adminPin: "#Rounak26",
    whatsappGroupLink: "https://chat.whatsapp.com/invite",
    pricing: {
      solo: 249,
      couple: 399
    },
    razorpayKeyId: "rzp_test_TmFBKDBb4nQgtD"
  };

  // Load any organizer-saved config overrides from localStorage
  function getConfig() {
    try {
      const saved = localStorage.getItem('jmu_config_override');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Force upgrade PIN if older PIN was stored
        if (parsed.adminPin && parsed.adminPin !== '#Rounak26') {
          delete parsed.adminPin;
          localStorage.setItem('jmu_config_override', JSON.stringify(parsed));
        }
        return Object.assign({}, DEFAULT_CONFIG, parsed);
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
    quantity: 1,
    amount: 249,
    data: {
      name: '',
      phone: '',
      address: '',
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

  // Quantity selection for Solo Pass (Max 4 tickets)
  window.setSoloQuantity = function (qty) {
    const config = getConfig();
    const cleanQty = Math.max(1, Math.min(4, Number(qty) || 1));
    wizardState.quantity = cleanQty;

    // Update active pill styling
    document.querySelectorAll('.qty-pill-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.getAttribute('data-qty')) === cleanQty);
    });

    const price = config.pricing.solo * cleanQty;
    wizardState.amount = price;

    const summaryAmount = document.getElementById('reg-summary-amount');
    const summaryCat = document.getElementById('reg-summary-category');
    const proceedBtnText = document.getElementById('btn-proceed-pay-text');

    if (summaryAmount) summaryAmount.textContent = `₹${price}`;
    if (summaryCat) {
      summaryCat.textContent = `Solo Pass (${cleanQty} ${cleanQty === 1 ? 'Person' : 'Persons / Tickets'})`;
    }
    if (proceedBtnText) {
      proceedBtnText.textContent = `Pay Now · ₹${price} ➔`;
    }
  };

  function updateCategorySelection(category) {
    wizardState.category = category;
    const config = getConfig();

    const soloBtn = document.getElementById('cat-btn-solo');
    const coupleBtn = document.getElementById('cat-btn-couple');
    const coupleFields = document.getElementById('couple-fields-group');
    const soloQtyGroup = document.getElementById('solo-quantity-group');
    const summaryAmount = document.getElementById('reg-summary-amount');
    const summaryCat = document.getElementById('reg-summary-category');
    const proceedBtnText = document.getElementById('btn-proceed-pay-text');

    if (soloBtn && coupleBtn) {
      soloBtn.classList.toggle('active', category === 'solo');
      coupleBtn.classList.toggle('active', category === 'couple');
    }

    if (category === 'couple') {
      if (coupleFields) coupleFields.style.display = 'block';
      if (soloQtyGroup) soloQtyGroup.style.display = 'none';
      wizardState.quantity = 1;
      const price = config.pricing.couple;
      wizardState.amount = price;

      if (summaryAmount) summaryAmount.textContent = `₹${price}`;
      if (summaryCat) summaryCat.textContent = 'Couple Pass (Married Couple)';
      if (proceedBtnText) proceedBtnText.textContent = `Pay Now · ₹${price} ➔`;
    } else {
      if (coupleFields) coupleFields.style.display = 'none';
      if (soloQtyGroup) soloQtyGroup.style.display = 'block';
      const qty = wizardState.quantity || 1;
      const price = config.pricing.solo * qty;
      wizardState.amount = price;

      // Ensure active pill button matches
      document.querySelectorAll('.qty-pill-btn').forEach(btn => {
        btn.classList.toggle('active', Number(btn.getAttribute('data-qty')) === qty);
      });

      if (summaryAmount) summaryAmount.textContent = `₹${price}`;
      if (summaryCat) {
        summaryCat.textContent = `Solo Pass (${qty} ${qty === 1 ? 'Person' : 'Persons / Tickets'})`;
      }
      if (proceedBtnText) proceedBtnText.textContent = `Pay Now · ₹${price} ➔`;
    }
  }
  window.selectWizardCategory = updateCategorySelection;

  function setWizardStep(stepNumber) {
    wizardState.step = stepNumber;

    const step1El = document.getElementById('wizard-step-1');
    const step3El = document.getElementById('wizard-step-3');

    if (step1El) {
      step1El.style.display = (stepNumber === 1 ? 'block' : 'none');
      step1El.classList.toggle('active', stepNumber === 1);
    }
    if (step3El) {
      step3El.style.display = (stepNumber === 3 ? 'block' : 'none');
      step3El.classList.toggle('active', stepNumber === 3);
    }
  }

  // Step 1 Validation & Immediate Razorpay Checkout
  window.handleStep1Submit = function (e) {
    if (e) e.preventDefault();

    const nameInput = document.getElementById('reg-name');
    const phoneInput = document.getElementById('reg-phone');
    const addressInput = document.getElementById('reg-address');
    const partnerNameInput = document.getElementById('reg-partner-name');
    const partnerPhoneInput = document.getElementById('reg-partner-phone');

    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim().replace(/\D/g, '') : '';
    const address = addressInput ? addressInput.value.trim() : '';

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

    // Defensive capping of string lengths (address is optional)
    wizardState.data = {
      name: name.slice(0, 60),
      phone: phone,
      address: address ? address.slice(0, 120) : '',
      partnerName: partnerName ? partnerName.slice(0, 60) : '',
      partnerPhone: partnerPhone
    };

    // Immediately launch Razorpay Standard Checkout
    startRazorpayPayment();
  };

  // Resilient Razorpay SDK loader (prevents "SDK loading" failure on slower networks)
  function ensureRazorpayLoaded() {
    return new Promise((resolve) => {
      if (typeof window.Razorpay === 'function') {
        return resolve(true);
      }
      let existingScript = document.querySelector('script[src*="checkout.razorpay.com"]');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(true), { once: true });
        existingScript.addEventListener('error', () => resolve(false), { once: true });
        // Poll for up to 4 seconds
        let checks = 0;
        const interval = setInterval(() => {
          checks++;
          if (typeof window.Razorpay === 'function') {
            clearInterval(interval);
            resolve(true);
          } else if (checks > 40) {
            clearInterval(interval);
            resolve(false);
          }
        }, 100);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  // Direct Razorpay Gateway Checkout Launcher
  window.startRazorpayPayment = async function () {
    const config = getConfig();
    const price = wizardState.amount || (wizardState.category === 'solo' ? config.pricing.solo * (wizardState.quantity || 1) : config.pricing.couple);
    const qty = wizardState.category === 'solo' ? (wizardState.quantity || 1) : 1;
    const passId = generatePassId();

    const payBtn = document.getElementById('btn-proceed-pay');
    const payBtnText = document.getElementById('btn-proceed-pay-text');
    const defaultBtnLabel = `Pay Now · ₹${price} ➔`;

    if (payBtn) payBtn.disabled = true;
    if (payBtnText) payBtnText.textContent = 'Opening payment...';

    function resetPayBtn() {
      if (payBtn) payBtn.disabled = false;
      if (payBtnText) payBtnText.textContent = defaultBtnLabel;
    }

    // Ensure Razorpay SDK is ready
    const isReady = await ensureRazorpayLoaded();
    if (!isReady || typeof Razorpay === 'undefined') {
      showToast('Payment system connecting. Please check your internet connection and try again.', 'error');
      resetPayBtn();
      return;
    }

    try {
      // 1. Create order on backend (/api/create-order)
      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(price * 100), // in paise
          currency: 'INR',
          receipt: passId
        })
      });

      const orderData = await orderRes.json();
      if (!orderData.success || !orderData.order_id) {
        throw new Error(orderData.error || 'Failed to initialize payment');
      }

      // 2. Open Razorpay Checkout Modal
      const options = {
        key: orderData.key_id || config.razorpayKeyId || 'rzp_test_TmFBKDBb4nQgtD',
        amount: orderData.amount,
        currency: orderData.currency,
        name: "Jaynagar Milan Utsav 2026",
        description: `${wizardState.category === 'solo' ? 'Solo Pass' : 'Married Couple Pass'} (${qty} ${qty > 1 ? 'Tickets' : 'Ticket'})`,
        image: "assets/jmu-logo-small.webp",
        order_id: orderData.order_id,
        prefill: {
          name: wizardState.data.name || '',
          contact: wizardState.data.phone || ''
        },
        notes: {
          pass_id: passId,
          quantity: String(qty),
          category: wizardState.category
        },
        theme: {
          color: "#8B1E3F"
        },
        modal: {
          ondismiss: function () {
            showToast('Payment window closed. Click Pay Now to retry.', 'info');
            resetPayBtn();
          }
        },
        handler: async function (response) {
          if (payBtnText) {
            payBtnText.textContent = 'Confirming booking...';
          }
          showToast('Confirming your payment...', 'info');

          try {
            const passData = {
              passId: passId,
              category: wizardState.category === 'solo' 
                ? (wizardState.quantity > 1 ? `Solo Pass (${wizardState.quantity} Tickets)` : 'Solo Pass')
                : 'Married Couple Pass',
              quantity: wizardState.category === 'solo' ? (wizardState.quantity || 1) : 1,
              amount: price,
              name: wizardState.data.name,
              phone: wizardState.data.phone,
              address: wizardState.data.address || '',
              insta: '',
              partnerName: wizardState.data.partnerName || null,
              partnerPhone: wizardState.data.partnerPhone || null,
              timestamp: Date.now(),
              dateStr: config.eventDate,
              timeStr: config.eventTime,
              venue: config.venue,
              organizer: config.organizer,
              checkedIn: false,
              status: 'approved',
              paymentMethod: 'razorpay',
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id
            };

            // 3. Verify signature on backend (/api/verify-payment)
            const verifyRes = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                passData: passData
              })
            });

            const verifyData = await verifyRes.json();
            if (!verifyData.success) {
              showToast('Payment verification failed: ' + (verifyData.error || 'Invalid signature'), 'error');
              resetPayBtn();
              return;
            }

            showToast('✓ Ticket confirmed & approved!', 'success');
            handlePaymentConfirmed({
              passId: passId,
              paymentMethod: 'razorpay',
              paymentId: response.razorpay_payment_id,
              orderId: response.razorpay_order_id,
              status: 'approved'
            });
          } catch (vErr) {
            console.error('Verify error:', vErr);
            showToast('Verification error: ' + vErr.message, 'error');
            resetPayBtn();
          }
        }
      };

      const rzp = new Razorpay(options);
      rzp.on('payment.failed', function (failResp) {
        console.error('Razorpay payment failed:', failResp.error);
        const reason = (failResp.error && (failResp.error.description || failResp.error.reason)) || 'Payment was declined';
        showToast('Payment failed: ' + reason, 'error');
        resetPayBtn();
      });
      rzp.open();
    } catch (err) {
      console.error('Razorpay init error:', err);
      showToast('Error starting payment: ' + err.message, 'error');
      resetPayBtn();
    }
  };

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
  window.handlePaymentConfirmed = function (paymentMeta = {}) {
    const config = getConfig();
    const price = wizardState.amount || (wizardState.category === 'solo' ? config.pricing.solo : config.pricing.couple);
    const passId = (paymentMeta && paymentMeta.passId) || generatePassId();
    const isOnlineApproved = paymentMeta && paymentMeta.status === 'approved';

    const pass = {
      passId: passId,
      category: wizardState.category === 'solo' 
        ? (wizardState.quantity > 1 ? `Solo Pass (${wizardState.quantity} Tickets)` : 'Solo Pass')
        : 'Married Couple Pass',
      quantity: wizardState.category === 'solo' ? (wizardState.quantity || 1) : 1,
      amount: price,
      name: wizardState.data.name,
      phone: wizardState.data.phone,
      address: wizardState.data.address || '',
      insta: '',
      partnerName: wizardState.data.partnerName || null,
      partnerPhone: wizardState.data.partnerPhone || null,
      timestamp: Date.now(),
      dateStr: config.eventDate,
      timeStr: config.eventTime,
      venue: config.venue,
      organizer: config.organizer,
      checkedIn: false,
      status: isOnlineApproved ? 'approved' : 'pending',
      paymentMethod: (paymentMeta && paymentMeta.paymentMethod) || 'upi',
      razorpayOrderId: (paymentMeta && paymentMeta.orderId) || null,
      razorpayPaymentId: (paymentMeta && paymentMeta.paymentId) || null
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
    const partnerWrap = document.getElementById('pass-partner-wrap');
    const partnerNameEl = document.getElementById('pass-partner-display');
    const amountEl = document.getElementById('pass-amount-display');

    if (nameEl) nameEl.textContent = pass.name;
    if (catEl) {
      const q = Number(pass.quantity) || 1;
      catEl.textContent = `${pass.category} ${q > 1 ? `· ${q} Persons` : ''}`;
    }
    if (phoneEl) phoneEl.textContent = pass.phone;
    if (addrEl) addrEl.textContent = pass.address && pass.address.trim() ? pass.address : 'Jaynagar';
    if (amountEl) amountEl.textContent = `₹${pass.amount}/-`;

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

    // Official WhatsApp Group Button
    const joinWaBtn = document.getElementById('btn-join-whatsapp-group');
    if (joinWaBtn && config.whatsappGroupLink) {
      joinWaBtn.href = config.whatsappGroupLink;
    }

    // Update status plaque
    const plaqueSub = document.querySelector('.plaque-sub');
    if (plaqueSub) {
      plaqueSub.textContent = '✓ Approved Entry Pass';
      plaqueSub.style.color = '#10b981';
    }
  }

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

    const qtyBadge = pass.quantity && Number(pass.quantity) > 1 
      ? `<span class="badge badge-gold" style="font-size:11px; margin-left:6px;">${pass.quantity} Tickets</span>` 
      : '';

    const isApproved = pass.status === 'approved';
    const statusBadge = isApproved
      ? `<span class="badge badge-success" style="font-size:12px; padding:4px 8px;">✓ Payment Verified &amp; Approved</span>`
      : `<span class="badge badge-warning" style="font-size:12px; padding:4px 8px;">⏳ Verification Pending (Screenshot Required)</span>`;

    const gateBadge = pass.checkedIn
      ? `<span class="status-pill checked-in" style="margin-left:6px;">🚪 Admitted at Gate</span>`
      : '';

    const addrHtml = pass.address && pass.address.trim() && pass.address !== '-'
      ? `<div class="lookup-field"><span>Address:</span> <strong>${escapeHtml(pass.address)}</strong></div>`
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
          <div class="lookup-field"><span>Category:</span> <strong>${escapeHtml(pass.category)} (₹${escapeHtml(pass.amount)})</strong>${qtyBadge}</div>
          <div class="lookup-field"><span>Mobile:</span> <strong>${escapeHtml(pass.phone)}</strong></div>
          ${addrHtml}
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
    const cfgWaGroupInput = document.getElementById('cfg-whatsapp-group');
    const cfgRzpInput = document.getElementById('cfg-razorpay-key');
    if (cfgWaGroupInput) cfgWaGroupInput.value = config.whatsappGroupLink || 'https://chat.whatsapp.com/invite';
    if (cfgRzpInput) cfgRzpInput.value = config.razorpayKeyId || '';

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

    const activePasses = all.filter(r => !r.isDeleted);
    const archivedPasses = all.filter(r => Boolean(r.isDeleted));

    // Calculate metrics across active registered passes
    let totalRevenue = 0;
    let approvedCount = 0;
    let pendingCount = 0;
    let checkedInCount = 0;

    activePasses.forEach(r => {
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

    if (statTotalEl) statTotalEl.textContent = activePasses.length;
    if (statRevEl) statRevEl.textContent = `₹${totalRevenue.toLocaleString('en-IN')}`;
    if (statApprovedEl) statApprovedEl.textContent = approvedCount;
    if (statPendingEl) statPendingEl.textContent = pendingCount;
    if (statCheckedEl) statCheckedEl.textContent = checkedInCount;

    // Update filter tab counts
    const fAll = document.getElementById('filter-count-all');
    const fPending = document.getElementById('filter-count-pending');
    const fApproved = document.getElementById('filter-count-approved');
    const fChecked = document.getElementById('filter-count-checked');
    const fArchived = document.getElementById('filter-count-archived');

    if (fAll) fAll.textContent = activePasses.length;
    if (fPending) fPending.textContent = pendingCount;
    if (fApproved) fApproved.textContent = approvedCount;
    if (fChecked) fChecked.textContent = checkedInCount;
    if (fArchived) fArchived.textContent = archivedPasses.length;

    // Apply active filter
    let list = activePasses;
    if (activeAdminFilter === 'pending') {
      list = activePasses.filter(r => r.status !== 'approved');
    } else if (activeAdminFilter === 'approved') {
      list = activePasses.filter(r => r.status === 'approved');
    } else if (activeAdminFilter === 'checkedin') {
      list = activePasses.filter(r => r.checkedIn);
    } else if (activeAdminFilter === 'archived') {
      list = archivedPasses;
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
      showingCountEl.textContent = `Showing ${list.length} attendees (${activeAdminFilter})`;
    }

    renderRegistrationsTable(list);
    renderRegistrationsCards(list);
  }

  // Desktop Table Rendering
  function renderRegistrationsTable(list) {
    const tbody = document.getElementById('admin-registrations-tbody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:28px 16px; color:var(--muted);">No attendees match this filter or search query.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item) => {
      const isApproved = item.status === 'approved';
      const isArchived = Boolean(item.isDeleted);
      const cleanPhone = String(item.phone || '').replace(/[^0-9]/g, '');
      const waMsg = encodeURIComponent(`Namaste ${item.name}, Jaynagar Milan Utsav 2026 ke ticket (Pass ID: ${item.passId}) payment verification ke sambandh mein:`);
      
      return `
        <tr class="${isArchived ? 'archived-row' : ''}">
          <td>
            <strong style="font-family:var(--font-mono, monospace); color:var(--gold); font-size:13.5px;">${escapeHtml(item.passId)}</strong>
          </td>
          <td>
            <strong style="color:#fff;">${escapeHtml(item.name)}</strong>
            ${item.partnerName ? `<div style="font-size:12px; color:var(--gold); margin-top:2px;">+ ${escapeHtml(item.partnerName)}</div>` : ''}
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">${escapeHtml(item.address || '-')}</div>
          </td>
          <td>
            <span class="badge ${item.category && item.category.includes('Couple') ? 'badge-gold' : 'badge-wine'}">${escapeHtml(item.category || 'Solo')}</span>
            <div style="font-size:12px; font-weight:600; color:var(--gold); margin-top:3px;">₹${escapeHtml(item.amount || '249')} · ${item.quantity || 1} Ticket(s)</div>
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
            ${isArchived 
              ? `<span class="badge badge-danger">🗑️ Archived</span>`
              : (isApproved ? `<span class="badge badge-success">✓ Approved</span>` : `<span class="badge badge-warning">⏳ Pending</span>`)
            }
          </td>
          <td>
            <span class="status-pill ${item.checkedIn ? 'checked-in' : 'pending'}">
              ${item.checkedIn ? '🚪 Admitted' : 'Pending'}
            </span>
            ${item.checkedIn && item.checkInTime ? `<div style="font-size:10px; color:var(--muted); margin-top:2px;">${escapeHtml(item.checkInTime)}</div>` : ''}
          </td>
          <td>
            <div class="admin-actions-cell">
              ${isArchived ? `
                <button type="button" class="button small" style="padding:4px 10px; font-size:11px; min-height:28px; background:#10b981; border-color:#10b981; color:#fff;" onclick="adminRestorePass('${escapeHtml(item.passId)}', '${escapeHtml(item.name)}')">
                  ↩️ Restore
                </button>
              ` : `
                ${isApproved
                  ? `<button type="button" class="button outline small" style="padding:4px 8px; font-size:11px; min-height:28px;" onclick="adminMarkPendingPass('${escapeHtml(item.passId)}')">Undo Appr</button>`
                  : `<button type="button" class="button small" style="padding:4px 8px; font-size:11px; min-height:28px; background:#10b981; border-color:#10b981; color:#fff;" onclick="adminApprovePass('${escapeHtml(item.passId)}')">✓ Approve</button>`
                }
                <button type="button" class="button small" style="padding:4px 8px; font-size:11px; min-height:28px; background:var(--ink-2);" onclick="toggleCheckIn('${escapeHtml(item.passId)}')">
                  ${item.checkedIn ? 'Undo Entry' : '🚪 Admit'}
                </button>
                <button type="button" class="button small" style="padding:4px 8px; font-size:11px; min-height:28px; background:rgba(239,68,68,0.15); border-color:rgba(239,68,68,0.3); color:#ef4444;" onclick="adminDeletePass('${escapeHtml(item.passId)}', '${escapeHtml(item.name)}')">
                  🗑️ Archive
                </button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Mobile Cards Rendering (Phone Optimized touch UI)
  function renderRegistrationsCards(list) {
    const container = document.getElementById('admin-registrations-cards');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:28px 16px; color:var(--muted); background:#111714; border-radius:10px; border:1px solid var(--line);">No attendees found in this tab.</div>`;
      return;
    }

    container.innerHTML = list.map(item => {
      const isApproved = item.status === 'approved';
      const isArchived = Boolean(item.isDeleted);
      const cleanPhone = String(item.phone || '').replace(/[^0-9]/g, '');
      const waMsg = encodeURIComponent(`Namaste ${item.name}, Jaynagar Milan Utsav 2026 ke ticket (${item.passId}) ke sambandh mein:`);
      const qty = item.quantity || 1;

      return `
        <div class="admin-attendee-card ${item.checkedIn ? 'admitted' : ''} ${isArchived ? 'archived' : ''}">
          <div class="aac-header">
            <span class="aac-pass-id">${escapeHtml(item.passId)}</span>
            <div class="aac-badges">
              ${isArchived 
                ? `<span class="badge badge-danger">🗑️ Archived</span>` 
                : (isApproved ? `<span class="badge badge-success">✓ Approved</span>` : `<span class="badge badge-warning">⏳ Pending</span>`)
              }
              ${item.checkedIn ? `<span class="status-pill checked-in">🚪 Admitted</span>` : ''}
            </div>
          </div>

          <div class="aac-body">
            <div class="aac-name">${escapeHtml(item.name)}</div>
            ${item.partnerName ? `<div class="aac-partner">👫 Spouse: ${escapeHtml(item.partnerName)}</div>` : ''}
            <div class="aac-meta">
              <span class="aac-meta-category">${escapeHtml(item.category || 'Solo')} · ${qty} ${qty > 1 ? 'Tickets' : 'Ticket'}</span>
              <span class="aac-meta-amount">₹${escapeHtml(item.amount || '249')}</span>
            </div>
            ${item.address && item.address.trim() && item.address !== '-' ? `<div style="font-size:11.5px; color:var(--muted);">📍 ${escapeHtml(item.address)}</div>` : ''}
            ${item.checkedIn && item.checkInTime ? `<div style="font-size:11.5px; color:#38bdf8; font-weight:700;">🚪 Admitted at: ${escapeHtml(item.checkInTime)}</div>` : ''}
          </div>

          ${cleanPhone ? `
            <div class="aac-contact-row">
              <a href="tel:${escapeHtml(item.phone)}" class="aac-contact-btn phone">
                📞 Call Attendee
              </a>
              <a href="https://wa.me/91${cleanPhone}?text=${waMsg}" target="_blank" rel="noopener noreferrer" class="aac-contact-btn whatsapp">
                💬 WhatsApp
              </a>
            </div>
          ` : ''}

          <div class="aac-actions-row">
            ${isArchived ? `
              <button type="button" class="aac-action-btn" style="background:#10b981; border-color:#10b981; color:#fff; grid-column:span 3;" onclick="adminRestorePass('${escapeHtml(item.passId)}', '${escapeHtml(item.name)}')">
                ↩️ Restore to Active Roster
              </button>
            ` : `
              ${isApproved
                ? `<button type="button" class="aac-action-btn" style="background:var(--ink-2); color:var(--muted); border-color:var(--line);" onclick="adminMarkPendingPass('${escapeHtml(item.passId)}')">Undo Appr</button>`
                : `<button type="button" class="aac-action-btn" style="background:#10b981; border-color:#10b981; color:#fff;" onclick="adminApprovePass('${escapeHtml(item.passId)}')">✓ Approve</button>`
              }
              <button type="button" class="aac-action-btn" style="background:${item.checkedIn ? 'rgba(56,189,248,0.2)' : 'var(--ink-2)'}; border-color:${item.checkedIn ? '#38bdf8' : 'var(--line)'}; color:${item.checkedIn ? '#38bdf8' : '#fff'};" onclick="toggleCheckIn('${escapeHtml(item.passId)}')">
                ${item.checkedIn ? 'Undo Entry' : '🚪 Admit'}
              </button>
              <button type="button" class="aac-action-btn" style="background:rgba(239,68,68,0.15); border-color:rgba(239,68,68,0.3); color:#ef4444;" onclick="adminDeletePass('${escapeHtml(item.passId)}', '${escapeHtml(item.name)}')">
                🗑️ Archive
              </button>
            `}
          </div>
        </div>
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
    showToast(`✓ Pass ${passId} Approved!`, 'success');

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
    showToast(`Pass ${passId} marked as Pending`, 'info');

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

  // Admin Soft Delete (Archive) Action - Data is NEVER permanently destroyed
  window.adminDeletePass = async function (passId, attendeeName) {
    const config = getConfig();
    const confirmed = confirm(`Are you sure you want to archive attendee "${attendeeName || passId}" (${passId})?\n\nThis will safely move them to the Archived tab. The ticket and payment records remain 100% safe in the database and can be restored at any time.`);
    if (!confirmed) return;

    let item = adminPassesCache.find(r => r.passId === passId) || getRegistrations().find(r => r.passId === passId);
    if (item) {
      item.isDeleted = true;
      item.deletedAt = new Date().toISOString();
      saveRegistration(item);
    }
    renderAdminData();
    showToast(`🗑️ Attendee ${passId} moved to Archive`, 'info');

    try {
      await fetch('/api/all-passes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': config.adminPin
        },
        body: JSON.stringify({ action: 'delete', passId })
      });
    } catch (err) {
      console.warn('Cloud archive error:', err);
    }
  };

  // Admin Restore Action - Recovers accidentally deleted attendees
  window.adminRestorePass = async function (passId, attendeeName) {
    const config = getConfig();
    let item = adminPassesCache.find(r => r.passId === passId) || getRegistrations().find(r => r.passId === passId);
    if (item) {
      item.isDeleted = false;
      item.deletedAt = null;
      saveRegistration(item);
    }
    renderAdminData();
    showToast(`✓ Attendee ${passId} restored to active roster!`, 'success');

    try {
      await fetch('/api/all-passes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': config.adminPin
        },
        body: JSON.stringify({ action: 'restore', passId })
      });
    } catch (err) {
      console.warn('Cloud restore sync error:', err);
    }
  };

  // Gate Check-in verification terminal with duplicate detection & 1-tap admission
  window.handleGateTerminalSubmit = async function (e) {
    if (e) e.preventDefault();
    const input = document.getElementById('gate-pass-input');
    const query = input ? input.value.trim().toUpperCase() : '';
    const feedbackEl = document.getElementById('gate-terminal-feedback');
    const config = getConfig();

    if (!query) return;

    if (feedbackEl) {
      feedbackEl.style.display = 'block';
      feedbackEl.innerHTML = `<div style="text-align:center; padding:12px; color:var(--gold);">Verifying Ticket ID...</div>`;
    }

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
        feedbackEl.style.display = 'block';
        feedbackEl.innerHTML = `
          <div style="background:rgba(239,68,68,0.15); border:2px solid #ef4444; border-radius:10px; padding:16px; text-align:center;">
            <div style="font-size:30px; margin-bottom:4px;">❌</div>
            <strong style="color:#ef4444; font-size:16px; display:block; letter-spacing:0.02em;">TICKET NOT FOUND / INVALID</strong>
            <p style="color:var(--snow); font-size:13px; margin:6px 0 0;">Code "${escapeHtml(query)}" is not registered in the system roster.</p>
          </div>
        `;
      }
      return;
    }

    const qty = Number(match.quantity) || 1;
    const isApproved = match.status === 'approved';

    // Duplicate Entry Check: Has this ticket already entered?
    if (match.checkedIn) {
      if (feedbackEl) {
        feedbackEl.style.display = 'block';
        feedbackEl.innerHTML = `
          <div style="background:rgba(239,68,68,0.22); border:2px solid #ef4444; border-radius:10px; padding:18px; text-align:center;">
            <div style="font-size:32px; margin-bottom:4px;">🚫</div>
            <strong style="color:#f87171; font-size:17px; display:block; letter-spacing:0.02em;">ENTRY DENIED — ALREADY CHECKED IN!</strong>
            <p style="color:#fca5a5; font-size:13px; margin:6px 0 12px; font-weight:600;">Duplicate Entry Alert! This ticket was already admitted at the gate.</p>
            <div style="background:rgba(0,0,0,0.5); border-radius:8px; padding:12px 16px; font-size:13px; text-align:left; color:#fff; display:inline-block; min-width:260px;">
              <div><strong>Pass ID:</strong> <span style="color:var(--gold); font-family:var(--font-mono);">${escapeHtml(match.passId)}</span></div>
              <div><strong>Attendee:</strong> ${escapeHtml(match.name)}</div>
              <div><strong>Allowed Persons:</strong> ${qty} ${qty > 1 ? 'Persons' : 'Person'}</div>
              <div><strong>Admitted At:</strong> <span style="color:#fbbf24; font-weight:700;">${escapeHtml(match.checkInTime || 'Earlier today')}</span></div>
            </div>
            <div style="margin-top:14px;">
              <button type="button" class="button dark small" onclick="toggleCheckIn('${escapeHtml(match.passId)}')">Undo Check-In (Allow Re-Entry)</button>
            </div>
          </div>
        `;
      }
      return;
    }

    // Valid Ticket - Ready for Check-in
    if (feedbackEl) {
      feedbackEl.style.display = 'block';
      feedbackEl.innerHTML = `
        <div style="background:rgba(16,185,129,0.15); border:2px solid #10b981; border-radius:10px; padding:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <span style="background:${isApproved ? '#10b981' : '#f59e0b'}; color:#000; font-weight:800; font-size:11px; padding:3px 8px; border-radius:4px; text-transform:uppercase;">
                ${isApproved ? '✓ VALID & APPROVED' : '⚠️ PENDING CASH VERIFICATION'}
              </span>
              <h4 style="margin:8px 0 4px; font-size:18px; color:#fff;">${escapeHtml(match.name)}</h4>
              <div style="font-size:13px; color:var(--gold);">
                <strong>Pass ID:</strong> <span style="font-family:var(--font-mono);">${escapeHtml(match.passId)}</span> · <strong>${escapeHtml(match.category)}</strong>
              </div>
              ${match.partnerName ? `<div style="font-size:12px; color:var(--muted); margin-top:2px;">Partner: ${escapeHtml(match.partnerName)}</div>` : ''}
              <div style="font-size:13.5px; color:var(--snow); margin-top:6px;">
                🎟️ <strong>Admit Allowed:</strong> <span style="font-size:16px; font-weight:800; color:#38bdf8;">${qty} ${qty > 1 ? 'Persons' : 'Person'}</span>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:18px; font-weight:700; color:var(--gold); margin-bottom:8px;">₹${escapeHtml(match.amount)}</div>
              <button type="button" class="button" style="background:#10b981; border-color:#10b981; color:#fff; font-weight:800; padding:10px 18px;" onclick="confirmGateAdmit('${escapeHtml(match.passId)}')">
                ✅ CONFIRM CHECK-IN &amp; ALLOW ENTRY (${qty} ${qty > 1 ? 'Pax' : 'Pax'})
              </button>
            </div>
          </div>
        </div>
      `;
    }
  };

  // Confirm Gate Admission
  window.confirmGateAdmit = async function (passId) {
    const config = getConfig();
    let match = adminPassesCache.find(r => r.passId === passId) || getRegistrations().find(r => r.passId === passId);
    if (!match) return;

    match.checkedIn = true;
    match.checkInTime = new Date().toLocaleTimeString('en-IN');
    saveRegistration(match);
    renderAdminData();

    const feedbackEl = document.getElementById('gate-terminal-feedback');
    if (feedbackEl) {
      feedbackEl.style.display = 'block';
      feedbackEl.innerHTML = `
        <div style="background:rgba(16,185,129,0.25); border:2px solid #10b981; border-radius:10px; padding:16px; text-align:center;">
          <div style="font-size:30px; margin-bottom:4px;">🎉</div>
          <strong style="color:#10b981; font-size:17px; display:block;">ENTRY CONFIRMED &amp; ADMITTED!</strong>
          <p style="margin:6px 0 0; font-size:13px; color:#fff;">Attendee <strong>${escapeHtml(match.name)}</strong> (${match.quantity || 1} Persons) admitted at ${match.checkInTime}.</p>
        </div>
      `;
    }
    const input = document.getElementById('gate-pass-input');
    if (input) input.value = '';
    showToast(`✓ Admitted: ${passId}`, 'success');

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
      console.warn('Checkin sync error:', err);
    }
  };

  // Clear Gate Terminal Input & Feedback
  window.clearGateInput = function () {
    const input = document.getElementById('gate-pass-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    const feedbackEl = document.getElementById('gate-terminal-feedback');
    if (feedbackEl) {
      feedbackEl.style.display = 'none';
      feedbackEl.innerHTML = '';
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
      "Tickets Count",
      "Amount",
      "Attendee Name",
      "Mobile",
      "Address",
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
      safeCsvCell(item.quantity || 1),
      safeCsvCell(item.amount),
      safeCsvCell(item.name),
      safeCsvCell(item.phone),
      safeCsvCell(item.address),
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
    const waGroup = (document.getElementById('cfg-whatsapp-group')?.value || '').trim();
    const rzpKey = (document.getElementById('cfg-razorpay-key')?.value || '').trim();

    saveConfigOverride({
      whatsappGroupLink: waGroup,
      razorpayKeyId: rzpKey
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
