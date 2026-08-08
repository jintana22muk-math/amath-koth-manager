export const PASSWORD_ITERATIONS = 600000;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value) {
  const base64 = String(value).replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((String(value).length + 3) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let mismatch = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) mismatch |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
  return mismatch === 0;
}

export function normalizeAdminUsername(value) {
  return String(value ?? '').trim().toLowerCase().slice(0, 40);
}

export function validateAdminUsername(value) {
  return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalizeAdminUsername(value));
}

export function normalizePassword(value) {
  return String(value ?? '').slice(0, 128);
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizePassword(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function hashPassword(password, iterations = PASSWORD_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    hash: await derivePassword(password, salt, iterations),
    salt: bytesToBase64Url(salt),
    iterations
  };
}

export async function verifyPassword(password, record) {
  if (!record?.password_hash || !record?.password_salt) return false;
  const iterations = Number(record.password_iterations || PASSWORD_ITERATIONS);
  const derived = await derivePassword(password, base64UrlToBytes(record.password_salt), iterations);
  return constantTimeEqual(derived, record.password_hash);
}

