import { createHash, timingSafeEqual } from 'node:crypto';

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function readIntegrationKeys(raw) {
  if (!raw) return new Map();
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('STUDIO_INTEGRATIONS_JSON must be a JSON object');
  const keys = new Map();
  for (const [project, digest] of Object.entries(parsed)) {
    if (!PROJECT_ID.test(project) || typeof digest !== 'string' || !SHA256.test(digest)) throw new Error('Invalid project ID or SHA-256 key digest in STUDIO_INTEGRATIONS_JSON');
    keys.set(project, Buffer.from(digest, 'hex'));
  }
  return keys;
}

export function verifyIntegrationKey(keys, project, authorization) {
  const expected = keys.get(project);
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(authorization || '');
  if (!expected || !match) return false;
  const actual = createHash('sha256').update(match[1]).digest();
  return timingSafeEqual(expected, actual);
}
