'use strict';
// Confirmed campaign policy. Presentation is informational; only this server
// policy and persisted order snapshots determine checkout and verification.
const {CATALOG,EARLY_BIRD,BOOKING_LIMITS}=require('../campaign-config');
function quote(category,quantity,promotionalQuantity=0){
  if(!Object.hasOwn(BOOKING_LIMITS,category)||!Number.isSafeInteger(quantity)||quantity<BOOKING_LIMITS[category].min||quantity>BOOKING_LIMITS[category].max||
    !Number.isSafeInteger(promotionalQuantity)||promotionalQuantity<0||promotionalQuantity>quantity||(category!=='solo'&&promotionalQuantity!==0))throw new Error('Invalid pricing inputs');
  return {category,quantity,amountPaise:CATALOG[category]*quantity-(CATALOG.solo-EARLY_BIRD.unitPrice)*promotionalQuantity,
    capacity:category==='couple'?2:quantity,currency:CATALOG.currency,promotionalQuantity,regularQuantity:quantity-promotionalQuantity,
    regularUnitPaise:CATALOG[category],promotionalUnitPaise:promotionalQuantity?EARLY_BIRD.unitPrice:null};
}
function campaignSnapshot(campaign=EARLY_BIRD){
  if(!campaign.enabled)return null;
  if(!/^[a-z0-9-]{3,80}$/.test(campaign.key)||campaign.limit!==100||campaign.category!=='solo'||campaign.unitPrice!==19900||
    campaign.countUnit!=='attendees'||campaign.partialGroups!==true||campaign.latePolicy!=='review_required'||campaign.refundPolicy!=='retain_redeemed'||
    !Number.isFinite(campaign.reservationMinutes)||campaign.reservationMinutes<=0||campaign.reservationMinutes>60)throw new Error('Invalid campaign configuration');
  return {key:campaign.key,limit:campaign.limit,category:campaign.category,unitPrice:campaign.unitPrice,
    regularUnitPrice:CATALOG.solo,reservationMinutes:campaign.reservationMinutes,countUnit:campaign.countUnit,
    partialGroups:campaign.partialGroups,latePolicy:campaign.latePolicy,refundPolicy:campaign.refundPolicy};
}
module.exports={CATALOG,EARLY_BIRD,quote,campaignSnapshot};
