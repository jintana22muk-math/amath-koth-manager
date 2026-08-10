import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker.js';

class MemoryStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.sql.startsWith('SELECT * FROM admin_users WHERE username')) {
      return this.database.admins.find((admin) => admin.username.toLowerCase() === String(this.args[0]).toLowerCase() && admin.is_active === 1) || null;
    }
    if (this.sql.startsWith('SELECT id FROM admin_users WHERE username')) {
      const admin = this.database.admins.find((item) => item.username.toLowerCase() === String(this.args[0]).toLowerCase());
      return admin ? { id: admin.id } : null;
    }
    if (this.sql.startsWith('SELECT id, username, display_name, created_at FROM admin_users WHERE id')) {
      const admin = this.database.admins.find((item) => item.id === this.args[0] && (!this.sql.includes('is_active = 1') || item.is_active === 1));
      return admin ? { id: admin.id, username: admin.username, display_name: admin.display_name, created_at: admin.created_at } : null;
    }
    if (this.sql.startsWith('SELECT id, username, display_name FROM admin_users WHERE id')) {
      const admin = this.database.admins.find((item) => item.id === this.args[0] && item.is_active === 1);
      return admin ? { id: admin.id, username: admin.username, display_name: admin.display_name } : null;
    }
    if (this.sql.startsWith('SELECT COUNT(*) AS total FROM admin_users')) return { total: this.database.admins.filter((admin) => admin.is_active === 1).length };
    throw new Error(`Unhandled first query: ${this.sql}`);
  }

  async all() {
    if (this.sql.startsWith('SELECT id, username, display_name, created_at FROM admin_users WHERE is_active')) {
      return { results: this.database.admins.filter((admin) => admin.is_active === 1).map(({ id, username, display_name, created_at }) => ({ id, username, display_name, created_at })) };
    }
    throw new Error(`Unhandled all query: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith('INSERT INTO admin_users')) {
      const [id, username, display_name, password_hash, password_salt, password_iterations, created_by, updated_at] = this.args;
      this.database.admins.push({ id, username, display_name, password_hash, password_salt, password_iterations, created_by, created_at: updated_at, updated_at, is_active: 1 });
      return { success: true };
    }
    if (this.sql.startsWith('DELETE FROM admin_users WHERE id')) {
      this.database.admins = this.database.admins.filter((admin) => admin.id !== this.args[0]);
      return { success: true };
    }
    if (this.sql.startsWith('INSERT INTO audit_logs')) {
      this.database.audit.push(this.args);
      return { success: true };
    }
    throw new Error(`Unhandled run query: ${this.sql}`);
  }
}

class MemoryDatabase {
  constructor() {
    this.admins = [];
    this.audit = [];
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }
}

function apiRequest(path, options = {}) {
  return new Request(`https://example.test${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
}

test('environment administrator can add an account and deletion invalidates its session', async () => {
  const env = { DB: new MemoryDatabase(), ASSETS: { fetch: () => new Response('asset') }, AUTH_SECRET: 'test-auth-secret', ADMIN_PASSWORD: 'main-admin-password' };
  const loginResponse = await worker.fetch(apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'main-admin-password' }) }), env);
  assert.equal(loginResponse.status, 200);
  const loginCookieHeader = loginResponse.headers.get('set-cookie');
  assert.match(loginCookieHeader, /; HttpOnly;/);
  assert.match(loginCookieHeader, /; Secure;/);
  assert.match(loginCookieHeader, /; SameSite=None;/);
  assert.match(loginCookieHeader, /; Partitioned;/);
  const mainCookie = loginCookieHeader.split(';')[0];

  const createResponse = await worker.fetch(apiRequest('/api/admins', {
    method: 'POST',
    headers: { cookie: mainCookie },
    body: JSON.stringify({ username: 'teacher.one', display_name: 'ครูหนึ่ง', password: 'teacher-password-123' })
  }), env);
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).admin;
  assert.equal(created.username, 'teacher.one');
  assert.equal(env.DB.admins[0].password_hash.includes('teacher-password-123'), false);

  const teacherLogin = await worker.fetch(apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'teacher.one', password: 'teacher-password-123' }) }), env);
  assert.equal(teacherLogin.status, 200);
  const teacherCookie = teacherLogin.headers.get('set-cookie').split(';')[0];

  const deleteResponse = await worker.fetch(apiRequest(`/api/admins/${created.id}`, { method: 'DELETE', headers: { cookie: mainCookie }, body: JSON.stringify({}) }), env);
  assert.equal(deleteResponse.status, 200);

  const sessionAfterDelete = await worker.fetch(apiRequest('/api/auth/me', { method: 'GET', headers: { cookie: teacherCookie } }), env);
  assert.equal((await sessionAfterDelete.json()).authenticated, false);
});

test('logout clears the partitioned iframe session cookie', async () => {
  const env = { DB: new MemoryDatabase(), ASSETS: { fetch: () => new Response('asset') }, AUTH_SECRET: 'test-auth-secret', ADMIN_PASSWORD: 'main-admin-password' };
  const response = await worker.fetch(apiRequest('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }), env);
  const cookie = response.headers.get('set-cookie');

  assert.equal(response.status, 200);
  assert.match(cookie, /^session=;/);
  assert.match(cookie, /; SameSite=None;/);
  assert.match(cookie, /; Partitioned;/);
  assert.match(cookie, /; Max-Age=0$/);
});
