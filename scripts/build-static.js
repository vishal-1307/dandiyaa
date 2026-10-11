'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const output = path.resolve(root,'public');
const staticFiles = ['index.html','404.html','app.js','security-ui.js','campaign-config.js','checkout-loader.js','styles-v2.css','styles.css',
  'qrcode.bundle.js','html2canvas.bundle.js','site.webmanifest','robots.txt','sitemap.xml'];
function build() {
  if (path.dirname(output) !== root || path.basename(output) !== 'public') throw new Error('Invalid output target');
  // Never remove a user-created public folder. Only replace our generated output.
  if (fs.existsSync(output) && !fs.existsSync(path.join(output,'.jmu-generated'))) throw new Error('Unmanaged public directory; move it before building');
  if (fs.existsSync(output)) fs.rmSync(output,{recursive:true});
  fs.mkdirSync(path.join(output,'assets'),{recursive:true});
  fs.writeFileSync(path.join(output,'.jmu-generated'),'Generated static output; not application source.\n');
  for (const file of staticFiles) fs.copyFileSync(path.join(root,file),path.join(output,file));
  for (const entry of fs.readdirSync(path.join(root,'assets'),{withFileTypes:true})) {
    if (entry.isSymbolicLink()) throw new Error('Asset symlinks are not deployable');
    if (entry.isFile() && /\.(png|jpe?g|webp|avif|ico|svg)$/i.test(entry.name)) {
      fs.copyFileSync(path.join(root,'assets',entry.name),path.join(output,'assets',entry.name));
    }
  }
  console.log('Allowlisted static output generated; backend, scripts, reports and environment files excluded.');
}
if (require.main === module) build();
module.exports = { build,staticFiles,output };
