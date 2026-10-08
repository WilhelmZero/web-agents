import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordHash, verifyPassword, createSession, verifySession, encryptTemporaryKey, decryptTemporaryKey, readUsers } from './security.mjs';
import { allowedAiPath } from './index.mjs';

const secret = 'test-secret-at-least-thirty-two-characters-long';

test('account hashes, signed sessions and temporary keys', () => {
  const hash = passwordHash('a-secure-password-123');
  assert.equal(verifyPassword('a-secure-password-123', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
  const users = readUsers(JSON.stringify({ admin: { passwordHash: hash, admin: true } }));
  const token = createSession('admin', secret, 1000);
  assert.deepEqual(verifySession(token, secret, users, 2000), { username: 'admin', admin: true });
  assert.equal(verifySession(`${token}tampered`, secret, users, 2000), null);
  assert.equal(verifySession(token, secret, users, 604802000), null);
  const encrypted = encryptTemporaryKey('sk-secret', secret);
  assert.equal(decryptTemporaryKey(encrypted, secret), 'sk-secret');
  assert.equal(encrypted.includes('sk-secret'), false);
});

test('AI gateway uses an endpoint allowlist', () => {
  assert.equal(allowedAiPath('openai', '/v1/images/edits'), '/v1/images/edits');
  assert.equal(allowedAiPath('gemini', '/v1beta/models/gemini-3.1-flash-image:generateContent?key=secret'), '/v1beta/models/gemini-3.1-flash-image:generateContent');
  assert.equal(allowedAiPath('openai', '/v1/models'), null);
  assert.equal(allowedAiPath('gemini', 'http://127.0.0.1/internal'), null);
});
