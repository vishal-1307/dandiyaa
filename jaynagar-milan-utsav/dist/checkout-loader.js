(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = { createLoader: factory };
  else root.JmuCheckoutSDK = { load: factory(root, root.document) };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (host, doc, timeoutMs) {
  'use strict';
  if (timeoutMs === undefined) timeoutMs = 20000;
  const url = 'https://checkout.razorpay.com/v1/checkout.js';
  let pending;
  const available = () => typeof host.Razorpay === 'function';
  return function load() {
    if (available()) return Promise.resolve();
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      let script = doc.querySelector('script[src="' + url + '"]');
      // At complete, the initial script has already settled. A missing SDK is
      // not a loading state: replace the failed tag so a user retry can recover.
      if (script && (doc.readyState === 'complete' || script.dataset?.jmuCheckoutFailed === 'true')) {
        script.remove(); script = null;
      }
      const fresh = !script;
      if (fresh) { script = doc.createElement('script'); script.src = url; script.async = true; }
      let timer;
      function finish(code) {
        host.clearTimeout(timer);
        script.removeEventListener('load', loaded);
        script.removeEventListener('error', failed);
        if (!code && available()) return resolve();
        script.dataset.jmuCheckoutFailed = 'true';
        script.remove();
        const error = new Error(code === 'CHECKOUT_SDK_TIMEOUT'
          ? 'Secure checkout could not load in time. Check your connection and retry. No order was created.'
          : 'Secure checkout could not load. Check browser or network blocking and retry. No order was created.');
        error.code = code || 'CHECKOUT_SDK_UNAVAILABLE'; reject(error);
      }
      function loaded() { finish(available() ? null : 'CHECKOUT_SDK_UNAVAILABLE'); }
      function failed() { finish('CHECKOUT_SDK_UNAVAILABLE'); }
      script.addEventListener('load', loaded);
      script.addEventListener('error', failed);
      timer = host.setTimeout(() => finish('CHECKOUT_SDK_TIMEOUT'), timeoutMs);
      if (fresh) doc.head.appendChild(script);
    }).finally(() => { pending = null; });
    return pending;
  };
});
