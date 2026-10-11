'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./helpers');
const s=require('../server/security');

test('unpaid checkout stores only anonymous tracking, no attendee PII or issued ticket, and stays out of roster',async()=>{
  const h=harness(),booking=(await h.book({quantity:3})).body,row=h.repo.passes.get(booking.passId);
  assert.equal(row.name,s.PENDING_NAME);assert.equal(row.phone,'0');assert.equal(row.address,'');assert.equal(row.partner_name,null);
  assert.ok(!JSON.stringify(row).includes(h.valid.name));assert.ok(!JSON.stringify(row).includes(h.valid.phone));
  assert.equal(s.publicPass(row).ticketId,null);assert.equal(s.publicPass(row).name,'');assert.equal((await h.repo.roster()).length,0);
  assert.equal(booking.amount,74700);assert.equal(h.repo.orders.size,1);
});
test('captured payment atomically stores original details and issues a five-digit ID without replacing internal identity',async()=>{
  const h=harness(),booking=(await h.book()).body,paid=await h.verify(booking,h.capture(booking));
  assert.equal(paid.code,200);assert.equal(paid.body.pass.ticketId,'JMU-00001');assert.equal(paid.body.pass.passId,booking.passId);
  const row=h.repo.passes.get(booking.passId);assert.equal(row.name,h.valid.name);assert.equal(row.phone,h.valid.phone);assert.equal((await h.repo.roster()).length,1);
  const alias=await h.invoke('getPass',{method:'GET',query:{id:paid.body.pass.ticketId},headers:{authorization:'Bearer '+booking.recoveryToken}});
  assert.equal(alias.code,200);assert.equal(alias.body.pass.passId,booking.passId);
  assert.equal((await h.invoke('getPass',{method:'GET',query:{id:paid.body.pass.ticketId}})).code,401);
  const auth=await h.login();assert.equal((await h.invoke('allPasses',{headers:auth,body:{action:'checkin',passId:paid.body.pass.ticketId}})).code,200);
  assert.equal((await h.invoke('allPasses',{headers:auth,body:{action:'checkin',passId:paid.body.pass.ticketId}})).code,409);
});
test('changed attendee details and missing completion data cannot issue a ticket, even with a valid captured payment',async()=>{
  for(const changes of [{bookingDetails:undefined},{bookingDetails:{category:'solo',quantity:1,name:'Changed fixture',phone:'9999999999',address:'Test locality',idempotencyKey:'a'.repeat(64)}}]){
    const h=harness(),booking=(await h.book()).body,result=await h.verify(booking,h.capture(booking),changes);
    assert.ok([400,409].includes(result.code));assert.equal(h.repo.payments.size,0);assert.equal(h.repo.passes.get(booking.passId).phone,'0');
  }
});
test('webhook-first payment cannot admit or disclose an unfinished attendee; owner resumes without organizer confirmation',async()=>{
  const h=harness(),booking=(await h.book()).body,paymentId=h.capture(booking);
  assert.equal((await h.webhook(booking,paymentId)).code,200);
  const row=h.repo.passes.get(booking.passId);assert.equal(row.payment_state,'verified');assert.equal(row.phone,'0');assert.equal(s.publicPass(row).status,'pending');assert.equal((await h.repo.roster()).length,0);
  const auth=await h.login();assert.equal((await h.invoke('allPasses',{headers:auth,body:{action:'checkin',passId:booking.passId}})).code,409);
  const completed=await h.invoke('verifyPayment',{headers:{authorization:'Bearer '+booking.recoveryToken},body:{passId:booking.passId,resume:true,bookingDetails:h.valid}});
  assert.equal(completed.code,200);assert.equal(completed.body.pass.name,h.valid.name);assert.match(completed.body.pass.ticketId,/^JMU-\d{5}$/);
  assert.equal(h.repo.payments.size,1);assert.equal(h.calls.create,1);
});

test('captured payment can resume before callback or webhook; repeated owner resumes keep the same stored ticket and payment',async()=>{
  const h=harness(),booking=(await h.book()).body;
  h.capture(booking);assert.equal(h.repo.passes.get(booking.passId).payment_state,'pending');
  const request={headers:{authorization:'Bearer '+booking.recoveryToken},body:{passId:booking.passId,resume:true,bookingDetails:h.valid}};
  for(let i=0;i<3;i++){
    const result=await h.invoke('verifyPayment',request);assert.equal(result.code,200);
    assert.equal(result.body.pass.ticketId,'JMU-00001');assert.equal(result.body.pass.passId,booking.passId);
    assert.equal(result.body.pass.name,h.valid.name);
  }
  assert.equal(h.repo.payments.size,1);assert.equal(h.calls.create,1);assert.equal((await h.repo.roster()).length,1);
});

test('unpaid owner resume is explicitly PAYMENT_PENDING and persists neither PII nor an issued ticket',async()=>{
  const h=harness(),booking=(await h.book()).body;
  const result=await h.invoke('verifyPayment',{headers:{authorization:'Bearer '+booking.recoveryToken},body:{passId:booking.passId,resume:true,bookingDetails:h.valid}});
  assert.equal(result.code,409);assert.equal(result.body.code,'PAYMENT_PENDING');assert.ok(!/organizer/i.test(result.body.error));
  const row=h.repo.passes.get(booking.passId);assert.equal(row.phone,'0');assert.equal(row.name,s.PENDING_NAME);assert.equal(s.publicPass(row).ticketId,null);
  assert.equal(h.repo.payments.size,0);assert.equal((await h.repo.roster()).length,0);
});

test('malformed or ambiguous provider payment lists fail closed during owner resume',async()=>{
  for(const list of [{},{items:null},{items:[null]},{items:[{id:'pay_one',status:'captured'},{id:'pay_two',status:'captured'}]}]){
    const h=harness(),booking=(await h.book()).body;h.provider.orders.fetchPayments=async()=>list;
    const result=await h.invoke('verifyPayment',{headers:{authorization:'Bearer '+booking.recoveryToken},body:{passId:booking.passId,resume:true,bookingDetails:h.valid}});
    assert.ok([409,503].includes(result.code));assert.equal(h.repo.payments.size,0);assert.equal(h.repo.passes.get(booking.passId).phone,'0');
  }
});
test('resume cannot approve unpaid, mismatched or refunded provider evidence',async()=>{
  for(const state of ['unpaid','wrong-amount','refunded']){
    const h=harness(),booking=(await h.book()).body;
    if(state!=='unpaid')h.capture(booking,state==='wrong-amount'?{amount:100}:{status:'refunded',amount_refunded:24900});
    const result=await h.invoke('verifyPayment',{headers:{authorization:'Bearer '+booking.recoveryToken},body:{passId:booking.passId,resume:true,bookingDetails:h.valid}});
    assert.equal(result.code,409);assert.notEqual(s.publicPass(h.repo.passes.get(booking.passId)).status,'approved');
  }
});
test('ambiguous creation automatically recovers a matching provider order without another POST or promotion allocation',async()=>{
  const h=harness({campaign:true}),create=h.provider.orders.create;let first=true;
  h.provider.orders.create=async input=>{const result=await create(input);if(first){first=false;throw new Error('fixture timeout after provider commit');}return result;};
  assert.equal((await h.book({quantity:3})).code,503);
  const recovered=await h.book({quantity:3});assert.equal(recovered.code,200);assert.equal(h.calls.create,1);assert.equal(h.repo.passes.size,1);
  assert.equal(recovered.body.amount,59700);assert.equal(recovered.body.pricing.promotionalQuantity,3);
  const latest=(await h.book({quantity:3})).body;assert.equal(latest.order_id,recovered.body.order_id);
  assert.equal((await h.verify(recovered.body,h.capture(recovered.body))).code,401);
  assert.equal((await h.verify(latest,'pay_fixture1')).code,200);
});
test('no receipt match is not enough to repeat an ambiguous external create',async()=>{
  const h=harness();let calls=0;h.provider.orders.create=async()=>{calls++;throw new Error('fixture timeout');};
  assert.equal((await h.book()).code,503);const retry=await h.book();assert.equal(retry.code,503);assert.equal(retry.body.code,'CHECKOUT_PENDING');assert.equal(calls,1);assert.equal(h.repo.orders.size,1);
  assert.ok(!/organizer/i.test(retry.body.error));
});
test('explicit provider rejection permits one atomic retry of the same frozen booking without duplicate PII or slots',async()=>{
  const h=harness({campaign:true}),create=h.provider.orders.create;let attempts=0;
  h.provider.orders.create=async input=>{if(++attempts===1)throw {statusCode:400,error:{code:'BAD_REQUEST_ERROR',description:'private fixture credential',field:'amount'}};return create(input);};
  const first=await h.book();assert.equal(first.code,503);assert.equal(first.body.code,'CHECKOUT_REJECTED');assert.ok(!JSON.stringify(first.body).includes('private fixture'));
  const results=await Promise.all([h.book(),h.book(),h.book()]);assert.ok(results.some(r=>r.code===200));assert.equal(attempts,2);assert.equal(h.repo.passes.size,1);
  assert.equal(h.repo.campaigns.values().next().value.used_units,1);assert.ok(h.repo.audits.some(a=>a.action==='order-create-retry'));
});
test('recovery rejects mismatched provider amount/currency/receipt and never replaces a frozen price',async()=>{
  for(const field of ['amount','currency']){
    const h=harness(),create=h.provider.orders.create;
    h.provider.orders.create=async input=>{const row=await create(input);Object.assign(h.orders.get(row.id),{[field]:field==='amount'?1:'USD'});throw new Error('fixture interrupted');};
    await h.book();assert.equal((await h.book()).code,409);assert.equal(h.calls.create,1);assert.equal(h.repo.orders.values().next().value.order_id,null);
  }
});
test('short references are unique across 100000 identifiers, never silently truncated; collisions with historical IDs fail closed',async()=>{
  const ids=new Set();for(let id=1;id<=99999;id++)ids.add(s.ticketId({id,pass_id:'JMU-INTERNAL',phone:'9999999999',payment_state:'verified'}));
  assert.equal(ids.size,99999);assert.equal(s.ticketId({id:100000,pass_id:'JMU-INTERNAL',phone:'9999999999',payment_state:'verified'}),'JMU-INTERNAL');
  const h=harness(),a=(await h.book()).body;h.repo.passes.set('JMU-00001',{pass_id:'JMU-00001',id:2});await assert.rejects(h.repo.findPass('JMU-00001'),e=>e.code==='TICKET_REFERENCE_CONFLICT');
  assert.ok(h.repo.passes.has(a.passId));
});
test('availability diagnosis uses only provider GET, no personal details, booking, order or campaign allocation',async()=>{
  const h=harness({campaign:true}),result=await h.invoke('createOrder',{body:{operation:'availability'}});
  assert.equal(result.code,200);assert.equal(result.body.available,true);assert.equal(h.calls.create,0);assert.equal(h.repo.orders.size,0);assert.equal(h.repo.passes.size,0);assert.equal(h.repo.campaigns.size,0);
  assert.ok(!('items' in result.body));
  h.provider.orders.all=async()=>{throw {statusCode:401,error:{code:'BAD_REQUEST_ERROR',description:'private fixture credential'}};};
  const failed=await h.invoke('createOrder',{body:{operation:'availability'}});assert.equal(failed.body.code,'CHECKOUT_CONFIGURATION_ERROR');assert.ok(!JSON.stringify(failed.body).includes('private fixture'));
});

test('misformatted payment credentials fail before database allocation and never appear in errors',async()=>{
  for(const name of ['RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET'])for(const wrapper of [v=>' '+v,v=>v+'\n',v=>'"'+v+'"',v=>"'"+v+"'",v=>name+'='+v]){
    const h=harness(),privateValue='private-fixture-never-display';
    h.handlers=require('../server/handlers').createHandlers({env:{...require('./helpers').env,[name]:wrapper(privateValue)},
      provider:h.provider,database:async()=>{assert.fail('Malformed credentials must be rejected before database access');}});
    for(const body of [h.valid,{operation:'availability'}]){
      const result=await h.invoke('createOrder',{body});assert.equal(result.code,503);assert.equal(result.body.code,'CHECKOUT_CONFIGURATION_FORMAT');
      assert.ok(result.body.error.includes(name));assert.ok(!JSON.stringify(result.body).includes(privateValue));
      assert.equal(h.calls.create,0);assert.equal(h.repo.orders.size,0);assert.equal(h.repo.campaigns.size,0);assert.equal(h.repo.passes.size,0);
    }
  }
});
