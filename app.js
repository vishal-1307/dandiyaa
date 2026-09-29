/* Central event configuration — replace placeholder data here without touching UI code. */
const EVENT = {
  name: 'Raaga Raas — Dandiya & Garba Night', date: '2026-10-18T17:00:00+05:30', venue: 'Rajnagar Community Grounds, Madhubani, Bihar', capacity: 500, baselineRegistrations: 312,
  schedule: [
    ['05:00 PM', 'Gates open', 'Settle in, get your wristband and find your circle.', 'Entry'],
    ['05:30 PM', 'Welcome raas', 'A festive opening and a few easy steps for everyone.', 'Live'],
    ['06:00 PM', 'Garba session', 'The first circle begins — traditional rhythm, modern energy.', 'Live'],
    ['07:30 PM', 'Dandiya on repeat', 'Bring your sticks or borrow a pair at the venue.', 'Main event'],
    ['08:45 PM', 'Best dressed moment', 'Our hosts spotlight the colour, craft and confidence.', 'Spotlight'],
    ['09:15 PM', 'Open dance floor', 'DJ-led beats till the final flourish.', 'Finale']
  ],
  faqs: [
    ['Who can come?', 'Everyone aged 14+ is welcome. Guests aged 14–17 should attend with a parent or guardian.'],
    ['What should I wear?', 'Bring your brightest festive look. Traditional wear is loved, but there is no strict dress code — just choose something comfortable enough to dance in.'],
    ['Are Dandiya sticks provided?', 'A limited number of sticks will be available at the venue. You are welcome to bring your own lightweight sticks.'],
    ['Is there parking?', 'Yes. Designated parking and drop-off zones will be signposted near the Rajnagar Community Grounds entrance.'],
    ['Can I update my registration?', 'Yes — use Find my pass with your registration email or mobile number, or contact the event support team on WhatsApp.'],
    ['What do I show at the gate?', 'Open your QR digital pass on your phone. Staff will scan it, verify your entry, and welcome you into the circle.']
  ]
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const storageKey = 'raaga-raas-registrations';
let currentStep = 1;

// Use a consistent overlay implementation even in preview browsers that only partially support <dialog>.
$$('dialog.dialog').forEach(dialog => {
  const overlay = document.createElement('div');
  overlay.id = dialog.id;
  overlay.className = dialog.className;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('hidden', '');
  overlay.innerHTML = dialog.innerHTML;
  dialog.replaceWith(overlay);
});

function registrations() { return JSON.parse(localStorage.getItem(storageKey) || '[]'); }
function saveRegistrations(list) { localStorage.setItem(storageKey, JSON.stringify(list)); }
function claimed() { return EVENT.baselineRegistrations + registrations().reduce((total, r) => total + Number(r.guestCount || 1), 0); }
function ticketId() { return `RR-${String(Math.floor(1000 + Math.random() * 8999))}`; }

function renderSchedule() {
  $('#schedule-list').innerHTML = EVENT.schedule.map(([time, event, description, status]) => `<div class="schedule-row"><span class="schedule-time">${time}</span><strong class="schedule-event">${event}</strong><span class="schedule-description">${description}</span><span class="status">${status}</span></div>`).join('');
}
function renderFaqs() {
  $('#faq-list').innerHTML = EVENT.faqs.map(([q, a]) => `<article class="faq-item"><button class="faq-button" aria-expanded="false"><span>${q}</span><span>+</span></button><div class="faq-answer"><p>${a}</p></div></article>`).join('');
  $$('.faq-button').forEach(button => button.addEventListener('click', () => { const item = button.closest('.faq-item'); item.classList.toggle('open'); button.setAttribute('aria-expanded', item.classList.contains('open')); }));
}
function updateCountdown() {
  const diff = Math.max(0, new Date(EVENT.date) - new Date());
  const units = [Math.floor(diff / 86400000), Math.floor(diff / 3600000) % 24, Math.floor(diff / 60000) % 60, Math.floor(diff / 1000) % 60];
  $$('#countdown b').forEach((node, index) => node.textContent = String(units[index]).padStart(2, '0'));
}
function updateCapacity() {
  const total = claimed(), available = Math.max(0, EVENT.capacity - total), percent = `${Math.min(100, (total / EVENT.capacity) * 100)}%`;
  $('.capacity div:first-child').innerHTML = `<span>${total}</span> of ${EVENT.capacity} places claimed`;
  $('.capacity .meter i').style.width = percent;
  $('.capacity small').textContent = `${available} places remain`;
  $('#metric-registrations').textContent = total;
  $('#metric-available').textContent = available;
  $$('[data-open-register]').forEach(button => {
    button.disabled = available === 0;
    if (available === 0) button.innerHTML = 'Registration closed';
  });
}

function openDialog(id) {
  const dialog = $(id);
  dialog.removeAttribute('hidden');
  dialog.setAttribute('aria-hidden', 'false');
  dialog.classList.add('dialog-fallback-open');
  document.body.style.overflow = 'hidden';
}
function closeDialog(id) {
  const dialog = $(id);
  dialog.classList.remove('dialog-fallback-open');
  dialog.setAttribute('aria-hidden', 'true');
  dialog.setAttribute('hidden', '');
  document.body.style.overflow = '';
}
$$('[data-open-register]').forEach(button => button.addEventListener('click', () => openDialog('#registration-dialog')));
$$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog('#registration-dialog')));
$$('[data-close-success]').forEach(button => button.addEventListener('click', () => closeDialog('#success-dialog')));
$('#open-lookup').addEventListener('click', () => openDialog('#lookup-dialog'));
$('#mobile-pass-link').addEventListener('click', () => {
  $('.topbar').classList.remove('menu-open');
  $('#menu-button').setAttribute('aria-expanded', 'false');
  openDialog('#lookup-dialog');
});
$$('[data-close-lookup]').forEach(button => button.addEventListener('click', () => closeDialog('#lookup-dialog')));
$$('.gallery-card').forEach(card => card.addEventListener('click', () => {
  $('#gallery-lightbox-image').src = card.dataset.galleryImage;
  $('#gallery-lightbox-image').alt = card.dataset.galleryTitle;
  $('#gallery-lightbox-title').textContent = card.dataset.galleryTitle;
  openDialog('#gallery-dialog');
}));
$$('[data-close-gallery]').forEach(button => button.addEventListener('click', () => closeDialog('#gallery-dialog')));
$('#open-admin').addEventListener('click', () => { updateAdmin(); openDialog('#admin-dialog'); });
$$('[data-close-admin]').forEach(button => button.addEventListener('click', () => closeDialog('#admin-dialog')));
$('#menu-button').addEventListener('click', () => {
  const header = $('.topbar'), isOpen = header.classList.toggle('menu-open');
  $('#menu-button').setAttribute('aria-expanded', String(isOpen));
});
$$('.topbar nav a').forEach(link => link.addEventListener('click', () => {
  $('.topbar').classList.remove('menu-open');
  $('#menu-button').setAttribute('aria-expanded', 'false');
}));
// Delegated controls keep all overlays operable even where browser preview layers interfere with direct listeners.
const closeTargets = {
  closeDialog: '#registration-dialog',
  closeSuccess: '#success-dialog',
  closeLookup: '#lookup-dialog',
  closeGallery: '#gallery-dialog',
  closeAdmin: '#admin-dialog'
};
document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const control = event.target.closest('[data-close-dialog],[data-close-success],[data-close-lookup],[data-close-gallery],[data-close-admin]');
  if (!control) return;
  if (control.hasAttribute('data-close-dialog')) closeDialog(closeTargets.closeDialog);
  if (control.hasAttribute('data-close-success')) closeDialog(closeTargets.closeSuccess);
  if (control.hasAttribute('data-close-lookup')) closeDialog(closeTargets.closeLookup);
  if (control.hasAttribute('data-close-gallery')) closeDialog(closeTargets.closeGallery);
  if (control.hasAttribute('data-close-admin')) closeDialog(closeTargets.closeAdmin);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const activeOverlay = $$('.dialog-fallback-open').at(-1);
  if (activeOverlay) closeDialog(`#${activeOverlay.id}`);
});
$('#explore-button').addEventListener('click', () => $('#experience').scrollIntoView({behavior:'smooth'}));
$$('[data-scroll]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.scroll}`).scrollIntoView({behavior:'smooth'})));
$('#directions').addEventListener('click', () => window.open('https://www.google.com/maps/search/?api=1&query=Rajnagar+Community+Grounds+Madhubani', '_blank', 'noopener'));

function stepUI() {
  $$('.form-step').forEach(step => step.classList.toggle('active', Number(step.dataset.step) === currentStep));
  $$('.progress-dots i').forEach((dot, index) => dot.classList.toggle('active', index < currentStep));
  $('#form-progress-label').textContent = `Step ${currentStep} of 3`;
  $('#form-back').style.visibility = currentStep === 1 ? 'hidden' : 'visible';
  $('#form-next').innerHTML = currentStep === 3 ? 'Create my pass <span>✦</span>' : 'Continue <span>→</span>';
  $('#form-error').textContent = '';
}
function setGuestDefaults() {
  const type = $('input[name="entryType"]:checked').value, select = $('[name="guestCount"]');
  const defaults = {Individual:'1', Couple:'2', Group:'3', Family:'3'};
  select.value = defaults[type];
  $('#guest-count-label').firstChild.textContent = type === 'Individual' ? 'How many passes?' : 'How many people?';
}
$$('input[name="entryType"]').forEach(input => input.addEventListener('change', setGuestDefaults));
$('#form-back').addEventListener('click', () => { currentStep = Math.max(1, currentStep - 1); stepUI(); });
$('#form-next').addEventListener('click', () => {
  const form = $('#registration-form');
  if (currentStep === 2) {
    const fields = ['fullName', 'phone', 'email', 'city'];
    const missing = fields.find(field => !form.elements[field].value.trim());
    if (missing) { $('#form-error').textContent = 'Please complete the required fields.'; return; }
    if (!/^\d{10}$/.test(form.elements.phone.value.replace(/\D/g, ''))) { $('#form-error').textContent = 'Enter a valid 10-digit mobile number.'; return; }
    if (!form.elements.email.validity.valid) { $('#form-error').textContent = 'Enter a valid email address.'; return; }
  }
  if (currentStep === 3) { if (!form.elements.rules.checked) { $('#form-error').textContent = 'Please agree to the event guidelines to continue.'; return; } completeRegistration(); return; }
  currentStep += 1;
  if (currentStep === 3) { const fd = new FormData(form); $('#review-entry').textContent = `${fd.get('entryType')} · ${fd.get('guestCount')} ${fd.get('guestCount') === '1' ? 'pass' : 'passes'}`; }
  stepUI();
});
function qr(seed) {
  const value = [...seed].reduce((n, char) => n + char.charCodeAt(0), 0);
  $('#qr-code').innerHTML = Array.from({length:49}, (_, index) => `<i style="visibility:${((value * (index + 7) + index * index) % 5 < 3 || [0,1,7,8,40,41,47,48].includes(index)) ? 'visible' : 'hidden'}"></i>`).join('');
}
function completeRegistration() {
  const data = Object.fromEntries(new FormData($('#registration-form')).entries());
  const existing = registrations();
  const normalizedPhone = data.phone.replace(/\D/g, '');
  if (existing.some(item => item.email.toLowerCase() === data.email.toLowerCase() || item.phone.replace(/\D/g, '') === normalizedPhone)) {
    $('#form-error').textContent = 'A registration already exists with this email or mobile number. Use “Find my pass” to retrieve it.';
    return;
  }
  if (claimed() + Number(data.guestCount) > EVENT.capacity) {
    $('#form-error').textContent = 'This booking would exceed the remaining event capacity. Please select fewer passes or join the waitlist.';
    return;
  }
  const registration = {...data, id: ticketId(), checkedIn:false, createdAt:new Date().toISOString()};
  saveRegistrations([...existing, registration]);
  $('#pass-name').textContent = registration.fullName;
  $('#pass-type').textContent = `${registration.entryType} · ${registration.guestCount} ${registration.guestCount === '1' ? 'pass' : 'passes'}`;
  $('#pass-id').textContent = registration.id;
  qr(registration.id);
  updateCapacity(); closeDialog('#registration-dialog'); openDialog('#success-dialog');
  $('#registration-form').reset(); currentStep = 1; setGuestDefaults(); stepUI();
}
$('#download-pass').addEventListener('click', () => { window.print(); });

$('#lookup-form').addEventListener('submit', event => {
  event.preventDefault(); const term = $('#lookup-input').value.trim().toLowerCase(); const record = registrations().find(r => r.email.toLowerCase() === term || r.phone.replace(/\D/g,'') === term.replace(/\D/g,'') || r.id.toLowerCase() === term);
  $('#lookup-result').innerHTML = record ? `<div class="lookup-found"><strong>${record.fullName}</strong><br />${record.id} · ${record.entryType} · ${record.guestCount} pass${record.guestCount === '1' ? '' : 'es'}<br /><button class="arrow-link" id="show-lookup-pass">Open digital pass ↗</button></div>` : '<p>No local prototype registration matched that detail. Register a pass first, or check the spelling.</p>';
  const passButton = $('#show-lookup-pass'); if (passButton) passButton.addEventListener('click', () => { $('#pass-name').textContent = record.fullName; $('#pass-type').textContent = `${record.entryType} · ${record.guestCount} pass${record.guestCount === '1' ? '' : 'es'}`; $('#pass-id').textContent = record.id; qr(record.id); closeDialog('#lookup-dialog'); openDialog('#success-dialog'); });
});

function allAttendees() { return registrations(); }
function updateAdmin() {
  const guests = allAttendees(), checkins = guests.filter(r => r.checkedIn).length;
  updateCapacity(); $('#metric-checkin').textContent = checkins; renderAttendees(guests);
}
function renderAttendees(list) { $('#attendee-rows').innerHTML = list.length ? list.slice().reverse().map(r => `<div class="attendee-row"><div><b>${r.fullName}</b><small>${r.id} · ${r.phone}</small></div><span>${r.entryType}<small>${r.guestCount} pass${r.guestCount === '1' ? '' : 'es'}</small></span><span>${r.email}</span><em class="badge ${r.checkedIn ? 'checked' : ''}">${r.checkedIn ? 'Checked in' : 'Ready'}</em></div>`).join('') : '<p style="padding:18px 0;color:#876f75;font-size:12px">New prototype registrations will appear here.</p>'; }
$$('[data-admin-view]').forEach(button => button.addEventListener('click', () => { const view = button.dataset.adminView; $$('.admin-view').forEach(panel => panel.classList.toggle('active', panel.id === `${view}-view`)); $$('.admin-nav').forEach(nav => nav.classList.toggle('active', nav.dataset.adminView === view)); }));
$('#checkin-form').addEventListener('submit', event => { event.preventDefault(); const id = $('#checkin-input').value.trim().toLowerCase(); const list = registrations(); const index = list.findIndex(r => r.id.toLowerCase() === id); if (index < 0) { $('#checkin-result').innerHTML = '<div class="checkin-bad"><strong>Pass not found</strong><br />Check the ID or scan the participant’s QR code.</div>'; return; } if (list[index].checkedIn) { $('#checkin-result').innerHTML = `<div class="checkin-bad"><strong>Already checked in</strong><br />${list[index].fullName} entered earlier with ${list[index].id}.</div>`; return; } list[index].checkedIn = true; saveRegistrations(list); $('#checkin-result').innerHTML = `<div class="checkin-good"><strong>Check-in successful ✓</strong><br />Welcome ${list[index].fullName}. ${list[index].guestCount} pass${list[index].guestCount === '1' ? '' : 'es'} verified.</div>`; $('#checkin-input').value = ''; updateAdmin(); });
$('#attendee-search').addEventListener('input', event => { const term = event.target.value.toLowerCase(); renderAttendees(allAttendees().filter(r => [r.fullName,r.phone,r.id,r.email].some(value => value.toLowerCase().includes(term)))); });
$('#export-csv').addEventListener('click', () => { const rows = [['Registration ID','Name','Phone','Email','Entry type','Passes','Checked in'], ...allAttendees().map(r => [r.id,r.fullName,r.phone,r.email,r.entryType,r.guestCount,r.checkedIn ? 'Yes':'No'])]; const file = new Blob([rows.map(row => row.map(value => `"${String(value).replace(/"/g,'""')}"`).join(',')).join('\n')], {type:'text/csv'}); const link = document.createElement('a'); link.href = URL.createObjectURL(file); link.download = 'raaga-raas-attendees.csv'; link.click(); URL.revokeObjectURL(link.href); });

renderSchedule(); renderFaqs(); updateCountdown(); setInterval(updateCountdown, 1000); setGuestDefaults(); stepUI(); updateCapacity();
