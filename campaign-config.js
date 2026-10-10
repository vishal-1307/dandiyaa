(function(root,factory){
  'use strict';const config=factory();if(typeof module==='object'&&module.exports)module.exports=config;else root.JmuPricing=config;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Public campaign policy, shared for presentation and server pricing. This
  // contains no secrets or remaining-slot counter; browser edits grant nothing.
  const CATALOG=Object.freeze({solo:24900,couple:39900,currency:'INR'});
  const BOOKING_LIMITS=Object.freeze({solo:Object.freeze({min:1,max:10}),couple:Object.freeze({min:1,max:1})});
  const EARLY_BIRD=Object.freeze({enabled:true,key:'jmu-solo-early-bird-2026-v1',limit:100,
    category:'solo',unitPrice:19900,reservationMinutes:20,countUnit:'attendees',
    partialGroups:true,latePolicy:'review_required',refundPolicy:'retain_redeemed'});
  return Object.freeze({CATALOG,EARLY_BIRD,BOOKING_LIMITS});
});
