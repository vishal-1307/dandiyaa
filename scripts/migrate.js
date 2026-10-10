'use strict';
const fs=require('node:fs'),path=require('node:path');
const {localDatabase}=require('./local-database');
async function preflight(client) {
  const exists=await client.query("SELECT to_regclass('jmu_passes') AS existing");
  if(!exists.rows[0].existing)return {emptyDatabase:true,blocking:0,issues:[]};
  const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='jmu_passes'")).rows.map(row=>row.column_name);
  const statements=[
    ['case_duplicate_ids','SELECT COUNT(*)::int AS count FROM (SELECT UPPER(pass_id) FROM jmu_passes GROUP BY UPPER(pass_id) HAVING COUNT(*)>1) x',true],
    ['invalid_ticket_ids',"SELECT COUNT(*)::int AS count FROM jmu_passes WHERE pass_id IS NULL OR pass_id !~* '^JMU-[A-Z0-9]{4,60}$'",true],
    ['invalid_amounts',"SELECT COUNT(*)::int AS count FROM jmu_passes WHERE amount IS NULL OR amount<=0 OR amount='NaN'::numeric",true],
    ['invalid_names_phones',"SELECT COUNT(*)::int AS count FROM jmu_passes WHERE name IS NULL OR name='' OR phone IS NULL OR phone=''",true]
  ];
  if(columns.includes('quantity'))statements.push(['invalid_quantities','SELECT COUNT(*)::int AS count FROM jmu_passes WHERE quantity IS NULL OR quantity NOT BETWEEN 1 AND 10',true]);
  if(columns.includes('quantity')){
    const soloPrice=columns.includes('promotion_units')?'24900*(quantity-promotion_units)+19900*promotion_units':'24900*quantity';
    statements.push(['historical_catalog_mismatches',`SELECT COUNT(*)::int AS count FROM jmu_passes WHERE (category LIKE '%Couple%' AND (quantity<>1 OR amount<>399)) OR (category LIKE 'Solo Pass%' AND amount*100<>${soloPrice}) OR (category NOT LIKE '%Couple%' AND category NOT LIKE 'Solo Pass%')`,false]);
  }
  for(const column of ['razorpay_order_id','razorpay_payment_id'])if(columns.includes(column))statements.push([column+'_duplicates',`SELECT COUNT(*)::int AS count FROM (SELECT ${column} FROM jmu_passes WHERE ${column} IS NOT NULL GROUP BY ${column} HAVING COUNT(*)>1) x`,true]);
  if(columns.includes('status'))statements.push(['historical_approvals_requiring_provider_reconciliation',"SELECT COUNT(*)::int AS count FROM jmu_passes WHERE status='approved'"+(columns.includes('payment_state')?" AND payment_state='legacy_unverified'":''),false]);
  const issues=[];let blocking=0;
  for(const [name,sql,blocks]of statements){const count=(await client.query(sql)).rows[0].count;if(count){issues.push({name,count,blocking:blocks});if(blocks)blocking+=count;}}
  return {emptyDatabase:false,blocking,issues};
}
const migrationFiles=['001_security.sql','002_early_bird.sql'];
function transactionBody(source) {
  if(!/^BEGIN;\s*$/m.test(source)||!/^COMMIT;\s*$/.test(source.slice(source.lastIndexOf('\nCOMMIT;')+1)))throw new Error('Unexpected migration transaction envelope');
  const body=source.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
  if(/^\s*(?:BEGIN|COMMIT|ROLLBACK);\s*$/m.test(body))throw new Error('Nested migration transaction control is not permitted');
  return body;
}
async function applyMigrations(client,sources=migrationFiles.map(file=>fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'))) {
  const bodies=sources.map(transactionBody);
  await client.query('BEGIN');
  try {
    // Both schema steps commit together: a failed promotion step must not leave
    // an older, less restrictive trigger installed by the first migration.
    for(const body of bodies)await client.query(body);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
}
async function main() {
  const connectionString=localDatabase(process.env.TEST_DATABASE_URL);
  const {Client}=require('pg');
  const client=new Client({connectionString,connectionTimeoutMillis:3000});
  await client.connect();
  try {
    const report=await preflight(client);console.log(JSON.stringify(report,null,2));
    if(process.argv.includes('--preflight'))return;
    if(!process.argv.includes('--apply'))throw new Error('Select --preflight or --apply');
    if(report.blocking)throw new Error('Historical conflicts block migration; no rows were modified');
    await applyMigrations(client);
    console.log('Migration applied to explicitly selected disposable local database.');
  }finally{await client.end();}
}
if(require.main===module)main().catch(()=>{console.error('Migration not completed. Check the local target, preflight and database availability; no credentials are printed.');process.exitCode=1;});
module.exports={preflight,applyMigrations,transactionBody};
