'use strict';
const { HttpError, reject, appOrigin } = require('./security');

async function rawBody(req, limit = 16384, rawOnly = false) {
  const declared = req.headers['content-length'];
  if (declared && (!/^\d+$/.test(String(declared)) || Number(declared) > limit)) reject(413, 'Request too large');
  // Consume the IncomingMessage stream BEFORE touching Vercel's lazy req.body getter.
  // A parsed JSON object is never an acceptable webhook signature input.
  if (typeof req[Symbol.asyncIterator] === 'function') {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > limit) reject(413, 'Request too large');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }
  const body = req.rawBody ?? req.body;
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    const bytes = Buffer.from(body);
    if (bytes.length > limit) reject(413, 'Request too large');
    return bytes;
  }
  if (rawOnly) reject(400, 'Original webhook bytes required');
  // Injection-friendly test harnesses may supply an already parsed body.
  const bytes = Buffer.from(JSON.stringify(body ?? null));
  if (bytes.length > limit) reject(413, 'Request too large');
  return bytes;
}
async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) reject(415, 'JSON content type required');
  const raw = await rawBody(req);
  try { return JSON.parse(raw.toString('utf8')); } catch { reject(400, 'Invalid JSON'); }
}
function endpoint(methods, env, operation) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    try {
      if (req.method === 'OPTIONS') {
        if (req.headers.origin !== appOrigin(env)) reject(403, 'Request origin rejected');
        res.setHeader('Access-Control-Allow-Origin', appOrigin(env));
        res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        return res.status(204).end();
      }
      if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); reject(405, 'Method not allowed'); }
      const result = await operation(req, res);
      return res.status(result?.httpStatus || 200).json({ success: true, ...result, httpStatus: undefined });
    } catch (error) {
      const known = error instanceof HttpError;
      // Never serialize provider/SQL errors, credentials, body contents or attendee data.
      if (!known) console.error('JMU request failed', { code: 'INTERNAL_FAILURE' });
      return res.status(known ? error.status : 503).json({ success: false,
        error: known ? error.message : 'Service temporarily unavailable; retry or contact the organizer',
        code: known ? error.code : 'TEMPORARY_FAILURE' });
    }
  };
}
module.exports = { rawBody, jsonBody, endpoint };
