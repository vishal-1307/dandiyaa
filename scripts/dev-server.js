'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
// Explicit process environment only: deliberately never read .env automatically.
const root=path.resolve(__dirname,'../public');
if(!fs.existsSync(root))throw new Error('Run npm run build first');
const routes={'create-order':'createOrder','verify-payment':'verifyPayment','get-pass':'getPass','all-passes':'allPasses',
  'admin-session':'adminSession',webhook:'webhook',register:'register'};
const handlers=require('../server/handlers').createHandlers();
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png',
  '.jpg':'image/jpeg','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.xml':'application/xml','.txt':'text/plain'};
const headers=JSON.parse(fs.readFileSync(path.join(__dirname,'../vercel.json'),'utf8')).headers[0].headers;
http.createServer(async(req,res)=>{
  res.status=function(code){this.statusCode=code;return this;};
  res.json=function(value){this.setHeader('Content-Type','application/json');this.end(JSON.stringify(value));return this;};
  const url=new URL(req.url,'http://127.0.0.1');req.query=Object.fromEntries(url.searchParams);
  for(const header of headers)res.setHeader(header.key,header.value);
  if(url.pathname.startsWith('/api/')){
    const route=routes[url.pathname.slice(5)];if(route)return handlers[route](req,res);
    return res.status(404).json({success:false,error:'Not found'});
  }
  let target;
  try{target=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));}catch{return res.status(400).end();}
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile())return res.status(404).end();
  res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
  fs.createReadStream(target).pipe(res);
}).listen(3000,'127.0.0.1',()=>console.log('Local preview at http://127.0.0.1:3000; production environment files are not loaded.'));
