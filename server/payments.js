'use strict';
const s = require('./security');

function assertOrder(order, frozen) {
  if (!order || order.id !== frozen.order_id || order.receipt !== frozen.pass_id ||
      order.amount !== frozen.amount_paise || order.currency !== frozen.currency || order.partial_payment === true) {
    s.reject(409, 'Payment does not match this booking', 'PAYMENT_MISMATCH');
  }
}
function validatePayment(order, payment, frozen, paymentId) {
  assertOrder(order, frozen);
  if (!payment || payment.id !== paymentId || payment.order_id !== frozen.order_id ||
      payment.amount !== frozen.amount_paise || payment.currency !== frozen.currency ||
      order.status !== 'paid' || order.amount_paid !== frozen.amount_paise || order.amount_due !== 0) {
    s.reject(409, 'Payment does not match this booking', 'PAYMENT_MISMATCH');
  }
  if (!Number.isSafeInteger(payment.amount_refunded) || payment.amount_refunded < 0 || payment.amount_refunded > payment.amount) {
    s.reject(409, 'Payment state requires reconciliation', 'PAYMENT_MISMATCH');
  }
  const revoked = payment.amount_refunded > 0 || payment.status === 'refunded';
  if (!['captured','refunded'].includes(payment.status) ||
      (payment.status === 'captured' && payment.captured !== true) ||
      (payment.status === 'refunded' && payment.amount_refunded === 0)) {
    s.reject(409, 'Payment has not been captured; retry confirmation later', 'PAYMENT_PENDING');
  }
  return revoked;
}
async function reconcile(repo, provider, frozen, paymentId, eventId = null, audit = null, details = null) {
  const [order,payment] = await Promise.all([provider.orders.fetch(frozen.order_id),provider.payments.fetch(paymentId)]);
  const revoked = validatePayment(order,payment,frozen,paymentId);
  // A signed refund notification must not be consumed against a stale provider
  // read. Keep its durable work for retry; callbacks/admin recovery also honor
  // the same pending refund instead of granting admission from that stale read.
  if(!revoked&&await repo.hasPendingRefund(frozen.order_id,paymentId)) {
    s.reject(503,'Refund evidence is still being reconciled; retry confirmation later','PAYMENT_RECONCILIATION_PENDING');
  }
  return repo.finalize(frozen,payment,revoked,eventId,audit,details);
}
async function paymentForOrder(provider, orderId) {
  const list = await provider.orders.fetchPayments(orderId);
  if(!Array.isArray(list?.items)||list.items.some(p=>!p||typeof p!=='object'))s.reject(503,'Payment confirmation is temporarily unavailable; retry My Pass','PAYMENT_RECONCILIATION_PENDING');
  const candidates = list.items.filter(p => ['captured','refunded'].includes(p.status));
  if(candidates.length===0)s.reject(409,'Payment has not been captured yet; your ticket will appear after verification','PAYMENT_PENDING');
  if(candidates.length!==1)s.reject(409,'Payment requires organizer reconciliation','PAYMENT_MISMATCH');
  return s.providerId(candidates[0].id, 'pay');
}
module.exports = { assertOrder, validatePayment, reconcile, paymentForOrder };
