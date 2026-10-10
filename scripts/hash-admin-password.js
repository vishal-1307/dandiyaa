'use strict';
const crypto=require('node:crypto');
const {SCRYPT_OPTIONS}=require('../server/security');
function encodePassword(password){
  if(typeof password!=='string'||password.length<16||password.length>256||/[\r\n\0]/.test(password))throw new Error('Use a unique password of 16–256 characters');
  const salt=crypto.randomBytes(16);return 'scrypt$'+salt.toString('hex')+'$'+crypto.scryptSync(password,salt,64,SCRYPT_OPTIONS).toString('hex');
}
if(require.main===module){
  if(process.argv.length!==2||process.stdin.isTTY){console.error('Supply the password through stdin only, not command arguments. See README.md.');process.exitCode=1;}
  else{let bytes=Buffer.alloc(0);process.stdin.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);if(bytes.length>2048){console.error('Input too long');process.exit(1);}});process.stdin.on('end',()=>{try{console.log(encodePassword(bytes.toString('utf8').replace(/\r?\n$/,'')));}catch{console.error('Use a unique password of 16–256 characters; no password is printed.');process.exitCode=1;}finally{bytes.fill(0);}});}
}
module.exports={encodePassword};
