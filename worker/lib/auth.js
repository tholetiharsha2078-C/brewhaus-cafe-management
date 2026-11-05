// Authentication helpers — PBKDF2 password hashing + opaque session cookies.

const ITERATIONS = 75000;
const COOKIE = 'bh_session';

const enc = new TextEncoder();

function b64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iter, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'pbkdf2') return false;
    const salt = fromB64(saltB64);
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: Number(iter), hash: 'SHA-256' },
      key,
      256
    );
    const expected = fromB64(hashB64);
    const actual = new Uint8Array(bits);
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomRef(prefix, bytes = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return `${prefix}-${[...arr].map((n) => chars[n % chars.length]).join('')}`;
}

export async function createSession(env, type, userId, request) {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const days = type === 'customer' ? 30 : 7;
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString()).run();
  await env.DB.prepare('INSERT INTO sessions (id, user_type, user_id, expires_at) VALUES (?,?,?,?)')
    .bind(id, type, userId, expires)
    .run();
  return { token, maxAge: days * 86400 };
}

export function sessionCookie(token, maxAge, secure) {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSessionToken(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const [k, ...rest] = part.split('=');
    if (k === COOKIE) return rest.join('=');
  }
  return null;
}

export async function loadAuth(env, request) {
  const token = readSessionToken(request.headers.get('Cookie') || '');
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.user_type,
            COALESCE(u.name, c.name) AS name,
            COALESCE(u.email, c.email) AS email,
            u.role, u.station_id, u.active AS staff_active,
            COALESCE(u.phone, c.phone) AS phone,
            c.loyalty_points,
            ks.name AS station_name
       FROM sessions s
       LEFT JOIN users u ON s.user_type = 'staff' AND u.id = s.user_id
       LEFT JOIN customers c ON s.user_type = 'customer' AND c.id = s.user_id
       LEFT JOIN kitchen_stations ks ON ks.id = u.station_id
      WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(id, new Date().toISOString())
    .first();
  if (!row) return null;
  if (row.user_type === 'staff' && !row.staff_active) return null;
  return {
    id: row.user_id,
    type: row.user_type,
    name: row.name,
    email: row.email,
    role: row.role || 'customer',
    phone: row.phone,
    stationId: row.station_id,
    stationName: row.station_name,
    loyaltyPoints: row.loyalty_points,
  };
}

export const ROLE_PERMISSIONS = {
  owner: ['*'],
  manager: ['*'],
  supervisor: ['dashboard','orders','kitchen','reservations','tables','menu','customers','inventory','analytics','ai','kitchen_staff'],
  kitchen: ['kitchen','availability'],
  waiter: ['orders','reservations','tables','dashboard'],
};

export function can(auth, permission) {
  if (!auth || auth.type !== 'staff') return false;
  const perms = ROLE_PERMISSIONS[auth.role] || [];
  return perms.includes('*') || perms.includes(permission);
}
