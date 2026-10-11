'use strict';
const s = require('./security');
const pricing=require('./pricing');
class Repository {
  constructor(client) { this.client = client; }
  async query(sql, values = []) { return (await this.client.query(sql, values)).rows; }
  async transaction(run) {
    await this.client.query('BEGIN');
    try { const result = await run(); await this.client.query('COMMIT'); return result; }
    catch (error) { await this.client.query('ROLLBACK'); throw error; }
  }
  async findPass(id) {
    const short = /^JMU-\d{5}$/.test(id) ? Number(id.slice(4)) : null;
    const rows = short === null ? await this.query('SELECT * FROM jmu_passes WHERE UPPER(pass_id)=$1',[id]) :
      await this.query('SELECT * FROM jmu_passes WHERE UPPER(pass_id)=$1 OR id=$2',[id,short]);
    if(rows.length > 1) s.reject(409,'Ticket reference requires review','TICKET_REFERENCE_CONFLICT');
    return rows[0];
  }
  async findOrder(id) { return (await this.query('SELECT * FROM jmu_orders WHERE UPPER(pass_id)=$1', [id]))[0]; }
  async findByOrder(id) { return (await this.query('SELECT * FROM jmu_orders WHERE order_id=$1', [id]))[0]; }
  async lockCampaign(key){
    const [row]=await this.query('SELECT * FROM jmu_campaigns WHERE campaign_key=$1 FOR UPDATE',[key]);
    if(!row)s.reject(503,'Campaign configuration requires review');return row;
  }
  async expireCampaign(key){
    const [row]=await this.query(`WITH expired AS (
      UPDATE jmu_promotion_reservations SET state='released' WHERE campaign_key=$1 AND state='reserved'
      AND expires_at<=clock_timestamp() RETURNING units)
      UPDATE jmu_campaigns SET used_units=used_units-COALESCE((SELECT SUM(units) FROM expired),0)
      WHERE campaign_key=$1 RETURNING *`,[key]);return row;
  }
  async allocatePromotion(campaign,quantity){
    const config=pricing.campaignSnapshot(campaign);if(!config)return {units:0,key:null,expires:null};
    const configHash=s.hash(JSON.stringify(config));
    await this.query(`INSERT INTO jmu_campaigns(campaign_key,config_hash,max_units,unit_price,regular_unit_price)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(campaign_key) DO NOTHING`,[config.key,configHash,config.limit,config.unitPrice,config.regularUnitPrice]);
    const old=await this.lockCampaign(config.key);if(old.config_hash!==configHash)s.reject(503,'Campaign configuration requires review');
    const current=await this.expireCampaign(config.key),units=Math.min(quantity,current.max_units-current.used_units);
    if(!units)return {units:0,key:null,expires:null};
    await this.query('UPDATE jmu_campaigns SET used_units=used_units+$1 WHERE campaign_key=$2',[units,config.key]);
    const [clock]=await this.query("SELECT clock_timestamp()+($1::double precision*INTERVAL '1 minute') AS expires_at",[config.reservationMinutes]);
    return {units,key:config.key,expires:clock.expires_at};
  }
  async prepareOrder(input, passId, recoveryHash, campaign={enabled:false}) {
    const requestHash = s.hash(JSON.stringify(input));
    return this.transaction(async () => {
      await this.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.keyHash]);
      const previous = (await this.query('SELECT * FROM jmu_orders WHERE idempotency_hash=$1', [input.keyHash]))[0];
      if (previous) {
        // Shared lock order: campaign (when present), pass, order, payment.
        if(previous.promotion_key)await this.lockCampaign(previous.promotion_key);
        const [pass]=await this.query('SELECT * FROM jmu_passes WHERE pass_id=$1 FOR UPDATE', [previous.pass_id]);
        if (previous.request_hash !== requestHash) s.reject(409, 'Booking key was used for different details');
        if(previous.promotion_units>0 && pass.payment_state!=='verified'){
          const [reservation]=await this.query('SELECT *,expires_at>clock_timestamp() AS active FROM jmu_promotion_reservations WHERE pass_id=$1',[pass.pass_id]);
          if(!reservation||reservation.state!=='reserved'||!reservation.active)s.reject(409,'Early-bird reservation expired. If you paid, contact the organizer; do not pay again.','PROMOTION_EXPIRED');
        }
        if (previous.state === 'unknown' && !previous.order_id) return { ...previous, create:false, recover:true };
        if (previous.state !== 'ready' || !previous.order_id) s.reject(409,
          'Checkout is still being prepared. Please retry in a moment.', 'ORDER_PREPARING');
        // The 256-bit booking key is a capability. A retry rotates recovery access,
        // so no plaintext recovery token must be stored in PostgreSQL.
        await this.query('UPDATE jmu_passes SET recovery_hash=$1 WHERE pass_id=$2', [recoveryHash, previous.pass_id]);
        return { ...previous, create: false };
      }
      const promotion=input.category==='solo'?await this.allocatePromotion(campaign,input.quantity):{units:0,key:null,expires:null};
      const applicable=pricing.quote(input.category,input.quantity,promotion.units);
      await this.query(`INSERT INTO jmu_passes
        (pass_id,category,category_key,amount,name,phone,address,partner_name,partner_phone,timestamp,
         date_str,time_str,venue,organizer,quantity,checked_in,status,payment_method,payment_state,recovery_hash,
         promotion_key,promotion_units,promotion_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'19 October 2026','6:00–10:00 PM',
         'Marwadi Vivah Bhavan, Jaynagar','Motion Arts Academy',$11,FALSE,'pending','razorpay','pending',$12,$13,$14,$15)`,
        [passId, input.category === 'couple' ? 'Married Couple Pass' : 'Solo Pass', input.category,
         applicable.amountPaise / 100, s.PENDING_NAME, '0', '', null,
         null, Date.now(), input.quantity, recoveryHash,promotion.key,promotion.units,promotion.expires]);
      const [order] = await this.query(`INSERT INTO jmu_orders
        (pass_id,idempotency_hash,request_hash,category,quantity,amount_paise,currency,promotion_key,promotion_units,promotion_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [passId,input.keyHash,requestHash,input.category,input.quantity,applicable.amountPaise,input.currency,promotion.key,promotion.units,promotion.expires]);
      if(promotion.units)await this.query('INSERT INTO jmu_promotion_reservations(pass_id,campaign_key,units,expires_at) VALUES($1,$2,$3,$4)',[passId,promotion.key,promotion.units,promotion.expires]);
      return { ...order, create: true };
    });
  }
  async bindOrder(id, orderId) {
    const rows = await this.query(`UPDATE jmu_orders SET order_id=$1,state='ready'
      WHERE pass_id=$2 AND (order_id IS NULL OR order_id=$1) RETURNING *`, [orderId,id]);
    if (!rows.length) s.reject(409, 'Order association conflict');
    return rows[0];
  }
  async markUnknown(id) { await this.query("UPDATE jmu_orders SET state='unknown' WHERE pass_id=$1 AND order_id IS NULL", [id]); }
  async rotateRecovery(id,recoveryHash) { await this.query('UPDATE jmu_passes SET recovery_hash=$1 WHERE pass_id=$2',[recoveryHash,id]); }
  async claimRejectedRetry(id) {
    return this.transaction(async()=>{
      const [order]=await this.query('SELECT * FROM jmu_orders WHERE pass_id=$1 FOR UPDATE',[id]);
      if(order?.state!=='unknown'||order.order_id)return false;
      const [last]=await this.query("SELECT action FROM jmu_audit WHERE pass_id=$1 AND action IN ('order-create-rejected','order-create-retry') ORDER BY id DESC LIMIT 1",[id]);
      if(last?.action!=='order-create-rejected')return false;
      await this.query("UPDATE jmu_orders SET state='creating' WHERE pass_id=$1",[id]);
      // Consume the proof: an interrupted new attempt is ambiguous, not safely retryable.
      await this.audit('system','order-create-retry',id);
      return true;
    });
  }
  async installLegacyOrder(pass, order) {
    const category = pass.category.includes('Couple') ? 'couple' : pass.category.startsWith('Solo Pass') ? 'solo' : '';
    const price = s.pricing(category, Number(pass.quantity));
    if (Number(pass.amount) * 100 !== price.amountPaise || order.receipt !== pass.pass_id ||
        order.amount !== price.amountPaise || order.currency !== 'INR') s.reject(409, 'Historical booking requires organizer review');
    return this.transaction(async () => {
      await this.query('SELECT pass_id FROM jmu_passes WHERE pass_id=$1 FOR UPDATE', [pass.pass_id]);
      const [existing] = await this.query('SELECT * FROM jmu_orders WHERE pass_id=$1', [pass.pass_id]);
      if (existing) return existing;
      const key = s.hash('legacy:' + pass.pass_id);
      const [frozen] = await this.query(`INSERT INTO jmu_orders
        (pass_id,idempotency_hash,request_hash,order_id,category,quantity,amount_paise,currency,state)
        VALUES ($1,$2,$2,$3,$4,$5,$6,'INR','ready') RETURNING *`,
        [pass.pass_id,key,order.id,category,price.quantity,price.amountPaise]);
      await this.query('UPDATE jmu_passes SET category_key=$1 WHERE pass_id=$2', [category,pass.pass_id]);
      return frozen;
    });
  }
  async finalize(frozen, payment, revoked, eventId = null, audit = null, details = null) {
    return this.transaction(async () => {
      if(frozen.promotion_key)await this.lockCampaign(frozen.promotion_key);
      const [pass] = await this.query('SELECT * FROM jmu_passes WHERE pass_id=$1 FOR UPDATE', [frozen.pass_id]);
      const [order] = await this.query('SELECT * FROM jmu_orders WHERE pass_id=$1 FOR UPDATE', [frozen.pass_id]);
      if (!pass || !order || order.order_id !== frozen.order_id || order.amount_paise !== frozen.amount_paise) s.reject(409, 'Order association conflict');
      let eligible=true;
      if(order.promotion_units>0){
        const [reservation]=await this.query('SELECT * FROM jmu_promotion_reservations WHERE pass_id=$1 FOR UPDATE',[pass.pass_id]);
        if(!reservation||reservation.units!==order.promotion_units||reservation.campaign_key!==order.promotion_key||+new Date(reservation.expires_at)!==+new Date(order.promotion_expires_at))s.reject(409,'Promotion association conflict');
        eligible=reservation.state==='redeemed';
        if(reservation.state==='reserved'){
          if(!revoked){const rows=await this.query("UPDATE jmu_promotion_reservations SET state='redeemed' WHERE pass_id=$1 AND state='reserved' AND expires_at>clock_timestamp() RETURNING pass_id",[pass.pass_id]);eligible=rows.length===1;}
          if(!eligible){await this.query("UPDATE jmu_promotion_reservations SET state='released' WHERE pass_id=$1 AND state='reserved'",[pass.pass_id]);await this.query('UPDATE jmu_campaigns SET used_units=used_units-$1 WHERE campaign_key=$2',[reservation.units,reservation.campaign_key]);}
        }
      }
      let state=revoked||pass.payment_state==='revoked'?'revoked':eligible&&pass.payment_state!=='review_required'?'verified':'review_required';
      await this.query(`INSERT INTO jmu_payments (payment_id,order_id,pass_id,amount_paise,currency,state)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(payment_id) DO NOTHING`,
        [payment.id,order.order_id,pass.pass_id,order.amount_paise,order.currency,state]);
      const [evidence] = await this.query('SELECT * FROM jmu_payments WHERE payment_id=$1 FOR UPDATE', [payment.id]);
      if (!evidence || evidence.pass_id !== pass.pass_id || evidence.order_id !== order.order_id ||
          evidence.amount_paise !== order.amount_paise || evidence.currency !== order.currency) s.reject(409, 'Payment is already associated with another booking');
      if(evidence.state==='revoked')state='revoked';else if(evidence.state==='review_required'&&state!=='revoked')state='review_required';
      if(evidence.state!==state)await this.query('UPDATE jmu_payments SET state=$1 WHERE payment_id=$2',[state,payment.id]);
      if(details && s.hash(JSON.stringify(details))!==order.request_hash)s.reject(409,'Booking details do not match the original checkout','BOOKING_DETAILS_MISMATCH');
      // Personal details are materialized only after trusted captured-payment evidence.
      // A webhook may record payment first; the owner callback/resume completes the record.
      if(details && s.attendeePending(pass))await this.query(`UPDATE jmu_passes SET name=$1,phone=$2,address=$3,partner_name=$4,partner_phone=$5 WHERE pass_id=$6`,
        [details.name,details.phone,details.address,details.partnerName||null,details.partnerPhone||null,pass.pass_id]);
      const [result] = await this.query(`UPDATE jmu_passes SET payment_state=$1,status=$2,
        razorpay_order_id=$3,razorpay_payment_id=$4,payment_method='razorpay'
        WHERE pass_id=$5 RETURNING *`, [state,state === 'verified' ? 'approved' : 'pending',order.order_id,payment.id,pass.pass_id]);
      if (eventId) await this.query(`UPDATE jmu_webhook_events SET state='done',processed_at=CURRENT_TIMESTAMP
        WHERE event_id=ANY($1::text[]) AND order_id=$2 AND payment_id=$3`,
        [Array.isArray(eventId)?eventId:[eventId],order.order_id,payment.id]);
      if (audit) await this.audit(audit.actor,'reconcile',pass.pass_id,audit.reason);
      return result;
    });
  }
  async throttle(key, now, limit, period) {
    const bucket = Math.floor(now / period);
    await this.query('DELETE FROM jmu_rate_limits WHERE expires_at < CURRENT_TIMESTAMP');
    const [row] = await this.query(`INSERT INTO jmu_rate_limits(key_hash,bucket,count,expires_at)
      VALUES ($1,$2,1,$3) ON CONFLICT(key_hash,bucket) DO UPDATE
      SET count=LEAST(jmu_rate_limits.count+1,$4) RETURNING count`, [s.hash(key),bucket,new Date((bucket+1)*period),limit+1]);
    if (row.count > limit) s.reject(429, 'Too many attempts; try again later');
  }
  async createSession(sessionHash, csrfHash, expires) {
    await this.query('DELETE FROM jmu_admin_sessions WHERE expires_at < CURRENT_TIMESTAMP');
    await this.query('INSERT INTO jmu_admin_sessions(session_hash,csrf_hash,expires_at) VALUES($1,$2,$3)', [sessionHash,csrfHash,new Date(expires)]);
  }
  async session(hash, now) { return (await this.query('SELECT * FROM jmu_admin_sessions WHERE session_hash=$1 AND revoked=FALSE AND expires_at>$2', [hash,new Date(now)]))[0]; }
  async logout(hash) { await this.query('UPDATE jmu_admin_sessions SET revoked=TRUE WHERE session_hash=$1', [hash]); }
  async audit(actor, action, id = null, reason = '') {
    await this.query('INSERT INTO jmu_audit(actor_hash,action,pass_id,reason) VALUES($1,$2,$3,$4)', [actor,action,id,reason]);
  }
  async roster() { return this.query("SELECT * FROM jmu_passes WHERE phone<>'0' AND payment_state<>'pending' ORDER BY timestamp DESC"); }
  async hasPendingRefund(orderId,paymentId) {
    const [row]=await this.query(`SELECT EXISTS(SELECT 1 FROM jmu_webhook_events
      WHERE order_id=$1 AND payment_id=$2 AND event_type='refund.processed' AND state<>'done') AS pending`,[orderId,paymentId]);
    return row.pending;
  }
  async action(actor, action, id, data = {}, reason = '') {
    return this.transaction(async () => {
      const resolved=await this.findPass(id);
      const [pass] = resolved ? await this.query('SELECT * FROM jmu_passes WHERE pass_id=$1 FOR UPDATE', [resolved.pass_id]) : [];
      if (!pass) s.reject(404, 'Ticket not found');
      let rows;
      if (action === 'checkin') {
        rows = await this.query(`UPDATE jmu_passes p SET checked_in=TRUE,check_in_at=CURRENT_TIMESTAMP,check_in_time=NULL
          WHERE p.pass_id=$1 AND p.phone<>'0' AND p.checked_in IS NOT TRUE AND p.is_deleted IS NOT TRUE AND p.payment_state='verified'
          AND EXISTS (SELECT 1 FROM jmu_payments m JOIN jmu_orders o ON o.order_id=m.order_id AND o.pass_id=m.pass_id
            WHERE m.pass_id=p.pass_id AND m.state='verified' AND m.amount_paise=o.amount_paise AND m.currency=o.currency)
          AND NOT EXISTS (SELECT 1 FROM jmu_webhook_events e WHERE e.order_id=p.razorpay_order_id
            AND e.payment_id=p.razorpay_payment_id AND e.event_type='refund.processed' AND e.state<>'done')
          RETURNING p.*`, [pass.pass_id]);
        if (!rows.length) s.reject(409, pass.checked_in ? 'Already checked in' : 'Verified active ticket required');
      } else if (action === 'undo-checkin') {
        rows = await this.query('UPDATE jmu_passes SET checked_in=FALSE,check_in_at=NULL,check_in_time=NULL WHERE pass_id=$1 RETURNING *', [pass.pass_id]);
      } else if (action === 'delete' || action === 'restore') {
        rows = await this.query('UPDATE jmu_passes SET is_deleted=$1,deleted_at=$2 WHERE pass_id=$3 RETURNING *', [action === 'delete',action === 'delete' ? new Date() : null,pass.pass_id]);
      } else if (action === 'recovery') {
        rows = await this.query('UPDATE jmu_passes SET recovery_hash=$1 WHERE pass_id=$2 RETURNING *', [data.recoveryHash,pass.pass_id]);
      } else if (action === 'update') {
        if(s.attendeePending(pass))s.reject(409,'Complete verified booking details on the booking device first','BOOKING_DETAILS_REQUIRED');
        rows = await this.query(`UPDATE jmu_passes SET name=COALESCE($1,name),phone=COALESCE($2,phone),address=COALESCE($3,address)
          WHERE pass_id=$4 RETURNING *`, [data.name ?? null,data.phone ?? null,data.address ?? null,pass.pass_id]);
      } else s.reject(400, 'Unsupported administrative action');
      await this.audit(actor,action,pass.pass_id,reason);
      return rows[0];
    });
  }
  async recordEvent(event) {
    await this.query(`INSERT INTO jmu_webhook_events(event_id,digest,event_type,order_id,payment_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id) DO NOTHING`, [event.id,event.digest,event.type,event.orderId,event.paymentId]);
    const [row] = await this.query('SELECT * FROM jmu_webhook_events WHERE event_id=$1', [event.id]);
    if (row.digest !== event.digest) s.reject(400, 'Webhook event conflict');
    return row;
  }
  async eventState(id, state) { await this.query('UPDATE jmu_webhook_events SET state=$1 WHERE event_id=$2 AND state<>\'done\'', [state,id]); }
  async pendingEvents(orderId) { return this.query("SELECT * FROM jmu_webhook_events WHERE order_id=$1 AND state<>'done' ORDER BY created_at LIMIT 1000", [orderId]); }
}
module.exports = { Repository };
