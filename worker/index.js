// Brewhaus Cafe Management — Cloudflare Worker entrypoint.
import { Hono } from 'hono';
import {
  clearSessionCookie, createSession, hashPassword, loadAuth, readSessionToken, ROLE_PERMISSIONS,
  sessionCookie, sha256Hex, randomToken, verifyPassword,
} from './lib/auth.js';
import { audit, istDateStr, nowISO } from './lib/utils.js';
import { ensureSeeded } from './seed.js';
import publicRoutes from './routes/public.js';
import accountRoutes from './routes/account.js';
import adminRoutes from './routes/admin.js';
import adminOpsRoutes from './routes/admin-ops.js';
import kitchenRoutes from './routes/kitchen.js';

// ------------------------------------------------------- Realtime Durable Object
export class KitchenHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/broadcast')) {
      const body = await request.text();
      for (const ws of this.state.getWebSockets('all')) {
        try { ws.send(body); } catch { /* dropped socket */ }
      }
      return new Response('ok');
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket endpoint', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], ['all']);
    try { pair[1].send(JSON.stringify({ type: 'hello', at: nowISO() })); } catch { /* ignore */ }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, message) {
    if (message === 'ping') {
      try { ws.send('pong'); } catch { /* ignore */ }
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { /* ignore */ }
  }

  async webSocketError(ws) {
    try { ws.close(); } catch { /* ignore */ }
  }
}

const app = new Hono();

// --------------------------------------------------------------- Base middleware
app.use('/api/*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'geolocation=(self)');
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const env = c.env;
    if (env.ENVIRONMENT !== 'development') {
      const origin = c.req.header('Origin');
      if (origin) {
        try {
          if (new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: 'Cross-origin request blocked.' }, 403);
        } catch { return c.json({ error: 'Invalid origin.' }, 403); }
      }
    }
  }
  try {
    await ensureSeeded(c.env);
  } catch (err) {
    return c.json({
      error: 'Database is not ready.',
      detail: 'Run `npm run db:init` to apply the D1 migrations, then reload.',
      message: String(err.message || err),
    }, 503);
  }
  const auth = await loadAuth(c.env, c.req.raw);
  c.set('auth', auth);
  await next();
});

app.use('/api/admin/*', async (c, next) => {
  const auth = c.get('auth');
  if (!auth || auth.type !== 'staff') return c.json({ error: 'Staff sign-in required.' }, 401);
  if (auth.role === 'kitchen') return c.json({ error: 'Kitchen accounts use the kitchen display.' }, 403);
  const path = c.req.path;
  if (auth.role === 'waiter') {
    const allowed = ['/api/admin/dashboard', '/api/admin/orders', '/api/admin/reservations', '/api/admin/tables', '/api/admin/floor', '/api/admin/payments', '/api/admin/upload', '/api/admin/ai', '/api/admin/customers'];
    const ok = allowed.some((p) => path === p || path.startsWith(`${p}/`));
    if (!ok) return c.json({ error: 'Your role does not have access to this area.' }, 403);
    if (path.includes('/refund')) return c.json({ error: 'Only management can refund payments.' }, 403);
  }
  if (auth.role === 'supervisor') {
    const blocked = ['/api/admin/finance', '/api/admin/settings', '/api/admin/staff', '/api/admin/offers', '/api/admin/export', '/api/admin/analytics', '/api/admin/retention', '/api/admin/ai'];
    if (blocked.some((p) => path === p || path.startsWith(`${p}/`))) {
      return c.json({ error: 'This area is restricted to management.' }, 403);
    }
  }
  await next();
});

app.use('/api/customer/*', async (c, next) => {
  const auth = c.get('auth');
  if (!auth || auth.type !== 'customer') return c.json({ error: 'Please sign in to your customer account.' }, 401);
  await next();
});

app.use('/api/kitchen/*', async (c, next) => {
  const auth = c.get('auth');
  if (!auth || auth.type !== 'staff') return c.json({ error: 'Kitchen sign-in required.' }, 401);
  if (!['owner', 'manager', 'supervisor', 'kitchen', 'waiter'].includes(auth.role)) return c.json({ error: 'Not permitted.' }, 403);
  await next();
});

// ----------------------------------------------------------------------- Health
app.get('/api/health', async (c) => {
  try {
    const row = await c.env.DB.prepare('SELECT (SELECT COUNT(*) FROM menu_items) AS menu, (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM users) AS staff').first();
    return c.json({ ok: true, database: 'connected', counts: row, time: nowISO() });
  } catch (err) {
    return c.json({ ok: false, database: 'error', message: String(err.message || err) }, 500);
  }
});

// ------------------------------------------------------------------------- Auth
const loginAttempts = new Map();
function rateLimited(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.start > 5 * 60000) {
    loginAttempts.set(key, { count: 1, start: now });
    return false;
  }
  entry.count += 1;
  return entry.count > 8;
}

function authResponse(c, user, token, maxAge) {
  const secure = new URL(c.req.url).protocol === 'https:';
  c.header('Set-Cookie', sessionCookie(token, maxAge, secure));
  return c.json({
    user,
    redirect: user.type === 'customer' ? '/' : ['kitchen'].includes(user.role) ? '/kitchen' : '/admin',
  });
}

app.post('/api/auth/staff/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const ip = c.req.header('CF-Connecting-IP') || 'local';
  if (!email || !password) return c.json({ error: 'Enter your email and password.' }, 400);
  if (rateLimited(`${ip}:${email}`)) return c.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, 429);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await audit(c.env, null, 'staff_login_failed', 'user', null, { email }, ip);
    return c.json({ error: 'Email or password is incorrect.' }, 401);
  }
  if (!user.active) return c.json({ error: 'This account has been deactivated.' }, 403);
  const { token, maxAge } = await createSession(c.env, 'staff', user.id, c.req.raw);
  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowISO(), user.id).run();
  await audit(c.env, { type: 'staff', id: user.id, name: user.name }, 'staff_login', 'user', user.id, { role: user.role }, ip);
  return authResponse(c, {
    id: user.id, type: 'staff', name: user.name, email: user.email, role: user.role,
    stationId: user.station_id,
  }, token, maxAge);
});

app.post('/api/auth/customer/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const ip = c.req.header('CF-Connecting-IP') || 'local';
  if (!email || !password) return c.json({ error: 'Enter your email and password.' }, 400);
  if (rateLimited(`${ip}:c:${email}`)) return c.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, 429);
  const customer = await c.env.DB.prepare('SELECT * FROM customers WHERE email = ?').bind(email).first();
  if (!customer.password_hash || !(await verifyPassword(password, customer.password_hash))) {
    return c.json({ error: 'Email or password is incorrect. If a staff member created your profile, use password recovery.' }, 401);
  }
  const { token, maxAge } = await createSession(c.env, 'customer', customer.id, c.req.raw);
  await audit(c.env, { type: 'customer', id: customer.id, name: customer.name }, 'customer_login', 'customer', customer.id, null, ip);
  return authResponse(c, {
    id: customer.id, type: 'customer', name: customer.name, email: customer.email, role: 'customer',
    loyaltyPoints: customer.loyalty_points,
  }, token, maxAge);
});

app.post('/api/auth/customer/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  if (!name || name.length > 120) return c.json({ error: 'Enter your name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Enter a valid email address.' }, 400);
  if (phone && phone.length > 30) return c.json({ error: 'Enter a valid phone number.' }, 400);
  if (password.length < 8) return c.json({ error: 'Use a password of at least 8 characters.' }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first();
  if (dup) return c.json({ error: 'An account with that email already exists. Try signing in.' }, 409);
  const hash = await hashPassword(password);
  const result = await c.env.DB.prepare(
    'INSERT INTO customers (name,email,phone,password_hash) VALUES (?,?,?,?)'
  ).bind(name, email, phone || null, hash).run();
  const { token, maxAge } = await createSession(c.env, 'customer', result.meta.last_row_id, c.req.raw);
  await c.env.DB.prepare("INSERT INTO notifications (audience,user_id,type,title,body,link) VALUES ('customer',?,'welcome',?,?, '/account')")
    .bind(result.meta.last_row_id, `Welcome to Brewhaus, ${name.split(' ')[0]}`, 'Your account is ready. Book a table or order ahead whenever you like.').run();
  await audit(c.env, { type: 'customer', id: result.meta.last_row_id, name }, 'customer_register', 'customer', result.meta.last_row_id, null, c.req.header('CF-Connecting-IP'));
  return authResponse(c, {
    id: result.meta.last_row_id, type: 'customer', name, email, role: 'customer', loyaltyPoints: 0,
  }, token, maxAge);
});

app.post('/api/auth/logout', async (c) => {
  const token = readSessionToken(c.req.header('Cookie') || '');
  if (token) {
    const id = await sha256Hex(token);
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
  }
  c.header('Set-Cookie', clearSessionCookie());
  return c.json({ ok: true });
});

app.get('/api/auth/me', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ user: null });
  const cafe = await c.env.DB.prepare('SELECT name, currency, tax_rate FROM cafe_settings WHERE id = 1').first();
  let permissions = [];
  if (auth.type === 'staff') permissions = ROLE_PERMISSIONS[auth.role] || [];
  return c.json({
    user: auth,
    permissions,
    cafe,
    isManager: auth.type === 'staff' && ['owner', 'manager'].includes(auth.role),
  });
});

app.post('/api/auth/password/request', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const userType = body.userType === 'staff' ? 'staff' : 'customer';
  const generic = { ok: true, message: 'If that email is registered, a reset link has been created.' };
  if (!email) return c.json({ error: 'Enter your email address.' }, 400);
  const table = userType === 'staff' ? 'users' : 'customers';
  const account = await c.env.DB.prepare(`SELECT id, name, email FROM ${table} WHERE email = ?`).bind(email).first();
  if (!account) return c.json(generic);
  const token = randomToken(24);
  const id = await sha256Hex(token);
  await c.env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND user_type = ?').bind(account.id, userType).run();
  await c.env.DB.prepare('INSERT INTO password_reset_tokens (id,user_type,user_id,expires_at,created_at) VALUES (?,?,?,?,?)')
    .bind(id, userType, account.id, new Date(Date.now() + 30 * 60000).toISOString(), nowISO()).run();
  const origin = new URL(c.req.url).origin;
  const link = `${origin}/reset-password?token=${token}&type=${userType}`;
  let delivered = false;
  if (c.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: c.env.RESET_FROM || 'Brewhaus <onboarding@resend.dev>',
          to: [account.email],
          subject: 'Reset your Brewhaus password',
          html: `<p>Hello ${account.name},</p><p>Use the link below to reset your password. It expires in 30 minutes.</p><p><a href="${link}">${link}</a></p>`,
        }),
      });
      delivered = res.ok;
    } catch { delivered = false; }
  }
  await audit(c.env, null, 'password_reset_requested', userType, account.id, { delivered }, c.req.header('CF-Connecting-IP'));
  if (c.env.ENVIRONMENT === 'development' && !delivered) {
    return c.json({ ...generic, devLink: link, note: 'Email delivery is not configured. This development link is shown only in the local environment.' });
  }
  return c.json({ ...generic, note: delivered ? 'Check your inbox.' : 'Email delivery is not configured. Contact cafe staff for help.' });
});

app.post('/api/auth/password/reset', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '');
  const password = String(body.password || '');
  if (password.length < 8) return c.json({ error: 'Use a password of at least 8 characters.' }, 400);
  if (!token) return c.json({ error: 'This reset link is invalid.' }, 400);
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare('SELECT * FROM password_reset_tokens WHERE id = ? AND used_at IS NULL AND expires_at > ?').bind(id, nowISO()).first();
  if (!row) return c.json({ error: 'This reset link is invalid or has expired.' }, 400);
  const hash = await hashPassword(password);
  const table = row.user_type === 'staff' ? 'users' : 'customers';
  const column = 'password_hash';
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).bind(hash, row.user_id),
    c.env.DB.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').bind(nowISO(), id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_type = ? AND user_id = ?').bind(row.user_type, row.user_id),
  ]);
  await audit(c.env, { type: row.user_type, id: row.user_id, name: 'Password reset' }, 'password_reset', row.user_type, row.user_id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- Notifications
app.get('/api/notifications', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ notifications: [], unread: 0 });
  let query;
  if (auth.type === 'customer') {
    query = c.env.DB.prepare(
      "SELECT * FROM notifications WHERE audience = 'customer' AND (user_id = ? OR user_id IS NULL) ORDER BY created_at DESC LIMIT 50"
    ).bind(auth.id);
  } else if (['kitchen', 'supervisor'].includes(auth.role)) {
    query = c.env.DB.prepare(
      "SELECT * FROM notifications WHERE audience IN ('kitchen','staff') ORDER BY created_at DESC LIMIT 40"
    );
  } else {
    query = c.env.DB.prepare(
      "SELECT * FROM notifications WHERE audience = 'staff' ORDER BY created_at DESC LIMIT 40"
    );
  }
  const rows = await query.all();
  return c.json({ notifications: rows.results, unread: rows.results.filter((n) => !n.read_at).length });
});

app.post('/api/notifications/read', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'Sign in first.' }, 401);
  const body = await c.req.json().catch(() => ({}));
  if (body.all) {
    if (auth.type === 'customer') {
      await c.env.DB.prepare("UPDATE notifications SET read_at=? WHERE audience='customer' AND (user_id=? OR user_id IS NULL) AND read_at IS NULL").bind(nowISO(), auth.id).run();
    } else if (['kitchen', 'supervisor'].includes(auth.role)) {
      await c.env.DB.prepare("UPDATE notifications SET read_at=? WHERE audience IN ('kitchen','staff') AND read_at IS NULL").bind(nowISO()).run();
    } else {
      await c.env.DB.prepare("UPDATE notifications SET read_at=? WHERE audience='staff' AND read_at IS NULL").bind(nowISO()).run();
    }
    return c.json({ ok: true });
  }
  if (body.id) {
    await c.env.DB.prepare('UPDATE notifications SET read_at=? WHERE id=?').bind(nowISO(), Number(body.id)).run();
  }
  return c.json({ ok: true });
});

// ------------------------------------------------------------------- Realtime WS
app.get('/api/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('WebSocket endpoint. Connect with a WebSocket client.', 426);
  const id = c.env.HUB.idFromName('global');
  return c.env.HUB.get(id).fetch(c.req.raw);
});

// --------------------------------------------------------------- Static images
app.get('/api/images/*', async (c) => {
  const key = c.req.path.replace('/api/images/', '');
  if (!key || key.includes('..')) return c.notFound();
  if (!c.env.IMAGES) return c.json({ error: 'Image storage is not configured.' }, 503);
  const object = await c.env.IMAGES.get(key);
  if (!object) return c.json({ error: 'Image not found.' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
});

// ------------------------------------------------------------------ API routing
app.route('/api', publicRoutes);
app.route('/api/customer', accountRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/admin', adminOpsRoutes);
app.route('/api/kitchen', kitchenRoutes);

app.all('/api/*', (c) => c.json({ error: 'API route not found.' }, 404));

// SPA is served by the Workers Assets binding; any non-API request falls through.
app.all('*', (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text('Not found', 404);
});

export default app;
