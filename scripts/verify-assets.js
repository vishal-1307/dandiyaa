const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const regex = /(?:src|href)="([^"]+)"/g;
let match;
const missing = [];
const found = [];

while ((match = regex.exec(html)) !== null) {
  const url = match[1];
  if (url.startsWith('http') || url.startsWith('#') || url.startsWith('tel:') || url.startsWith('data:')) {
    continue;
  }
  const fullPath = path.join(dist, url);
  if (!fs.existsSync(fullPath)) {
    missing.push(url);
  } else {
    found.push(url);
  }
}

console.log('Valid local assets found:', [...new Set(found)]);
if (missing.length > 0) {
  console.error('MISSING ASSETS:', missing);
  process.exit(1);
} else {
  console.log('✓ ALL ASSET REFERENCES ARE 100% VALID AND EXIST ON DISK!');
}
