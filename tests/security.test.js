'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const s=require('../server/security');
const {harness,env,password}=require('./helpers');
const {createHandlers}=require('../server/handlers');
test('webhook signature input consumes original streamed bytes without touching a parsed body getter',async()=>{
  const {Readable}=require('node:stream'),{rawBody}=require('../server/http');const original=Buffer.from('{ "event": "payment.captured" }\n');
  const req=Readable.from([original.subarray(0,5),original.subarray(5)]);req.headers={};Object.defineProperty(req,'body',{get(){throw new Error('Parsed getter must not run');}});
  assert.deepEqual(await rawBody(req,262144,true),original);
  const large=Readable.from([Buffer.alloc(10),Buffer.alloc(10)]);large.headers={};await assert.rejects(rawBody(large,15,true),error=>error.status===413);
});
test('organizer reconciliation drains matching durable webhook events without repeated provider calls',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking),headers=await h.login();
  for(let i=0;i<3;i++)await h.repo.recordEvent({id:'evt_queued_'+i,digest:s.hash('fixture'+i),type:'payment.captured',orderId:booking.order_id,paymentId:id});
  const reconciled=await h.invoke('allPasses',{headers,body:{action:'reconcile',passId:booking.passId,reason:'Interrupted checkout recovery'}});
  assert.equal(reconciled.code,200);assert.equal(h.calls.fetch,2);assert.ok([...h.repo.events.values()].every(row=>row.state==='done'));assert.ok(h.repo.audits.some(row=>row.action==='reconcile'));
});

test('server catalog and capacities retain legitimate business rules',()=>{
  for(let quantity=1;quantity<=10;quantity++)assert.deepEqual(s.pricing('solo',quantity),{category:'solo',quantity,amountPaise:24900*quantity,capacity:quantity,currency:'INR'});
  assert.equal(s.pricing('couple',1).amountPaise,39900);assert.equal(s.pricing('couple',1).capacity,2);
});
test('invalid quantities and categories are rejected',()=>{
  for(const value of [0,-1,11,NaN,Infinity,1.5,'1',null])assert.throws(()=>s.pricing('solo',value));
  assert.throws(()=>s.pricing('couple',2));assert.throws(()=>s.pricing('unknown',1));
});
test('create-order rejects every out-of-range or non-integer quantity before persistence or payment calls',async()=>{
  for(const quantity of [0,-1,11,1.5,'2',null]){
    const h=harness(),result=await h.book({quantity});
    assert.equal(result.code,400);assert.equal(h.calls.create,0);assert.equal(h.repo.passes.size,0);
  }
});
test('each Solo quantity persists its server amount and survives verified checkout without client repricing',async()=>{
  for(let quantity=1;quantity<=10;quantity++){
    const h=harness(),result=await h.book({quantity});assert.equal(result.code,200);
    const booking=result.body,pass=h.repo.passes.get(booking.passId);
    assert.equal(booking.amount,24900*quantity);assert.equal(pass.quantity,quantity);
    assert.equal(h.orders.get(booking.order_id).amount,booking.amount);
    const verified=await h.verify(booking,h.capture(booking));assert.equal(verified.code,200);
    assert.equal(verified.body.pass.quantity,quantity);assert.equal(verified.body.pass.amount,249*quantity);
  }
});
test('identifiers have 128 random bits and recovery tokens have 256 bits',()=>{
  const ids=new Set();for(let i=0;i<1000;i++){const id=s.randomPassId();assert.match(id,/^JMU-[A-F0-9]{32}$/);ids.add(id);}
  assert.equal(ids.size,1000);assert.equal(Buffer.from(s.randomToken(),'base64url').length,32);
});
test('create-order rejects client amounts, status, IDs and extra payment fields',async()=>{
  for(const extra of [{amount:1},{currency:'USD'},{status:'approved'},{passId:'JMU-FAKE'},{checkedIn:true},{paymentId:'pay_other'}]){
    const h=harness(),result=await h.book(extra);assert.equal(result.code,400);assert.equal(h.calls.create,0);assert.equal(h.repo.passes.size,0);
  }
});
test('input validation fails closed without provider or database calls',async()=>{
  for(const extra of [{quantity:0},{quantity:11},{category:'unknown'},{name:'a'},{phone:'1234567890'},{address:'x'.repeat(121)},
    {category:'couple',partnerName:''},{partnerPhone:'9999999998'},{idempotencyKey:'short'}]){
    const h=harness();assert.equal((await h.book(extra)).code,400);assert.equal(h.calls.create,0);
  }
});
test('normal booking persists a price snapshot before checkout and creates no approved ticket',async()=>{
  const h=harness();const response=await h.book({quantity:4});assert.equal(response.code,200);assert.equal(response.body.amount,99600);
  const pass=h.repo.passes.get(response.body.passId);assert.equal(pass.payment_state,'pending');assert.equal(pass.recovery_hash,s.hash(response.body.recoveryToken));
  const order=h.orders.get(response.body.order_id);assert.equal(order.partial_payment,false);assert.equal(order.receipt,response.body.passId);assert.equal(order.notes.registration_id,response.body.passId);
});
test('same booking key reuses its order; altered details cannot reuse that key',async()=>{
  const h=harness();const first=await h.book(),again=await h.book();assert.equal(first.body.order_id,again.body.order_id);assert.equal(h.calls.create,1);assert.equal(h.repo.passes.size,1);
  assert.equal((await h.book({quantity:2})).code,409);
});
test('ambiguous provider timeout is durable and does not create another order on retry',async()=>{
  const h=harness();h.handlers=createHandlers({env,database:async run=>run(h.repo),provider:{orders:{create:async()=>{throw new Error('private provider error');}}}});
  const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await h.handlers.createOrder({method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json'},body:h.valid},response);
  assert.equal(response.code,503);assert.equal([...h.repo.orders.values()][0].state,'unknown');
  const retry=await h.book();assert.equal(retry.code,503);assert.equal(h.calls.create,0);assert.ok(!JSON.stringify(response.body).includes('private provider error'));
});
test('configuration failure contains no embedded credential or detailed error',async()=>{
  const handlers=createHandlers({env:{APP_ORIGIN:env.APP_ORIGIN},database:()=>{throw new Error('must not connect');}});
  const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handlers.createOrder({method:'POST',headers:{origin:env.APP_ORIGIN},body:{}},response);assert.equal(response.code,503);assert.equal(response.body.code,'CONFIGURATION_REQUIRED');
});
test('valid captured payment yields the server ticket, not browser passData',async()=>{
  const h=harness(),booking=(await h.book()).body,paymentId=h.capture(booking),verified=await h.verify(booking,paymentId);
  assert.equal(verified.code,200);assert.equal(verified.body.pass.status,'approved');assert.equal(h.repo.payments.size,1);
  assert.equal((await h.verify(booking,paymentId,{passData:{quantity:4,status:'approved'}})).code,400);
});
test('invalid, malformed and mismatched callback signatures do not fetch provider data',async()=>{
  for(const signature of ['bad','0'.repeat(64),'f'.repeat(63),null]){
    const h=harness(),booking=(await h.book()).body,id=h.capture(booking);assert.equal((await h.verify(booking,id,{razorpay_signature:signature})).code,400);assert.equal(h.calls.fetch,0);assert.equal(h.repo.payments.size,0);
  }
});
test('valid signature is insufficient for amount, currency, capture or binding mismatches',async()=>{
  for(const changes of [{amount:100},{currency:'USD'},{order_id:'order_other'},{status:'authorized',captured:false},{captured:false},{id:'pay_other'},{amount_refunded:-1}]){
    const h=harness(),booking=(await h.book()).body,id=h.capture(booking,changes);assert.equal((await h.verify(booking,id)).code,409);assert.equal(h.repo.payments.size,0);
  }
});
test('order state, receipt, paid amount, due balance and currency each independently cause rejection',async()=>{
  for(const changes of [{status:'created'},{receipt:'JMU-OTHER'},{amount_paid:1},{amount_due:1},{currency:'USD'},{amount:100},{partial_payment:true}]){
    const h=harness(),booking=(await h.book()).body,id=h.capture(booking);Object.assign(h.orders.get(booking.order_id),changes);assert.equal((await h.verify(booking,id)).code,409);assert.equal(h.repo.payments.size,0);
  }
});
test('payment belonging to another stored order cannot approve this registration',async()=>{
  const h=harness(),a=(await h.book()).body,id=h.capture(a),b=(await h.book({idempotencyKey:'b'.repeat(64)})).body;
  assert.equal((await h.verify(b,id,{razorpay_order_id:a.order_id})).code,409);
  assert.equal((await h.verify(b,id)).code,409);
});
test('repeated and simultaneous callback requests preserve a single ticket and payment',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);
  const responses=await Promise.all(Array.from({length:12},()=>h.verify(booking,id)));
  assert.ok(responses.every(response=>response.code===200));assert.equal(h.repo.payments.size,1);assert.equal(h.repo.passes.size,1);
});
test('database failure during callback is retryable and never reports successful issuance',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);h.repo.failure=true;
  assert.equal((await h.verify(booking,id)).code,503);assert.equal(h.repo.payments.size,0);assert.equal((await h.verify(booking,id)).code,200);
});
test('refunds revoke tickets and stale captured events cannot restore eligibility',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);await h.verify(booking,id);
  Object.assign(h.paymentRows.get(id),{amount_refunded:1});assert.equal((await h.webhook(booking,id,{event:'refund.processed'})).code,200);
  assert.equal(h.repo.passes.get(booking.passId).payment_state,'revoked');h.paymentRows.get(id).amount_refunded=0;
  await h.webhook(booking,id,{eventId:'evt_stale'});assert.equal(h.repo.passes.get(booking.passId).payment_state,'revoked');assert.equal((await h.verify(booking,id)).code,409);
});
test('signed webhook confirms a paid booking when the browser callback never runs',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);const response=await h.webhook(booking,id);
  assert.equal(response.code,200);assert.equal(h.repo.passes.get(booking.passId).payment_state,'verified');assert.equal(h.repo.events.get('evt_fixture').state,'done');
});
test('duplicate webhook IDs and distinct event IDs for the same payment are idempotent',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);
  await h.webhook(booking,id);assert.equal((await h.webhook(booking,id)).body.duplicate,true);await h.webhook(booking,id,{eventId:'evt_again'});
  assert.equal(h.repo.payments.size,1);
});
test('invalid webhook signatures and reconstructed parsed bodies are rejected',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);
  assert.equal((await h.webhook(booking,id,{signature:'f'.repeat(64)})).code,400);assert.equal(h.repo.events.size,0);
  const bytes=h.webhookBody(booking,id);const signature=crypto.createHmac('sha256',env.RAZORPAY_WEBHOOK_SECRET).update(bytes).digest('hex');
  assert.equal((await h.invoke('webhook',{body:JSON.parse(bytes),headers:{'x-razorpay-signature':signature}})).code,400);
  assert.equal((await h.webhook(booking,id,{raw:Buffer.from(bytes.toString()+' '),signature})).code,400);
});
test('webhook transaction failure retains retry work, not a false processed marker',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);h.repo.failure=true;
  assert.equal((await h.webhook(booking,id)).code,503);assert.equal(h.repo.events.get('evt_fixture').state,'retry');assert.equal(h.repo.payments.size,0);
  assert.equal((await h.webhook(booking,id)).code,200);assert.equal(h.repo.events.get('evt_fixture').state,'done');
});
test('unmatched signed events remain durable for organizer reconciliation',async()=>{
  const h=harness(),booking=(await h.book()).body,id=h.capture(booking);const frozen=h.repo.orders.get(booking.passId);frozen.order_id=null;
  assert.equal((await h.webhook(booking,id)).body.queued,true);assert.equal(h.repo.events.get('evt_fixture').state,'unmatched');assert.equal(h.repo.payments.size,0);
  await h.repo.bindOrder(booking.passId,booking.order_id);assert.equal((await h.webhook(booking,id)).code,200);assert.equal(h.repo.payments.size,1);
});
test('public lookup requires an owner capability or a signed administrator session',async()=>{
  const h=harness(),booking=(await h.book()).body;
  assert.equal((await h.invoke('getPass',{method:'GET',query:{id:booking.passId}})).code,401);
  assert.equal((await h.invoke('getPass',{method:'GET',query:{id:booking.passId},headers:{authorization:'Bearer '+'z'.repeat(43)}})).code,401);
  const lookup=await h.invoke('getPass',{method:'GET',query:{id:booking.passId},headers:{authorization:'Bearer '+booking.recoveryToken}});assert.equal(lookup.code,200);
  for(const field of ['phone','address','insta','partnerPhone','razorpayPaymentId','razorpayOrderId','recoveryToken','recovery_hash'])assert.equal(lookup.body.pass[field],undefined);
});
test('short legacy IDs have no unauthenticated retrieval path',async()=>{
  const h=harness();assert.equal((await h.invoke('getPass',{method:'GET',query:{id:'JMU-ABCDE'}})).code,401);
});
test('capability for one attendee cannot retrieve another attendee',async()=>{
  const h=harness(),a=(await h.book()).body,b=(await h.book({idempotencyKey:'b'.repeat(64)})).body;
  assert.equal((await h.invoke('getPass',{method:'GET',query:{id:b.passId},headers:{authorization:'Bearer '+a.recoveryToken}})).code,401);
});
test('every administrative action and roster require server authentication',async()=>{
  const h=harness();assert.equal((await h.invoke('allPasses',{method:'GET'})).code,401);
  for(const action of ['checkin','undo-checkin','delete','restore','update','recovery','reconcile'])assert.equal((await h.invoke('allPasses',{body:{action,passId:'JMU-ABCDE'}})).code,401);
  assert.equal((await h.invoke('allPasses',{method:'GET',headers:{'x-admin-pin':'anything'}})).code,401);
  assert.equal((await h.invoke('allPasses',{method:'GET',query:{pin:'anything'}})).code,401);
  assert.equal((await h.invoke('allPasses',{method:'DELETE'})).code,405);
});
test('browser flags and unsigned or tampered cookies cannot establish a session',async()=>{
  const h=harness();for(const value of ['jmu_admin_auth=true','jmu_admin_session=true','jmu_admin_session=unsigned.invalid'])assert.equal((await h.invoke('allPasses',{method:'GET',headers:{cookie:value}})).code,401);
  const headers=await h.login();headers.cookie=headers.cookie.slice(0,-1)+(headers.cookie.endsWith('A')?'B':'A');assert.equal((await h.invoke('allPasses',{method:'GET',headers})).code,401);
});
test('administrator password is hashed, cookies are protected and sessions expire',async()=>{
  assert.equal(await s.passwordMatches(password,env.ADMIN_PASSWORD_HASH),true);assert.equal(await s.passwordMatches('incorrect-long-password',env.ADMIN_PASSWORD_HASH),false);
  const h=harness(),login=await h.invoke('adminSession',{body:{password}});assert.equal(login.code,200);
  for(const attribute of ['HttpOnly','SameSite=Strict','Secure','Path=/api','Max-Age=1800'])assert.ok(login.headers['Set-Cookie'].includes(attribute));
  h.setTime(login.body.expires+1);assert.equal((await h.invoke('allPasses',{method:'GET',headers:{cookie:login.headers['Set-Cookie'].split(';')[0]}})).code,401);
});
test('shared login throttling survives separate handler instances',async()=>{
  const h=harness();for(let i=0;i<5;i++)assert.equal((await h.invoke('adminSession',{body:{password:'incorrect-long-password'}})).code,401);
  h.handlers=require('../server/handlers').createHandlers({env,database:async run=>run(h.repo),provider:{}});
  assert.equal((await h.invoke('adminSession',{body:{password}})).code,429);
});
test('administrative writes require origin and session-bound CSRF',async()=>{
  const h=harness(),booking=(await h.book()).body,headers=await h.login();
  assert.equal((await h.invoke('allPasses',{headers:{cookie:headers.cookie},body:{action:'delete',passId:booking.passId}})).code,403);
  assert.equal((await h.invoke('allPasses',{headers:{...headers,origin:'https://attacker.example'},body:{action:'delete',passId:booking.passId}})).code,403);
  assert.equal((await h.invoke('allPasses',{headers,body:{action:'delete',passId:booking.passId}})).code,200);
});
test('logout revokes the persisted session even when the old cookie is replayed',async()=>{
  const h=harness(),headers=await h.login();assert.equal((await h.invoke('adminSession',{method:'DELETE',headers})).code,200);
  assert.equal((await h.invoke('allPasses',{method:'GET',headers})).code,401);
});
test('manual issuance, approval and payment/check-in mass assignment are disabled',async()=>{
  const h=harness(),booking=(await h.book()).body,headers=await h.login();
  assert.equal((await h.invoke('register',{headers,body:{status:'approved'}})).code,410);
  for(const action of ['approve','pending'])assert.equal((await h.invoke('allPasses',{headers,body:{action,passId:booking.passId}})).code,400);
  for(const field of ['status','checkedIn','amount','quantity','payment_state'])assert.equal((await h.invoke('allPasses',{headers,body:{action:'update',passId:booking.passId,data:{[field]:'approved'}}})).code,400);
});
test('pending or archived tickets cannot be admitted, even by authenticated organizers',async()=>{
  const h=harness(),booking=(await h.book()).body,headers=await h.login();
  assert.equal((await h.invoke('allPasses',{headers,body:{action:'checkin',passId:booking.passId}})).code,409);
  const id=h.capture(booking);await h.verify(booking,id);await h.invoke('allPasses',{headers,body:{action:'delete',passId:booking.passId}});
  assert.equal((await h.invoke('allPasses',{headers,body:{action:'checkin',passId:booking.passId}})).code,409);
});
test('concurrent admissions return exactly one success and use server timestamps',async()=>{
  const h=harness(),booking=(await h.book({category:'couple',partnerName:'Fixture Partner'})).body,id=h.capture(booking);await h.verify(booking,id);const headers=await h.login();
  const results=await Promise.all(Array.from({length:8},()=>h.invoke('allPasses',{headers,body:{action:'checkin',passId:booking.passId}})));
  assert.equal(results.filter(result=>result.code===200).length,1);assert.equal(results.filter(result=>result.code===409).length,7);
  assert.equal(results.find(result=>result.code===200).body.pass.capacity,2);assert.ok(h.repo.passes.get(booking.passId).check_in_at);
  assert.equal((await h.invoke('allPasses',{headers,body:{action:'undo-checkin',passId:booking.passId}})).code,400);
  assert.equal((await h.invoke('allPasses',{headers,body:{action:'undo-checkin',passId:booking.passId,reason:'Operator corrected an accidental scan'}})).code,200);
});
test('organizer recovery rotates owner access and is audit recorded',async()=>{
  const h=harness(),booking=(await h.book()).body,headers=await h.login();const recovered=await h.invoke('allPasses',{headers,body:{action:'recovery',passId:booking.passId,reason:'Attendee identity checked in person'}});
  assert.equal(recovered.code,200);assert.equal((await h.invoke('getPass',{method:'GET',query:{id:booking.passId},headers:{authorization:'Bearer '+booking.recoveryToken}})).code,401);
  assert.equal((await h.invoke('getPass',{method:'GET',query:{id:booking.passId},headers:{authorization:'Bearer '+recovered.body.recoveryToken}})).code,200);assert.ok(h.repo.audits.some(row=>row.action==='recovery'));
});
test('sensitive responses are never publicly cached and no wildcard CORS is returned',async()=>{
  const response=await harness().invoke('allPasses',{method:'GET'});assert.equal(response.headers['Cache-Control'],'private, no-store');assert.equal(response.headers['Access-Control-Allow-Origin'],undefined);
});
test('invalid JSON, content types and oversize bodies are bounded',async()=>{
  const h=harness();assert.equal((await h.invoke('createOrder',{rawBody:Buffer.from('{')})).code,400);
  assert.equal((await h.invoke('createOrder',{body:h.valid,headers:{'content-type':'text/plain'}})).code,415);
  assert.equal((await h.invoke('createOrder',{rawBody:Buffer.alloc(17000)})).code,413);
  assert.equal((await h.invoke('createOrder',{body:h.valid,headers:{origin:'https://attacker.example'}})).code,403);
});
