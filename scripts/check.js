'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname,'..');
const files = ['app.js','security-ui.js','campaign-config.js','checkout-loader.js'];
for (const directory of ['api','server','scripts','tests']) {
  function walk(relative) {
    if (!fs.existsSync(path.join(root,relative))) return;
    for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})) {
      const file=path.join(relative,entry.name);
      if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.js'))files.push(file);
    }
  }
  walk(directory);
}
for (const file of files) {
  const result=spawnSync(process.execPath,['--check',file],{cwd:root,encoding:'utf8'});
  if(result.status!==0){console.error('Syntax check failed:',file);process.exit(1);}
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))JSON.parse(match[1]);
if (/\son(?:click|submit|input|change)=/.test(html))throw new Error('Inline event handlers are disallowed');
console.log('Syntax checks passed for '+files.length+' JavaScript files; event metadata and event bindings validated.');
const assets=spawnSync(process.execPath,['scripts/verify-assets.js'],{cwd:root,stdio:'inherit'});
process.exitCode=assets.status===null?1:assets.status;
