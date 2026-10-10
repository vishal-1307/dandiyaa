const { getDb, ensureTable } = require('./db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check PIN
  const pin = req.headers['x-admin-pin'] || (req.query && req.query.pin) || (req.body && req.body.pin);
  const correctPin = process.env.ADMIN_PIN || 'motion13';
  if (pin !== correctPin) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin PIN' });
  }

  try {
    const db = getDb();
    await ensureTable();

    // POST / ACTIONS
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }
      body = body || {};
      const { action, passId } = body;

      if (!passId) {
        return res.status(400).json({ success: false, error: 'passId is required' });
      }

      const cleanPassId = passId.trim().toUpperCase();

      // Action: DELETE ATTENDEE ("kisi bande ko hatane")
      if (action === 'delete') {
        await db`DELETE FROM jmu_passes WHERE UPPER(pass_id) = ${cleanPassId};`;
        return res.status(200).json({ success: true, action: 'delete', passId: cleanPassId });
      }

      // Action: APPROVE ATTENDEE ("approve karne tak ka saara chiz")
      if (action === 'approve') {
        await db`
          UPDATE jmu_passes 
          SET status = 'approved'
          WHERE UPPER(pass_id) = ${cleanPassId};
        `;
        return res.status(200).json({ success: true, action: 'approve', passId: cleanPassId, status: 'approved' });
      }

      // Action: MARK PENDING
      if (action === 'pending') {
        await db`
          UPDATE jmu_passes 
          SET status = 'pending'
          WHERE UPPER(pass_id) = ${cleanPassId};
        `;
        return res.status(200).json({ success: true, action: 'pending', passId: cleanPassId, status: 'pending' });
      }

      // Action: TOGGLE GATE CHECK-IN
      if (action === 'checkin') {
        const checkedIn = Boolean(body.checkedIn);
        await db`
          UPDATE jmu_passes 
          SET checked_in = ${checkedIn}
          WHERE UPPER(pass_id) = ${cleanPassId};
        `;
        return res.status(200).json({ success: true, action: 'checkin', passId: cleanPassId, checkedIn });
      }

      // Action: UPDATE / EDIT ATTENDEE
      if (action === 'update' && body.data) {
        const d = body.data;
        await db`
          UPDATE jmu_passes 
          SET 
            name = COALESCE(${d.name}, name),
            phone = COALESCE(${d.phone}, phone),
            address = COALESCE(${d.address}, address),
            status = COALESCE(${d.status}, status),
            checked_in = COALESCE(${d.checkedIn !== undefined ? Boolean(d.checkedIn) : null}, checked_in)
          WHERE UPPER(pass_id) = ${cleanPassId};
        `;
        return res.status(200).json({ success: true, action: 'update', passId: cleanPassId });
      }

      // Legacy fallback: direct checkedIn update
      if (body.checkedIn !== undefined) {
        const checkedIn = Boolean(body.checkedIn);
        await db`
          UPDATE jmu_passes 
          SET checked_in = ${checkedIn}
          WHERE UPPER(pass_id) = ${cleanPassId};
        `;
        return res.status(200).json({ success: true, passId: cleanPassId, checkedIn });
      }

      return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    // GET ALL PASSES
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
        COALESCE(status, 'pending') as "status",
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
