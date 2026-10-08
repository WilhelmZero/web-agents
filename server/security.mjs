import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';

const SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;

export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Password must contain at least 12 characters');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, encoded) {
  const [algorithm, salt, expected] = String(encoded || '').split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function readUsers(value) {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('APP_USERS_JSON must be an object');
  const users = new Map();
  for (const [name, entry] of Object.entries(parsed)) {
    if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(name) || !entry || typeof entry !== 'object' || typeof entry.passwordHash !== 'string') throw new Error(`Invalid user entry: ${name}`);
    users.set(name, { passwordHash: entry.passwordHash, admin: entry.admin === true });
  }
  if (!users.size) throw new Error('APP_USERS_JSON must contain at least one account');
  return users;
}

function signature(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSession(username, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ username, expires: Math.floor(now / 1000) + SESSION_AGE_SECONDS })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySession(token, secret, users, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = Buffer.from(signature(parts[0], secret));
  const received = Buffer.from(parts[1]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(payload.expires) || payload.expires <= now / 1000 || !users.has(payload.username)) return null;
    return { username: payload.username, admin: users.get(payload.username).admin };
  } catch { return null; }
}

function aesKey(secret) { return createHash('sha256').update(secret).digest(); }

export function encryptTemporaryKey(key, secret) {
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey(secret), iv);
  const data = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptTemporaryKey(value, secret) {
  if (!value) return null;
  const [iv, tag, data] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', aesKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
