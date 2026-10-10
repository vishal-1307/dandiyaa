const { getDb, ensureTable } = require('./db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    let pass = req.body;
    if (typeof pass === 'string') {
      try {
        pass = JSON.parse(pass);
      } catch (e) {
        // ignore
      }
    }

    // Security: Only authorized organizers can directly insert unverified passes.
    // Attendees must complete Razorpay payment verification at /api/verify-payment.
    const pin = req.headers['x-admin-pin'];
    const correctPin = process.env.ADMIN_PIN || '#Rounak26';
    if (pin !== correctPin) {
      return res.status(403).json({
        success: false,
        error: 'Direct registration is restricted. All attendees must complete online payment verification via Razorpay.'
      });
    }

    if (!pass || !pass.passId || !pass.name || !pass.phone) {
      return res.status(400).json({ success: false, error: 'Missing required pass fields (passId, name, phone)' });
    }

    const db = getDb();
    await ensureTable();

    await db`
      INSERT INTO jmu_passes (
        pass_id, category, amount, name, phone, address, insta,
        partner_name, partner_phone, timestamp, date_str, time_str,
        venue, organizer, checked_in, status, quantity,
        payment_method, razorpay_order_id, razorpay_payment_id
      ) VALUES (
        ${pass.passId.trim().toUpperCase()},
        ${pass.category || 'Solo Pass'},
        ${Number(pass.amount) || 249},
        ${pass.name.trim()},
        ${pass.phone.trim()},
        ${pass.address ? pass.address.trim() : ''},
        ${pass.insta ? pass.insta.trim() : ''},
        ${pass.partnerName ? pass.partnerName.trim() : null},
        ${pass.partnerPhone ? pass.partnerPhone.trim() : null},
        ${Number(pass.timestamp) || Date.now()},
        ${pass.dateStr || '19 October 2026'},
        ${pass.timeStr || '6:00–10:00 PM'},
        ${pass.venue || 'Marwadi Vivah Bhavan, Jaynagar'},
        ${pass.organizer || 'Motion Arts Academy'},
        ${Boolean(pass.checkedIn)},
        ${pass.status || 'pending'},
        ${Number(pass.quantity) || 1},
        ${pass.paymentMethod || 'upi'},
        ${pass.razorpayOrderId || null},
        ${pass.razorpayPaymentId || null}
      )
      ON CONFLICT (pass_id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        checked_in = EXCLUDED.checked_in,
        status = COALESCE(jmu_passes.status, EXCLUDED.status),
        payment_method = COALESCE(EXCLUDED.payment_method, jmu_passes.payment_method),
        razorpay_order_id = COALESCE(EXCLUDED.razorpay_order_id, jmu_passes.razorpay_order_id),
        razorpay_payment_id = COALESCE(EXCLUDED.razorpay_payment_id, jmu_passes.razorpay_payment_id);
    `;

    return res.status(200).json({ success: true, passId: pass.passId.trim().toUpperCase() });
  } catch (err) {
    console.error('Registration API error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
};
