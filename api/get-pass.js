const { getDb, ensureTable } = require('./db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const queryId = req.query ? (req.query.id || req.query.passId) : null;
    if (!queryId || typeof queryId !== 'string') {
      return res.status(400).json({ success: false, error: 'Pass ID is required' });
    }

    const cleanId = queryId.trim().toUpperCase();
    const db = getDb();
    await ensureTable();

    const rows = await db`
      SELECT 
        pass_id as "passId",
        category,
        amount,
        name,
        phone,
        address,
        insta,
        partner_name as "partnerName",
        partner_phone as "partnerPhone",
        timestamp,
        date_str as "dateStr",
        time_str as "timeStr",
        venue,
        organizer,
        checked_in as "checkedIn",
        check_in_time as "checkInTime",
        COALESCE(status, 'pending') as "status",
        COALESCE(quantity, 1) as "quantity",
        COALESCE(payment_method, 'upi') as "paymentMethod",
        razorpay_order_id as "razorpayOrderId",
        razorpay_payment_id as "razorpayPaymentId"
      FROM jmu_passes 
      WHERE UPPER(pass_id) = ${cleanId}
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Pass not found' });
    }

    const pass = rows[0];
    pass.amount = Number(pass.amount);
    pass.timestamp = Number(pass.timestamp);
    pass.quantity = Number(pass.quantity) || 1;

    return res.status(200).json({ success: true, pass });
  } catch (err) {
    console.error('Get-pass API error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
};
