'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,env}=require('./helpers');
const s=require('../server/security'),{Repository}=require('../server/repository');

test('in-flight and ambiguous order retries cannot rotate recovery access before a usable response',async()=>{
  for(const state of ['creating','unknown']){
    const h=harness(),input=s.registration(h.valid),original=s.hash('original fixture access');
    const order={pass_id:'JMU-'+ 'B'.repeat(32),idempotency_hash:input.keyHash,request_hash:s.hash(JSON.stringify(input)),state,order_id:null,promotion_units:0};
    const pass={pass_id:order.pass_id,payment_state:'pending',recovery_hash:original};
    const client={async query(sql,values){
      if(sql.includes('SELECT * FROM jmu_orders WHERE idempotency_hash'))return {rows:[order]};
      if(sql.includes('SELECT * FROM jmu_passes'))return {rows:[pass]};
      if(sql.includes('UPDATE jmu_passes SET recovery_hash'))pass.recovery_hash=values[0];
      return {rows:[]};
    }};
    const run=()=>new Repository(client).prepareOrder(input,s.randomPassId(),s.hash('replacement fixture access'));
    if(state==='creating')await assert.rejects(run,error=>error.status===409&&error.code==='ORDER_PREPARING');
    else assert.equal((await run()).recover,true);
    assert.equal(pass.recovery_hash,original);
  }
});

test('every administrative mutation rejects missing CSRF and incorrect origins before changing records',async()=>{
  const h=harness(),booking=(await h.book()).body;
  assert.equal((await h.verify(booking,h.capture(booking))).code,200);
  const auth=await h.login();
  for(const action of ['checkin','undo-checkin','delete','restore','update','recovery','reconcile']){
    const body={action,passId:booking.passId,reason:'Isolated fixture review',...(action==='update'?{data:{name:'Changed fixture'}}:{})};
    for(const headers of [{cookie:auth.cookie},{...auth,origin:'https://attacker.invalid'}])assert.equal((await h.invoke('allPasses',{headers,body})).code,403,action);
  }
  assert.equal(h.repo.passes.get(booking.passId).name,'Fixture Attendee');assert.equal(h.repo.payments.size,1);
  for(const query of [{pin:'fixture'},{password:'fixture'},{token:'fixture'}])assert.ok((await h.invoke('allPasses',{method:'GET',headers:auth,query})).code>=400);
});

test('public owner responses omit contact, address, social, session and provider information',async()=>{
  const h=harness(),booking=(await h.book()).body;
  Object.assign(h.repo.passes.get(booking.passId),{insta:'private-fixture',partner_phone:'8888888888',razorpay_order_id:'order_fixtureprivate',razorpay_payment_id:'pay_fixtureprivate'});
  const result=await h.invoke('getPass',{method:'GET',query:{id:booking.passId},headers:{authorization:'Bearer '+booking.recoveryToken}});
  assert.equal(result.code,200);
  for(const key of ['phone','address','insta','partnerPhone','partner_phone','recovery_hash','recoveryToken','razorpay_order_id','razorpay_payment_id','razorpayOrderId','razorpayPaymentId'])assert.equal(result.body.pass[key],undefined,key);
  assert.equal(result.headers['Cache-Control'],'private, no-store');
});

test('installed Razorpay SDK uses the reviewed endpoints and configured timeout without network access',async()=>{
  const api=require('../server/provider').provider(env),requests=[];
  api.api.rq.defaults.adapter=async config=>{
    requests.push({url:config.url,method:config.method,timeout:config.timeout,data:config.data});
    return {data:{id:'order_fixtureadapter',items:[]},status:200,statusText:'OK',headers:{},config};
  };
  await api.orders.create({amount:24900,currency:'INR',receipt:'JMU-'+ 'A'.repeat(32),partial_payment:false});
  await api.orders.fetch('order_fixtureadapter');await api.orders.fetchPayments('order_fixtureadapter');await api.payments.fetch('pay_fixtureadapter');
  assert.deepEqual(requests.map(row=>row.url),['/v1/orders','/v1/orders/order_fixtureadapter','/v1/orders/order_fixtureadapter/payments','/v1/payments/pay_fixtureadapter']);
  assert.ok(requests.every(row=>row.timeout===8000));assert.equal(JSON.parse(requests[0].data).partial_payment,false);
});

test('full and partial refunds both revoke eligibility despite later captured or order-paid events',async()=>{
  for(const refund of [{status:'refunded',amount_refunded:24900,refund_status:'full'},{status:'captured',amount_refunded:1,refund_status:'partial'}]){
    const h=harness(),booking=(await h.book()).body,id=h.capture(booking);assert.equal((await h.verify(booking,id)).code,200);
    Object.assign(h.paymentRows.get(id),refund);assert.equal((await h.webhook(booking,id,{event:'refund.processed'})).code,200);
    Object.assign(h.paymentRows.get(id),{status:'captured',amount_refunded:0,refund_status:null});
    assert.equal((await h.webhook(booking,id,{event:'order.paid',eventId:'evt_staleorder'})).code,200);
    assert.equal(h.repo.passes.get(booking.passId).payment_state,'revoked');assert.equal((await h.verify(booking,id)).code,409);
  }
});

test('processed-refund events remain retryable until provider reads confirm the refund',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);
  // Signed notification can arrive before the current payment endpoint catches
  // up. It must not be acknowledged as done against a stale captured response.
  const event=await h.webhook(booking,id,{event:'refund.processed',eventId:'evt_refundlag'});
  assert.equal(event.code,503);assert.equal(h.repo.events.get('evt_refundlag').state,'retry');
  assert.equal(h.repo.passes.get(booking.passId).payment_state,'pending');
  assert.equal((await h.verify(booking,id)).code,503);
  const auth=await h.login();assert.equal((await h.invoke('allPasses',{headers:auth,body:{action:'reconcile',passId:booking.passId,reason:'Refund visibility review'}})).code,503);
  Object.assign(h.paymentRows.get(id),{status:'refunded',amount_refunded:24900,refund_status:'full'});
  assert.equal((await h.webhook(booking,id,{event:'refund.processed',eventId:'evt_refundlag'})).code,200);
  assert.equal(h.repo.events.get('evt_refundlag').state,'done');assert.equal(h.repo.passes.get(booking.passId).payment_state,'revoked');
});

test('a previously verified ticket cannot enter while a signed refund is awaiting provider consistency',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);assert.equal((await h.verify(booking,id)).code,200);
  assert.equal((await h.webhook(booking,id,{event:'refund.processed',eventId:'evt_verifiedrefundlag'})).code,503);
  const auth=await h.login(),gate=await h.invoke('allPasses',{headers:auth,body:{action:'checkin',passId:booking.passId}});
  assert.equal(gate.code,409);assert.equal(h.repo.passes.get(booking.passId).checked_in,false);
  assert.equal((await h.webhook(booking,id,{eventId:'evt_stalecapture'})).code,503);
  Object.assign(h.paymentRows.get(id),{status:'refunded',amount_refunded:24900});
  assert.equal((await h.webhook(booking,id,{event:'refund.processed',eventId:'evt_verifiedrefundlag'})).code,200);
  assert.equal(h.repo.passes.get(booking.passId).payment_state,'revoked');
});

test('review_required and refunded tickets cannot be admitted, reconciled to verified, or bypassed by administrators',async()=>{
  const h=harness({campaign:true});
  const booking=(await h.book({quantity:4})).body;
  h.setTime(+booking.promotionExpiresAt+1);
  const payId=h.capture(booking);
  const verifyRes=await h.verify(booking,payId);
  assert.equal(verifyRes.code,409);
  assert.equal(verifyRes.body.code,'PROMOTION_EXPIRED');
  assert.equal(h.repo.passes.get(booking.passId).payment_state,'review_required');

  const auth=await h.login();
  const checkinRes=await h.invoke('allPasses',{headers:auth,body:{action:'checkin',passId:booking.passId}});
  assert.equal(checkinRes.code,409);
  assert.equal(h.repo.passes.get(booking.passId).checked_in,false);

  const reconcileRes=await h.invoke('allPasses',{headers:auth,body:{action:'reconcile',passId:booking.passId,reason:'Testing bypass prevention'}});
  assert.equal(reconcileRes.code,200);
  assert.equal(h.repo.passes.get(booking.passId).payment_state,'review_required');
  assert.equal(reconcileRes.body.pass.paymentState,'review_required');

  const recheckinRes=await h.invoke('allPasses',{headers:auth,body:{action:'checkin',passId:booking.passId}});
  assert.equal(recheckinRes.code,409);

  const regular=(await h.book({idempotencyKey:'b'.repeat(64)})).body;
  const regPayId=h.capture(regular);
  assert.equal((await h.verify(regular,regPayId)).code,200);
  assert.equal(h.repo.passes.get(regular.passId).payment_state,'verified');

  Object.assign(h.paymentRows.get(regPayId),{status:'refunded',amount_refunded:regular.amount});
  assert.equal((await h.webhook(regular,regPayId,{event:'refund.processed',eventId:'evt_refund_revocation'})).code,200);
  assert.equal(h.repo.passes.get(regular.passId).payment_state,'revoked');

  const revokedCheckin=await h.invoke('allPasses',{headers:auth,body:{action:'checkin',passId:regular.passId}});
  assert.equal(revokedCheckin.code,409);

  const revokedReconcile=await h.invoke('allPasses',{headers:auth,body:{action:'reconcile',passId:regular.passId,reason:'Testing restore bypass prevention'}});
  assert.equal(revokedReconcile.code,200);
  assert.equal(h.repo.passes.get(regular.passId).payment_state,'revoked');
  assert.equal(revokedReconcile.body.pass.paymentState,'revoked');

  assert.equal((await h.invoke('allPasses',{headers:auth,body:{action:'checkin',passId:regular.passId}})).code,409);
});
