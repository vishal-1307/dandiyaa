'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
// OWASP's 32 MiB scrypt option, fixed rather than attacker-configurable.
const SCRYPT_OPTIONS=Object.freeze({N:32768,r:8,p:3,maxmem:64*1024*1024});
const {quote}=require('./pricing');
const {BOOKING_LIMITS}=require('../campaign-config');

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_REJECTED') {
    super(message); this.status = status; this.code = code;
  }
}
const reject = (status, message, code) => { throw new HttpError(status, message, code); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const randomPassId = () => 'JMU-' + crypto.randomBytes(16).toString('hex').toUpperCase();
const PENDING_NAME = 'Awaiting payment confirmation';
const attendeePending = row => row?.phone === '0';
function ticketId(row) {
  // The database sequence is a unique human reference, NOT an access capability.
  // Keep the random internal ID for order associations and existing QR payloads.
  if (attendeePending(row) || !['verified','revoked'].includes(row?.payment_state)) return null;
  return Number.isSafeInteger(row.id) && row.id > 0 && row.id <= 99999 ?
    'JMU-' + String(row.id).padStart(5,'0') : row.pass_id;
}
function bookingDetails(body, frozen) {
  const input = registration(body);
  if (hash(JSON.stringify(input)) !== frozen.request_hash) reject(409,'Booking details do not match the original checkout','BOOKING_DETAILS_MISMATCH');
  return input;
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function required(env, name, minimum = 1) {
  const value = env[name];
  if (typeof value !== 'string' || value.length < minimum) reject(503, 'Service is not configured', 'CONFIGURATION_REQUIRED');
  return value;
}
function appOrigin(env) {
  const value = required(env, 'APP_ORIGIN');
  let url; try { url = new URL(value); } catch { reject(503, 'Service is not configured'); }
  if (url.origin !== value || url.username || url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    reject(503, 'Service is not configured');
  }
  return value;
}
function requireOrigin(req, env) {
  if (req.headers.origin !== appOrigin(env)) reject(403, 'Request origin rejected');
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(400, 'JSON object required');
  return value;
}
function keys(value, allowed) {
  if (Object.keys(value).some(key => !allowed.includes(key))) reject(400, 'Unsupported request field');
}
function text(value, field, max, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string') reject(400, 'Invalid ' + field);
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) reject(400, 'Invalid ' + field);
  return clean;
}
function phone(value, optional = false) {
  const clean = text(value, 'phone', 10, optional);
  if (clean && !/^[6-9]\d{9}$/.test(clean)) reject(400, 'Invalid phone');
  return clean;
}
function pricing(category, quantity) {
  if (!Object.hasOwn(BOOKING_LIMITS,category) || !Number.isSafeInteger(quantity) ||
      quantity < BOOKING_LIMITS[category].min || quantity > BOOKING_LIMITS[category].max) reject(400, 'Invalid ticket category or quantity');
  const {promotionalQuantity,regularQuantity,regularUnitPaise,promotionalUnitPaise,...regular}=quote(category,quantity);
  return regular;
}
function registration(body) {
  object(body);
  keys(body, ['category', 'quantity', 'name', 'phone', 'address', 'partnerName', 'partnerPhone', 'idempotencyKey']);
  const price = pricing(body.category, body.quantity);
  const name = text(body.name, 'name', 60);
  if (name.length < 2) reject(400, 'Invalid name');
  const partnerName = text(body.partnerName, 'partner name', 60, price.category !== 'couple');
  if (price.category === 'couple' && partnerName.length < 2) reject(400, 'Partner name required');
  const partnerPhone = phone(body.partnerPhone, true);
  if (price.category === 'solo' && (partnerName || partnerPhone)) reject(400, 'Partner fields require a couple pass');
  const idempotencyKey = text(body.idempotencyKey, 'booking key', 64);
  if (!/^[a-f0-9]{64}$/.test(idempotencyKey)) reject(400, 'Invalid booking key');
  return { ...price, name, phone: phone(body.phone), address: text(body.address, 'address', 120, true),
    partnerName, partnerPhone, keyHash: hash(idempotencyKey) };
}
function passId(value) {
  const id = text(value, 'ticket ID', 64).toUpperCase();
  if (!/^JMU-[A-Z0-9]{4,60}$/.test(id)) reject(400, 'Invalid ticket ID');
  return id;
}
function providerId(value, prefix) {
  if (typeof value !== 'string' || !new RegExp('^' + prefix + '_[A-Za-z0-9]{4,64}$').test(value)) reject(400, 'Invalid payment identifier');
  return value;
}
function bearer(req) {
  const header = req.headers.authorization;
  return typeof header === 'string' && /^Bearer [A-Za-z0-9_-]{43}$/.test(header) ? header.slice(7) : null;
}
function owner(req, pass) {
  const token = bearer(req);
  if (!token || !pass || !equal(hash(token), pass.recovery_hash)) reject(401, 'Ticket access required');
}
function signature(message, received, secret) {
  if (typeof received !== 'string' || !/^[a-f0-9]{64}$/.test(received)) return false;
  return equal(crypto.createHmac('sha256', secret).update(message).digest('hex'), received);
}
const COOKIE = 'jmu_admin_session';
function signedSession(sid, expires, env) {
  const payload = Buffer.from(JSON.stringify({ sid, expires })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', required(env, 'ADMIN_SESSION_SECRET', 32)).update(payload).digest('base64url');
}
function csrfFor(sid, env) {
  return crypto.createHmac('sha256', required(env, 'ADMIN_SESSION_SECRET', 32)).update('csrf:' + sid).digest('base64url');
}
function decodeSession(req, env, now = Date.now()) {
  const cookies = String(req.headers.cookie || '').split(';').map(v => v.trim());
  const entries = cookies.filter(v => v.startsWith(COOKIE + '='));
  if (entries.length !== 1 || entries[0].length > 600) reject(401, 'Administrator login required');
  const parts = entries[0].slice(COOKIE.length + 1).split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) reject(401, 'Administrator login required');
  const mac = crypto.createHmac('sha256', required(env, 'ADMIN_SESSION_SECRET', 32)).update(parts[0]).digest('base64url');
  if (!equal(mac, parts[1])) reject(401, 'Administrator login required');
  let data; try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { reject(401, 'Administrator login required'); }
  if (!data || Object.keys(data).sort().join(',') !== 'expires,sid' || !/^[A-Za-z0-9_-]{43}$/.test(data.sid) ||
      !Number.isSafeInteger(data.expires) || data.expires <= now || data.expires > now + 30 * 60 * 1000) reject(401, 'Administrator login required');
  return { ...data, hash: hash(data.sid) };
}
function cookie(value, env, clear = false) {
  return COOKIE + '=' + value + '; Path=/api; HttpOnly; SameSite=Strict; Max-Age=' + (clear ? '0' : '1800') +
    (appOrigin(env).startsWith('https:') ? '; Secure' : '');
}
async function passwordMatches(password, encoded) {
  // Fixed cost parameters prevent a malformed configuration from exhausting memory.
  if (typeof encoded !== 'string' || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)) reject(503, 'Service is not configured');
  if (typeof password !== 'string' || password.length < 16 || password.length > 256) return false;
  const [, salt, expected] = encoded.split('$');
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), 64, SCRYPT_OPTIONS);
  return equal(actual.toString('hex'), expected);
}
function clientKey(req, env) {
  // Only trust headers overwritten by Vercel while actually running on Vercel.
  const source = env.VERCEL === '1' ? req.headers['x-vercel-forwarded-for'] : req.socket?.remoteAddress;
  return hash(typeof source === 'string' ? source.slice(0, 128) : 'unknown-client');
}
function publicPass(row) {
  const pending = attendeePending(row);
  const isVerified = row.payment_state === 'verified' && !row.is_deleted && !pending;
  return { passId: row.pass_id, ticketId: ticketId(row), awaitingDetails: pending,
    name: pending ? '' : row.name, partnerName: pending ? '' : row.partner_name || '',
    category: row.category, quantity: Number(row.quantity), capacity: row.category_key === 'couple' || row.category.includes('Couple') ? 2 : Number(row.quantity),
    amount: Number(row.amount), status: isVerified ? 'approved' : 'pending', paymentState: row.payment_state,
    promotionalQuantity:Number(row.promotion_units||0),regularQuantity:Number(row.quantity)-Number(row.promotion_units||0),
    promotionExpiresAt:row.promotion_expires_at||null,
    isDeleted: Boolean(row.is_deleted), checkedIn: Boolean(row.checked_in), checkInTime: row.check_in_at || null,
    timestamp: Number(row.timestamp), dateStr: '19 October 2026', timeStr: '6:00–10:00 PM',
    venue: 'Marwadi Vivah Bhavan, Jaynagar', organizer: 'Motion Arts Academy' };
}
module.exports = { PENDING_NAME, attendeePending, ticketId, bookingDetails, SCRYPT_OPTIONS, HttpError, reject, hash, randomToken, randomPassId, equal, required, appOrigin, requireOrigin,
  object, keys, text, phone, pricing, registration, passId, providerId, bearer, owner, signature,
  signedSession, csrfFor, decodeSession, cookie, passwordMatches, clientKey, publicPass };
