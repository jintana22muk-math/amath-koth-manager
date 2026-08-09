import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword,
  normalizeAdminUsername,
  validateAdminUsername,
  verifyPassword
} from '../src/auth.js';

test('administrator usernames are normalized and validated', () => {
  assert.equal(normalizeAdminUsername('  Teacher.One  '), 'teacher.one');
  assert.equal(validateAdminUsername('teacher_one'), true);
  assert.equal(validateAdminUsername('ab'), false);
  assert.equal(validateAdminUsername('ชื่อไทย'), false);
});

test('administrator passwords use salted PBKDF2 hashes', async () => {
  const first = await hashPassword('correct horse battery staple', 1000);
  const second = await hashPassword('correct horse battery staple', 1000);

  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword('correct horse battery staple', { password_hash: first.hash, password_salt: first.salt, password_iterations: first.iterations }), true);
  assert.equal(await verifyPassword('wrong password', { password_hash: first.hash, password_salt: first.salt, password_iterations: first.iterations }), false);
});

