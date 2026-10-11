'use strict';
const s=require('./security'),payments=require('./payments');

async function recoverOrder(repo,api,frozen,recoveryHash){
  let result;
  try { result=await api.orders.all({receipt:frozen.pass_id,count:100}); }
  catch(error){ logFailure(error,'lookup'); s.reject(503,'Payment gateway is temporarily unavailable. Please retry shortly.','CHECKOUT_UNAVAILABLE'); }
  if(!Array.isArray(result?.items))s.reject(503,'Checkout status is still being checked. Please retry shortly.','CHECKOUT_PENDING');
  const matches=result.items.filter(order=>order.receipt===frozen.pass_id);
  if(matches.length>1)s.reject(503,'Checkout status requires further checking. Do not make another payment.','CHECKOUT_PENDING');
  if(matches.length===1){
    const order=matches[0];s.providerId(order.id,'order');payments.assertOrder(order,{...frozen,order_id:order.id});
    const bound=await repo.bindOrder(frozen.pass_id,order.id);
    await repo.rotateRecovery(frozen.pass_id,recoveryHash);
    return {...bound,create:false};
  }
  // Absence in a provider list is NOT proof that an ambiguous POST failed.
  // Retry creation only with durable evidence of an explicit provider rejection.
  if(await repo.claimRejectedRetry(frozen.pass_id))return {...frozen,state:'creating',create:true};
  s.reject(503,'Your previous checkout is still being checked automatically. Please retry shortly; do not make another payment.','CHECKOUT_PENDING');
}
function providerRejection(error){
  return [400,401,403,422,429].includes(error?.statusCode) && typeof error?.error?.code==='string';
}
function logFailure(error,stage){
  const code=/^[A-Z_]{1,50}$/.test(error?.error?.code||'')?error.error.code:'UNCLASSIFIED';
  const field=/^[a-z_]{1,40}$/.test(error?.error?.field||'')?error.error.field:null;
  console.error('JMU checkout failure',{stage,statusCode:Number.isInteger(error?.statusCode)?error.statusCode:null,code,field});
}
async function availability(api){
  try{const result=await api.orders.all({count:1});if(!Array.isArray(result?.items))throw new Error('Invalid gateway response');return {available:true};}
  catch(error){logFailure(error,'availability');s.reject(503,[401,403].includes(error?.statusCode)?
    'Payment service configuration needs correction. No payment was taken.':'Payment gateway is temporarily unavailable. Please retry shortly.',
    [401,403].includes(error?.statusCode)?'CHECKOUT_CONFIGURATION_ERROR':'CHECKOUT_UNAVAILABLE');}
}
async function createGatewayOrder(repo,api,frozen,recoveryHash){
  let stage='create';
  try{
    const created=await api.orders.create({amount:frozen.amount_paise,currency:frozen.currency,
      receipt:frozen.pass_id,partial_payment:false,notes:{registration_id:frozen.pass_id}});
    stage='validate';s.providerId(created?.id,'order');payments.assertOrder(created,{...frozen,order_id:created.id});
    stage='bind';const bound=await repo.bindOrder(frozen.pass_id,created.id);
    await repo.rotateRecovery(frozen.pass_id,recoveryHash);
    return bound;
  }catch(error){
    await repo.markUnknown(frozen.pass_id);
    logFailure(error,stage);
    if(stage==='create'&&providerRejection(error)){
      await repo.audit('system','order-create-rejected',frozen.pass_id,String(error.statusCode));
      if([401,403].includes(error.statusCode))s.reject(503,'Payment service configuration needs correction. No payment was taken.','CHECKOUT_CONFIGURATION_ERROR');
      s.reject(503,'Payment gateway could not prepare checkout. No payment was taken. Please retry shortly.','CHECKOUT_REJECTED');
    }
    s.reject(503,'Checkout status is being recovered automatically. Please retry shortly; do not make another payment.','CHECKOUT_PENDING');
  }
}
module.exports={recoverOrder,createGatewayOrder,availability};
