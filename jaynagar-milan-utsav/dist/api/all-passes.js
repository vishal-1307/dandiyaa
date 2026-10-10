const { getDb, ensureTable } = require('./db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const pin = req.headers['x-admin-pin'] || (req.query && req.query.pin);
  const correctPin = process.env.ADMIN_PIN || 'motion13';
  if (pin !== correctPin) {
    return res.status(401).json({ success: false, error: 'Unauthorized PIN' });
  }

  try {
    const db = getDb();
    await ensureTable();

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }
      const { passId, checkedIn } = body || {};
      if (!passId) {
        return res.status(400).json({ success: false, error: 'passId is required' });
      }

      await db`
        UPDATE jmu_passes
        SET checked_in = ${Boolean(checkedIn)}
        WHERE UPPER(pass_id) = ${passId.trim().toUpperCase()};
      `;

      return res.status(200).json({ success: true, passId, checkedIn: Boolean(checkedIn) });
    }

    // GET all passes
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
        created_at as "createdAt"
      FROM jmu_passes 
      ORDER BY timestamp DESC;
    `;

    const formatted = rows.map(r => ({
      ...r,
      amount: Number(r.amount),
      timestamp: Number(r.timestamp)
    }));

    return res.status(200).json({ success: true, passes: formatted });
  } catch (err) {
    console.error('All-passes API error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Database error' });
  }
};
