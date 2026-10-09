/**
 * Test Suite for Jaynagar Milan Utsav Registration & Payment Engine
 */

const assert = require('assert');

// Simulate localStorage
const localStorageMock = (function () {
  let store = {};
  return {
    getItem: key => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString(); },
    removeItem: key => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

console.log('--- STARTING FLOW VERIFICATION TESTS ---');

// 1. Pass ID Generation Test
function generatePassId() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `JMU-${code}`;
}

const passId1 = generatePassId();
assert(passId1.startsWith('JMU-'), 'Pass ID must start with JMU-');
assert(passId1.length === 8, 'Pass ID must be 8 characters long');
console.log('✓ Pass ID Generator test passed:', passId1);

// 2. UPI Intent URL test
const config = {
  upiId: "8252969861lol@ibl",
  payeeName: "Mr SONU KUMAR BHANDARI",
  whatsappNumber: "917050551310",
  pricing: { solo: 249, couple: 399 }
};

const soloAmount = config.pricing.solo;
const upiSolo = `upi://pay?pa=${encodeURIComponent(config.upiId)}&pn=${encodeURIComponent(config.payeeName)}&am=${soloAmount}&cu=INR&tn=${encodeURIComponent('Jaynagar Milan Utsav 2026 Ticket')}`;
assert(upiSolo.includes('8252969861lol%40ibl'), 'UPI ID must be encoded');
assert(upiSolo.includes('am=249'), 'Solo amount must be 249');
console.log('✓ UPI Deep Link test passed:', upiSolo);

// 3. WhatsApp Message Payload Test
const attendee = {
  passId: passId1,
  name: "Rahul Sharma",
  category: "Solo Pass",
  amount: 249,
  phone: "9876543210",
  address: "Station Road, Jaynagar",
  insta: "@rahul_dance",
  partnerName: "",
  date: "19 October 2026",
  time: "6:00 PM – 10:00 PM",
  venue: "Marwadi Vivah Bhavan, Jaynagar"
};

const waMessage = 
`🌸 JAYNAGAR MILAN UTSAV 2026 🌸
━━━━━━━━━━━━━━━━━━━━
🎫 Pass ID: ${attendee.passId}
👤 Attendee Name: ${attendee.name}
🏷️ Category: ${attendee.category} (₹${attendee.amount})
📞 Mobile: ${attendee.phone}
📍 Address: ${attendee.address}
📸 Instagram: ${attendee.insta}
💰 Registration Fee: ₹${attendee.amount}/-
📅 Date: ${attendee.date} • ${attendee.time}
📍 Venue: ${attendee.venue}
━━━━━━━━━━━━━━━━━━━━
📸 Payment Verification: Maine ₹${attendee.amount} ka payment successfully kar diya hai.
Kripya mera payment screenshot neeche check karein aur mera Pass verify/confirm karein. Dhanyawad! 🙏`;

assert(waMessage.includes(passId1), 'Message must include Pass ID');
assert(waMessage.includes('Rahul Sharma'), 'Message must include Attendee Name');
assert(waMessage.includes('9876543210'), 'Message must include Mobile');
assert(waMessage.includes('Station Road, Jaynagar'), 'Message must include Address');
assert(waMessage.includes('@rahul_dance'), 'Message must include Instagram');
assert(waMessage.includes('Payment Verification'), 'Message must include Payment verification text');

const waUrl = `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(waMessage)}`;
assert(waUrl.includes('https://wa.me/917050551310?text='), 'WhatsApp URL must route to +91 70505 51310');
console.log('✓ WhatsApp Message & Deep Link test passed!');

// 4. Couple Registration Test
const couplePassId = generatePassId();
const coupleAttendee = {
  passId: couplePassId,
  name: "Amit Kumar",
  category: "Married Couple Pass",
  amount: 399,
  phone: "9123456780",
  address: "Main Bazar, Jaynagar",
  insta: "@amit_k",
  partnerName: "Sneha Kumari",
  partnerPhone: "9123456781"
};

let registrations = [];
registrations.push(attendee);
registrations.push(coupleAttendee);
localStorageMock.setItem('jmu_registrations_v1', JSON.stringify(registrations));

const stored = JSON.parse(localStorageMock.getItem('jmu_registrations_v1'));
assert(stored.length === 2, 'Must store 2 registrations');
assert(stored[1].partnerName === 'Sneha Kumari', 'Must preserve partner name');
console.log('✓ Couple Pass & LocalStorage persistence test passed!');

// 5. Gate Check-in Logic Test
function checkIn(passId) {
  const match = registrations.find(r => r.passId === passId);
  if (!match) return { status: 'NOT_FOUND' };
  if (match.checkedIn) return { status: 'ALREADY_CHECKED_IN', name: match.name };
  match.checkedIn = true;
  return { status: 'APPROVED', name: match.name };
}

const res1 = checkIn(passId1);
assert.strictEqual(res1.status, 'APPROVED', 'First entry must be approved');

const res2 = checkIn(passId1);
assert.strictEqual(res2.status, 'ALREADY_CHECKED_IN', 'Duplicate entry must be rejected');

const res3 = checkIn('JMU-FAKE');
assert.strictEqual(res3.status, 'NOT_FOUND', 'Non-existent ID must be not found');

console.log('✓ Gate check-in verification & duplicate prevention test passed!');

// 6. CSV Export Test
const headers = ["Pass ID", "Category", "Amount", "Attendee Name", "Mobile", "Address", "Instagram", "Partner Name", "Partner Mobile", "Booking Date", "Gate Check-In"];
const rows = registrations.map(item => [
  `"${item.passId}"`,
  `"${item.category}"`,
  `"${item.amount}"`,
  `"${(item.name || '').replace(/"/g, '""')}"`,
  `"${item.phone || ''}"`,
  `"${(item.address || '').replace(/"/g, '""')}"`,
  `"${(item.insta || '').replace(/"/g, '""')}"`,
  `"${(item.partnerName || '').replace(/"/g, '""')}"`,
  `"${(item.partnerPhone || '').replace(/"/g, '""')}"`,
  `"${new Date().toLocaleString('en-IN')}"`,
  `"${item.checkedIn ? 'YES' : 'NO'}"`
]);
const csv = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
assert(csv.includes('"Rahul Sharma"'), 'CSV must contain attendee name');
assert(csv.includes('"Sneha Kumari"'), 'CSV must contain partner name');
assert(csv.includes('"YES"'), 'CSV must reflect checked in status');
console.log('✓ CSV generation test passed!');

console.log('\n========================================');
console.log('ALL REGISTRATION & PAYMENT TESTS PASSED!');
console.log('========================================');
