'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {Client}=require('pg'),{localDatabase}=require('../../scripts/local-database'),{Repository}=require('../../server/repository');
const s=require('../../server/security'),{EARLY_BIRD}=require('../../server/pricing');
const target=process.env.TEST_DATABASE_URL;if(target)localDatabase(target);
test('PostgreSQL early-bird allocation and expiry', {skip:!target&&'Explicit disposable local PostgreSQL required'},async t=>{
  const connectionString=localDatabase(target),schema='jmu_promo_'+crypto.randomBytes(8).toString('hex');
  const root=new Client({connectionString,connectionTimeoutMillis:3000});await root.connect();
  async function repo(run){const c=new Client({connectionString,connectionTimeoutMillis:3000});await c.connect();try{await c.query('SET search_path TO '+schema);return await run(new Repository(c),c);}finally{await c.end();}}
  const key=()=>crypto.randomBytes(32).toString('hex');
  const input=(quantity,bookingKey=key())=>s.registration({category:'solo',quantity,name:'Promotion fixture',phone:'9999999999',address:'',idempotencyKey:bookingKey});
  const campaign=key=>({...EARLY_BIRD,key:'fixture-'+key});
  async function book(config,quantity=4,bookingKey=key()){return repo(r=>r.prepareOrder(input(quantity,bookingKey),s.randomPassId(),s.hash(s.randomToken()),config));}
  try{
    await root.query('CREATE SCHEMA '+schema);await root.query('SET search_path TO '+schema);
    for(const file of ['001_security.sql','002_early_bird.sql'])await root.query(fs.readFileSync(path.join(__dirname,'../../migrations',file),'utf8'));
    await t.test('32 concurrent four-person bookings reserve exactly 100 discounted attendees',async()=>{
      const config=campaign('concurrent');const rows=await Promise.all(Array.from({length:32},()=>book(config)));
      assert.equal(rows.reduce((n,row)=>n+row.promotion_units,0),100);assert.equal((await root.query('SELECT used_units FROM jmu_campaigns WHERE campaign_key=$1',[config.key])).rows[0].used_units,100);
      assert.ok(rows.every(row=>row.amount_paise===24900*(4-row.promotion_units)+19900*row.promotion_units));
    });
    await t.test('concurrent ten-person promotional bookings still consume at most 100 individual slots',async()=>{
      const config=campaign('ten-person');const rows=await Promise.all(Array.from({length:12},()=>book(config,10)));
      assert.equal(rows.reduce((sum,row)=>sum+row.promotion_units,0),100);
      assert.ok(rows.every(row=>row.quantity===10&&row.amount_paise===24900*(10-row.promotion_units)+19900*row.promotion_units));
      const promoted=rows.find(row=>row.promotion_units===10);assert.ok(promoted);
      await repo(r=>r.bindOrder(promoted.pass_id,'order_tenpromofixture'));const frozen=await repo(r=>r.findOrder(promoted.pass_id));
      const payment={id:'pay_tenpromofixture',order_id:frozen.order_id,amount:199000,currency:'INR',status:'captured',captured:true,amount_refunded:0};
      const pass=await repo(r=>r.finalize(frozen,payment,false));assert.equal(pass.payment_state,'verified');assert.equal(pass.quantity,10);
      assert.equal((await root.query('SELECT used_units FROM jmu_campaigns WHERE campaign_key=$1',[config.key])).rows[0].used_units,100);
    });
    await t.test('mixed groups use only remaining slots and retries preserve their exact price',async()=>{
      const config=campaign('mixed');await Promise.all(Array.from({length:24},()=>book(config)));await book(config,2);
      const bookingKey=key(),last=await book(config,4,bookingKey);assert.equal(last.promotion_units,2);assert.equal(last.amount_paise,89600);
      await repo(r=>r.bindOrder(last.pass_id,'order_mixedfixture'));const retries=await Promise.all(Array.from({length:10},()=>book(config,4,bookingKey)));
      assert.ok(retries.every(row=>row.pass_id===last.pass_id&&row.amount_paise===89600&&row.promotion_units===2));
      assert.equal((await root.query('SELECT used_units FROM jmu_campaigns WHERE campaign_key=$1',[config.key])).rows[0].used_units,100);
      await assert.rejects(root.query('UPDATE jmu_orders SET promotion_units=0,amount_paise=99600 WHERE pass_id=$1',[last.pass_id]));
      await assert.rejects(root.query('UPDATE jmu_passes SET amount=996,promotion_units=0,promotion_key=NULL,promotion_expires_at=NULL WHERE pass_id=$1',[last.pass_id]));
    });
    await t.test('expired unpaid slots are reclaimed; late payment is durably ineligible and replay safe',async()=>{
      const config={...campaign('expiry'),reservationMinutes:1/60},bookingKey=key(),old=await book(config,4,bookingKey);await repo(r=>r.bindOrder(old.pass_id,'order_expiredfixture'));
      await new Promise(resolve=>setTimeout(resolve,1100));await assert.rejects(book(config,4,bookingKey),error=>error.code==='PROMOTION_EXPIRED');
      const fresh=await book(config);assert.equal(fresh.promotion_units,4);const frozen=await repo(r=>r.findOrder(old.pass_id));
      const payment={id:'pay_expiredfixture',order_id:frozen.order_id,amount:frozen.amount_paise,currency:'INR',status:'captured',captured:true,amount_refunded:0};
      const provider={orders:{fetch:async()=>({id:frozen.order_id,receipt:frozen.pass_id,amount:frozen.amount_paise,currency:'INR',status:'paid',amount_paid:frozen.amount_paise,amount_due:0,partial_payment:false})},payments:{fetch:async()=>payment}};
      const outcomes=await Promise.all(Array.from({length:8},()=>repo(r=>require('../../server/payments').reconcile(r,provider,frozen,payment.id))));assert.ok(outcomes.every(row=>row.payment_state==='review_required'));
      const count=await root.query('SELECT used_units FROM jmu_campaigns WHERE campaign_key=$1',[config.key]);assert.equal(count.rows[0].used_units,4);
      assert.equal((await root.query('SELECT state FROM jmu_payments WHERE payment_id=$1',[payment.id])).rows[0].state,'review_required');
      await assert.rejects(repo(r=>r.action('fixture','checkin',old.pass_id)),error=>error.status===409);assert.equal((await repo(r=>r.findOrder(old.pass_id))).amount_paise,79600);
      await assert.rejects(root.query("UPDATE jmu_promotion_reservations SET state='redeemed' WHERE pass_id=$1",[old.pass_id]));
    });
    await t.test('successful redemption never releases a slot on expiry or refund',async()=>{
      const config={...campaign('redeemed'),reservationMinutes:1/60},first=await book(config,1);await repo(r=>r.bindOrder(first.pass_id,'order_redeemedfixture'));
      const frozen=await repo(r=>r.findOrder(first.pass_id));const payment={id:'pay_redeemedfixture'};await repo(r=>r.finalize(frozen,payment,false));
      await new Promise(resolve=>setTimeout(resolve,1100));await book(config,1);await repo(r=>r.finalize(frozen,payment,true));
      assert.equal((await root.query('SELECT used_units FROM jmu_campaigns WHERE campaign_key=$1',[config.key])).rows[0].used_units,2);assert.equal((await repo(r=>r.findPass(first.pass_id))).payment_state,'revoked');
    });
    await t.test('regular and historical prices remain intact through the promotional migration',async()=>{
      const regular=await repo(r=>r.prepareOrder(input(4),s.randomPassId(),s.hash(s.randomToken()),{enabled:false}));assert.equal(regular.amount_paise,99600);assert.equal(regular.promotion_units,0);
      await root.query(fs.readFileSync(path.join(__dirname,'../../migrations/002_early_bird.sql'),'utf8'));assert.equal((await repo(r=>r.findOrder(regular.pass_id))).amount_paise,99600);
      const couple=s.registration({category:'couple',quantity:1,name:'Couple fixture',phone:'9999999999',partnerName:'Spouse fixture',idempotencyKey:key()});const row=await repo(r=>r.prepareOrder(couple,s.randomPassId(),s.hash(s.randomToken()),campaign('couple')));assert.equal(row.amount_paise,39900);assert.equal(row.promotion_units,0);
    });
  }finally{await root.query('ROLLBACK');await root.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await root.end();}
});
