'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLoader}=require('../checkout-loader');
function fixture({existing=false,complete=false}={}){
  const scripts=[],timers=new Map();let next=0;
  function script(){const listeners=new Map();return {dataset:{},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name),remove(){scripts.splice(scripts.indexOf(this),1);},emit(name){listeners.get(name)?.();}};}
  const delays=[];
  const host={setTimeout(fn,delay){delays.push(delay);timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);}};
  const doc={readyState:complete?'complete':'loading',querySelector:()=>scripts[0]||null,createElement:()=>script(),head:{appendChild:s=>scripts.push(s)}};
  if(existing)scripts.push(script());
  return {host,doc,scripts,timers,delays,load:createLoader(host,doc)};
}
test('checkout loader reuses an already usable SDK without a new request',async()=>{
  const f=fixture();f.host.Razorpay=function(){};await f.load();assert.equal(f.scripts.length,0);
});
test('slow initial checkout script is awaited without a four-second polling cutoff',async()=>{
  const f=fixture({existing:true}),original=f.scripts[0];const first=f.load(),second=f.load();
  assert.equal(first,second);assert.equal(f.scripts.length,1);
  assert.deepEqual(f.delays,[20000]);
  f.host.Razorpay=function(){};original.emit('load');await first;assert.equal(f.timers.size,0);
});
test('a settled failed initial script is replaced, and load without a constructor is rejected',async()=>{
  const f=fixture({existing:true,complete:true}),original=f.scripts[0],first=f.load();
  assert.notEqual(f.scripts[0],original);f.scripts[0].emit('load');
  await assert.rejects(first,e=>e.code==='CHECKOUT_SDK_UNAVAILABLE');assert.equal(f.scripts.length,0);assert.equal(f.timers.size,0);
  const retry=f.load();f.host.Razorpay=function(){};f.scripts[0].emit('load');await retry;
});
test('network failure and timeout clear listeners, remove the failed tag, and allow a fresh retry',async()=>{
  for(const reason of ['error','timeout']){
    const f=fixture(),first=f.load(),failed=f.scripts[0];
    if(reason==='error')failed.emit('error');else [...f.timers.values()][0]();
    await assert.rejects(first,e=>e.code===(reason==='error'?'CHECKOUT_SDK_UNAVAILABLE':'CHECKOUT_SDK_TIMEOUT'));
    assert.equal(f.timers.size,0);assert.equal(f.scripts.length,0);
    const retry=f.load();assert.notEqual(f.scripts[0],failed);f.host.Razorpay=function(){};f.scripts[0].emit('load');await retry;
  }
});
