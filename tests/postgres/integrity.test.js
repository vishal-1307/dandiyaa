'use strict';
// Only explicit, disposable loopback targets. Never read .env or DATABASE_URL.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg');
const {localDatabase}=require('../../scripts/local-database');
const {preflight,applyMigrations}=require('../../scripts/migrate');
const {Repository}=require('../../server/repository');
const s=require('../../server/security');
const migration=fs.readFileSync(path.join(__dirname,'../../migrations/001_security.sql'),'utf8');
const promotionMigration=fs.readFileSync(path.join(__dirname,'../../migrations/002_early_bird.sql'),'utf8');
const target=process.env.TEST_DATABASE_URL;
// Fail, rather than skip, if an unsafe target was supplied.
if(target)localDatabase(target);
test('PostgreSQL migration, issuance and admission integrity', {skip:!target&&'TEST_DATABASE_URL not supplied; local PostgreSQL engine required'},async t=>{
  const connectionString=localDatabase(target);
  const schema='jmu_security_'+crypto.randomBytes(8).toString('hex');
  const root=new Client({connectionString,connectionTimeoutMillis:3000});await root.connect();
  const connections=new Set();
  async function client(){const c=new Client({connectionString,connectionTimeoutMillis:3000});await c.connect();connections.add(c);await c.query('SET search_path TO '+schema);return c;}
  async function repo(run){const c=await client();try{return await run(new Repository(c),c);}finally{await c.end();connections.delete(c);}}
  const input=(key,changes={})=>s.registration({category:'solo',quantity:1,name:'Integration fixture',phone:'9999999999',address:'Local test',idempotencyKey:key.repeat(64),...changes});
  async function booking(key,changes={}){return repo(async r=>{const row=await r.prepareOrder(input(key,changes),s.randomPassId(),s.hash(s.randomToken()));await r.bindOrder(row.pass_id,'order_'+key.repeat(16));return r.findOrder(row.pass_id);});}
  const payment=frozen=>({id:'pay_'+frozen.order_id.slice(6),order_id:frozen.order_id,amount:frozen.amount_paise,currency:'INR',status:'captured',captured:true,amount_refunded:0});
  try{
    await root.query('CREATE SCHEMA '+schema);await root.query('SET search_path TO '+schema);
    // Simulate the preceding four-ticket schema, then exercise its safe upgrade.
    await root.query(migration.replaceAll('BETWEEN 1 AND 10','BETWEEN 1 AND 4'));await root.query(promotionMigration.replaceAll('BETWEEN 1 AND 10','BETWEEN 1 AND 4'));
    await t.test('migration upgrades the previous quantity constraints without changing existing pass rows',async()=>{
      const f=await booking('a',{quantity:4});await root.query(migration);await root.query(promotionMigration);const row=(await root.query('SELECT * FROM jmu_passes WHERE pass_id=$1',[f.pass_id])).rows[0];assert.equal(row.payment_state,'pending');assert.equal(Number(row.amount),996);assert.equal(row.quantity,4);
    });
    await t.test('ten-person bookings verify and admit once, while SQL rejects quantities outside the limit',async()=>{
      const frozen=await booking('9',{quantity:10});assert.equal(frozen.amount_paise,249000);
      const paid=await repo(r=>r.finalize(frozen,payment(frozen),false,null,null,input('9',{quantity:10})));assert.equal(paid.quantity,10);
      const results=await Promise.allSettled(Array.from({length:6},()=>repo(r=>r.action('fixture','checkin',frozen.pass_id))));assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
      assert.ok(results.filter(row=>row.status==='rejected').every(row=>row.reason.status===409));
      const pass=(await root.query('SELECT * FROM jmu_passes WHERE pass_id=$1',[frozen.pass_id])).rows[0];
      for(const quantity of [0,11]){
        await assert.rejects(root.query('INSERT INTO jmu_passes(pass_id,category,category_key,quantity,amount,name,phone,timestamp,payment_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[s.randomPassId(),'Solo Pass','solo',quantity,249,'Boundary fixture','9999999999',Date.now(),'pending']));
      }
      assert.equal(pass.checked_in,true);
      await root.query(migration);await root.query(promotionMigration);assert.equal((await repo(r=>r.findPass(frozen.pass_id))).quantity,10);
    });
    await t.test('simultaneous identical bookings persist a single registration and frozen order',async()=>{
      const request=input('b');const outcomes=await Promise.allSettled(Array.from({length:8},()=>repo(r=>r.prepareOrder(request,s.randomPassId(),s.hash(s.randomToken())))));
      // No provider association exists yet: concurrent retries must neither
      // manufacture another order nor rotate the first checkout's access token.
      const rows=outcomes.filter(row=>row.status==='fulfilled').map(row=>row.value);
      assert.equal(rows.length,1);assert.equal(rows[0].create,true);
      assert.ok(outcomes.filter(row=>row.status==='rejected').every(row=>row.reason.code==='ORDER_PREPARING'));
      const count=await root.query('SELECT COUNT(*)::int AS n FROM jmu_orders WHERE idempotency_hash=$1',[request.keyHash]);assert.equal(count.rows[0].n,1);
    });
    await t.test('unpaid SQL records contain no attendee details; webhook-only evidence cannot admit; verified owner completion is atomic',async()=>{
      const details=s.registration({category:'solo',quantity:2,name:'Privacy fixture',phone:'9999999999',address:'Local private fixture',idempotencyKey:crypto.randomBytes(32).toString('hex')});
      const frozen=await repo(async r=>{const f=await r.prepareOrder(details,s.randomPassId(),s.hash(s.randomToken()));return r.bindOrder(f.pass_id,'order_privacyfixture');});
      const row=await repo(r=>r.findPass(frozen.pass_id));assert.equal(row.phone,'0');assert.equal(row.name,s.PENDING_NAME);assert.equal(row.address,'');assert.equal(s.publicPass(row).ticketId,null);
      assert.ok(!(await repo(r=>r.roster())).some(p=>p.pass_id===frozen.pass_id));
      await root.query("CREATE FUNCTION jmu_test_pii_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture detail write failure'; END $$");
      await root.query("CREATE TRIGGER jmu_test_pii_failure BEFORE UPDATE ON jmu_passes FOR EACH ROW WHEN (OLD.phone='0' AND NEW.phone<>'0') EXECUTE FUNCTION jmu_test_pii_failure()");
      await assert.rejects(repo(r=>r.finalize(frozen,payment(frozen),false,null,null,details)));
      assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM jmu_payments WHERE pass_id=$1',[frozen.pass_id])).rows[0].n,0);assert.equal((await repo(r=>r.findPass(frozen.pass_id))).phone,'0');
      await root.query('DROP TRIGGER jmu_test_pii_failure ON jmu_passes');
      await repo(r=>r.finalize(frozen,payment(frozen),false));
      await assert.rejects(repo(r=>r.action('fixture','checkin',frozen.pass_id)),e=>e.status===409);
      const complete=await repo(r=>r.finalize(frozen,payment(frozen),false,null,null,details));const alias=s.ticketId(complete);assert.match(alias,/^JMU-\d{5}$/);
      assert.equal((await repo(r=>r.findPass(alias))).pass_id,frozen.pass_id);assert.equal(complete.name,details.name);assert.equal(complete.phone,details.phone);
      assert.ok((await repo(r=>r.roster())).some(p=>p.pass_id===frozen.pass_id));
      const results=await Promise.allSettled(Array.from({length:5},()=>repo(r=>r.action('fixture','checkin',alias))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    });
    await t.test('explicitly rejected provider creation has a single database-backed retry claim and keeps frozen pricing',async()=>{
      const details=s.registration({category:'solo',quantity:1,name:'Retry fixture',phone:'9999999999',idempotencyKey:crypto.randomBytes(32).toString('hex')});
      const frozen=await repo(r=>r.prepareOrder(details,s.randomPassId(),s.hash(s.randomToken())));await repo(async r=>{await r.markUnknown(frozen.pass_id);await r.audit('system','order-create-rejected',frozen.pass_id,'400');});
      const claims=await Promise.all(Array.from({length:8},()=>repo(r=>r.claimRejectedRetry(frozen.pass_id))));assert.equal(claims.filter(Boolean).length,1);
      const unchanged=await repo(r=>r.findOrder(frozen.pass_id));assert.equal(unchanged.amount_paise,frozen.amount_paise);assert.equal(unchanged.request_hash,frozen.request_hash);
      await repo(r=>r.markUnknown(frozen.pass_id));assert.equal(await repo(r=>r.claimRejectedRetry(frozen.pass_id)),false);
    });
    await t.test('row locks make simultaneous callback and webhook finalization idempotent',async()=>{
      const frozen=await booking('c',{quantity:4});const paid=await Promise.all(Array.from({length:10},()=>repo(r=>r.finalize(frozen,payment(frozen),false))));
      assert.ok(paid.every(row=>row.payment_state==='verified'));const count=await root.query('SELECT COUNT(*)::int AS n FROM jmu_payments WHERE pass_id=$1',[frozen.pass_id]);assert.equal(count.rows[0].n,1);
    });
    await t.test('admission concurrency commits exactly one group admission',async()=>{
      const details={category:'couple',partnerName:'Second fixture',partnerPhone:'8888888888'};
      const frozen=await booking('d',details);await repo(r=>r.finalize(frozen,payment(frozen),false,null,null,input('d',details)));
      const outcomes=await Promise.allSettled(Array.from({length:10},()=>repo(r=>r.action('fixture','checkin',frozen.pass_id))));
      assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);assert.ok(outcomes.filter(result=>result.status==='rejected').every(result=>result.reason.status===409));
      const row=await repo(r=>r.findPass(frozen.pass_id));assert.ok(row.check_in_at instanceof Date);assert.equal(s.publicPass(row).capacity,2);
      await repo(r=>r.action('fixture','undo-checkin',frozen.pass_id,{},'Wrong group scanned'));assert.equal((await repo(r=>r.findPass(frozen.pass_id))).checked_in,false);
    });
    await t.test('pending admission, client status and frozen-price edits cannot bypass evidence',async()=>{
      const frozen=await booking('e');await assert.rejects(repo(r=>r.action('fixture','checkin',frozen.pass_id)),error=>error.status===409);
      await assert.rejects(root.query("UPDATE jmu_passes SET payment_state='verified' WHERE pass_id=$1",[frozen.pass_id]));
      await assert.rejects(root.query('UPDATE jmu_passes SET amount=1 WHERE pass_id=$1',[frozen.pass_id]));
      await assert.rejects(root.query('UPDATE jmu_orders SET amount_paise=1 WHERE pass_id=$1',[frozen.pass_id]));
      await assert.rejects(root.query('UPDATE jmu_orders SET order_id=$1 WHERE pass_id=$2',['order_replaced',frozen.pass_id]));
      await assert.rejects(root.query("INSERT INTO jmu_payments(payment_id,order_id,pass_id,amount_paise,currency,state) VALUES($1,$2,$3,1,'INR','verified')",['pay_wrongamount',frozen.order_id,frozen.pass_id]));
    });
    await t.test('one provider payment cannot fund two different registrations',async()=>{
      const first=await booking('f'),second=await booking('1');await repo(r=>r.finalize(first,payment(first),false));
      await assert.rejects(repo(r=>r.finalize(second,payment(first),false)),error=>error.status===409);assert.equal((await repo(r=>r.findPass(second.pass_id))).payment_state,'pending');
    });
    await t.test('revocation is irreversible despite stale callback state',async()=>{
      const frozen=await booking('2');await repo(r=>r.finalize(frozen,payment(frozen),false));await repo(r=>r.finalize(frozen,payment(frozen),true));
      const stale=await repo(r=>r.finalize(frozen,payment(frozen),false));assert.equal(stale.payment_state,'revoked');await assert.rejects(root.query("UPDATE jmu_payments SET state='verified' WHERE pass_id=$1",[frozen.pass_id]));
    });
    await t.test('payment commit and webhook completion roll back together on a database error',async()=>{
      const frozen=await booking('3');await repo(r=>r.recordEvent({id:'evt_rollback',digest:s.hash('fixture'),type:'payment.captured',orderId:frozen.order_id,paymentId:payment(frozen).id}));
      await root.query("CREATE FUNCTION jmu_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$");
      await root.query('CREATE TRIGGER jmu_test_failure BEFORE UPDATE ON jmu_passes FOR EACH ROW EXECUTE FUNCTION jmu_test_failure()');
      await assert.rejects(repo(r=>r.finalize(frozen,payment(frozen),false,'evt_rollback')));await root.query('DROP TRIGGER jmu_test_failure ON jmu_passes');
      assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM jmu_payments WHERE pass_id=$1',[frozen.pass_id])).rows[0].n,0);
      assert.equal((await repo(r=>r.findPass(frozen.pass_id))).payment_state,'pending');assert.equal((await root.query("SELECT state FROM jmu_webhook_events WHERE event_id='evt_rollback'")).rows[0].state,'received');
      await repo(r=>r.finalize(frozen,payment(frozen),false,'evt_rollback'));assert.equal((await root.query("SELECT state FROM jmu_webhook_events WHERE event_id='evt_rollback'")).rows[0].state,'done');
    });
    await t.test('throttling remains atomic across independent connections',async()=>{
      const outcomes=await Promise.allSettled(Array.from({length:12},()=>repo(r=>r.throttle('test-login',Date.now(),5,900000))));assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,5);assert.ok(outcomes.filter(row=>row.status==='rejected').every(row=>row.reason.status===429));
    });
    await t.test('reconciliation audit failure rolls payment and event completion back together',async()=>{
      const frozen=await booking('6'),paid=payment(frozen);
      await repo(r=>r.recordEvent({id:'evt_audit_rollback',digest:s.hash('audit fixture'),type:'payment.captured',orderId:frozen.order_id,paymentId:paid.id}));
      await root.query("CREATE FUNCTION jmu_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit rollback'; END $$");
      await root.query('CREATE TRIGGER jmu_test_audit_failure BEFORE INSERT ON jmu_audit FOR EACH ROW EXECUTE FUNCTION jmu_test_audit_failure()');
      try {
        await assert.rejects(repo(r=>r.finalize(frozen,paid,false,'evt_audit_rollback',{actor:'fixture',reason:'Evidence checked'})));
        assert.equal((await repo(r=>r.findPass(frozen.pass_id))).payment_state,'pending');
        assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM jmu_payments WHERE pass_id=$1',[frozen.pass_id])).rows[0].n,0);
        assert.equal((await root.query("SELECT state FROM jmu_webhook_events WHERE event_id='evt_audit_rollback'")).rows[0].state,'received');
      } finally {await root.query('DROP TRIGGER jmu_test_audit_failure ON jmu_audit');}
      await repo(r=>r.finalize(frozen,paid,false,'evt_audit_rollback',{actor:'fixture',reason:'Evidence checked'}));
      assert.equal((await root.query("SELECT COUNT(*)::int AS n FROM jmu_audit WHERE action='reconcile' AND pass_id=$1",[frozen.pass_id])).rows[0].n,1);
    });
    await t.test('a failed second migration rolls back the complete schema set and preserves registrations',async()=>{
      const before=(await root.query('SELECT COUNT(*)::int AS n FROM jmu_passes')).rows[0].n;
      await assert.rejects(applyMigrations(root,[migration,"BEGIN;\nCREATE TABLE jmu_test_should_rollback(id INT);\nSELECT jmu_deliberately_missing_function();\nCOMMIT;\n"]));
      assert.equal((await root.query("SELECT to_regclass('jmu_test_should_rollback') AS x")).rows[0].x,null);
      assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM jmu_passes')).rows[0].n,before);
      // The prior promotion-aware price guard must still be installed.
      const frozen=await booking('7');await assert.rejects(root.query('UPDATE jmu_orders SET amount_paise=1 WHERE pass_id=$1',[frozen.pass_id]));
      await applyMigrations(root);assert.equal((await repo(r=>r.findPass(frozen.pass_id))).payment_state,'pending');
    });
    await t.test('actual in-flight checkout retries retain the first owner capability and one provider order',async()=>{
      const {harness,env}=require('../helpers'),fixture=harness();let release,started;
      const waiting=new Promise(resolve=>{release=resolve;}),persisted=new Promise(resolve=>{started=resolve;});
      const create=fixture.provider.orders.create;
      fixture.provider.orders.create=async options=>{started();await waiting;const row=await create(options);fixture.orders.delete(row.id);row.id='order_racefixture';fixture.orders.set(row.id,row);return row;};
      const handlers=require('../../server/handlers').createHandlers({env,provider:fixture.provider,database:run=>repo(run),campaign:{enabled:false}});
      async function invoke(name,body,headers={}){
        const req={method:'POST',body,headers:{origin:env.APP_ORIGIN,'content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.4'}};
        const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
        await handlers[name](req,res);return res;
      }
      const body={...fixture.valid,quantity:10,idempotencyKey:'8'.repeat(64)},first=invoke('createOrder',body);await persisted;
      try {const retry=await invoke('createOrder',body);assert.equal(retry.code,409);assert.equal(retry.body.code,'ORDER_PREPARING');} finally {release();}
      const created=await first;assert.equal(created.code,200);assert.equal(created.body.amount,249000);assert.equal(fixture.calls.create,1);
      const owner=await repo(r=>r.findPass(created.body.passId));assert.equal(owner.recovery_hash,s.hash(created.body.recoveryToken));assert.equal(owner.quantity,10);
      const oldPaymentId=fixture.capture(created.body),paid=fixture.paymentRows.get(oldPaymentId);fixture.paymentRows.delete(oldPaymentId);paid.id='pay_racefixture';fixture.paymentRows.set(paid.id,paid);
      const verified=await invoke('verifyPayment',fixture.verification(created.body,paid.id,body),{authorization:'Bearer '+created.body.recoveryToken});
      assert.equal(verified.code,200);assert.equal(verified.body.pass.quantity,10);
    });
    await t.test('stored attacker strings are data in parameterized administrative writes',async()=>{
      const frozen=await booking('4');await repo(r=>r.finalize(frozen,payment(frozen),false,null,null,input('4')));
      const name="'); DROP TABLE jmu_passes; --";await repo(r=>r.action('fixture','update',frozen.pass_id,{name},''));assert.equal((await repo(r=>r.findPass(frozen.pass_id))).name,name);assert.ok((await root.query('SELECT COUNT(*)::int AS n FROM jmu_passes')).rows[0].n>0);
    });
    await t.test('historical approved records survive and are not treated as payment evidence',async()=>{
      await root.query("INSERT INTO jmu_passes(pass_id,category,amount,name,phone,timestamp,status) VALUES('JMU-OLD123','Solo Pass',249,'Legacy fixture','9999999999',1,'approved')");
      const row=await repo(r=>r.findPass('JMU-OLD123'));assert.equal(row.payment_state,'legacy_unverified');assert.equal(s.publicPass(row).status,'pending');await assert.rejects(repo(r=>r.action('fixture','checkin',row.pass_id)),error=>error.status===409);
    });
    await t.test('actual checkout, callback, webhook and gate handlers share transactional PostgreSQL authority',async()=>{
      const {harness,env,password}=require('../helpers');const fixture=harness();
      const handlers=require('../../server/handlers').createHandlers({env,provider:fixture.provider,database:run=>repo(run)});
      async function invoke(name,{method='POST',body,headers={},rawBody,query={}}={}){
        const req={method,body,rawBody,query,headers:{origin:env.APP_ORIGIN,'content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.2'}};
        const res={code:200,headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};await handlers[name](req,res);return res;
      }
      const created=await invoke('createOrder',{body:{...fixture.valid,quantity:3,idempotencyKey:'5'.repeat(64)}});assert.equal(created.code,200);const ticket=created.body,paymentId=fixture.capture(ticket);
      const raw=fixture.webhookBody(ticket,paymentId);const signature=crypto.createHmac('sha256',env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
      const outcomes=await Promise.all([
        ...Array.from({length:8},()=>invoke('verifyPayment',{body:fixture.verification(ticket,paymentId,{...fixture.valid,quantity:3,idempotencyKey:'5'.repeat(64)}),headers:{authorization:'Bearer '+ticket.recoveryToken}})),
        ...Array.from({length:4},(_,index)=>invoke('webhook',{rawBody:raw,headers:{'x-razorpay-signature':signature,'x-razorpay-event-id':'evt_concurrent_'+index}}))
      ]);assert.ok(outcomes.every(result=>result.code===200));assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM jmu_payments WHERE pass_id=$1',[ticket.passId])).rows[0].n,1);
      assert.equal((await root.query("SELECT COUNT(*)::int AS n FROM jmu_webhook_events WHERE event_id LIKE 'evt_concurrent_%' AND state='done'")).rows[0].n,4);
      const logged=await invoke('adminSession',{body:{password}});assert.equal(logged.code,200);const auth={cookie:logged.headers['Set-Cookie'].split(';')[0],'x-csrf-token':logged.body.csrfToken};
      const gate=await Promise.all(Array.from({length:8},()=>invoke('allPasses',{headers:auth,body:{action:'checkin',passId:ticket.passId}})));
      assert.equal(gate.filter(result=>result.code===200).length,1);assert.ok(gate.filter(result=>result.code!==200).every(result=>result.code===409));assert.equal(gate.find(result=>result.code===200).body.pass.capacity,3);
      const refundRaw=fixture.webhookBody(ticket,paymentId,'refund.processed'),refundHeaders={'x-razorpay-signature':crypto.createHmac('sha256',env.RAZORPAY_WEBHOOK_SECRET).update(refundRaw).digest('hex'),'x-razorpay-event-id':'evt_refund_providerlag'};
      const staleRefund=await invoke('webhook',{rawBody:refundRaw,headers:refundHeaders});assert.equal(staleRefund.code,503);
      assert.equal((await root.query("SELECT state FROM jmu_webhook_events WHERE event_id='evt_refund_providerlag'")).rows[0].state,'retry');
      assert.equal((await invoke('allPasses',{headers:auth,body:{action:'undo-checkin',passId:ticket.passId,reason:'Isolated pending-refund gate test'}})).code,200);
      assert.equal((await invoke('allPasses',{headers:auth,body:{action:'checkin',passId:ticket.passId}})).code,409);
      assert.equal((await repo(r=>r.findPass(ticket.passId))).checked_in,false);
      Object.assign(fixture.paymentRows.get(paymentId),{status:'refunded',amount_refunded:ticket.amount,refund_status:'full'});
      assert.equal((await invoke('webhook',{rawBody:refundRaw,headers:refundHeaders})).code,200);
      assert.equal((await repo(r=>r.findPass(ticket.passId))).payment_state,'revoked');
    });
    await t.test('historical reconciliation and organizer recovery preserve the original ticket ID',async()=>{
      const {env,password}=require('../helpers');const order={id:'order_legacyfixture',receipt:'JMU-OLD123',amount:24900,currency:'INR',status:'paid',amount_paid:24900,amount_due:0,partial_payment:false};
      const payment={id:'pay_legacyfixture',order_id:order.id,amount:24900,currency:'INR',status:'captured',captured:true,amount_refunded:0};
      const provider={orders:{fetch:async()=>order,fetchPayments:async()=>({items:[payment]})},payments:{fetch:async()=>payment}};
      const handlers=require('../../server/handlers').createHandlers({env,provider,database:run=>repo(run)});
      async function invoke(name,{body,headers={},method='POST',query={}}={}){
        const req={method,body,query,headers:{origin:env.APP_ORIGIN,'content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.3'}};
        const res={code:200,headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};await handlers[name](req,res);return res;
      }
      const session=await invoke('adminSession',{body:{password}});const auth={cookie:session.headers['Set-Cookie'].split(';')[0],'x-csrf-token':session.body.csrfToken};
      const result=await invoke('allPasses',{headers:auth,body:{action:'reconcile',passId:'JMU-OLD123',orderId:order.id,reason:'Provider history inspected'}});
      assert.equal(result.code,200);assert.equal(result.body.pass.passId,'JMU-OLD123');assert.equal(result.body.pass.status,'approved');
      const recovery=await invoke('allPasses',{headers:auth,body:{action:'recovery',passId:'JMU-OLD123',reason:'Owner identity verified outside the app'}});assert.equal(recovery.code,200);
      const lookup=await invoke('getPass',{method:'GET',query:{id:'JMU-OLD123'},headers:{authorization:'Bearer '+recovery.body.recoveryToken}});assert.equal(lookup.code,200);assert.equal(lookup.body.pass.phone,undefined);assert.equal(lookup.body.pass.name,'Legacy fixture');
      assert.equal((await repo(r=>r.findPass('JMU-OLD123'))).recovery_hash,s.hash(recovery.body.recoveryToken));
    });
    await t.test('conflicting historical records abort migration and preserve rows',async()=>{
      // Separate disposable schema, no public tables are changed.
      const oldSchema=schema+'_legacy';await root.query('CREATE SCHEMA '+oldSchema);await root.query('SET search_path TO '+oldSchema);
      await root.query("CREATE TABLE jmu_passes(id SERIAL PRIMARY KEY,pass_id VARCHAR(64) UNIQUE NOT NULL,category TEXT NOT NULL,amount NUMERIC NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,address TEXT,timestamp BIGINT NOT NULL,quantity INT,status TEXT)");
      await root.query("INSERT INTO jmu_passes(pass_id,category,amount,name,phone,timestamp,quantity,status) VALUES('JMU-case1','Solo Pass',249,'First','9999999999',1,1,'approved'),('JMU-CASE1','Solo Pass',249,'Second','9999999999',2,1,'approved')");
      const report=await preflight(root);assert.equal(report.blocking,1);assert.ok(report.issues.some(issue=>issue.name==='historical_approvals_requiring_provider_reconciliation'&&issue.count===2));
      await assert.rejects(root.query(migration));await root.query('ROLLBACK');assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM jmu_passes')).rows[0].n,2);assert.equal((await root.query("SELECT to_regclass('jmu_orders') AS x")).rows[0].x,null);
      await root.query('SET search_path TO '+schema);await root.query('DROP SCHEMA '+oldSchema+' CASCADE');
    });
  }finally{
    await Promise.all([...connections].map(c=>c.end()));await root.query('ROLLBACK');
    // Only the exact random schema created above in the guarded test database.
    await root.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await root.query('DROP SCHEMA IF EXISTS '+schema+'_legacy CASCADE');await root.end();
  }
});
