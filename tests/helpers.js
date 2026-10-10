'use strict';
// Intentionally fake test credentials. No .env, external SDK or database connection.
const crypto=require('node:crypto');
const s=require('../server/security');
const {createHandlers}=require('../server/handlers');
const pricing=require('../server/pricing');
const password='test-only-long-organizer-password';
const salt=Buffer.alloc(16,7);
const env={APP_ORIGIN:'https://event.example',RAZORPAY_KEY_ID:'fixture-key-id',
  RAZORPAY_KEY_SECRET:'fixture-payment-secret-not-a-real-key',
  RAZORPAY_WEBHOOK_SECRET:'fixture-webhook-secret-not-a-real-key',
  ADMIN_SESSION_SECRET:'fixture-session-secret-not-a-real-key',
  ADMIN_PASSWORD_HASH:'scrypt$'+salt.toString('hex')+'$'+crypto.scryptSync(password,salt,64,s.SCRYPT_OPTIONS).toString('hex')};
class MemoryRepository {
  constructor(){this.passes=new Map();this.orders=new Map();this.payments=new Map();this.sessions=new Map();this.events=new Map();this.rates=new Map();this.audits=[];this.reservations=new Map();this.campaigns=new Map();this.now=Date.now;this.failure=false;this.lock=Promise.resolve();}
  async serial(run){const previous=this.lock;let release;this.lock=new Promise(resolve=>{release=resolve;});await previous;try{return await run();}finally{release();}}
  async throttle(key,now,limit,period){const bucket=key+':'+Math.floor(now/period),count=(this.rates.get(bucket)||0)+1;this.rates.set(bucket,count);if(count>limit)s.reject(429,'Too many attempts; try again later');}
  async prepareOrder(input,id,recoveryHash,campaign={enabled:false}){return this.serial(async()=>{
    const requestHash=s.hash(JSON.stringify(input)),old=[...this.orders.values()].find(o=>o.idempotency_hash===input.keyHash);
    if(old){if(old.request_hash!==requestHash)s.reject(409,'Booking key was used for different details');if(old.state!=='ready'||!old.order_id)s.reject(409,'Booking requires recovery','ORDER_RECOVERY_REQUIRED');const pass=this.passes.get(old.pass_id),reservation=this.reservations.get(old.pass_id);if(old.promotion_units>0&&pass.payment_state!=='verified'&&(reservation.state!=='reserved'||+reservation.expires_at<=this.now()))s.reject(409,'Promotion expired','PROMOTION_EXPIRED');pass.recovery_hash=recoveryHash;return {...old,create:false};}
    let units=0,key=null,expires=null;
    if(campaign.enabled&&input.category==='solo'){
      const config=pricing.campaignSnapshot(campaign);key=config.key;let row=this.campaigns.get(key);if(!row){row={used_units:0,config_hash:s.hash(JSON.stringify(config))};this.campaigns.set(key,row);}if(row.config_hash!==s.hash(JSON.stringify(config)))s.reject(503,'Campaign configuration requires review');
      for(const reservation of this.reservations.values())if(reservation.campaign_key===key&&reservation.state==='reserved'&&+reservation.expires_at<=this.now()){reservation.state='released';row.used_units-=reservation.units;}
      units=Math.min(input.quantity,config.limit-row.used_units);if(units){row.used_units+=units;expires=new Date(this.now()+config.reservationMinutes*60000);}else key=null;
    }
    const applicable=pricing.quote(input.category,input.quantity,units),promotion={promotion_key:key,promotion_units:units,promotion_expires_at:expires};
    this.passes.set(id,{pass_id:id,recovery_hash:recoveryHash,category_key:input.category,category:input.category==='couple'?'Married Couple Pass':'Solo Pass',quantity:input.quantity,amount:applicable.amountPaise/100,name:input.name,phone:input.phone,address:input.address,partner_name:input.partnerName,partner_phone:input.partnerPhone,payment_state:'pending',timestamp:Date.now(),checked_in:false,is_deleted:false,...promotion});
    const order={pass_id:id,idempotency_hash:input.keyHash,request_hash:requestHash,category:input.category,quantity:input.quantity,amount_paise:applicable.amountPaise,currency:input.currency,state:'creating',order_id:null,...promotion};this.orders.set(id,order);
    if(units)this.reservations.set(id,{pass_id:id,campaign_key:key,units,expires_at:expires,state:'reserved'});return {...order,create:true};
  });}
  async bindOrder(id,orderId){const order=this.orders.get(id);if(order.order_id&&order.order_id!==orderId)s.reject(409,'Conflict');Object.assign(order,{order_id:orderId,state:'ready'});return {...order};}
  async markUnknown(id){if(!this.orders.get(id).order_id)this.orders.get(id).state='unknown';}
  async findPass(id){return this.passes.get(id);}
  async findOrder(id){return this.orders.get(id);}
  async findByOrder(id){return [...this.orders.values()].find(o=>o.order_id===id);}
  async finalize(frozen,payment,revoked,eventId,audit){return this.serial(async()=>{
    if(this.failure){this.failure=false;throw new Error('simulated database outage');}
    const old=this.payments.get(payment.id);if(old&&old.pass_id!==frozen.pass_id)s.reject(409,'Payment already used');
    const pass=this.passes.get(frozen.pass_id);let eligible=true;const reservation=this.reservations.get(pass.pass_id);
    if(reservation){eligible=reservation.state==='redeemed';if(reservation.state==='reserved'){if(!revoked&&+reservation.expires_at>this.now()){reservation.state='redeemed';eligible=true;}else{reservation.state='released';this.campaigns.get(reservation.campaign_key).used_units-=reservation.units;eligible=false;}}else if(reservation.state==='released')eligible=false;}
    const state=revoked||pass.payment_state==='revoked'||old?.state==='revoked'?'revoked':!eligible||pass.payment_state==='review_required'||old?.state==='review_required'?'review_required':'verified';
    this.payments.set(payment.id,{pass_id:frozen.pass_id,order_id:frozen.order_id,state});Object.assign(pass,{payment_state:state,razorpay_order_id:frozen.order_id,razorpay_payment_id:payment.id});
    if(eventId)for(const id of Array.isArray(eventId)?eventId:[eventId])this.events.get(id).state='done';if(audit)await this.audit(audit.actor,'reconcile',pass.pass_id,audit.reason);return {...pass};
  });}
  async createSession(sessionHash,csrfHash,expires){this.sessions.set(sessionHash,{csrf_hash:csrfHash,expires_at:expires,revoked:false});}
  async session(hash,now){const row=this.sessions.get(hash);return row&&!row.revoked&&row.expires_at>now?row:null;}
  async logout(hash){this.sessions.get(hash).revoked=true;}
  async audit(actor,action,id,reason){this.audits.push({actor,action,id,reason});}
  async roster(){return [...this.passes.values()];}
  async action(actor,action,id,data,reason){return this.serial(async()=>{
    const pass=this.passes.get(id);if(!pass)s.reject(404,'Ticket not found');
    if(action==='checkin'){const refund=[...this.events.values()].some(e=>e.order_id===pass.razorpay_order_id&&e.payment_id===pass.razorpay_payment_id&&e.event_type==='refund.processed'&&e.state!=='done');if(pass.checked_in||pass.payment_state!=='verified'||pass.is_deleted||refund)s.reject(409,'Verified active ticket required');pass.checked_in=true;pass.check_in_at=new Date().toISOString();}
    else if(action==='undo-checkin'){pass.checked_in=false;pass.check_in_at=null;}
    else if(action==='delete')pass.is_deleted=true;
    else if(action==='restore')pass.is_deleted=false;
    else if(action==='recovery')pass.recovery_hash=data.recoveryHash;
    else if(action==='update')Object.assign(pass,data);
    else s.reject(400,'Unsupported action');
    await this.audit(actor,action,id,reason);return {...pass};
  });}
  async recordEvent(event){const old=this.events.get(event.id);if(old){if(old.digest!==event.digest)s.reject(400,'Webhook event conflict');return old;}const row={event_id:event.id,digest:event.digest,event_type:event.type,order_id:event.orderId,payment_id:event.paymentId,state:'received'};this.events.set(event.id,row);return row;}
  async eventState(id,state){if(this.events.get(id).state!=='done')this.events.get(id).state=state;}
  async pendingEvents(orderId){return [...this.events.values()].filter(event=>event.order_id===orderId&&event.state!=='done');}
  async hasPendingRefund(orderId,paymentId){return [...this.events.values()].some(event=>event.order_id===orderId&&event.payment_id===paymentId&&event.event_type==='refund.processed'&&event.state!=='done');}
}
function harness(options={}){
  const repo=new MemoryRepository(),orders=new Map(),paymentRows=new Map();let time=Date.now();
  const calls={create:0,fetch:0};
  const provider={orders:{create:async input=>{calls.create++;const order={...input,id:'order_fixture'+calls.create,status:'created',amount_paid:0,amount_due:input.amount};orders.set(order.id,order);return {...order};},
    fetch:async id=>{calls.fetch++;return {...orders.get(id)};},fetchPayments:async orderId=>({items:[...paymentRows.values()].filter(row=>row.order_id===orderId)})},payments:{fetch:async id=>({...paymentRows.get(id)})}};
  repo.now=()=>time;
  const handlers=createHandlers({env:{...env},database:async run=>run(repo),provider,now:()=>time,campaign:options.campaign===true?pricing.EARLY_BIRD:options.campaign||{enabled:false}});
  async function invoke(name,{method='POST',headers={},body,query={},rawBody,url}={}){
    const response={code:200,headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(value){this.body=value;return this;},end(){return this;}};
    const request={method,headers:{origin:env.APP_ORIGIN,'content-type':'application/json',...headers},body,query,rawBody,url,socket:{remoteAddress:'127.0.0.1'}};
    await hHandlers()[name](request,response);return response;
  }
  const valid={category:'solo',quantity:1,name:'Fixture Attendee',phone:'9999999999',address:'Test locality',idempotencyKey:'a'.repeat(64)};
  async function book(changes={}){return invoke('createOrder',{body:{...valid,...changes}});}
  function capture(booking,changes={}){const order=orders.get(booking.order_id);Object.assign(order,{status:'paid',amount_paid:order.amount,amount_due:0});const id='pay_fixture'+calls.create;paymentRows.set(id,{id,order_id:order.id,amount:order.amount,currency:'INR',status:'captured',captured:true,amount_refunded:0,...changes});return id;}
  function verification(booking,paymentId){return {passId:booking.passId,razorpay_order_id:booking.order_id,razorpay_payment_id:paymentId,razorpay_signature:crypto.createHmac('sha256',env.RAZORPAY_KEY_SECRET).update(booking.order_id+'|'+paymentId).digest('hex')};}
  async function verify(booking,paymentId,changes={}){return invoke('verifyPayment',{headers:{authorization:'Bearer '+booking.recoveryToken},body:{...verification(booking,paymentId),...changes}});}
  async function login(){const result=await invoke('adminSession',{body:{password}});return {cookie:result.headers['Set-Cookie'].split(';')[0],'x-csrf-token':result.body.csrfToken};}
  function webhookBody(booking,paymentId,event='payment.captured'){return Buffer.from(JSON.stringify({event,payload:{payment:{entity:{id:paymentId,order_id:booking.order_id}},...(event==='refund.processed'?{refund:{entity:{payment_id:paymentId}}}:{})}}));}
  async function webhook(booking,paymentId,{event='payment.captured',eventId='evt_fixture',raw,signature}={}){const bytes=raw||webhookBody(booking,paymentId,event);return invoke('webhook',{rawBody:bytes,headers:{'x-razorpay-event-id':eventId,'x-razorpay-signature':signature||crypto.createHmac('sha256',env.RAZORPAY_WEBHOOK_SECRET).update(bytes).digest('hex')}});}
  const result={repo,orders,paymentRows,calls,provider,handlers,invoke,valid,book,capture,verification,verify,login,webhook,webhookBody,setTime:value=>{time=value;}};
  function hHandlers(){return result.handlers;}
  return result;
}
module.exports={harness,env,password,MemoryRepository};
