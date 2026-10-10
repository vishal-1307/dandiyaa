'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {harness}=require('./helpers');const {EARLY_BIRD,quote}=require('../server/pricing');
const key=()=>crypto.randomBytes(32).toString('hex');
test('confirmed campaign applies to Solo attendees, not Couple passes, and mixed groups have a precise quote',async()=>{
  assert.deepEqual([quote('solo',4,2).amountPaise,quote('solo',4,2).regularQuantity],[89600,2]);assert.equal(quote('couple',1).amountPaise,39900);
  const h=harness({campaign:true}),solo=await h.book({quantity:4}),couple=await h.book({category:'couple',partnerName:'Spouse fixture',partnerPhone:'',idempotencyKey:key()});
  assert.equal(solo.body.amount,79600);assert.equal(solo.body.pricing.promotionalQuantity,4);assert.ok(solo.body.promotionExpiresAt);assert.equal(couple.body.amount,39900);assert.equal(couple.body.pricing.promotionalQuantity,0);assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,4);
});
test('concurrent promotional bookings cannot exceed 100 individual discounted attendees',async()=>{
  const h=harness({campaign:true});const rows=await Promise.all(Array.from({length:30},()=>h.book({quantity:4,idempotencyKey:key()})));
  assert.ok(rows.every(row=>row.code===200));assert.equal(rows.reduce((n,row)=>n+row.body.pricing.promotionalQuantity,0),100);assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,100);
});
test('remaining slots split a group into promotional and regular prices',async()=>{
  const h=harness({campaign:true});for(let i=0;i<24;i++)await h.book({quantity:4,idempotencyKey:key()});await h.book({quantity:2,idempotencyKey:key()});
  const last=await h.book({quantity:4,idempotencyKey:key()});assert.equal(last.body.amount,89600);assert.equal(last.body.pricing.promotionalQuantity,2);assert.equal(last.body.pricing.regularQuantity,2);
  const regular=await h.book({idempotencyKey:key()});assert.equal(regular.body.amount,24900);assert.equal(regular.body.pricing.promotionalQuantity,0);
});
test('ten-person groups retain the first-100 attendee limit and mixed-price payment snapshots',async()=>{
  const h=harness({campaign:true});for(let i=0;i<9;i++)assert.equal((await h.book({quantity:10,idempotencyKey:key()})).body.amount,199000);
  await h.book({quantity:8,idempotencyKey:key()});const bookingKey=key();
  const booking=(await h.book({quantity:10,idempotencyKey:bookingKey})).body;
  assert.equal(booking.amount,239000);assert.equal(booking.pricing.promotionalQuantity,2);assert.equal(booking.pricing.regularQuantity,8);
  const retry=(await h.book({quantity:10,idempotencyKey:bookingKey})).body;assert.equal(retry.order_id,booking.order_id);assert.equal(retry.amount,239000);
  assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,100);
  const verified=await h.verify(retry,h.capture(retry));assert.equal(verified.code,200);assert.equal(verified.body.pass.quantity,10);assert.equal(verified.body.pass.amount,2390);
  const regular=await h.book({quantity:10,idempotencyKey:key()});assert.equal(regular.body.amount,249000);assert.equal(regular.body.pricing.promotionalQuantity,0);
});
test('order retries and callback replays neither allocate slots again nor reprice an existing registration',async()=>{
  const h=harness({campaign:true}),first=(await h.book({quantity:4})).body,second=(await h.book({quantity:4})).body;
  assert.equal(first.passId,second.passId);assert.equal(first.amount,second.amount);assert.equal(h.calls.create,1);assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,4);
  const id=h.capture(second);const outcomes=await Promise.all(Array.from({length:6},()=>h.verify(second,id)));assert.ok(outcomes.every(row=>row.code===200));assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,4);assert.equal(h.repo.payments.size,1);
});
test('client promotion claims are rejected and provider evidence must match the saved promotional amount',async()=>{
  const h=harness({campaign:true});for(const field of ['promotion','promotionalQuantity','promotion_units','earlyBird','price'])assert.equal((await h.book({[field]:true})).code,400);
  const booking=(await h.book()).body,id=h.capture(booking,{amount:24900});assert.equal((await h.verify(booking,id)).code,409);
  h.paymentRows.get(id).amount=19900;assert.equal((await h.verify(booking,id)).code,200);assert.equal(h.repo.passes.get(booking.passId).amount,199);
});
test('expired unpaid reservations release slots but their old checkout prices never change or regain eligibility',async()=>{
  const h=harness({campaign:true}),old=(await h.book({quantity:4})).body;
  h.setTime(+old.promotionExpiresAt+1);const retry=await h.book({quantity:4});assert.equal(retry.code,409);assert.equal(retry.body.code,'PROMOTION_EXPIRED');assert.equal(h.calls.create,1);
  const fresh=(await h.book({quantity:4,idempotencyKey:key()})).body;assert.equal(fresh.amount,79600);assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,4);
  const id=h.capture(old);const late=await h.verify(old,id);assert.equal(late.code,409);assert.equal(late.body.code,'PROMOTION_EXPIRED');assert.equal(h.repo.passes.get(old.passId).payment_state,'review_required');assert.equal(h.repo.orders.get(old.passId).amount_paise,79600);
  const headers=await h.login();assert.equal((await h.invoke('allPasses',{headers,body:{action:'checkin',passId:old.passId}})).code,409);assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,4);
});
test('late webhook payments are durable review outcomes, not new promotional allocations',async()=>{
  const h=harness({campaign:true}),booking=(await h.book()).body;h.setTime(+booking.promotionExpiresAt+1);const id=h.capture(booking);
  assert.equal((await h.webhook(booking,id)).code,200);assert.equal(h.repo.passes.get(booking.passId).payment_state,'review_required');assert.equal(h.repo.events.get('evt_fixture').state,'done');assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,0);
  assert.equal((await h.webhook(booking,id)).body.duplicate,true);assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,0);
});
test('redeemed promotional slots stay consumed after refund, while tickets remain revoked',async()=>{
  const h=harness({campaign:true}),booking=(await h.book()).body,id=h.capture(booking);assert.equal((await h.verify(booking,id)).code,200);
  Object.assign(h.paymentRows.get(id),{status:'refunded',amount_refunded:19900});await h.webhook(booking,id,{event:'refund.processed'});assert.equal(h.repo.passes.get(booking.passId).payment_state,'revoked');assert.equal(h.repo.campaigns.get(EARLY_BIRD.key).used_units,1);
});
