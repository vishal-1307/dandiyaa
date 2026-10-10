'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const references = Array.from(html.matchAll(/\b(?:src|href|poster)="([^"]+)"/g),match=>match[1]);
for (const match of html.matchAll(/\bsrcset="([^"]+)"/g)) {
  references.push(...match[1].split(',').map(value=>value.trim().split(/\s+/)[0]));
}
const missing = [];
for (const reference of references) {
  if (/^(?:[a-z]+:|#)/i.test(reference)) continue;
  const local = decodeURIComponent(reference.split(/[?#]/)[0]);
  const target = path.resolve(root,local);
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) missing.push(local);
}
if (missing.length) { console.error('Missing local asset paths:',[...new Set(missing)]); process.exitCode=1; }
else console.log('All local HTML asset references resolve, including query strings and srcset.');
