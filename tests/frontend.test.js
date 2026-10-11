'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ui=require('../security-ui');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function browserFixture(fetch,options={}){
  const clicks=[],history=[];
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.textContent='';this.innerHTML='';this.value='';this.disabled=false;this.style={};this.dataset={};this.children=[];this.listeners={};this.classList={add(){},remove(){},toggle(){}};}
    appendChild(child){this.children.push(child);return child;}replaceChildren(...children){this.children=children;this.textContent='';}
    addEventListener(type,handler){this.listeners[type]=handler;}contains(child){return this.children.includes(child);}closest(){return this;}focus(){}click(){clicks.push(this);}remove(){}removeAttribute(name){delete this[name];}
  }
  const elements=new Map(),listeners={},storage=new Map([['jmu_registrations_v1','private legacy roster'],['jmu_my_passes','private legacy passes']]);
  for(const [key,value] of options.storage||[])storage.set(key,value);
  const doc={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},
    createElement(tag){return new Element(tag);},querySelector(){return new Element();},querySelectorAll(){return [];},addEventListener(type,fn){listeners[type]=fn;},body:new Element()};
  const store={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},sessionEntries=new Map(options.session||[]);
  const sessionStore={getItem:key=>sessionEntries.get(key)||null,setItem:(key,value)=>sessionEntries.set(key,value),removeItem:key=>sessionEntries.delete(key)};
  const qr=[];const context={document:doc,localStorage:store,sessionStorage:sessionStore,fetch,JmuSecurityUI:ui,JmuPricing:require('../campaign-config'),console,URL,URLSearchParams,TextEncoder,
    crypto:require('node:crypto').webcrypto,Uint8Array,Blob,File,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    location:{hash:options.hash||'',origin:'https://event.example',pathname:'/',search:''},history:{replaceState(...args){history.push(args);context.location.hash='';}},navigator:{},QRCode:{toCanvas:(canvas,text,opts,cb)=>{qr.push(text);cb(null);}},prompt:()=>null,confirm:()=>false};
  context.window=context;context.JmuCheckoutSDK={load:require('../checkout-loader').createLoader(context,doc)};
  vm.createContext(context);vm.runInContext(source,context);listeners.DOMContentLoaded();
  return {context,doc,elements,listeners,storage,sessionEntries,qr,Element,clicks,history};
}
const response=data=>({ok:true,status:200,json:async()=>({success:true,...data})});
test('Solo stepper updates quantities one through ten through delegated controls and enforces both bounds',()=>{
  const browser=browserFixture(async()=>response({}));browser.context.openRegistrationModal();
  const get=id=>browser.doc.getElementById(id),minus=get('solo-quantity-decrease'),plus=get('solo-quantity-increase');
  minus.dataset={uiHandler:'stepSoloQuantity',uiArgs:'[-1]'};plus.dataset={uiHandler:'stepSoloQuantity',uiArgs:'[1]'};
  const click=button=>browser.listeners.click({target:button});
  const expectQuantity=quantity=>{
    assert.equal(get('solo-quantity-value').textContent,String(quantity));
    const price=require('../campaign-config').CATALOG.solo/100*quantity;
    assert.equal(get('reg-summary-amount').textContent,'₹'+price);
    assert.equal(get('btn-proceed-pay-text').textContent,'Pay Now · ₹'+price+' ➔');
    assert.ok(get('reg-summary-category').textContent.includes('('+quantity+' '));
    assert.equal(minus.disabled,quantity===1);assert.equal(plus.disabled,quantity===10);
  };
  expectQuantity(1);click(minus);expectQuantity(1);
  for(let quantity=2;quantity<=10;quantity++){click(plus);expectQuantity(quantity);}
  click(plus);expectQuantity(10);
  for(const invalid of [0,-1,11,1.5,'2',NaN,Infinity,null]){browser.context.setSoloQuantity(invalid);expectQuantity(10);}
  for(let quantity=9;quantity>=1;quantity--){click(minus);expectQuantity(quantity);}
  browser.context.stepSoloQuantity(9);expectQuantity(1);
  browser.context.setSoloQuantity(3);browser.context.closeRegistrationModal();browser.context.openRegistrationModal();expectQuantity(1);
});
test('Couple pricing and quantity remain fixed and returning to Solo resets the stepper',()=>{
  const browser=browserFixture(async()=>response({}));browser.context.setSoloQuantity(4);browser.context.selectWizardCategory('couple');
  assert.equal(browser.doc.getElementById('solo-quantity-group').style.display,'none');
  browser.context.stepSoloQuantity(1);browser.context.setSoloQuantity(4);
  assert.equal(browser.doc.getElementById('reg-summary-amount').textContent,'₹399');
  browser.context.selectWizardCategory('solo');
  assert.equal(browser.doc.getElementById('solo-quantity-group').style.display,'block');
  assert.equal(browser.doc.getElementById('solo-quantity-value').textContent,'1');
  assert.equal(browser.doc.getElementById('solo-quantity-decrease').disabled,true);
  assert.equal(browser.doc.getElementById('reg-summary-amount').textContent,'₹249');
});
test('stepper uses labelled native non-submit buttons, live output, and visible interaction states',()=>{
  assert.ok(!html.includes('qty-pill'));
  assert.ok(!/Max \d+ tickets per booking|Festival Entry \(1[–-]\d+ Persons\)/.test(html));
  for(const [id,label] of [['decrease','Decrease'],['increase','Increase']]){
    const button=html.match(new RegExp('<button id="solo-quantity-'+id+'"[^>]+>'))[0];
    assert.ok(button.includes('type="button"'));assert.ok(button.includes('aria-label="'+label+' ticket quantity"'));
    assert.ok(button.includes('aria-controls="solo-quantity-value"'));
    if(id==='decrease')assert.ok(button.includes(' disabled'));
  }
  assert.match(html,/<output id="solo-quantity-value"[^>]*aria-live="polite"[^>]*>1<\/output>/);
  const css=fs.readFileSync(path.join(__dirname,'../styles-v2.css'),'utf8');
  for(const state of [':hover:not(:disabled)',':active:not(:disabled)',':focus-visible',':disabled'])assert.ok(css.includes('.quantity-stepper-button'+state));
  assert.match(css,/\.quantity-stepper-button\s*\{[^}]*min-height:\s*48px/);
  assert.match(css,/\.ticket-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css,/\.ticket-bottom\s*\{\s*flex-wrap:\s*wrap/);
});
const attendee={passId:'JMU-'+ 'A'.repeat(32),name:"'); globalThis.pwned=true; // <img src=x onerror=alert(1)>",partnerName:'<script>alert(1)</script>',phone:'9999999999',address:'<svg onload=alert(1)>',category:'Solo Pass',capacity:1,quantity:1,amount:249,status:'approved',paymentState:'verified',checkedIn:false,isDeleted:false,dateStr:'19 October 2026',timeStr:'6–10 PM'};
test('CSV quotes and neutralizes spreadsheet formula and control prefixes',()=>{
  for(const value of ['=HYPERLINK("x")',' +SUM(1)','\t@cmd','-42','\rmalicious'])assert.ok(ui.csvCell(value).startsWith('"\''));
  assert.equal(ui.csvCell('a,"b"'),'"a,""b"""');assert.equal(ui.csvCell(null),'""');
});
test('delegated actions only invoke the allowlisted action, with strings treated as data',()=>{
  let listener,received;const button={dataset:{action:'checkin',passId:"');evil()//"}};
  ui.bindActions({addEventListener:(_,fn)=>{listener=fn;},contains:()=>true},{checkin:id=>{received=id;}});
  listener({target:{closest:()=>button}});assert.equal(received,button.dataset.passId);
  button.dataset.action='constructor';received=null;listener({target:{closest:()=>button}});assert.equal(received,null);
});
test('HTML has no inline event handlers, bindings resolve, and CSP permits no inline JavaScript',()=>{
  assert.equal(/\son(?:click|submit|input|error|load)\s*=/i.test(html),false);
  const browser=browserFixture(async()=>response({}));for(const match of html.matchAll(/data-ui-handler="([^"]+)"/g))assert.equal(typeof browser.context[match[1]],'function',match[1]);
  for(const match of html.matchAll(/data-ui-args="([^"]*)"/g))assert.doesNotThrow(()=>JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')));
  const csp=require('../vercel.json').headers[0].headers.find(h=>h.key==='Content-Security-Policy').value;
  assert.ok(!csp.split(';').find(v=>v.trim().startsWith('script-src')).includes('unsafe-inline'));
  assert.ok(csp.split(';').find(v=>v.trim().startsWith('script-src')).includes('https://cdn.razorpay.com/static/cx/razorpay-risk-detection/bundle.js'));
  assert.ok(!csp.includes('https://*.razorpay.com'));
  const structured=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const hash=require('node:crypto').createHash('sha256').update(structured).digest('base64');assert.ok(csp.includes('sha256-'+hash));
});
test('actual roster rendering escapes stored attacker names, never embeds them in JavaScript and keeps data in memory',async()=>{
  const browser=browserFixture(async url=>response(url==='/api/admin-session'?{csrfToken:'fixture-csrf',expires:Date.now()+1800000}:{passes:[attendee]}));
  browser.doc.getElementById('admin-pin-input').value='fixture-organizer-password';await browser.context.handleAdminLogin();
  const table=browser.doc.getElementById('admin-registrations-tbody').innerHTML,cards=browser.doc.getElementById('admin-registrations-cards').innerHTML;
  for(const markup of [table,cards]){assert.ok(markup.includes('&lt;'));assert.ok(!markup.includes('<img'));assert.ok(!/\sonclick=/.test(markup));assert.ok(markup.includes('data-action="checkin"'));}
  assert.equal(browser.context.pwned,undefined);assert.equal(browser.storage.has('jmu_registrations_v1'),false);assert.equal(browser.storage.has('jmu_my_passes'),false);
  assert.ok(![...browser.storage.values()].some(value=>value.includes(attendee.name)));
});
test('digital pass generates an ID-only QR and name text without recovery capabilities or contact information',()=>{
  const browser=browserFixture(async()=>response({}));browser.context.handlePaymentConfirmed(attendee);
  assert.equal(browser.doc.getElementById('pass-name-display').textContent,attendee.name);assert.deepEqual(browser.qr,[attendee.passId]);
  assert.equal(browser.doc.getElementById('pass-phone-wrap').style.display,'none');assert.equal(browser.doc.getElementById('pass-addr-wrap').style.display,'none');
  assert.equal(browser.doc.getElementById('pass-code-display').textContent,attendee.passId);
});
test('digital pass and admin roster display short server references while QR and actions retain internal IDs',async()=>{
  const short={...attendee,ticketId:'JMU-00012'};
  const browser=browserFixture(async url=>response(url==='/api/admin-session'?{csrfToken:'fixture-csrf',expires:Date.now()+1800000}:{passes:[short]}));
  browser.context.handlePaymentConfirmed(short);assert.equal(browser.doc.getElementById('pass-code-display').textContent,'JMU-00012');assert.deepEqual(browser.qr,[attendee.passId]);
  browser.doc.getElementById('admin-pin-input').value='fixture-password';await browser.context.handleAdminLogin();
  const table=browser.doc.getElementById('admin-registrations-tbody').innerHTML;assert.ok(table.includes('<td>JMU-00012</td>'));assert.ok(table.includes('data-pass-id="'+attendee.passId+'"'));
});
test('checkout details stay only in this customer tab until payment, and the callback submits the frozen original form',async()=>{
  let checkout,verification;
  const booking={passId:attendee.passId,recoveryToken:'a'.repeat(43),order_id:'order_detailfixture',amount:24900,currency:'INR',key_id:'fixture-key'};
  const browser=browserFixture(async(url,options={})=>{
    if(url==='/api/create-order')return response(booking);
    if(url==='/api/verify-payment'){verification=JSON.parse(options.body);return response({pass:{...attendee,ticketId:'JMU-00012'}});}
    return response({pass:{...attendee,status:'pending',paymentState:'pending',awaitingDetails:true,name:''}});
  });
  browser.context.Razorpay=function(options){checkout=options;this.on=()=>{};this.open=()=>{};};
  browser.doc.getElementById('reg-name').value='Fixture attendee';browser.doc.getElementById('reg-phone').value='9999999999';await browser.context.handleStep1Submit();
  assert.equal(browser.sessionEntries.size,1);assert.ok(![...browser.storage.values()].some(v=>v.includes('Fixture attendee')));
  await checkout.handler({razorpay_order_id:booking.order_id,razorpay_payment_id:'pay_detailfixture',razorpay_signature:'b'.repeat(64)});
  assert.equal(verification.bookingDetails.name,'Fixture attendee');assert.equal(verification.bookingDetails.quantity,1);assert.match(verification.bookingDetails.idempotencyKey,/^[a-f0-9]{64}$/);
  assert.equal(browser.sessionEntries.size,0);assert.equal(browser.doc.getElementById('pass-code-display').textContent,'JMU-00012');
});
test('gate UI cannot show success before server confirmation and rejects an offline admission',async()=>{
  let resolveCheckin;let gateCalled=false;const browser=browserFixture(async(url,options={})=>{
    if(url==='/api/admin-session')return response({csrfToken:'fixture-csrf',expires:Date.now()+1800000});
    if(url.startsWith('/api/get-pass'))return response({pass:attendee});
    if(options.method==='POST'){gateCalled=true;return new Promise(resolve=>{resolveCheckin=resolve;});}
    return response({passes:[attendee]});
  });
  browser.doc.getElementById('admin-pin-input').value='fixture-password';await browser.context.handleAdminLogin();
  browser.doc.getElementById('gate-pass-input').value=attendee.passId;await browser.context.handleGateTerminalSubmit();
  const box=browser.doc.getElementById('gate-terminal-feedback'),button=box.children.find(child=>child.dataset.action==='checkin');assert.ok(button);
  box.listeners.click({target:button});await new Promise(setImmediate);assert.equal(gateCalled,true);assert.ok(!box.children.some(child=>child.textContent.includes('ENTRY CONFIRMED')));
  resolveCheckin({ok:false,status:503,json:async()=>({success:false,error:'Server unavailable'})});await new Promise(setImmediate);await new Promise(setImmediate);
  assert.ok(!box.children.some(child=>child.textContent.includes('ENTRY CONFIRMED')));assert.equal(button.disabled,false);
});
test('gate success follows committed server timestamp and group capacity',async()=>{
  const committed={...attendee,capacity:2,checkedIn:true,checkInTime:'2026-10-19T12:30:00Z'};
  const browser=browserFixture(async(url,options={})=>response(url==='/api/admin-session'?{csrfToken:'fixture',expires:Date.now()+1800000}:url.startsWith('/api/get-pass')?{pass:attendee}:options.method==='POST'?{pass:committed}:{passes:[attendee]}));
  await browser.context.handleAdminLogin();browser.doc.getElementById('gate-pass-input').value=attendee.passId;await browser.context.handleGateTerminalSubmit();
  const box=browser.doc.getElementById('gate-terminal-feedback');box.listeners.click({target:box.children.find(child=>child.dataset.action==='checkin')});await new Promise(setImmediate);await new Promise(setImmediate);
  assert.ok(box.children.some(child=>child.textContent.includes('ENTRY CONFIRMED')&&child.textContent.includes('2 persons')));
});
test('existing QR bundle exposes the renderer used by the actual pass',()=>{
  const context={window:{},console,Uint8Array,Uint16Array,ArrayBuffer,TextEncoder};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../qrcode.bundle.js'),'utf8'),context);assert.equal(typeof context.window.QRCode.toCanvas,'function');
});
test('actual checkout displays mixed server pricing and submits no client promotion eligibility',async()=>{
  let options,request;const booking={passId:attendee.passId,recoveryToken:'a'.repeat(43),order_id:'order_fixture',amount:89600,currency:'INR',key_id:'fixture-key',
    pricing:{promotionalQuantity:2,regularQuantity:2,promotionalUnitPaise:19900,regularUnitPaise:24900},promotionExpiresAt:new Date(Date.now()+1200000).toISOString()};
  const browser=browserFixture(async(url,opts={})=>{if(url==='/api/create-order'){request=JSON.parse(opts.body);return response(booking);}return response({pass:{...attendee,status:'pending',paymentState:'pending'}});});
  browser.context.Razorpay=function(value){options=value;this.on=()=>{};this.open=()=>{};};browser.context.setSoloQuantity(4);
  browser.doc.getElementById('reg-name').value='Fixture attendee';browser.doc.getElementById('reg-phone').value='9999999999';browser.context.handleStep1Submit();
  for(let i=0;i<20&&!options;i++)await new Promise(setImmediate);
  assert.ok(options);assert.equal(options.amount,89600);assert.equal(options.description,'Solo · 2 early-bird + 2 regular');
  assert.equal(request.quantity,4);for(const field of ['amount','price','promotion','promotionalQuantity','earlyBird'])assert.equal(request[field],undefined);
  assert.ok(browser.doc.getElementById('reg-pricing-detail').textContent.includes('2 early-bird × ₹199 + 2 regular × ₹249 = ₹896'));
});
test('active checkout locks booking controls and retains the server price after dismissal',async()=>{
  let options,requested,releaseQuote,paymentFailed;const quoteGate=new Promise(resolve=>{releaseQuote=resolve;});
  const booking={passId:attendee.passId,recoveryToken:'a'.repeat(43),order_id:'order_lockedfixture',amount:89600,currency:'INR',key_id:'fixture-key',pricing:{promotionalQuantity:2,regularQuantity:2,promotionalUnitPaise:19900,regularUnitPaise:24900}};
  const browser=browserFixture(async(url,opts)=>{if(url==='/api/create-order'){requested=JSON.parse(opts.body);await quoteGate;return response(booking);}return response({pass:{...attendee,status:'pending'}});});
  browser.context.Razorpay=function(value){options=value;this.on=(event,fn)=>{if(event==='payment.failed')paymentFailed=fn;};this.open=()=>{};};
  browser.context.setSoloQuantity(4);browser.doc.getElementById('reg-name').value='Fixture attendee';browser.doc.getElementById('reg-phone').value='9999999999';browser.context.handleStep1Submit();
  for(let i=0;i<20&&!requested;i++)await new Promise(setImmediate);
  assert.ok(requested);assert.equal(browser.doc.getElementById('solo-quantity-increase').disabled,true);
  browser.context.stepSoloQuantity(1);browser.context.selectWizardCategory('couple');
  assert.equal(browser.doc.getElementById('solo-quantity-value').textContent,'4');
  releaseQuote();for(let i=0;i<20&&!options;i++)await new Promise(setImmediate);assert.ok(options);
  assert.equal(browser.doc.getElementById('reg-summary-amount').textContent,'₹896');
  assert.equal(browser.doc.getElementById('btn-proceed-pay-text').textContent,'Pay Now · ₹896 ➔');
  assert.equal(typeof paymentFailed,'function');paymentFailed({error:{description:'Fixture failure'}});
  assert.equal(browser.doc.getElementById('solo-quantity-increase').disabled,true,'Razorpay may still offer retries after a failed attempt');
  options.modal.ondismiss();assert.equal(browser.doc.getElementById('btn-proceed-pay-text').textContent,'Pay Now · ₹896 ➔');
  assert.equal(browser.doc.getElementById('solo-quantity-increase').disabled,false);
  browser.context.stepSoloQuantity(1);assert.equal(browser.doc.getElementById('reg-summary-amount').textContent,'₹1245');
});
test('promotional offer is prominent, concise, Solo-only, with accessible reservation details',()=>{
  const browser=browserFixture(async()=>response({}));browser.context.openRegistrationModal();
  assert.ok(html.includes('EARLY BIRD OFFER'));assert.ok(html.includes('<details class="checkout-policy">'));
  assert.equal(browser.doc.getElementById('reg-early-bird-copy').textContent,'₹199 per person for the first 100 solo attendees.');
  assert.equal(browser.doc.getElementById('reg-pricing-detail').textContent,'Final price confirmed at checkout.');
  assert.ok(browser.doc.getElementById('reg-reservation-policy').textContent.includes('20 minutes'));
  assert.ok(browser.doc.getElementById('reg-reservation-policy').textContent.includes('do not guarantee admission'));
  assert.equal(browser.doc.getElementById('reg-price-caption').textContent,'Regular-price estimate');
  browser.context.selectWizardCategory('couple');assert.equal(browser.doc.getElementById('reg-early-bird-offer').style.display,'none');
  browser.context.selectWizardCategory('solo');assert.equal(browser.doc.getElementById('reg-early-bird-offer').style.display,'block');
});
test('exhausted promotional inventory displays the server regular quote without promising a discount',async()=>{
  let options;const booking={passId:attendee.passId,recoveryToken:'a'.repeat(43),order_id:'order_regularfixture',amount:249000,currency:'INR',key_id:'fixture-key',
    pricing:{promotionalQuantity:0,regularQuantity:10,promotionalUnitPaise:19900,regularUnitPaise:24900}};
  const browser=browserFixture(async url=>response(url==='/api/create-order'?booking:{pass:{...attendee,status:'pending'}}));
  browser.context.Razorpay=function(value){options=value;this.on=()=>{};this.open=()=>{};};browser.context.setSoloQuantity(10);
  browser.doc.getElementById('reg-name').value='Fixture attendee';browser.doc.getElementById('reg-phone').value='9999999999';browser.context.handleStep1Submit();
  for(let i=0;i<20&&!options;i++)await new Promise(setImmediate);
  assert.equal(options.amount,249000);assert.equal(browser.doc.getElementById('reg-summary-amount').textContent,'₹2490');
  assert.equal(browser.doc.getElementById('reg-pricing-detail').textContent,'10 regular × ₹249 = ₹2490');
  assert.equal(browser.doc.getElementById('reg-price-caption').textContent,'Confirmed checkout total');
});
test('SDK errors create no order; backend errors retain their own identity and unlock checkout',async()=>{
  for(const sdkFailure of [true,false]){
    let orderCalls=0;const browser=browserFixture(async()=>{orderCalls++;return {ok:false,status:503,json:async()=>({success:false,error:'Service is not configured',code:'CONFIGURATION_REQUIRED'})};});
    if(sdkFailure)browser.context.JmuCheckoutSDK.load=async()=>{const error=new Error('Secure checkout could not load. No order was created.');error.code='CHECKOUT_SDK_UNAVAILABLE';throw error;};
    else browser.context.Razorpay=function(){};
    browser.doc.getElementById('reg-name').value='Fixture attendee';browser.doc.getElementById('reg-phone').value='9999999999';await browser.context.handleStep1Submit();
    assert.equal(orderCalls,sdkFailure?0:1);assert.equal(browser.doc.getElementById('btn-proceed-pay').disabled,false);
    assert.equal(browser.doc.getElementById('reg-payment-feedback').textContent,sdkFailure?'Secure checkout could not load. No order was created.':'Service is not configured');
    browser.context.openRegistrationModal();assert.equal(browser.doc.getElementById('reg-payment-feedback').hidden,true);
  }
});
test('unexpected HTML API responses are not mistaken for SDK failures or displayed as raw HTML',async()=>{
  const browser=browserFixture(async()=>({ok:false,status:502,json:async()=>{throw new Error('<private provider details>');}}));
  browser.context.Razorpay=function(){};browser.doc.getElementById('reg-name').value='Fixture attendee';browser.doc.getElementById('reg-phone').value='9999999999';browser.context.handleStep1Submit();
  for(let i=0;i<20&&browser.doc.getElementById('reg-payment-feedback').hidden!==false;i++)await new Promise(setImmediate);
  assert.match(browser.doc.getElementById('reg-payment-feedback').textContent,/booking server returned an unexpected response/);
  assert.ok(!browser.doc.getElementById('reg-payment-feedback').textContent.includes('private provider'));
});

const paidPass={...attendee,name:'Paid fixture',ticketId:'JMU-00012',awaitingDetails:false};
const ownerEntry={passId:attendee.passId,ticketId:paidPass.ticketId,recoveryToken:'c'.repeat(43)};
const savedOwner=[['jmu_owner_tokens_v2',JSON.stringify([ownerEntry])]];
const groupInvite='https://chat.whatsapp.com/FJt21SRONmx3cnrgsd2QK0?s=sh&p=a&mlu=4&ilr=4&iam=0';
const resultCard=browser=>browser.doc.getElementById('mypass-results').children[0];
const resultText=browser=>resultCard(browser).children.map(child=>child.textContent).join(' ');

test('My Pass removes the manual private-code field and explains private cross-device recovery',()=>{
  assert.ok(!html.includes('mypass-recovery-token'));assert.ok(!html.includes('Private recovery code'));
  assert.match(html,/<label for="mypass-search-input">Ticket ID \/ Pass ID<\/label>/);
  assert.match(html,/id="mypass-search-input"[^>]*aria-describedby="mypass-device-help"/);
  assert.ok(html.includes('On a new device'));assert.ok(html.includes('private recovery link'));
  const css=fs.readFileSync(path.join(__dirname,'../styles-v2.css'),'utf8');
  assert.match(css,/\.lookup-pass-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css,/\.lookup-pass-actions \.button\s*\{[^}]*min-height:\s*48px/);
});

test('saved paid booking is retrieved on opening My Pass after reload and can download again without a new order',async()=>{
  const calls=[];
  const browser=browserFixture(async(url,opts)=>{calls.push({url,opts});return response({pass:paidPass});},{storage:savedOwner});
  await browser.context.openMyPassModal();
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/get-pass?id='+attendee.passId);
  assert.equal(calls[0].opts.headers.Authorization,'Bearer '+ownerEntry.recoveryToken);
  assert.equal(calls[0].opts.cache,'no-store');assert.equal(browser.doc.getElementById('mypass-search-input').value,'JMU-00012');
  const actions=resultCard(browser).children.find(child=>child.className==='lookup-pass-actions');
  assert.deepEqual(actions.children.map(button=>button.textContent),['Show Digital Pass','Download Ticket']);
  for(const button of actions.children)assert.equal(button.type,'button');
  let captures=0;browser.context.html2canvas=async card=>{assert.equal(card,browser.doc.getElementById('digital-pass-card'));captures++;return {toDataURL:()=> 'data:image/png;base64,fixture'};};
  await actions.children[1].listeners.click();
  assert.equal(captures,1);assert.equal(browser.clicks[0].download,'JMU-00012-Digital-Pass.png');
  assert.equal(browser.doc.getElementById('btn-join-whatsapp-group').href,groupInvite);
  assert.deepEqual(browser.qr,[attendee.passId]);
  await browser.context.openMyPassModal();
  await resultCard(browser).children.find(child=>child.className==='lookup-pass-actions').children[1].listeners.click();
  assert.equal(captures,2);assert.equal(calls.length,2);assert.ok(calls.every(call=>call.url.startsWith('/api/get-pass')));
  assert.ok(![...browser.storage.values()].some(value=>value.includes(paidPass.name)));
});

test('short-ID search uses saved private access, while another browser cannot look up or download by ID alone',async()=>{
  const calls=[],browser=browserFixture(async(url,opts)=>{calls.push({url,opts});return response({pass:paidPass});},{storage:savedOwner});
  browser.doc.getElementById('mypass-search-input').value=' jmu-00012 ';await browser.context.handleMyPassSearch();
  assert.equal(calls[0].url,'/api/get-pass?id=JMU-00012');assert.equal(calls[0].opts.headers.Authorization,'Bearer '+ownerEntry.recoveryToken);
  const empty=browserFixture(async()=>assert.fail('A guessed ID has no saved authorization'));
  empty.doc.getElementById('mypass-search-input').value='JMU-00012';await empty.context.handleMyPassSearch();
  assert.match(empty.doc.getElementById('mypass-results').textContent,/private recovery/i);assert.equal(empty.doc.getElementById('mypass-results').children.length,0);
  let captures=0;empty.context.html2canvas=async()=>{captures++;};empty.context.downloadPassAsImage();assert.equal(captures,0);
});

test('organizer recovery link clears the fragment before one authenticated lookup and normalizes the saved alias',async()=>{
  const calls=[];let browser;
  browser=browserFixture(async(url,opts)=>{calls.push({url,opts});return response({pass:paidPass});},{
    hash:'#pass=JMU-00012&access='+ownerEntry.recoveryToken});
  for(let i=0;i<5;i++)await new Promise(setImmediate);
  assert.equal(browser.history.length,1);assert.equal(browser.history[0][2],'/');assert.equal(browser.context.location.hash,'');
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/get-pass?id=JMU-00012');
  assert.equal(calls[0].opts.headers.Authorization,'Bearer '+ownerEntry.recoveryToken);
  const entries=JSON.parse(browser.storage.get('jmu_owner_tokens_v2'));assert.equal(entries.length,1);
  assert.equal(entries[0].passId,attendee.passId);assert.equal(entries[0].ticketId,'JMU-00012');
  assert.ok(!calls[0].url.includes(ownerEntry.recoveryToken));
  const invalid=browserFixture(async()=>assert.fail('Malformed recovery links must not cause a lookup'),{hash:'#pass=JMU-00012&access=invalid'});
  assert.equal(invalid.history.length,1);assert.equal(invalid.storage.has('jmu_owner_tokens_v2'),false);
});

test('the supplied shared WhatsApp invite is available on verified tickets, including browsers with the obsolete placeholder',()=>{
  for(const value of [null,'https://chat.whatsapp.com/invite','javascript:alert(1)','https://chat.whatsapp.com.evil.example/'+'a'.repeat(22)]){
    const browser=browserFixture(async()=>response({}),{storage:value?[['jmu_config_override',JSON.stringify({whatsappGroupLink:value})]]:[]});
    browser.context.handlePaymentConfirmed(paidPass);const link=browser.doc.getElementById('btn-join-whatsapp-group');
    assert.equal(link.href,groupInvite);assert.equal(link.hidden,false);assert.equal(link.style.display,'flex');
  }
  assert.match(html,/<a id="btn-join-whatsapp-group"[^>]* hidden[^>]*display:none/);
  assert.ok(html.includes('saving here does not update other browsers'));
});

test('pending, archived and refunded lookup results never expose a download action or attendee-group button',async()=>{
  for(const changes of [{status:'pending',paymentState:'pending',awaitingDetails:true,ticketId:null},
    {status:'revoked',paymentState:'revoked'},{isDeleted:true}]){
    const browser=browserFixture(async()=>response({pass:{...paidPass,...changes}}),{storage:savedOwner});
    await browser.context.openMyPassModal();assert.ok(!resultCard(browser).children.some(child=>child.className==='lookup-pass-actions'));
    browser.context.handlePaymentConfirmed({...paidPass,...changes});
    assert.equal(browser.doc.getElementById('btn-join-whatsapp-group').href,undefined);
    let captures=0;browser.context.html2canvas=async()=>{captures++;};browser.context.downloadPassAsImage();assert.equal(captures,0);
  }
});

test('My Pass resumes a captured payment even before webhook completion using only the saved original form',async()=>{
  const details={category:'solo',quantity:1,name:'Paid fixture',phone:'9999999999',idempotencyKey:'a'.repeat(64)},calls=[];
  const browser=browserFixture(async(url,opts)=>{
    calls.push({url,opts});return response({pass:url.startsWith('/api/get-pass')?{...paidPass,name:'',ticketId:null,status:'pending',paymentState:'pending',awaitingDetails:true}:paidPass});
  },{storage:savedOwner,session:[['jmu_pending_details_v1:'+attendee.passId,JSON.stringify(details)]]});
  await browser.context.openMyPassModal();assert.equal(calls.length,2);assert.equal(calls[1].url,'/api/verify-payment');
  const sent=JSON.parse(calls[1].opts.body);assert.deepEqual(sent,{passId:attendee.passId,resume:true,bookingDetails:details});
  assert.equal(calls[1].opts.headers.Authorization,'Bearer '+ownerEntry.recoveryToken);
  assert.ok(resultText(browser).includes('Payment verified'));assert.equal(browser.doc.getElementById('mypass-search-input').value,'JMU-00012');
  assert.equal(browser.sessionEntries.size,0);
  assert.ok(![...browser.storage.values()].some(value=>value.includes('Paid fixture')));
});

test('unpaid My Pass remains pending without routine organizer confirmation; missing tab details cannot auto-complete',async()=>{
  const details={name:'Unpaid fixture'},pending={...paidPass,name:'',ticketId:null,status:'pending',paymentState:'pending',awaitingDetails:true};
  for(const savedDetails of [true,false]){
    let resumes=0;const browser=browserFixture(async url=>{
      if(url==='/api/verify-payment'){resumes++;return {ok:false,status:409,json:async()=>({success:false,code:'PAYMENT_PENDING',error:'Not captured yet'})};}
      return response({pass:pending});
    },{storage:savedOwner,session:savedDetails?[['jmu_pending_details_v1:'+attendee.passId,JSON.stringify(details)]]:[]});
    await browser.context.openMyPassModal();assert.equal(resumes,savedDetails?1:0);
    assert.ok(resultText(browser).includes('after payment is verified'));assert.ok(!/organizer reconciliation/i.test(resultText(browser)));
    assert.ok(!resultCard(browser).children.some(child=>child.className==='lookup-pass-actions'));
  }
});

test('download prepares an image preview; native sharing needs a second explicit tap and uses only the selected ticket PNG',async()=>{
  const browser=browserFixture(async()=>response({}));let shares=0;
  browser.context.navigator.canShare=({files})=>files[0].type==='image/png';
  browser.context.navigator.share=async({files})=>{shares++;assert.equal(files[0].name,'JMU-00012-Digital-Pass.png');};
  browser.context.html2canvas=async()=>({toDataURL:()=> 'data:image/png;base64,fixture',toBlob:callback=>callback(new Blob(['fixture'],{type:'image/png'}))});
  browser.context.handlePaymentConfirmed(paidPass);await browser.context.downloadPassAsImage();
  assert.equal(shares,0);assert.equal(browser.doc.getElementById('pass-image-preview').hidden,false);
  assert.equal(browser.doc.getElementById('pass-image-preview').src,'data:image/png;base64,fixture');
  assert.equal(browser.doc.getElementById('btn-save-pass-image').hidden,false);
  await browser.context.savePassImage();assert.equal(shares,1);
  browser.context.handlePaymentConfirmed({...paidPass,passId:'JMU-'+ 'B'.repeat(32),ticketId:'JMU-00013'});
  assert.equal(browser.doc.getElementById('pass-image-preview').src,undefined);assert.equal(browser.doc.getElementById('btn-save-pass-image').hidden,true);
  await browser.context.savePassImage();assert.equal(shares,1,'a different booking cannot share the previous ticket image');
});

test('share cancellation and unsupported sharing retain the PNG preview; rendering failure never reports a successful download or silently prints',async()=>{
  for(const shareSupported of [true,false]){
    const browser=browserFixture(async()=>response({}));browser.context.handlePaymentConfirmed(paidPass);
    browser.context.navigator.canShare=()=>shareSupported;browser.context.navigator.share=async()=>{const e=new Error('fixture cancellation');e.name='AbortError';throw e;};
    browser.context.html2canvas=async()=>({toDataURL:()=> 'data:image/png;base64,fixture',toBlob:cb=>cb(new Blob(['fixture']))});
    await browser.context.downloadPassAsImage();assert.equal(browser.doc.getElementById('btn-save-pass-image').hidden,!shareSupported);
    await browser.context.savePassImage();assert.equal(browser.doc.getElementById('pass-image-preview').hidden,false);
  }
  const browser=browserFixture(async()=>response({}));browser.context.handlePaymentConfirmed(paidPass);
  browser.context.print=()=>assert.fail('PNG failure must not silently switch to printing');
  browser.context.html2canvas=async()=>{throw Error('fixture render failure');};await browser.context.downloadPassAsImage();
  assert.equal(browser.clicks.length,0);assert.equal(browser.doc.getElementById('pass-image-preview').hidden,true);
  assert.ok(browser.doc.getElementById('toast-container').children.some(toast=>toast.children[0].textContent.includes('Could not create the ticket image')));
  assert.ok(html.includes('not automatically in Photos'));
});

test('switching tickets while the image renders cannot download or share the old image under a different Ticket ID',async()=>{
  const browser=browserFixture(async()=>response({}));let resolveCanvas;
  browser.context.html2canvas=()=>new Promise(resolve=>{resolveCanvas=resolve;});
  browser.context.handlePaymentConfirmed(paidPass);const pending=browser.context.downloadPassAsImage();
  browser.context.handlePaymentConfirmed({...paidPass,passId:'JMU-'+ 'B'.repeat(32),ticketId:'JMU-00013'});
  resolveCanvas({toDataURL:()=> 'data:image/png;base64,old-fixture'});await pending;
  assert.equal(browser.clicks.length,0);assert.equal(browser.doc.getElementById('pass-image-preview').hidden,true);
});
