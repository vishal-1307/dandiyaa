/**
 * Jaynagar Milan Utsav 2026 - Main Application Logic
 * Organised by Motion Arts Academy
 * Server-authoritative registration, payment verification and gate admission
 */

(function () {
  'use strict';

const DEFAULT_CONFIG = {
    eventName: 'Jaynagar Milan Utsav 2026', eventTagline: 'Dandiya & Jhijhiya Special Night',
    eventDate: 'Monday, 19 October 2026', eventTime: '6:00 PM – 10:00 PM',
    eventTimestamp: new Date('2026-10-19T18:00:00+05:30').getTime(),
    venue: 'Marwadi Vivah Bhavan, Jaynagar', organizer: 'Motion Arts Academy',
    whatsappNumber: '917050551310', whatsappGroupLink: 'https://chat.whatsapp.com/FJt21SRONmx3cnrgsd2QK0?s=sh&p=a&mlu=4&ilr=4&iam=0',
    pricing: { solo: JmuPricing.CATALOG.solo/100, couple: JmuPricing.CATALOG.couple/100 }
  };
  function safeGroup(value) {
    try { const url=new URL(value); return url.protocol==='https:' && url.hostname==='chat.whatsapp.com' && !url.username && !url.password && /^\/[A-Za-z0-9]{16,64}\/?$/.test(url.pathname) ? url.href : null; } catch { return null; }
  }
  function getConfig() {
    try {
      const saved=JSON.parse(localStorage.getItem('jmu_config_override')||'{}');
      const link=safeGroup(saved.whatsappGroupLink);
      return { ...DEFAULT_CONFIG, ...(link ? { whatsappGroupLink:link } : {}) };
    } catch { return DEFAULT_CONFIG; }
  }
  function saveConfigOverride(overrides) {
    const link=safeGroup(overrides.whatsappGroupLink);
    if (!link) throw new Error('Use an official HTTPS WhatsApp group link');
    localStorage.setItem('jmu_config_override',JSON.stringify({whatsappGroupLink:link}));
  }
  async function apiRequest(url,options={}) {
    let response,data;
    try { response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options}); }
    catch { const error=new Error('Could not reach the booking server. Check your connection before retrying; if you paid, do not pay again.');error.code='API_NETWORK_FAILURE';throw error; }
    try { data=await response.json();if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid response envelope'); }
    catch { const error=new Error('The booking server returned an unexpected response. Please contact the organizer; if you paid, do not pay again.');error.code='API_INVALID_RESPONSE';throw error; }
    if (!response.ok || !data.success) {
      const error=new Error(data.error||'Request could not be completed'); error.status=response.status; error.code=data.code; throw error;
    }
    return data;
  }
  function bookingKey() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function resetPricingNote(){
    const note=document.getElementById('reg-pricing-detail'),promotion=JmuPricing.EARLY_BIRD;
    if(note)note.textContent='Final price confirmed at checkout.';
    const offer=document.getElementById('reg-early-bird-offer');
    if(offer)offer.style.display=promotion.enabled&&wizardState.category==='solo'?'block':'none';
    const copy=document.getElementById('reg-early-bird-copy');
    if(copy)copy.textContent='₹'+promotion.unitPrice/100+' per person for the first '+promotion.limit+' solo attendees.';
    const policy=document.getElementById('reg-reservation-policy');
    if(policy)policy.textContent='Promotional reservations last '+promotion.reservationMinutes+' minutes. Payment must be verified before expiry. Late payments require organizer review/refund and do not guarantee admission. If debited, do not pay again.';
    const caption=document.getElementById('reg-price-caption');if(caption)caption.textContent='Regular-price estimate';
    const feedback=document.getElementById('reg-payment-feedback');if(feedback){feedback.textContent='';feedback.hidden=true;}
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
    amount: JmuPricing.CATALOG.solo / 100,
    data: {
      name: '',
      phone: '',
      address: '',
      partnerName: '',
      partnerPhone: ''
    },
    currentPass: null
  };

function getMyPasses() {
    try { const values=JSON.parse(localStorage.getItem('jmu_owner_tokens_v2')||'[]');
      return Array.isArray(values) ? values.filter(p=>/^JMU-[A-Z0-9]{4,60}$/.test(p.passId)&&/^[A-Za-z0-9_-]{43}$/.test(p.recoveryToken)) : [];
    } catch { return []; }
  }
  function saveOwnerAccess(passId,recoveryToken,ticketId=null) {
    const entries=getMyPasses().filter(p=>p.passId!==passId&&(!ticketId||(p.passId!==ticketId&&p.ticketId!==ticketId)));
    entries.unshift({passId,recoveryToken,...(ticketId?{ticketId}:{})});
    localStorage.setItem('jmu_owner_tokens_v2',JSON.stringify(entries.slice(0,20)));
  }
  function ownerOptions(passId) {
    const access=getMyPasses().find(p=>p.passId===passId||p.ticketId===passId);
    if (!access) throw new Error('Ask the organizer for a private recovery link for this ticket');
    return { headers: { Authorization:'Bearer '+access.recoveryToken } };
  }
  const visibleTicketId = pass => pass.ticketId || (pass.status==='approved' ? pass.passId : 'Payment confirmation pending');
  function pendingDetails(passId,value){
    // Only this customer's in-progress form, in this tab. No unpaid PII in the DB.
    const key='jmu_pending_details_v1:'+passId;
    if(value){sessionStorage.setItem(key,JSON.stringify(value));return value;}
    try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}
  }

  // Open Registration Modal
  window.openRegistrationModal = function (preferredCategory = 'solo') {
    if (checkoutBusy) return;
    wizardState.category = preferredCategory;
    wizardState.step = 1;
    wizardState.quantity = 1;

    const modal = document.getElementById('reg-modal');
    if (!modal) return;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
    const content=document.querySelector('#reg-modal .modal-content');if(content)content.scrollTop=0;

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

  // Presentation only. The server independently validates quantity and pricing.
  const SOLO_MIN_QUANTITY = JmuPricing.BOOKING_LIMITS.solo.min;
  const SOLO_MAX_QUANTITY = JmuPricing.BOOKING_LIMITS.solo.max;
  function renderSoloQuantity() {
    const value = document.getElementById('solo-quantity-value');
    const decrease = document.getElementById('solo-quantity-decrease');
    const increase = document.getElementById('solo-quantity-increase');
    if (value) value.textContent = String(wizardState.quantity);
    if (decrease) decrease.disabled = checkoutBusy || wizardState.quantity <= SOLO_MIN_QUANTITY;
    if (increase) increase.disabled = checkoutBusy || wizardState.quantity >= SOLO_MAX_QUANTITY;
  }
  window.setSoloQuantity = function (qty) {
    if (checkoutBusy || wizardState.category !== 'solo' || !Number.isSafeInteger(qty) ||
        qty < SOLO_MIN_QUANTITY || qty > SOLO_MAX_QUANTITY) return;
    resetPricingNote();
    const config = getConfig();
    const cleanQty = qty;
    wizardState.quantity = cleanQty;
    renderSoloQuantity();

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
  window.stepSoloQuantity = function (direction) {
    if (direction !== -1 && direction !== 1) return;
    window.setSoloQuantity(wizardState.quantity + direction);
  };

  function updateCategorySelection(category) {
    if (checkoutBusy) return;
    wizardState.category = category;
    resetPricingNote();
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
      renderSoloQuantity();
      const price = config.pricing.couple;
      wizardState.amount = price;

      if (summaryAmount) summaryAmount.textContent = `₹${price}`;
      if (summaryCat) summaryCat.textContent = 'Couple Pass (Married Couple)';
      if (proceedBtnText) proceedBtnText.textContent = `Pay Now · ₹${price} ➔`;
    } else {
      if (coupleFields) coupleFields.style.display = 'none';
      if (soloQtyGroup) soloQtyGroup.style.display = 'block';
      window.setSoloQuantity(wizardState.quantity);
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
    if (checkoutBusy) return;

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
    return startRazorpayPayment();
  };

  // SDK failure is distinct from order/API failures and happens before allocation.
  function ensureRazorpayLoaded() {
    return JmuCheckoutSDK.load();
  }

  // Direct Razorpay Gateway Checkout Launcher
let checkoutBusy=false;
  function lockBookingControls(locked) {
    checkoutBusy=locked;
    for(const id of ['cat-btn-solo','cat-btn-couple','reg-name','reg-phone','reg-address','reg-partner-name','reg-partner-phone']){
      const control=document.getElementById(id);if(control)control.disabled=locked;
    }
    renderSoloQuantity();
  }
  window.startRazorpayPayment = async function () {
    if(checkoutBusy) return;
    lockBookingControls(true);
    const button=document.getElementById('btn-proceed-pay');
    const label=document.getElementById('btn-proceed-pay-text');
    const input={category:wizardState.category,quantity:wizardState.category==='couple'?1:wizardState.quantity,
      ...wizardState.data};
    const reset=()=>{lockBookingControls(false);if(button)button.disabled=false;if(label)label.textContent='Pay Now · ₹'+wizardState.amount+' ➔';};
    if(button)button.disabled=true;
    const feedback=document.getElementById('reg-payment-feedback');if(feedback){feedback.textContent='';feedback.hidden=true;}
    if(label)label.textContent='Loading secure checkout...';
    try {
      await ensureRazorpayLoaded();
      if(label)label.textContent='Confirming your price...';
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)))),b=>b.toString(16).padStart(2,'0')).join('');
      let attempt;
      try { attempt=JSON.parse(localStorage.getItem('jmu_booking_attempt_v2')||'null'); } catch {}
      if(!attempt || attempt.fingerprint!==fingerprint) attempt={fingerprint,key:bookingKey()};
      localStorage.setItem('jmu_booking_attempt_v2',JSON.stringify(attempt));
      const booking=await apiRequest('/api/create-order',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...input,idempotencyKey:attempt.key})});
      saveOwnerAccess(booking.passId,booking.recoveryToken);
      const details=pendingDetails(booking.passId,{...input,idempotencyKey:attempt.key});
      const quote=booking.pricing;
      const detail=document.getElementById('reg-pricing-detail');
      if(detail&&quote){
        const breakdown=[];
        if(quote.promotionalQuantity)breakdown.push(quote.promotionalQuantity+' early-bird × ₹'+quote.promotionalUnitPaise/100);
        if(quote.regularQuantity)breakdown.push(quote.regularQuantity+' regular × ₹'+quote.regularUnitPaise/100);
        detail.textContent=breakdown.join(' + ')+' = ₹'+booking.amount/100+(booking.promotionExpiresAt?
          '. Reserved until '+new Date(booking.promotionExpiresAt).toLocaleTimeString()+'. See checkout timing.':'');
      }
      const summary=document.getElementById('reg-summary-amount');if(summary)summary.textContent='₹'+booking.amount/100;
      const caption=document.getElementById('reg-price-caption');if(caption)caption.textContent='Confirmed checkout total';
      wizardState.amount=booking.amount/100;
      if(label)label.textContent='Pay Now · ₹'+wizardState.amount+' ➔';
      const existing=await apiRequest('/api/get-pass?id='+encodeURIComponent(booking.passId),ownerOptions(booking.passId));
      if(existing.pass.status==='approved') { handlePaymentConfirmed(existing.pass); reset(); return; }
      if(existing.pass.awaitingDetails&&existing.pass.paymentState==='verified'){
        const completed=await apiRequest('/api/verify-payment',{method:'POST',headers:{'Content-Type':'application/json',...ownerOptions(booking.passId).headers},
          body:JSON.stringify({passId:booking.passId,resume:true,bookingDetails:details})});
        handlePaymentConfirmed(completed.pass);reset();return;
      }
      const options={key:booking.key_id,order_id:booking.order_id,amount:booking.amount,currency:booking.currency,
        name:'Jaynagar Milan Utsav 2026',description:input.category==='couple'?'Married Couple Pass':
          'Solo · '+(quote?.promotionalQuantity||0)+' early-bird + '+(quote?.regularQuantity??input.quantity)+' regular',
        image:'assets/jmu-logo-small.webp',prefill:{name:input.name,contact:input.phone},theme:{color:'#8B1E3F'},
        modal:{ondismiss:()=>{showToast('Checkout closed. If you already paid, refresh My Pass; do not pay again.');reset();}},
        handler:async response=>{
          if(label)label.textContent='Confirming payment...';
          try {
            const verified=await apiRequest('/api/verify-payment',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+booking.recoveryToken},
              body:JSON.stringify({passId:booking.passId,razorpay_order_id:response.razorpay_order_id,
                razorpay_payment_id:response.razorpay_payment_id,razorpay_signature:response.razorpay_signature,bookingDetails:details})});
            handlePaymentConfirmed(verified.pass);
          } catch(error) { showToast('Confirmation pending: '+error.message+'. Refresh My Pass or contact the organizer. Do not pay again.','error'); }
          finally { reset(); }
        }};
      const checkout=new Razorpay(options);
      // Keep this frozen booking locked while Razorpay still owns an open modal.
      checkout.on('payment.failed',()=>{showToast('Payment was not completed. Check your payment app before retrying.','error');});
      checkout.open();
    } catch(error) {
      if(feedback){feedback.textContent=error.message;feedback.hidden=false;}
      showToast(error.message,'error');reset();
      if(error.code==='PROMOTION_EXPIRED'&&confirm('The promotional reservation expired. If money was debited, do not pay again—contact the organizer for review/refund. Only if NO payment was made, start a new booking?')){
        localStorage.removeItem('jmu_booking_attempt_v2');showToast('New booking enabled. Press Pay Now to request a fresh server quote.');
      }
      if(error.code==='CHECKOUT_PENDING'&&confirm('The previous checkout could not be recovered yet. If a payment window opened or money was debited, do NOT start again. Only if NO payment window opened and NO payment was made, start a separate fresh checkout?')){
        localStorage.removeItem('jmu_booking_attempt_v2');showToast('Fresh checkout enabled. Press Pay Now for a new server-confirmed price.');
      }
    }
  };
  window.handlePaymentConfirmed = function (pass) {
    if(!pass || pass.status!=='approved' || pass.isDeleted) { showToast('Server confirmation required before a ticket can be issued','error'); return; }
    const access=getMyPasses().find(p=>p.passId===pass.passId);if(access)saveOwnerAccess(pass.passId,access.recoveryToken,pass.ticketId);
    sessionStorage.removeItem('jmu_pending_details_v1:'+pass.passId);
    wizardState.currentPass=pass;
    renderStep3Pass(pass);setWizardStep(3);showToast('Your payment is verified and your ticket is ready','success');
  };

  // Step 3: Render Digital Pass Plaque & Setup WhatsApp Submission
function renderStep3Pass(pass) {
    const values={'pass-name-display':pass.name,'pass-cat-display':pass.category+' · '+pass.capacity+' persons',
      'pass-partner-display':pass.partnerName,'pass-amount-display':'₹'+pass.amount+'/-','pass-code-display':visibleTicketId(pass)};
    for(const [id,value] of Object.entries(values)){const element=document.getElementById(id);if(element)element.textContent=value||'';}
    const partner=document.getElementById('pass-partner-wrap');if(partner)partner.style.display=pass.partnerName?'block':'none';
    for(const id of ['pass-phone-wrap','pass-addr-wrap']){const element=document.getElementById(id);if(element)element.style.display='none';}
    const approved=pass.status==='approved'&&!pass.isDeleted&&!pass.awaitingDetails;
    const status=document.querySelector('.plaque-sub');if(status)status.textContent=approved?'✓ Verified Entry Pass':'Confirmation required';
    const badge=document.getElementById('pass-payment-status');if(badge)badge.textContent=approved?'✓ Payment Verified':'Not eligible for admission';
    const canvas=document.getElementById('pass-ticket-qr');
    if(canvas && approved && window.QRCode) window.QRCode.toCanvas(canvas,pass.passId,{width:164,margin:2,errorCorrectionLevel:'M'},error=>{if(error)showToast('Could not render QR; use the Ticket ID at the gate','error');});
    const link=document.getElementById('btn-join-whatsapp-group');const group=safeGroup(getConfig().whatsappGroupLink);
    if(link){link.hidden=!approved||!group;link.style.display=approved&&group?'flex':'none';if(approved&&group)link.href=group;else link.removeAttribute('href');}
  }

  // Copy Pass ID
  window.copyCurrentPassId = function () {
    if (wizardState.currentPass && wizardState.currentPass.passId) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(visibleTicketId(wizardState.currentPass)).then(() => {
          showToast('✓ Pass ID copied: ' + visibleTicketId(wizardState.currentPass), 'success');
        });
      } else {
        prompt('Copy Pass ID:', visibleTicketId(wizardState.currentPass));
      }
    }
  };

  // Download Pass as Image via html2canvas
  window.downloadPassAsImage = function () {
    if(!wizardState.currentPass||wizardState.currentPass.status!=='approved'||wizardState.currentPass.isDeleted||wizardState.currentPass.awaitingDetails){showToast('Complete verified payment before downloading a ticket','error');return;}
    const passCard = document.getElementById('digital-pass-card');
    if (!passCard) return;

    showToast('Generating high-res Pass image...', 'info');

    if (window.html2canvas) {
      return window.html2canvas(passCard, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#111714',
        logging: false
      }).then(canvas => {
        const link = document.createElement('a');
        link.download = `${wizardState.currentPass ? visibleTicketId(wizardState.currentPass) : 'JMU'}-Digital-Pass.png`;
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

  async function retrieveOwnPass(id){
    const access=getMyPasses().find(p=>p.passId===id||p.ticketId===id);
    let data=await apiRequest('/api/get-pass?id='+encodeURIComponent(id),ownerOptions(id));
    const details=pendingDetails(data.pass.passId);
    if(data.pass.awaitingDetails&&details&&['pending','verified'].includes(data.pass.paymentState)){
      try{data=await apiRequest('/api/verify-payment',{
        method:'POST',headers:{'Content-Type':'application/json',...ownerOptions(id).headers},
        body:JSON.stringify({passId:data.pass.passId,resume:true,bookingDetails:details})});}
      catch(error){if(error.code!=='PAYMENT_PENDING')throw error;}
    }
    if(access)saveOwnerAccess(data.pass.passId,access.recoveryToken,data.pass.ticketId);
    if(data.pass.status==='approved'&&!data.pass.awaitingDetails)sessionStorage.removeItem('jmu_pending_details_v1:'+data.pass.passId);
    return data.pass;
  }
window.openMyPassModal=async function(preferredId=null){
    document.getElementById('mypass-modal')?.classList.add('active');document.body.classList.add('modal-open');
    const entries=getMyPasses(),saved=(preferredId?entries.find(p=>p.passId===preferredId||p.ticketId===preferredId):null)||entries.find(p=>p.ticketId)||entries[0];
    const input=document.getElementById('mypass-search-input');if(input)input.value=saved?.ticketId||(preferredId||'');
    const results=document.getElementById('mypass-results');if(results)results.textContent=saved?'Checking your saved ticket...':'Use the same booking browser to find your ticket. On another device, contact the organizer for a private recovery link.';
    if(saved)try{
      const pass=await retrieveOwnPass(saved.passId);
      if(pass.ticketId&&input)input.value=pass.ticketId;
      renderLookupResult(pass);
    }catch(error){if(results)results.textContent=error.message;}
  };
  window.closeMyPassModal=function(){document.getElementById('mypass-modal')?.classList.remove('active');document.body.classList.remove('modal-open');};
  window.handleMyPassSearch=async function(event){
    event?.preventDefault();
    const id=(document.getElementById('mypass-search-input')?.value||'').trim().toUpperCase();
    const results=document.getElementById('mypass-results');
    try {
      if(!/^JMU-[A-Z0-9]{4,60}$/.test(id))throw new Error('Enter a valid Ticket ID');
      if(results)results.textContent='Checking the official ticket record...';
      renderLookupResult(await retrieveOwnPass(id));
    }catch(error){if(results)results.textContent=error.message;showToast(error.message,'error');}
  };
  function renderLookupResult(pass){
    const container=document.getElementById('mypass-results');if(!container)return;
    container.replaceChildren();
    const card=document.createElement('div');card.className='lookup-pass-card';
    for(const line of [visibleTicketId(pass),pass.name,pass.category+' · '+pass.capacity+' persons · ₹'+pass.amount,
      pass.isDeleted?'Ticket archived':pass.status==='approved'?'Payment verified':pass.awaitingDetails&&pass.paymentState==='verified'?
        'Payment verified. Return to the same booking form to finish your original ticket details.':pass.paymentState==='review_required'?
        'Promotional reservation expired. Payment requires organizer review/refund; this ticket cannot be admitted. Do not pay again.':'Your ticket will appear after payment is verified. If already debited, do not pay again; refresh My Pass.',
      pass.checkedIn?'Already admitted at gate':'Not checked in',pass.dateStr+' · '+pass.timeStr]){
      card.appendChild(JmuSecurityUI.textElement(document,'p',line));
    }
    if(pass.status==='approved'&&!pass.isDeleted&&!pass.awaitingDetails){
      const actions=document.createElement('div');actions.className='lookup-pass-actions';
      for(const [label,download] of [['Show Digital Pass',false],['Download Ticket',true]]){
        const button=JmuSecurityUI.textElement(document,'button',label,'button small');button.type='button';
        button.addEventListener('click',()=>{
          if(checkoutBusy){showToast('Close the active payment window before opening this ticket');return;}
          closeMyPassModal();openRegistrationModal(pass.category.includes('Couple')?'couple':'solo');handlePaymentConfirmed(pass);
          if(download)return downloadPassAsImage();
        });actions.appendChild(button);
      }
      card.appendChild(actions);
    }
    container.appendChild(card);
  }

let adminPassesCache=[];
  let activeAdminFilter='all';
  let adminCsrf=null;
  let expiryTimer=null;
  function clearAdmin(){adminCsrf=null;adminPassesCache=[];clearTimeout(expiryTimer);renderAdminData();showAdminLogin();}
  function showAdminLogin(){const login=document.getElementById('admin-login-view'),dash=document.getElementById('admin-dashboard-view');if(login)login.style.display='block';if(dash)dash.style.display='none';}
  async function showAdminDashboard(){const login=document.getElementById('admin-login-view'),dash=document.getElementById('admin-dashboard-view');if(login)login.style.display='none';if(dash)dash.style.display='block';await fetchCloudPassesForAdmin();}
  function rememberSession(data){adminCsrf=data.csrfToken;clearTimeout(expiryTimer);expiryTimer=setTimeout(clearAdmin,Math.max(0,data.expires-Date.now()));}
  async function adminRequest(url,options={}){
    if(!adminCsrf)throw new Error('Administrator login required');
    try{return await apiRequest(url,{...options,headers:{...options.headers,'X-CSRF-Token':adminCsrf}});}
    catch(error){if(error.status===401)clearAdmin();throw error;}
  }
  window.openAdminModal=async function(){
    document.getElementById('admin-modal')?.classList.add('active');document.body.classList.add('modal-open');showAdminLogin();
    try{const session=await apiRequest('/api/admin-session');rememberSession(session);await showAdminDashboard();}catch{clearAdmin();}
  };
  window.closeAdminModal=function(){document.getElementById('admin-modal')?.classList.remove('active');document.body.classList.remove('modal-open');const input=document.getElementById('admin-pin-input');if(input)input.value='';};
  window.handleAdminLogin=async function(event){
    event?.preventDefault();const input=document.getElementById('admin-pin-input');
    try{const session=await apiRequest('/api/admin-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input?.value||''})});rememberSession(session);if(input)input.value='';await showAdminDashboard();}
    catch(error){clearAdmin();showToast(error.message,'error');}
  };
  window.adminLogout=async function(){try{await adminRequest('/api/admin-session',{method:'DELETE'});}catch(error){showToast(error.message,'error');}finally{clearAdmin();}};
  async function fetchCloudPassesForAdmin(){
    try{const data=await adminRequest('/api/all-passes');adminPassesCache=data.passes;renderAdminData();}
    catch(error){adminPassesCache=[];renderAdminData();showToast('Roster unavailable. Gate admission requires a working server connection.','error');throw error;}
  }
  window.refreshAdminDataFromCloud=function(){fetchCloudPassesForAdmin().catch(()=>{});};
  window.setAdminFilter=function(filter){activeAdminFilter=filter||'all';document.querySelectorAll('.admin-filter-btn').forEach(button=>button.classList.toggle('active',button.dataset.filter===activeAdminFilter));renderAdminData();};

  function renderAdminData() {
    const all = adminPassesCache;

    const activePasses = all.filter(r => !r.isDeleted);
    const archivedPasses = all.filter(r => Boolean(r.isDeleted));

    // Calculate metrics across active registered passes
    let totalRevenue = 0;
    let approvedCount = 0;
    let pendingCount = 0;
    let checkedInCount = 0;

    activePasses.forEach(r => {
      if (r.status === 'approved') {
        totalRevenue += Number(r.amount) || 0;
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
        (r.ticketId && r.ticketId.toLowerCase().includes(query)) ||
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

function actionButton(item,action,label){return `<button type="button" class="button small aac-action-btn" data-action="${action}" data-pass-id="${escapeHtml(item.passId)}">${label}</button>`;}
  function actionsFor(item){
    if(item.isDeleted)return actionButton(item,'restore','Restore');
    return (item.status==='approved'?actionButton(item,item.checkedIn?'undo-checkin':'checkin',item.checkedIn?'Undo Entry':'Admit'):actionButton(item,'reconcile','Reconcile Payment'))+
      actionButton(item,'update','Edit')+actionButton(item,'recovery','Recovery Link')+actionButton(item,'delete','Archive');
  }
  function statusFor(item){return item.isDeleted?'Archived':item.paymentState==='revoked'?'Refunded / Ineligible':item.paymentState==='review_required'?'Late promo payment / Review & refund':item.status==='approved'?'Verified':'Needs payment reconciliation';}
  function renderRegistrationsTable(list){
    const tbody=document.getElementById('admin-registrations-tbody');if(!tbody)return;
    tbody.innerHTML=list.length?list.map(item=>`<tr><td>${escapeHtml(visibleTicketId(item))}</td><td><strong>${escapeHtml(item.name)}</strong><div>${escapeHtml(item.partnerName||'')}</div></td>
      <td>${escapeHtml(item.category)} · ${Number(item.capacity)||0} persons · ₹${Number(item.amount)||0}</td><td>${escapeHtml(item.phone)}</td>
      <td>${statusFor(item)}</td><td>${item.checkedIn?'Admitted':'Not admitted'}</td><td><div class="admin-actions-cell">${actionsFor(item)}</div></td></tr>`).join(''):'<tr><td colspan="7">No matching attendees.</td></tr>';
  }
  function renderRegistrationsCards(list){
    const container=document.getElementById('admin-registrations-cards');if(!container)return;
    container.innerHTML=list.length?list.map(item=>`<div class="admin-attendee-card ${item.checkedIn?'admitted':''} ${item.isDeleted?'archived':''}">
      <div class="aac-header"><span class="aac-pass-id">${escapeHtml(visibleTicketId(item))}</span><span class="badge">${statusFor(item)}</span></div>
      <div class="aac-body"><div class="aac-name">${escapeHtml(item.name)}</div><div class="aac-partner">${escapeHtml(item.partnerName||'')}</div>
      <div class="aac-meta"><span>${escapeHtml(item.category)} · ${Number(item.capacity)||0} persons</span><span>₹${Number(item.amount)||0}</span></div>
      <div>${escapeHtml(item.phone)}</div><div>${escapeHtml(item.address)}</div><div>${item.checkedIn?'Admitted at '+escapeHtml(item.checkInTime||'gate'):'Not admitted'}</div></div>
      <div class="aac-actions-row">${actionsFor(item)}</div></div>`).join(''):'<p>No matching attendees.</p>';
  }
  window.handleAdminSearch=function(){renderAdminData();};
  async function runAdminAction(action,id,extra={}){
    const result=await adminRequest('/api/all-passes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,passId:id,...extra})});
    const index=adminPassesCache.findIndex(item=>item.passId===id);
    if(index>=0)adminPassesCache[index]={...adminPassesCache[index],...result.pass};
    renderAdminData();return result;
  }
  async function adminAction(id,button){
    const action=button.dataset.action;button.disabled=true;
    try{
      let extra={};
      if(['undo-checkin','recovery','reconcile'].includes(action)){const reason=prompt('Record a reason for this organizer operation (required):');if(!reason)return;extra.reason=reason;}
      if(action==='delete'&&!confirm('Archive this ticket? Admission will be disabled; the record remains recoverable.'))return;
      if(action==='reconcile'){
        const current=adminPassesCache.find(p=>p.passId===id);
        if(!current?.razorpayOrderId){const orderId=prompt('Enter the Razorpay order ID from the payment dashboard:');if(!orderId)return;extra.orderId=orderId;}
      }
      if(action==='update'){
        const current=adminPassesCache.find(p=>p.passId===id);const name=prompt('Attendee name:',current?.name||'');if(name===null)return;
        const phone=prompt('10-digit mobile number:',current?.phone||'');if(phone===null)return;extra.data={name,phone};
      }
      const result=await runAdminAction(action,id,extra);
      if(action==='recovery'){
        const link=location.origin+location.pathname+'#pass='+encodeURIComponent(id)+'&access='+encodeURIComponent(result.recoveryToken);
        prompt('Share this private recovery link only after verifying the attendee. It replaces prior recovery access:',link);
      }
      if(action==='checkin'){const box=document.getElementById('gate-terminal-feedback');if(box){box.replaceChildren(JmuSecurityUI.textElement(document,'p','ENTRY CONFIRMED: '+result.pass.name+' · '+result.pass.capacity+' persons','badge badge-success'));}}
      showToast(result.pass.paymentState==='review_required'?'Late promotional payment: organizer review/refund required':'Server confirmed: '+action,result.pass.paymentState==='review_required'?'error':'success');
    }catch(error){showToast(error.message,'error');}
    finally{button.disabled=false;}
  }
  window.handleGateTerminalSubmit=async function(event){
    event?.preventDefault();const id=(document.getElementById('gate-pass-input')?.value||'').trim().toUpperCase();
    const box=document.getElementById('gate-terminal-feedback');if(!box)return;box.style.display='block';box.textContent='Checking the server...';
    try{
      const data=await adminRequest('/api/get-pass?id='+encodeURIComponent(id));const pass=data.pass;
      box.replaceChildren();box.appendChild(JmuSecurityUI.textElement(document,'p',pass.name+' · '+pass.category+' · '+pass.capacity+' persons'));
      if(pass.status!=='approved'||pass.isDeleted){box.appendChild(JmuSecurityUI.textElement(document,'p','ENTRY DENIED: verified active ticket required'));return;}
      if(pass.checkedIn){box.appendChild(JmuSecurityUI.textElement(document,'p','ALREADY ADMITTED: duplicate entry denied'));return;}
      const button=JmuSecurityUI.textElement(document,'button','Confirm group admission ('+pass.capacity+' persons)','button');button.type='button';button.dataset.action='checkin';button.dataset.passId=pass.passId;box.appendChild(button);
    }catch(error){box.textContent='ENTRY NOT CONFIRMED: '+error.message;}
  };
  window.clearGateInput=function(){const input=document.getElementById('gate-pass-input');if(input){input.value='';input.focus();}const box=document.getElementById('gate-terminal-feedback');if(box)box.replaceChildren();};
  window.exportRegistrationsCSV=async function(){
    try{
      const data=await adminRequest('/api/all-passes');
      const headers=['Pass ID','Payment State','Category','Persons','Amount','Attendee Name','Mobile','Address','Partner Name','Partner Mobile','Gate Entry','Check-In Time'];
      const rows=data.passes.map(p=>[visibleTicketId(p),p.paymentState,p.category,p.capacity,p.amount,p.name,p.phone,p.address,p.partnerName,p.partnerPhone,p.checkedIn?'YES':'NO',p.checkInTime||'']);
      const csv=[headers,...rows].map(row=>row.map(JmuSecurityUI.csvCell).join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='JMU_Registrations.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){showToast(error.message,'error');}
  };
  window.handleSaveSettings=async function(event){event?.preventDefault();try{await adminRequest('/api/admin-session');saveConfigOverride({whatsappGroupLink:document.getElementById('cfg-whatsapp-group')?.value||''});showToast('Community link saved on this device');}catch(error){showToast(error.message,'error');}};
  function bindInterface(){
    const handlers=['openRegistrationModal','closeRegistrationModal','openMyPassModal','closeMyPassModal','stepSoloQuantity','selectWizardCategory','handleStep1Submit','downloadPassAsImage','copyCurrentPassId','handleMyPassSearch','openAdminModal','closeAdminModal','handleAdminLogin','refreshAdminDataFromCloud','exportRegistrationsCSV','clearGateInput','handleGateTerminalSubmit','setAdminFilter','handleAdminSearch','handleSaveSettings','adminLogout'];
    for(const type of ['click','submit','input'])document.addEventListener(type,event=>{
      const target=event.target.closest('[data-ui-event="'+type+'"]');if(!target||target.disabled||!handlers.includes(target.dataset.uiHandler))return;
      if(type==='submit')event.preventDefault();
      let args=[];try{args=JSON.parse(target.dataset.uiArgs||'[]');}catch{return;}
      window[target.dataset.uiHandler](...args.map(value=>value==='__event__'?event:value));
    });
    const actions=Object.fromEntries(['checkin','undo-checkin','delete','restore','update','recovery','reconcile'].map(action=>[action,adminAction]));
    for(const id of ['admin-registrations-tbody','admin-registrations-cards','gate-terminal-feedback']){const element=document.getElementById(id);if(element)JmuSecurityUI.bindActions(element,actions);}
  }

document.addEventListener('DOMContentLoaded',function(){
    // Discard legacy full-roster/attendee caches and browser-only administrator flags.
    for(const key of ['jmu_registrations_v1','jmu_my_passes','jmu_config_override']){if(key!=='jmu_config_override')localStorage.removeItem(key);}
    sessionStorage.removeItem('jmu_admin_auth');sessionStorage.removeItem('jmu_admin_auth_time');
    const config=getConfig();if(localStorage.getItem('jmu_config_override'))saveConfigOverride({whatsappGroupLink:config.whatsappGroupLink});
    initCountdown();bindInterface();
    const promotion=JmuPricing.EARLY_BIRD,note=document.getElementById('early-bird-note');
    if(note)note.textContent=promotion.enabled?'Early bird: ₹'+promotion.unitPrice/100+' per person for the first '+promotion.limit+
      ' solo attendees. Limited availability; final price confirmed at checkout. Regular Solo ₹'+JmuPricing.CATALOG.solo/100+'; Couple ₹'+JmuPricing.CATALOG.couple/100+'.':
      'Regular Solo ₹'+JmuPricing.CATALOG.solo/100+'; Couple ₹'+JmuPricing.CATALOG.couple/100+'.';
    const fragment=new URLSearchParams(location.hash.slice(1));
    if(fragment.has('access')){
      const id=(fragment.get('pass')||'').toUpperCase(),access=fragment.get('access')||'';
      history.replaceState(null,'',location.pathname+location.search);
      if(/^JMU-[A-Z0-9]{4,60}$/.test(id)&&/^[A-Za-z0-9_-]{43}$/.test(access)){saveOwnerAccess(id,access);openMyPassModal(id);}
    }
    if(location.hash==='#admin')openAdminModal();
  });


})();
