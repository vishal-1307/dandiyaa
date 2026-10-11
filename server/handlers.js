'use strict';
const s = require('./security');
const { endpoint, jsonBody, rawBody } = require('./http');
const { withDatabase } = require('./database');
const { provider } = require('./provider');
const payments = require('./payments');
const pricing=require('./pricing');
const checkout=require('./checkout');

function createHandlers(options = {}) {
  const env = options.env || process.env;
  const database = options.database || (run => withDatabase(env, run));
  const gateway = () => options.provider || provider(env);
  const now = options.now || Date.now;
  const token = options.randomToken || s.randomToken;
  const ticketId = options.randomPassId || s.randomPassId;
  const campaign=options.campaign||pricing.EARLY_BIRD;
  async function rate(repo, req, route, limit = 120, period = 60000) {
    await repo.throttle(route + ':' + s.clientKey(req,env),now(),limit,period);
  }
  async function authenticated(req, repo, claims, mutation = false) {
    const session = await repo.session(claims.hash,now());
    if (!session) s.reject(401, 'Administrator login required');
    if (mutation) {
      const csrf = req.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !s.equal(s.hash(csrf),session.csrf_hash)) s.reject(403, 'Request confirmation required');
    }
    return session;
  }
  function claimsFor(req, mutation = false) {
    if (req.headers['x-admin-pin'] || req.query?.pin) s.reject(401, 'Legacy administrator credentials are disabled');
    if (mutation) s.requireOrigin(req,env);
    return s.decodeSession(req,env,now());
  }

  const createOrder = endpoint(['POST'],env,async req => {
    s.requireOrigin(req,env);
    // Validate configuration BEFORE persisting a registration or external order.
    const keyId = s.required(env,'RAZORPAY_KEY_ID');
    s.required(env,'RAZORPAY_KEY_SECRET');
    const body=await jsonBody(req);
    // A bounded read-only gateway check diagnoses deployed keys without creating
    // any registration/order. Only aggregate readiness is returned, never orders.
    if(body?.operation==='availability'){
      s.keys(s.object(body),['operation']);
      return database(async repo=>{await rate(repo,req,'checkout-availability',20,60000);return checkout.availability(gateway());});
    }
    const input = s.registration(body);
    return database(async repo => {
      await rate(repo,req,'create-order',100,3600000);
      const recoveryToken = token();
      let frozen = await repo.prepareOrder(input,ticketId(),s.hash(recoveryToken),campaign);
      if(frozen.recover)frozen=await checkout.recoverOrder(repo,gateway(),frozen,s.hash(recoveryToken));
      if(frozen.create)frozen=await checkout.createGatewayOrder(repo,gateway(),frozen,s.hash(recoveryToken));
      if (frozen.state !== 'ready' || !frozen.order_id) s.reject(409,'Checkout is still being prepared. Please retry shortly.','ORDER_PREPARING');
      return { passId: frozen.pass_id,recoveryToken,order_id: frozen.order_id,amount: frozen.amount_paise,
        currency: frozen.currency,key_id: keyId,pricing:pricing.quote(frozen.category,frozen.quantity,Number(frozen.promotion_units||0)),
        promotionExpiresAt:frozen.promotion_expires_at||null };
    });
  });

  const verifyPayment = endpoint(['POST'],env,async req => {
    s.requireOrigin(req,env);
    if (!s.bearer(req)) s.reject(401,'Ticket access required');
    const body = s.object(await jsonBody(req));
    s.keys(body,['passId','razorpay_order_id','razorpay_payment_id','razorpay_signature','bookingDetails','resume']);
    const id = s.passId(body.passId);
    const resume=body.resume===true;
    if(resume)s.keys(body,['passId','bookingDetails','resume']);
    else if(body.resume!==undefined)s.reject(400,'Invalid confirmation request');
    const orderId = resume?null:s.providerId(body.razorpay_order_id,'order');
    let paymentId = resume?null:s.providerId(body.razorpay_payment_id,'pay');
    return database(async repo => {
      await rate(repo,req,'verify-payment');
      const pass = await repo.findPass(id); s.owner(req,pass);
      const frozen = await repo.findOrder(pass.pass_id);
      if (!frozen || !frozen.order_id || (!resume&&frozen.order_id !== orderId)) s.reject(409,'Payment does not match this booking','PAYMENT_MISMATCH');
      const details=body.bookingDetails===undefined?null:s.bookingDetails(body.bookingDetails,frozen);
      if(s.attendeePending(pass)&&!details)s.reject(400,'Return to your booking device to complete ticket details','BOOKING_DETAILS_REQUIRED');
      if (!resume&&!s.signature(frozen.order_id + '|' + paymentId,body.razorpay_signature,s.required(env,'RAZORPAY_KEY_SECRET'))) {
        s.reject(400,'Invalid payment signature','INVALID_SIGNATURE');
      }
      const api=gateway();if(resume)paymentId=await payments.paymentForOrder(api,frozen.order_id);
      const paid = await payments.reconcile(repo,api,frozen,paymentId,null,null,details);
      if(paid.payment_state==='review_required')s.reject(409,'Promotional payment arrived after its reservation expired. Organizer review/refund is required; do not pay again.','PROMOTION_EXPIRED');
      if (paid.payment_state !== 'verified' || paid.is_deleted) s.reject(409,'Ticket is not eligible for admission','TICKET_INELIGIBLE');
      return { pass: s.publicPass(paid) };
    });
  });

  const getPass = endpoint(['GET'],env,async req => {
    const query = req.query || Object.fromEntries(new URL(req.url,'http://localhost').searchParams);
    s.keys(query,['id','passId']);
    const id = s.passId(query.id || query.passId);
    const recovery = s.bearer(req);
    const claims = recovery ? null : claimsFor(req);
    return database(async repo => {
      await rate(repo,req,'get-pass');
      if (claims) await authenticated(req,repo,claims);
      const pass = await repo.findPass(id);
      if (recovery) s.owner(req,pass);
      if (!pass) s.reject(404,'Ticket not found');
      return { pass: s.publicPass(pass) };
    });
  });

  const adminSession = endpoint(['GET','POST','DELETE'],env,async (req,res) => {
    if(req.headers['x-admin-pin']||req.query?.pin) s.reject(401,'Legacy administrator credentials are disabled');
    s.keys(req.query||{},[]);
    if (req.method === 'POST') {
      s.requireOrigin(req,env);
      const body = s.object(await jsonBody(req)); s.keys(body,['password']);
      const encoded = s.required(env,'ADMIN_PASSWORD_HASH');
      s.required(env,'ADMIN_SESSION_SECRET',32);
      return database(async repo => {
        await rate(repo,req,'admin-login',5,15*60000);
        if (!await s.passwordMatches(body.password,encoded)) s.reject(401,'Invalid administrator login');
        const sid = token(), expires = now() + 30*60000, csrfToken = s.csrfFor(sid,env);
        await repo.createSession(s.hash(sid),s.hash(csrfToken),expires);
        await repo.audit(s.hash(sid),'login');
        res.setHeader('Set-Cookie',s.cookie(s.signedSession(sid,expires,env),env));
        return { authenticated: true,csrfToken,expires };
      });
    }
    const claims = claimsFor(req,req.method === 'DELETE');
    return database(async repo => {
      await authenticated(req,repo,claims,req.method === 'DELETE');
      if (req.method === 'DELETE') {
        await repo.logout(claims.hash);
        await repo.audit(claims.hash,'logout');
        res.setHeader('Set-Cookie',s.cookie('',env,true));
        return { authenticated: false };
      }
      return { authenticated: true,csrfToken: s.csrfFor(claims.sid,env),expires: claims.expires };
    });
  });

  const allPasses = endpoint(['GET','POST'],env,async req => {
    const claims = claimsFor(req,req.method === 'POST');
    s.keys(req.query||{},[]);
    const body = req.method === 'POST' ? s.object(await jsonBody(req)) : null;
    if (body) s.keys(body,['action','passId','data','reason','orderId','paymentId']);
    return database(async repo => {
      await authenticated(req,repo,claims,req.method === 'POST');
      await rate(repo,req,'admin-actions',240);
      if (!body) {
        const rows = await repo.roster();
        await repo.audit(claims.hash,'roster');
        return { passes: rows.map(row => ({ ...s.publicPass(row),phone: row.phone,address: row.address || '',
          partnerPhone: row.partner_phone || '',paymentMethod: row.payment_method,
          razorpayOrderId: row.razorpay_order_id,razorpayPaymentId: row.razorpay_payment_id })) };
      }
      const requestedId=s.passId(body.passId),target=await repo.findPass(requestedId);
      const id=target?.pass_id||requestedId, action = body.action;
      if (!['checkin','undo-checkin','delete','restore','update','recovery','reconcile'].includes(action)) s.reject(400,'Unsupported administrative action');
      const reason = s.text(body.reason,'reason',200,!['undo-checkin','recovery','reconcile'].includes(action));
      if (action === 'reconcile') {
        const pass = await repo.findPass(id);
        if (!pass) s.reject(404,'Ticket not found');
        let frozen = await repo.findOrder(id);
        const orderId = s.providerId(frozen?.order_id || body.orderId || pass.razorpay_order_id,'order');
        const api = gateway();
        const providerOrder = await api.orders.fetch(orderId);
        if (!frozen) frozen = await repo.installLegacyOrder(pass,providerOrder);
        if (!frozen.order_id) {
          payments.assertOrder(providerOrder,{ ...frozen,order_id: orderId });
          frozen = await repo.bindOrder(frozen.pass_id,orderId);
        }
        const paymentId = s.providerId(body.paymentId || pass.razorpay_payment_id || await payments.paymentForOrder(api,orderId),'pay');
        // A single trusted provider read also drains events for this same payment.
        // Other payment identifiers remain queued for independent review, never guessed.
        const eventIds=(await repo.pendingEvents(orderId)).filter(event=>event.payment_id===paymentId).map(event=>event.event_id);
        const paid = await payments.reconcile(repo,api,frozen,paymentId,eventIds,{actor:claims.hash,reason});
        return { action,pass: s.publicPass(paid) };
      }
      const data = {};
      if (action === 'update') {
        s.object(body.data); s.keys(body.data,['name','phone','address']);
        if (!Object.keys(body.data).length) s.reject(400,'No editable fields supplied');
        if (body.data.name !== undefined) { data.name = s.text(body.data.name,'name',60); if(data.name.length<2) s.reject(400,'Invalid name'); }
        if (body.data.phone !== undefined) data.phone = s.phone(body.data.phone);
        if (body.data.address !== undefined) data.address = s.text(body.data.address,'address',120,true);
      } else if (body.data !== undefined) s.reject(400,'Unsupported request field');
      const recoveryToken = action === 'recovery' ? token() : undefined;
      if (recoveryToken) data.recoveryHash = s.hash(recoveryToken);
      const result = await repo.action(claims.hash,action,id,data,reason);
      return { action,pass: s.publicPass(result),...(recoveryToken ? { recoveryToken } : {}) };
    });
  });

  const webhook = endpoint(['POST'],env,async req => {
    const raw = await rawBody(req,262144,true);
    if (!s.signature(raw,req.headers['x-razorpay-signature'],s.required(env,'RAZORPAY_WEBHOOK_SECRET',32))) s.reject(400,'Invalid webhook signature');
    let body; try { body = JSON.parse(raw.toString('utf8')); } catch { s.reject(400,'Invalid webhook JSON'); }
    s.object(body);
    if (!['payment.captured','order.paid','refund.processed'].includes(body.event)) return { ignored: true };
    const eventId = s.text(req.headers['x-razorpay-event-id'],'event ID',128);
    if (!/^[A-Za-z0-9_-]+$/.test(eventId)) s.reject(400,'Invalid webhook event');
    const entity = body.payload?.payment?.entity;
    const paymentId = s.providerId(entity?.id || body.payload?.refund?.entity?.payment_id,'pay');
    let orderId = entity?.order_id || body.payload?.order?.entity?.id;
    // Refund payloads may not contain an order entity. Obtain it from trusted APIs.
    const api = gateway();
    if (!orderId) orderId = (await api.payments.fetch(paymentId)).order_id;
    orderId = s.providerId(orderId,'order');
    return database(async repo => {
      const recorded = await repo.recordEvent({ id: eventId,digest: s.hash(raw),type: body.event,orderId,paymentId });
      if (recorded.state === 'done') return { duplicate: true };
      const frozen = await repo.findByOrder(orderId);
      if (!frozen) {
        await repo.eventState(eventId,'unmatched');
        return { queued: true };
      }
      try {
        await payments.reconcile(repo,api,frozen,paymentId,eventId);
        return { processed: true };
      } catch (error) {
        await repo.eventState(eventId,'retry');
        // Non-2xx requests are retried by Razorpay. Never acknowledge lost work.
        s.reject(503,'Webhook reconciliation pending');
      }
    });
  });
  const register = endpoint(['POST'],env,async () => s.reject(410,'Direct ticket issuance is disabled; use verified Razorpay checkout'));
  return { createOrder,verifyPayment,getPass,adminSession,allPasses,webhook,register };
}
module.exports = { createHandlers };
