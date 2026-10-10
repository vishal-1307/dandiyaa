'use strict';
const { required } = require('./security');
function provider(env) {
  const Razorpay = require('razorpay');
  const client = new Razorpay({ key_id: required(env, 'RAZORPAY_KEY_ID'), key_secret: required(env, 'RAZORPAY_KEY_SECRET') });
  // The installed SDK exposes its Axios instance as api.rq; do not invent SDK options.
  client.api.rq.defaults.timeout = 8000;
  return client;
}
module.exports = { provider };
