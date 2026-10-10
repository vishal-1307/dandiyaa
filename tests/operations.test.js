'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {localDatabase}=require('../scripts/local-database');
test('administrator hash utility produces independently salted compatible scrypt hashes',async()=>{
  const {encodePassword}=require('../scripts/hash-admin-password'),security=require('../server/security');const password='fixture-unique-long-password';
  const first=encodePassword(password),second=encodePassword(password);assert.notEqual(first,second);assert.equal(await security.passwordMatches(password,first),true);assert.throws(()=>encodePassword('short'));
});
test('test and migration commands reject cloud, production-named and indirect connection targets',()=>{
  for(const target of [undefined,'postgres://user:fixture@db.example/jmu_test_security','postgres://localhost/production','postgres://localhost/jmu_test_safe?host=db.example','postgres://localhost/jmu_test_safe#x','mysql://localhost/jmu_test_safe','postgres://localhost/jmu_test_%2Fescape'])assert.throws(()=>localDatabase(target));
  assert.equal(localDatabase('postgres://fixture:fixture@127.0.0.1:55432/jmu_test_security'),'postgres://fixture:fixture@127.0.0.1:55432/jmu_test_security');
});
test('request-scoped Neon connection is released and pool ended after success, query failure and connection failure',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../server/database.js'),'utf8');
  for(const outcome of ['success','operation-error','connection-error']){
    let released=0,ended=0,created=0;const client={release(){released++;}};
    class Pool{constructor(){created++;}on(){}async connect(){if(outcome==='connection-error')throw new Error('fixture');return client;}async end(){ended++;}}
    const module={exports:{}};const context={module,require:name=>name==='@neondatabase/serverless'?{Pool}:name==='./repository'?{Repository:class{}}:require('../server/security')};
    vm.runInNewContext(source,context);const run=()=>module.exports.withDatabase({DATABASE_URL:'fixture-not-connected'},async()=>{if(outcome==='operation-error')throw new Error('fixture');return 'ok';});
    if(outcome==='success')assert.equal(await run(),'ok');else await assert.rejects(run());assert.equal(created,1);assert.equal(ended,1);assert.equal(released,outcome==='connection-error'?0:1);
  }
});
test('migration runner commits the complete set once and rolls back every step on failure',async()=>{
  const {applyMigrations}=require('../scripts/migrate');
  for(const fail of [false,true]){
    const calls=[],client={async query(sql){calls.push(sql);if(fail&&sql.includes('SECOND_STEP'))throw new Error('Isolated migration failure');return {rows:[]};}};
    const run=()=>applyMigrations(client,['-- First\nBEGIN;\nSELECT 1;\nCOMMIT;\n','BEGIN;\nSELECT 2 AS SECOND_STEP;\nCOMMIT;\n']);
    if(fail)await assert.rejects(run());else await run();
    assert.equal(calls[0],'BEGIN');assert.equal(calls.at(-1),fail?'ROLLBACK':'COMMIT');assert.equal(calls.filter(sql=>sql==='COMMIT').length,fail?0:1);
  }
});
test('Neon idle transport errors are handled without logging secret error details',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../server/database.js'),'utf8');let listener,released=false,ended=false;const logs=[];
  class Pool{on(event,fn){assert.equal(event,'error');listener=fn;}async connect(){return {release(){released=true;}};}async end(){ended=true;}}
  const module={exports:{}};vm.runInNewContext(source,{module,console:{error:(...args)=>logs.push(args)},require:name=>name==='@neondatabase/serverless'?{Pool}:name==='./repository'?{Repository:class{}}:require('../server/security')});
  await module.exports.withDatabase({DATABASE_URL:'fixture-not-connected'},async()=>{listener(new Error('DO NOT LOG PRIVATE CONNECTION DETAILS'));});
  assert.ok(released&&ended);assert.equal(logs.length,1);assert.ok(!JSON.stringify(logs).includes('DO NOT LOG'));
});
test('migration preflight is read-only and reports conflicts without exposing rows',async()=>{
  const calls=[];const client={async query(sql){calls.push(sql);if(sql.includes('to_regclass'))return {rows:[{existing:'jmu_passes'}]};if(sql.includes('column_name'))return {rows:['quantity','status','razorpay_order_id','razorpay_payment_id'].map(column_name=>({column_name}))};return {rows:[{count:sql.includes('GROUP BY UPPER')?1:0}]};}};
  const report=await require('../scripts/migrate').preflight(client);assert.equal(report.blocking,1);assert.ok(calls.every(sql=>/^SELECT /.test(sql)));assert.ok(!JSON.stringify(report).includes('name:'));
});
test('static build serves only the allowlist, never environment, report, backend or initialization files',()=>{
  const build=require('../scripts/build-static');build.build();
  const files=fs.readdirSync(build.output);assert.ok(files.includes('security-ui.js'));assert.ok(files.every(file=>build.staticFiles.includes(file)||['assets','.jmu-generated'].includes(file)));
  for(const excluded of ['api','server','scripts','migrations','node_modules','.env','package.json','ANTIGRAVITY_SECURITY_DISCOVERY.md','CODEX_SECURITY_AUDIT.md'])assert.ok(!files.includes(excluded));
  assert.equal(require('../vercel.json').outputDirectory,'public');assert.ok(fs.readdirSync(path.join(__dirname,'../api')).every(file=>!file.startsWith('db.')));
});

test('actual deployment-boundary and value-redacted historical exposure checks pass',()=>{
  require('../scripts/verify-security-boundaries').verify();
});

test('root and legacy flow wrappers report a failed child spawn, not a passing test',()=>{
  for(const file of ['scripts/test-registration-flow.js','jaynagar-milan-utsav/scripts/test-registration-flow.js']){
    const process={execPath:'node',exitCode:undefined};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{process,__dirname:path.dirname(path.join(__dirname,'..',file)),require:name=>name==='node:child_process'?{spawnSync:()=>({status:null,error:new Error('fixture spawn failure')})}:require(name)});
    assert.equal(process.exitCode,1);
  }
});
