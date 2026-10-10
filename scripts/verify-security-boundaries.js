'use strict';
// Read-only, value-redacted checks. Never load or print ignored environment files.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),build=require('./build-static');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
function verify(){
  const tracked=git('ls-files','-z').split('\0').filter(Boolean);
  const forbidden=tracked.filter(file=>/(^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.env.example'));
  assert.equal(forbidden.length,0,'Real environment files must not be tracked');
  const files=[...new Set(git('ls-files','-co','--exclude-standard','-z').split('\0').filter(Boolean))]
    .filter(file=>fs.existsSync(path.join(root,file))&&/\.(?:js|json|md|html|sql)$/.test(file)&&!file.startsWith('tests/')&&!file.includes('.env'));
  // Historical values stay in memory, never diagnostics. This is a targeted
  // known-exposure comparison, not proof that all possible secrets are absent.
  const exposed=new Set();
  const oldPaths=['api/db.js','api/create-order.js','api/verify-payment.js','scripts/init-db.js','app.js',
    'jaynagar-milan-utsav/dist/api/db.js','jaynagar-milan-utsav/dist/api/create-order.js','jaynagar-milan-utsav/dist/app.js'];
  const historicalRef=['392495d','origin/main','HEAD'].find(ref=>{try{git('cat-file','-e',ref+':api/db.js');return true;}catch(_){return false;}});
  for(const file of oldPaths){
    let source='';
    try{source=historicalRef?git('show',historicalRef+':'+file):git('show','HEAD:'+file);}catch(_){try{source=git('show','origin/main:'+file);}catch(_){continue;}}
    if(!source)continue;
    for(const match of source.matchAll(/Buffer\.from\(\s*['"]([^'"]+)['"]\s*,\s*['"](base64|hex)['"]\s*\)/g)){
      const decoded=Buffer.from(match[1],match[2]).toString();
      if(decoded.length>=8&&/^[\x20-\x7e]+$/.test(decoded)){exposed.add(match[1]);exposed.add(decoded);}
    }
    for(const line of source.split('\n')){
      for(const match of line.matchAll(/["'`]([^"'`\r\n]+)["'`]/g)){
        const value=match[1];
        if(/^(?:postgres(?:ql)?:\/\/|rzp_(?:live|test)_)/.test(value))exposed.add(value);
        if(/(?:RAZORPAY_KEY_SECRET|DATABASE_URL|ADMIN_PIN)/.test(line)&&/(?:\|\||\?\?|const\s+ADMIN_PIN)/.test(line)&&value.length>=4&&!/^[A-Z_]+$/.test(value))exposed.add(value);
        if(/Buffer\.from|atob|decode/.test(line)&&/^[a-f\d]{16,}$/i.test(value)&&value.length%2===0){const decoded=Buffer.from(value,'hex').toString();if(/^[\x20-\x7e]+$/.test(decoded))exposed.add(decoded);}
      }
    }
  }
  const leaks=[];
  for(const file of files){const source=fs.readFileSync(path.join(root,file),'utf8');if([...exposed].some(value=>source.includes(value)))leaks.push(file);}
  // Never report matched values, snippets, hashes or production identifiers.
  assert.equal(leaks.length,0,'Historical credential material remains in: '+leaks.join(', '));
  const expected=['admin-session.js','all-passes.js','create-order.js','get-pass.js','register.js','verify-payment.js','webhook.js'];
  assert.deepEqual(fs.readdirSync(path.join(root,'api')).sort(),expected);
  for(const file of expected)assert.equal(typeof require(path.join(root,'api',file)),'function');
  assert.equal(require('../vercel.json').outputDirectory,'public');
  const outputFiles=fs.readdirSync(build.output);
  assert.ok(outputFiles.every(file=>build.staticFiles.includes(file)||['assets','.jmu-generated'].includes(file)));
  for(const file of build.staticFiles)assert.equal(fs.readFileSync(path.join(root,file)).equals(fs.readFileSync(path.join(build.output,file))),true,'Stale output: '+file);
  for(const file of fs.readdirSync(path.join(build.output,'assets')))assert.ok(/\.(?:png|jpe?g|webp|avif|ico|svg)$/i.test(file));
  assert.ok(!fs.existsSync(path.join(root,'jaynagar-milan-utsav/dist/api'))||fs.readdirSync(path.join(root,'jaynagar-milan-utsav/dist/api')).length===0);
  assert.ok(require('../jaynagar-milan-utsav/dist/vercel.json').buildCommand.includes('throw new Error'));
  console.log('PASS: '+files.length+' current text files checked against '+exposed.size+' historical exposure literals (values redacted); only .env.example tracked.');
  console.log('PASS: seven API wrappers resolve their shared modules; fresh allowlisted public output excludes private source; nested deployment fails closed.');
}
if(require.main===module){try{verify();}catch(error){console.error('Boundary verification failed:',error.message);process.exitCode=1;}}
module.exports={verify};
