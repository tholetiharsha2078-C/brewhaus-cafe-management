// Customer account API: profile, orders, reservations, reviews, favourites, loyalty.
import { Hono } from 'hono';
import { menuAssistant } from '../lib/ai.js';
import { getOrderDetail, getSettings, refreshTableStatus } from '../lib/orders.js';
import { getFloorPlan, minutesOf, tableForSlot } from '../lib/floor.js';
import { randomRef, randomToken } from '../lib/auth.js';
import { audit, broadcast, istDateStr, money, notify, nowISO, pagination, safeJson, validate } from '../lib/utils.js';

const account = new Hono();

account.get('/profile', async (c) => {
  const auth = c.get('auth');
  const env = c.env;
  const customer = await env.DB.prepare(
    'SELECT id,name,email,phone,loyalty_points,marketing_opt_in,created_at,last_visit_at,notes FROM customers WHERE id = ?'
  )
    .bind(auth.id)
    .first();
  const stats = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM orders WHERE customer_id = ? AND status IN ('completed','served')) AS orders_count,
       (SELECT COUNT(*) FROM orders WHERE customer_id = ? AND status IN ('completed','served')) AS visits,
       (SELECT COALESCE(SUM(amount - refunded_amount),0) FROM payments WHERE customer_id = ? AND status IN ('paid','partially_refunded','refunded')) AS total_spent,
       (SELECT COUNT(*) FROM reservations WHERE customer_id = ? AND status IN ('completed','seated')) AS reservations_count`
  )
    .bind(auth.id, auth.id, auth.id, auth.id)
    .first();
  const settings = await getSettings(env);
  const favorites = await env.DB.prepare(
    `SELECT mi.id, mi.name, mi.price, mi.image_url, mi.available, mc.name AS category
       FROM favorites f JOIN menu_items mi ON mi.id = f.menu_item_id JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE f.customer_id = ? ORDER BY f.created_at DESC`
  )
    .bind(auth.id)
    .all();
  const loyalty = await env.DB.prepare(
    'SELECT * FROM loyalty_transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20'
  )
    .bind(auth.id)
    .all();
  return c.json({
    customer: {
      ...customer,
      loyalty_points: stats ? customer.loyalty_points : customer.loyalty_points,
    },
    stats,
    favorites: favorites.results,
    loyalty: loyalty.results,
    loyaltyConfig: {
      enabled: Boolean(settings.loyalty_enabled),
      pointsPer100: settings.loyalty_points_per_100,
      pointValue: settings.loyalty_point_value,
      minRedeem: settings.loyalty_min_redeem,
    },
  });
});

account.patch('/profile', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, {
    name: { required: true, maxLength: 120 },
    phone: { maxLength: 30 },
    email: { required: true, email: true, maxLength: 180 },
  });
  if (Object.keys(errors).length) return c.json({ error: 'Please check the form.', errors }, 400);
  const existing = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ? AND id != ?').bind(body.email, auth.id).first();
  if (existing) return c.json({ error: 'Another account already uses that email.', errors: { email: 'already in use' } }, 409);
  await c.env.DB.prepare('UPDATE customers SET name = ?, email = ?, phone = ?, marketing_opt_in = ? WHERE id = ?')
    .bind(body.name, body.email, body.phone || null, body.marketingOptIn ? 1 : 0, auth.id)
    .run();
  await audit(c.env, auth, 'update_profile', 'customer', auth.id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

account.get('/orders', async (c) => {
  const auth = c.get('auth');
  const { limit, offset, page } = pagination(c, 10, 50);
  const status = c.req.query('status');
  let where = 'o.customer_id = ?';
  const binds = [auth.id];
  if (status && status !== 'all') { where += ' AND o.status = ?'; binds.push(status); }
  const rows = await c.env.DB.prepare(
    `SELECT o.*, t.label AS table_label,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
       (SELECT GROUP_CONCAT(name_snapshot, ', ') FROM order_items WHERE order_id = o.id) AS items_summary
     FROM orders o LEFT JOIN cafe_tables t ON t.id = o.table_id
     WHERE ${where} ORDER BY o.placed_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where}`).bind(...binds).first();
  return c.json({ orders: rows.results, total: total.n, page, limit });
});

account.get('/orders/:id', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const exists = await c.env.DB.prepare('SELECT id FROM orders WHERE id = ? AND customer_id = ?').bind(id, auth.id).first();
  if (!exists) return c.json({ error: 'Order not found.' }, 404);
  const order = await getOrderDetail(c.env, id);
  const review = await c.env.DB.prepare('SELECT * FROM reviews WHERE order_id = ?').bind(id).first();
  return c.json({ order: { ...order, tracking_token: undefined }, canReview: ['served', 'completed'].includes(order.status) && !review, review: review || null });
});

account.get('/reservations', async (c) => {
  const auth = c.get('auth');
  const rows = await c.env.DB.prepare(
    `SELECT r.*, t.label AS table_label FROM reservations r LEFT JOIN cafe_tables t ON t.id = r.table_id
      WHERE r.customer_id = ? ORDER BY r.reservation_date DESC, r.reservation_time DESC`
  )
    .bind(auth.id)
    .all();
  return c.json({ reservations: rows.results });
});

account.post('/reservations', async (c) => {
  const auth = c.get('auth');
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, {
    date: { required: true, date: true },
    time: { required: true, time: true },
    party: { required: true, type: 'number', min: 1, max: 20 },
    tableId: { required: true, type: 'number' },
    specialRequests: { maxLength: 500 },
  });
  if (Object.keys(errors).length) return c.json({ error: 'Please check your reservation details.', errors }, 400);
  if (body.date < istDateStr()) return c.json({ error: 'Reservations cannot be made in the past.' }, 422);
  if (body.time < '08:00' || body.time > '22:30') return c.json({ error: 'Reservations are available between 08:00 and 22:30.' }, 422);

  const settings = await getSettings(env);
  const table = await env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(Number(body.tableId)).first();
  if (!table) return c.json({ error: 'That table could not be found.' }, 404);
  if (table.status === 'out_of_service') return c.json({ error: 'That table is out of service.' }, 409);
  if (Number(body.party) > Number(table.capacity)) return c.json({ error: `Table ${table.label} seats up to ${table.capacity} guests.` }, 409);

  if (body.holdToken) {
    const hold = await env.DB.prepare('SELECT * FROM table_holds WHERE token = ? AND expires_at > ?').bind(body.holdToken, nowISO()).first();
    if (!hold || hold.table_id !== Number(body.tableId)) return c.json({ error: 'Your table hold has expired. Please choose a table again.' }, 409);
  }

  const ref = randomRef('RSV', 4);
  const slot = settings.reservation_slot_minutes || 90;
  const guard = await env.DB.prepare(
    `INSERT INTO reservations (reference,customer_id,guest_name,phone,email,reservation_date,reservation_time,party_size,table_id,status,special_requests,source,created_by_type,created_by_id,confirmed_at,created_at,updated_at)
     SELECT ?,?,?,?,?,?,?,?,?, 'confirmed', ?, 'online', 'customer', ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM reservations rr WHERE rr.table_id = ? AND rr.reservation_date = ? AND rr.status IN ('pending','confirmed','seated')
         AND ABS((CAST(substr(rr.reservation_time,1,2) AS INTEGER)*60 + CAST(substr(rr.reservation_time,4,2) AS INTEGER)) - ?) < ?
     )
     AND NOT EXISTS (
       SELECT 1 FROM table_holds th WHERE th.table_id = ? AND th.slot_date = ? AND th.expires_at > ? AND th.token != ?
     )`
  )
    .bind(
      ref, auth.id, auth.name, auth.phone || body.phone || '', auth.email, body.date, body.time, Number(body.party), Number(body.tableId),
      String(body.specialRequests || '').slice(0, 500), auth.id, nowISO(), nowISO(), nowISO(),
      Number(body.tableId), body.date, minutesOf(body.time), slot,
      Number(body.tableId), body.date, nowISO(), body.holdToken || ''
    )
    .run();
  if (!guard.meta.changes) return c.json({ error: 'That table was just taken for this time. Please pick another.' }, 409);

  if (body.holdToken) await env.DB.prepare('DELETE FROM table_holds WHERE token = ?').bind(body.holdToken).run();
  await refreshTableStatus(env, Number(body.tableId));
  const reservation = await env.DB.prepare('SELECT * FROM reservations WHERE reference = ?').bind(ref).first();
  await notify(env, {
    audience: 'customer', userId: auth.id, type: 'reservation', title: `Table confirmed — ${ref}`,
    body: `${body.date} at ${body.time} for ${body.party} guests · Table ${table.label}`, link: '/account',
  });
  await notify(env, {
    audience: 'staff', type: 'reservation', title: `New online reservation ${ref}`,
    body: `${auth.name} · ${body.date} ${body.time} · ${body.party} guests · Table ${table.label}`, link: '/admin/reservations',
  });
  await audit(env, auth, 'create_reservation', 'reservation', reservation.id, { ref, date: body.date, time: body.time }, c.req.header('CF-Connecting-IP'));
  await broadcast(env, { type: 'reservation', action: 'created', reference: ref, date: body.date, time: body.time });
  return c.json({ reservation }, 201);
});

account.post('/reservations/:id/cancel', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const res = await c.env.DB.prepare('SELECT * FROM reservations WHERE id = ? AND customer_id = ?').bind(id, auth.id).first();
  if (!res) return c.json({ error: 'Reservation not found.' }, 404);
  if (!['pending', 'confirmed'].includes(res.status)) return c.json({ error: 'This reservation can no longer be cancelled online.' }, 409);
  const body = await c.req.json().catch(() => ({}));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE reservations SET status='cancelled', cancelled_at=?, cancelled_reason=?, updated_at=? WHERE id=?")
      .bind(nowISO(), String(body.reason || 'Cancelled by customer').slice(0, 300), nowISO(), id),
    c.env.DB.prepare("UPDATE orders SET status='cancelled', cancelled_at=?, cancel_reason=? WHERE reservation_id=? AND status='pending'")
      .bind(nowISO(), 'Reservation cancelled by customer', id),
  ]);
  await refreshTableStatus(c.env, res.table_id);
  await notify(c.env, { audience: 'staff', type: 'reservation_cancelled', title: `Reservation ${res.reference} cancelled`, body: res.guest_name, link: '/admin/reservations' });
  await audit(c.env, auth, 'cancel_reservation', 'reservation', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

account.post('/favorites/:itemId', async (c) => {
  const auth = c.get('auth');
  const itemId = Number(c.req.param('itemId'));
  const item = await c.env.DB.prepare('SELECT id FROM menu_items WHERE id = ?').bind(itemId).first();
  if (!item) return c.json({ error: 'Menu item not found.' }, 404);
  const existing = await c.env.DB.prepare('SELECT id FROM favorites WHERE customer_id = ? AND menu_item_id = ?').bind(auth.id, itemId).first();
  if (existing) {
    await c.env.DB.prepare('DELETE FROM favorites WHERE id = ?').bind(existing.id).run();
    return c.json({ favorite: false });
  }
  await c.env.DB.prepare('INSERT INTO favorites (customer_id, menu_item_id) VALUES (?,?)').bind(auth.id, itemId).run();
  return c.json({ favorite: true });
});

account.post('/reviews', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').bind(Number(body.orderId), auth.id).first();
  if (!order) return c.json({ error: 'Order not found.' }, 404);
  if (!['served', 'completed'].includes(order.status)) return c.json({ error: 'You can review an order once it has been served.' }, 409);
  const existing = await c.env.DB.prepare('SELECT id FROM reviews WHERE order_id = ?').bind(order.id).first();
  if (existing) return c.json({ error: 'You have already reviewed this order.' }, 409);
  const ratings = ['foodRating', 'serviceRating', 'overallRating'];
  for (const key of ratings) {
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < 1 || n > 5) return c.json({ error: 'Please give a rating from 1 to 5 stars.' }, 400);
  }
  const settings = await getSettings(c.env);
  const status = settings.review_moderation ? 'pending' : 'approved';
  const result = await c.env.DB.prepare(
    'INSERT INTO reviews (order_id,customer_id,food_rating,service_rating,overall_rating,comment,photo_url,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  )
    .bind(
      order.id, auth.id, Number(body.foodRating), Number(body.serviceRating), Number(body.overallRating),
      String(body.comment || '').slice(0, 1000) || null, body.photoUrl || null, status, nowISO()
    )
    .run();
  await notify(c.env, { audience: 'staff', type: 'review', title: 'New customer review', body: `${body.overallRating}★ on ${order.order_number}`, link: '/admin/analytics' });
  await audit(c.env, auth, 'create_review', 'review', result.meta.last_row_id, { orderId: order.id }, c.req.header('CF-Connecting-IP'));
  return c.json({ review: { id: result.meta.last_row_id, status } }, 201);
});

account.get('/reviews', async (c) => {
  const auth = c.get('auth');
  const rows = await c.env.DB.prepare(
    `SELECT r.*, o.order_number FROM reviews r JOIN orders o ON o.id = r.order_id WHERE r.customer_id = ? ORDER BY r.created_at DESC`
  )
    .bind(auth.id)
    .all();
  return c.json({ reviews: rows.results });
});

account.post('/ai', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const question = String(body.question || '').trim();
  if (!question) return c.json({ error: 'Ask a question about the menu.' }, 400);
  if (question.length > 500) return c.json({ error: 'Please keep questions under 500 characters.' }, 400);
  const result = await menuAssistant(c.env, question);
  return c.json(result);
});

account.get('/reservation-availability', async (c) => {
  const date = c.req.query('date') || istDateStr();
  const time = c.req.query('time') || '19:00';
  const party = Math.max(1, Number(c.req.query('party')) || 2);
  const data = await getFloorPlan(c.env, { date, time, party, includeDetails: false });
  return c.json(data);
});

account.post('/upload', async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: 'Upload an image.' }, 400);
  const file = form.get('file');
  if (!file || typeof file === 'string') return c.json({ error: 'No file received.' }, 400);
  const allowed = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ext = allowed[file.type];
  if (!ext) return c.json({ error: 'Use a JPG, PNG, WEBP or GIF image.' }, 415);
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'Images must be under 5 MB.' }, 413);
  if (!c.env.IMAGES) return c.json({ error: 'Image storage is not configured.' }, 503);
  const key = `reviews/${crypto.randomUUID()}.${ext}`;
  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });
  return c.json({ url: `/api/images/${key}` }, 201);
});

export default account;
