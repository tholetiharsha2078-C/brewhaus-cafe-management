// Restaurant management API (core operations).
import { Hono } from 'hono';
import {
  audit, broadcast, csvResponse, int, istDateStr, istDayEnd, istDayStart, money, nowISO,
  pagination, validate,
} from '../lib/utils.js';
import { createOrder, getOrderDetail, refreshTableStatus, transitionOrder, updateItemStatus } from '../lib/orders.js';
import { getFloorPlan, minutesOf } from '../lib/floor.js';
import { randomRef } from '../lib/auth.js';
import { staffAssistant } from '../lib/ai.js';

const admin = new Hono();

function readRange(c) {
  const today = istDateStr();
  const from = c.req.query('from') || c.req.query('date') || today;
  const to = c.req.query('to') || from;
  return { from, to, fromIso: istDayStart(from), toIso: istDayEnd(to) };
}

function fillDays(rows, from, to, valueKey = 'value') {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const start = new Date(`${from}T12:00:00+05:30`);
  const end = new Date(`${to}T12:00:00+05:30`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const row = map.get(day);
    out.push({ day, [valueKey]: row ? money(row[valueKey]) : 0, orders: row?.orders || 0 });
  }
  return out;
}

// ---------------------------------------------------------------- Dashboard
admin.get('/dashboard', async (c) => {
  const env = c.env;
  const { from, to, fromIso, toIso } = readRange(c);
  const today = istDateStr();
  const todayStart = istDayStart(today);
  const todayEnd = istDayEnd(today);

  const summary = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM reservations WHERE reservation_date = ? AND status IN ('pending','confirmed','seated')) AS today_reservations,
      (SELECT COALESCE(SUM(amount - refunded_amount),0) FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?) AS today_revenue,
      (SELECT COUNT(*) FROM orders WHERE status IN ('pending','confirmed','preparing','ready','collected','on_hold')) AS active_orders,
      (SELECT COUNT(DISTINCT COALESCE(customer_id, guest_name)) FROM orders WHERE status IN ('served','completed') AND placed_at BETWEEN ? AND ?) AS customers_served,
      (SELECT COUNT(*) FROM cafe_tables WHERE status = 'available') AS available_tables,
      (SELECT COUNT(*) FROM cafe_tables) AS total_tables,
      (SELECT COUNT(*) FROM ingredients WHERE stock_qty <= min_stock AND active = 1) AS low_stock,
      (SELECT COUNT(*) FROM orders WHERE placed_at BETWEEN ? AND ?) AS today_orders,
      (SELECT COALESCE(SUM(amount - refunded_amount),0) FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?) AS revenue_range,
      (SELECT COUNT(*) FROM orders WHERE placed_at BETWEEN ? AND ? AND status = 'cancelled') AS cancelled_range`
  )
    .bind(
      today, todayStart, todayEnd, todayStart, todayEnd,
      todayStart, todayEnd, fromIso, toIso, fromIso, toIso
    )
    .first();

  const yesterday = new Date(Date.now() - 86400000);
  const yDate = new Date(yesterday.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
  const yesterdayRevenue = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount - refunded_amount),0) AS v FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?"
  )
    .bind(istDayStart(yDate), istDayEnd(yDate))
    .first();

  const [dailyRows, weeklyRows, monthlyRows, statusRows, upcoming, recentOrders, bestSellers, recentPayments, inventoryAlerts, newCustomers, repeat, recentCustomers, pendingReports] =
    await Promise.all([
      env.DB.prepare(
        `SELECT date(paid_at, '+5 hours','+30 minutes') AS day, SUM(amount - refunded_amount) AS value, COUNT(*) AS orders
           FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?
          GROUP BY day ORDER BY day`
      ).bind(fromIso, toIso).all(),
      env.DB.prepare(
        `SELECT strftime('%Y-W%W', datetime(paid_at,'+5 hours','+30 minutes')) AS day, SUM(amount - refunded_amount) AS value, COUNT(*) AS orders
           FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?
          GROUP BY day ORDER BY day`
      ).bind(fromIso, toIso).all(),
      env.DB.prepare(
        `SELECT strftime('%Y-%m', datetime(paid_at,'+5 hours','+30 minutes')) AS day, SUM(amount - refunded_amount) AS value, COUNT(*) AS orders
           FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at >= datetime('now','-365 days')
          GROUP BY day ORDER BY day`
      ).all(),
      env.DB.prepare(
        'SELECT status, COUNT(*) AS count FROM orders WHERE placed_at BETWEEN ? AND ? GROUP BY status'
      ).bind(fromIso, toIso).all(),
      env.DB.prepare(
        `SELECT r.*, t.label AS table_label FROM reservations r LEFT JOIN cafe_tables t ON t.id = r.table_id
          WHERE r.reservation_date >= ? AND r.status IN ('pending','confirmed') ORDER BY r.reservation_date, r.reservation_time LIMIT 6`
      ).bind(today).all(),
      env.DB.prepare(
        `SELECT o.*, t.label AS table_label, COALESCE(c.name, o.guest_name) AS customer_name
           FROM orders o LEFT JOIN cafe_tables t ON t.id = o.table_id LEFT JOIN customers c ON c.id = o.customer_id
          ORDER BY o.placed_at DESC LIMIT 6`
      ).all(),
      env.DB.prepare(
        `SELECT oi.name_snapshot AS name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.status = 'completed' AND o.placed_at BETWEEN ? AND ?
          GROUP BY oi.name_snapshot ORDER BY qty DESC LIMIT 6`
      ).bind(fromIso, toIso).all(),
      env.DB.prepare(
        `SELECT p.*, o.order_number FROM payments p LEFT JOIN orders o ON o.id = p.order_id ORDER BY p.created_at DESC LIMIT 6`
      ).all(),
      env.DB.prepare(
        `SELECT id, name, unit, stock_qty, min_stock FROM ingredients WHERE stock_qty <= min_stock AND active = 1 ORDER BY (stock_qty - min_stock) LIMIT 6`
      ).all(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ?').bind(fromIso).first(),
      env.DB.prepare(
        "SELECT COUNT(*) AS n FROM (SELECT customer_id FROM orders WHERE customer_id IS NOT NULL AND status='completed' GROUP BY customer_id HAVING COUNT(*) > 1)"
      ).first(),
      env.DB.prepare(
        `SELECT c.id, c.name, c.email, c.created_at, c.last_visit_at,
                (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) AS orders_count,
                (SELECT COALESCE(SUM(amount-refunded_amount),0) FROM payments WHERE customer_id = c.id AND status IN ('paid','partially_refunded','refunded')) AS spend
           FROM customers c ORDER BY c.created_at DESC LIMIT 5`
      ).all(),
      env.DB.prepare(
        "SELECT COUNT(*) AS n FROM availability_reports WHERE status = 'open'"
      ).first(),
    ]);

  const dailySeries = fillDays(dailyRows.results, from, to);
  const weeklySeries = weeklyRows.results.map((r) => ({ label: r.day.replace('-W', ' W'), value: money(r.value), orders: r.orders }));
  const monthlySeries = monthlyRows.results.map((r) => ({ label: r.day, value: money(r.value), orders: r.orders }));

  return c.json({
    range: { from, to },
    summary: {
      ...summary,
      yesterdayRevenue: money(yesterdayRevenue.v),
      revenueDelta: summary.today_revenue - money(yesterdayRevenue.v),
      repeatCustomers: repeat.n,
      newCustomers: newCustomers.n,
      openAvailabilityReports: pendingReports.n,
    },
    revenueSeries: { daily: dailySeries, weekly: weeklySeries, monthly: monthlySeries },
    orderStatus: statusRows.results,
    upcomingReservations: upcoming.results,
    recentOrders: recentOrders.results,
    bestSellers: bestSellers.results,
    recentPayments: recentPayments.results,
    inventoryAlerts: inventoryAlerts.results,
    customerActivity: { recentCustomers: recentCustomers.results, newCustomers: newCustomers.n, repeatCustomers: repeat.n },
  });
});

// ------------------------------------------------------------- Reservations
admin.get('/reservations', async (c) => {
  const { limit, offset, page } = pagination(c, 15);
  const status = c.req.query('status');
  const q = (c.req.query('q') || '').trim();
  const from = c.req.query('from');
  const to = c.req.query('to');
  const date = c.req.query('date');
  let where = '1=1';
  const binds = [];
  if (status && status !== 'all') { where += ' AND r.status = ?'; binds.push(status); }
  if (date) { where += ' AND r.reservation_date = ?'; binds.push(date); }
  if (from) { where += ' AND r.reservation_date >= ?'; binds.push(from); }
  if (to) { where += ' AND r.reservation_date <= ?'; binds.push(to); }
  if (q) {
    where += ' AND (r.guest_name LIKE ? OR r.phone LIKE ? OR r.reference LIKE ? OR r.email LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = await c.env.DB.prepare(
    `SELECT r.*, t.label AS table_label, t.capacity, t.zone
       FROM reservations r LEFT JOIN cafe_tables t ON t.id = r.table_id
      WHERE ${where} ORDER BY r.reservation_date DESC, r.reservation_time DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM reservations r WHERE ${where}`).bind(...binds).first();
  const counts = await c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM reservations GROUP BY status').all();
  return c.json({ reservations: rows.results, total: total.n, page, limit, counts: counts.results });
});

admin.post('/reservations', async (c) => {
  const env = c.env;
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, {
    guestName: { required: true, maxLength: 120 },
    phone: { required: true, maxLength: 30 },
    date: { required: true, date: true },
    time: { required: true, time: true },
    partySize: { required: true, type: 'number', min: 1, max: 30 },
    tableId: { required: true, type: 'number' },
  });
  if (Object.keys(errors).length) return c.json({ error: 'Please check the reservation form.', errors }, 400);
  const table = await env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(Number(body.tableId)).first();
  if (!table) return c.json({ error: 'Table not found.' }, 404);
  if (Number(body.partySize) > Number(table.capacity)) return c.json({ error: `Table ${table.label} seats ${table.capacity}.`, errors: { tableId: 'capacity exceeded' } }, 409);
  if (table.status === 'out_of_service') return c.json({ error: 'That table is out of service.' }, 409);

  let customerId = body.customerId ? Number(body.customerId) : null;
  if (!customerId && body.email) {
    const existing = await env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(body.email).first();
    if (existing) customerId = existing.id;
  }
  const status = ['pending', 'confirmed'].includes(body.status) ? body.status : 'confirmed';
  const settings = await env.DB.prepare('SELECT reservation_slot_minutes FROM cafe_settings WHERE id = 1').first();
  const slot = settings?.reservation_slot_minutes || 90;
  const ref = randomRef('RSV', 4);
  const guard = await env.DB.prepare(
    `INSERT INTO reservations (reference,customer_id,guest_name,phone,email,reservation_date,reservation_time,party_size,table_id,status,special_requests,source,created_by_type,created_by_id,confirmed_at,created_at,updated_at)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
     WHERE NOT EXISTS (
       SELECT 1 FROM reservations rr WHERE rr.table_id = ? AND rr.reservation_date = ? AND rr.status IN ('pending','confirmed','seated')
         AND ABS((CAST(substr(rr.reservation_time,1,2) AS INTEGER)*60 + CAST(substr(rr.reservation_time,4,2) AS INTEGER)) - ?) < ?
     )`
  )
    .bind(
      ref, customerId, body.guestName, body.phone, body.email || null, body.date, body.time, Number(body.partySize), Number(body.tableId),
      status, String(body.specialRequests || '').slice(0, 500), body.source || 'management', 'staff', auth.id,
      status === 'confirmed' ? nowISO() : null, nowISO(), nowISO(),
      Number(body.tableId), body.date, minutesOf(body.time), slot
    )
    .run();
  if (!guard.meta.changes) return c.json({ error: 'This table already has a reservation within 90 minutes of that time.' }, 409);
  const reservation = await env.DB.prepare('SELECT * FROM reservations WHERE reference = ?').bind(ref).first();
  await refreshTableStatus(env, Number(body.tableId));
  await audit(env, auth, 'create_reservation', 'reservation', reservation.id, { ref }, c.req.header('CF-Connecting-IP'));
  await broadcast(env, { type: 'reservation', action: 'created', reference: ref });
  if (customerId) {
    await env.DB.prepare(
      "INSERT INTO notifications (audience,user_id,type,title,body,link) VALUES ('customer',?, 'reservation', ?, ?, '/account')"
    ).bind(customerId, `Table booked — ${ref}`, `${body.date} at ${body.time} · Table ${table.label}`).run();
  }
  return c.json({ reservation }, 201);
});

admin.patch('/reservations/:id', async (c) => {
  const env = c.env;
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const existing = await env.DB.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Reservation not found.' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const date = body.date || existing.reservation_date;
  const time = body.time || existing.reservation_time;
  const tableId = body.tableId ? Number(body.tableId) : existing.table_id;
  const party = body.partySize != null ? Number(body.partySize) : existing.party_size;
  const table = await env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(tableId).first();
  if (!table) return c.json({ error: 'Table not found.' }, 404);
  if (party > table.capacity) return c.json({ error: `Table ${table.label} seats ${table.capacity} guests.` }, 409);
  const settings = await env.DB.prepare('SELECT reservation_slot_minutes FROM cafe_settings WHERE id = 1').first();
  const slot = settings?.reservation_slot_minutes || 90;
  const result = await env.DB.prepare(
    `UPDATE reservations SET guest_name = ?, phone = ?, email = ?, reservation_date = ?, reservation_time = ?, party_size = ?, table_id = ?,
        special_requests = ?, status = ?, updated_at = ?
     WHERE id = ?
       AND NOT EXISTS (
         SELECT 1 FROM reservations rr WHERE rr.id != ? AND rr.table_id = ? AND rr.reservation_date = ? AND rr.status IN ('pending','confirmed','seated')
           AND ABS((CAST(substr(rr.reservation_time,1,2) AS INTEGER)*60 + CAST(substr(rr.reservation_time,4,2) AS INTEGER)) - ?) < ?
       )`
  )
    .bind(
      body.guestName ?? existing.guest_name, body.phone ?? existing.phone, body.email ?? existing.email,
      date, time, party, tableId, body.specialRequests ?? existing.special_requests,
      body.status || existing.status, nowISO(), id, id, tableId, date, minutesOf(time), slot
    )
    .run();
  if (!result.meta.changes) return c.json({ error: 'That table is already booked around this time.' }, 409);
  await refreshTableStatus(env, existing.table_id);
  if (tableId !== existing.table_id) await refreshTableStatus(env, tableId);
  await audit(env, auth, 'update_reservation', 'reservation', id, body, c.req.header('CF-Connecting-IP'));
  const updated = await env.DB.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first();
  return c.json({ reservation: updated });
});

admin.post('/reservations/:id/status', async (c) => {
  const env = c.env;
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const status = body.status;
  const res = await env.DB.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first();
  if (!res) return c.json({ error: 'Reservation not found.' }, 404);
  const allowed = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['seated', 'completed', 'cancelled', 'no_show', 'pending'],
    seated: ['completed', 'cancelled', 'no_show'],
    completed: [], cancelled: [], no_show: [],
  };
  if (!(allowed[res.status] || []).includes(status)) return c.json({ error: `Cannot change a ${res.status} reservation to ${status}.` }, 409);
  const ts = nowISO();
  const sets = ['status = ?', 'updated_at = ?'];
  const binds = [status, ts];
  if (status === 'confirmed') { sets.push('confirmed_at = ?'); binds.push(ts); }
  if (status === 'seated') { sets.push('seated_at = ?'); binds.push(ts); }
  if (status === 'completed') { sets.push('completed_at = ?'); binds.push(ts); }
  if (status === 'cancelled') { sets.push('cancelled_at = ?', 'cancelled_reason = ?'); binds.push(ts, String(body.reason || 'Cancelled by staff').slice(0, 300)); }
  binds.push(id);
  await env.DB.prepare(`UPDATE reservations SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (status === 'seated' && res.table_id) {
    const table = await env.DB.prepare('SELECT status FROM cafe_tables WHERE id = ?').bind(res.table_id).first();
    if (table && !['out_of_service', 'cleaning'].includes(table.status)) {
      await env.DB.prepare("UPDATE cafe_tables SET status='occupied', updated_at=? WHERE id=?").bind(ts, res.table_id).run();
    }
  } else {
    await refreshTableStatus(env, res.table_id);
  }
  await audit(env, auth, `reservation_${status}`, 'reservation', id, body, c.req.header('CF-Connecting-IP'));
  if (res.customer_id) {
    await env.DB.prepare(
      "INSERT INTO notifications (audience,user_id,type,title,body,link) VALUES ('customer',?, 'reservation', ?, ?, '/account')"
    ).bind(res.customer_id, `Reservation ${status} — ${res.reference}`, `${res.reservation_date} at ${res.reservation_time}`, '/account').run();
  }
  await broadcast(env, { type: 'reservation', action: status, reference: res.reference });
  const updated = await env.DB.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first();
  return c.json({ reservation: updated });
});

admin.delete('/reservations/:id', async (c) => {
  const auth = c.get('auth');
  if (!['owner', 'manager'].includes(auth.role)) return c.json({ error: 'Only management can delete reservations.' }, 403);
  const res = await c.env.DB.prepare('SELECT * FROM reservations WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!res) return c.json({ error: 'Reservation not found.' }, 404);
  await c.env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(res.id).run();
  await refreshTableStatus(c.env, res.table_id);
  await audit(c.env, auth, 'delete_reservation', 'reservation', res.id, { reference: res.reference }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// -------------------------------------------------------------------- Orders
admin.get('/orders', async (c) => {
  const { limit, offset, page } = pagination(c, 15);
  const status = c.req.query('status');
  const q = (c.req.query('q') || '').trim();
  const type = c.req.query('type');
  const payment = c.req.query('payment');
  const from = c.req.query('from');
  const to = c.req.query('to');
  let where = '1=1';
  const binds = [];
  if (status && status !== 'all') { where += ' AND o.status = ?'; binds.push(status); }
  if (type && type !== 'all') { where += ' AND o.type = ?'; binds.push(type); }
  if (payment && payment !== 'all') { where += ' AND o.payment_status = ?'; binds.push(payment); }
  if (from) { where += ' AND o.placed_at >= ?'; binds.push(istDayStart(from)); }
  if (to) { where += ' AND o.placed_at <= ?'; binds.push(istDayEnd(to)); }
  if (q) {
    where += ' AND (o.order_number LIKE ? OR o.guest_name LIKE ? OR c.name LIKE ? OR o.guest_phone LIKE ? OR c.phone LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = await c.env.DB.prepare(
    `SELECT o.*, t.label AS table_label, COALESCE(c.name, o.guest_name) AS customer_name,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
       (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS item_qty,
       (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND status = 'ready') AS ready_items
     FROM orders o LEFT JOIN cafe_tables t ON t.id = o.table_id LEFT JOIN customers c ON c.id = o.customer_id
     WHERE ${where} ORDER BY o.placed_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all();
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE ${where}`
  ).bind(...binds).first();
  const counts = await c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all();
  return c.json({ orders: rows.results, total: total.n, page, limit, counts: counts.results });
});

admin.get('/orders/:id', async (c) => {
  const order = await getOrderDetail(c.env, Number(c.req.param('id')));
  if (!order) return c.json({ error: 'Order not found.' }, 404);
  return c.json({ order });
});

admin.post('/orders', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await createOrder(c.env, c.get('auth'), { ...body, source: 'management' }, { source: 'management' });
  if (result.error) return c.json({ error: result.error, details: result.details }, result.status || 400);
  await audit(c.env, c.get('auth'), 'create_order', 'order', result.order.id, { number: result.order.order_number }, c.req.header('CF-Connecting-IP'));
  return c.json({ order: result.order }, 201);
});

admin.patch('/orders/:id/status', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await transitionOrder(c.env, c.get('auth'), Number(c.req.param('id')), body.status, {
    reason: body.reason,
    collectedBy: body.collectedBy ? Number(body.collectedBy) : undefined,
  });
  if (result.error) return c.json({ error: result.error }, result.status || 400);
  await audit(c.env, c.get('auth'), `order_${body.status}`, 'order', result.order.id, { number: result.order.order_number }, c.req.header('CF-Connecting-IP'));
  return c.json({ order: result.order });
});

admin.patch('/orders/:id/items/:itemId/status', async (c) => {
  const result = await updateItemStatus(c.env, c.get('auth'), Number(c.req.param('itemId')), (await c.req.json().catch(() => ({}))).status);
  if (result.error) return c.json({ error: result.error }, result.status || 400);
  return c.json(result);
});

// -------------------------------------------------------------------- Tables
admin.get('/floor', async (c) => {
  const date = c.req.query('date') || istDateStr();
  const time = c.req.query('time') || '19:00';
  const party = Math.max(1, Number(c.req.query('party')) || 1);
  const floor = await getFloorPlan(c.env, { date, time, party, includeDetails: true });
  return c.json(floor);
});

admin.post('/tables', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, {
    label: { required: true, maxLength: 20 },
    capacity: { required: true, type: 'number', min: 1, max: 30 },
    x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', min: 40 }, height: { type: 'number', min: 40 },
  });
  if (Object.keys(errors).length) return c.json({ error: 'Check the table details.', errors }, 400);
  const plan = await c.env.DB.prepare('SELECT id FROM floor_plans WHERE active = 1 ORDER BY id LIMIT 1').first();
  const dup = await c.env.DB.prepare('SELECT id FROM cafe_tables WHERE floor_plan_id = ? AND label = ?').bind(plan.id, body.label).first();
  if (dup) return c.json({ error: 'A table with that label already exists.', errors: { label: 'already used' } }, 409);
  const result = await c.env.DB.prepare(
    `INSERT INTO cafe_tables (floor_plan_id,label,capacity,x,y,width,height,shape,zone,status,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      plan.id, body.label, Number(body.capacity), Number(body.x) || 60, Number(body.y) || 60,
      Number(body.width) || 110, Number(body.height) || 110, body.shape || 'round', body.zone || null,
      body.status || 'available', body.notes || null
    )
    .run();
  await audit(c.env, auth, 'create_table', 'table', result.meta.last_row_id, { label: body.label }, c.req.header('CF-Connecting-IP'));
  const table = await c.env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(result.meta.last_row_id).first();
  return c.json({ table }, 201);
});

admin.put('/tables/:id', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Table not found.' }, 404);
  if (body.label && body.label !== existing.label) {
    const dup = await c.env.DB.prepare('SELECT id FROM cafe_tables WHERE floor_plan_id = ? AND label = ? AND id != ?').bind(existing.floor_plan_id, body.label, id).first();
    if (dup) return c.json({ error: 'A table with that label already exists.' }, 409);
  }
  await c.env.DB.prepare(
    `UPDATE cafe_tables SET label=?, capacity=?, x=?, y=?, width=?, height=?, shape=?, zone=?, status=?, notes=?, updated_at=? WHERE id=?`
  )
    .bind(
      body.label ?? existing.label, body.capacity != null ? Number(body.capacity) : existing.capacity,
      body.x != null ? Number(body.x) : existing.x, body.y != null ? Number(body.y) : existing.y,
      body.width != null ? Number(body.width) : existing.width, body.height != null ? Number(body.height) : existing.height,
      body.shape || existing.shape, body.zone ?? existing.zone, body.status || existing.status,
      body.notes ?? existing.notes, nowISO(), id
    )
    .run();
  await audit(c.env, auth, 'update_table', 'table', id, body, c.req.header('CF-Connecting-IP'));
  const table = await c.env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(id).first();
  return c.json({ table });
});

admin.patch('/tables/layout', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.tables)) return c.json({ error: 'A tables array is required.' }, 400);
  const allowed = await c.env.DB.prepare('SELECT id FROM cafe_tables').all();
  const ids = new Set(allowed.results.map((t) => t.id));
  const stmts = [];
  for (const t of body.tables) {
    if (!ids.has(Number(t.id))) continue;
    stmts.push(
      c.env.DB.prepare('UPDATE cafe_tables SET x=?, y=?, width=?, height=?, updated_at=? WHERE id=?').bind(
        Math.max(0, Number(t.x) || 0), Math.max(0, Number(t.y) || 0),
        Math.max(60, Number(t.width) || 100), Math.max(60, Number(t.height) || 100),
        nowISO(), Number(t.id)
      )
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env, auth, 'update_floor_layout', 'floor_plan', 1, { count: stmts.length }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true, saved: stmts.length });
});

admin.patch('/tables/:id/status', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const allowed = ['available', 'reserved', 'occupied', 'cleaning', 'out_of_service'];
  if (!allowed.includes(body.status)) return c.json({ error: 'Invalid table status.' }, 400);
  const table = await c.env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(id).first();
  if (!table) return c.json({ error: 'Table not found.' }, 404);
  if (body.status === 'out_of_service' || body.status === 'cleaning') {
    const active = await c.env.DB.prepare(
      "SELECT id FROM orders WHERE table_id = ? AND status IN ('pending','confirmed','preparing','ready','collected','served') LIMIT 1"
    ).bind(id).first();
    if (active) return c.json({ error: 'This table has an active order. Close the order first.' }, 409);
  }
  await c.env.DB.prepare('UPDATE cafe_tables SET status=?, updated_at=? WHERE id=?').bind(body.status, nowISO(), id).run();
  await audit(c.env, auth, 'update_table_status', 'table', id, { status: body.status }, c.req.header('CF-Connecting-IP'));
  await broadcast(c.env, { type: 'table', action: 'status', tableId: id, status: body.status });
  return c.json({ ok: true });
});

admin.delete('/tables/:id', async (c) => {
  const auth = c.get('auth');
  if (!['owner', 'manager'].includes(auth.role)) return c.json({ error: 'Only management can delete tables.' }, 403);
  const id = Number(c.req.param('id'));
  const active = await c.env.DB.prepare(
    "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('completed','cancelled') LIMIT 1"
  ).bind(id).first();
  if (active) return c.json({ error: 'This table has an active order and cannot be deleted.' }, 409);
  const activeRes = await c.env.DB.prepare(
    "SELECT id FROM reservations WHERE table_id = ? AND reservation_date >= ? AND status IN ('pending','confirmed','seated') LIMIT 1"
  ).bind(id, istDateStr()).first();
  if (activeRes) return c.json({ error: 'This table has upcoming reservations. Move or cancel them first.' }, 409);
  await c.env.DB.prepare('DELETE FROM cafe_tables WHERE id = ?').bind(id).run();
  await audit(c.env, auth, 'delete_table', 'table', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Customers
admin.get('/customers', async (c) => {
  const { limit, offset, page } = pagination(c, 15);
  const q = (c.req.query('q') || '').trim();
  const segment = c.req.query('segment');
  let where = '1=1';
  const binds = [];
  if (q) {
    where += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const base = `SELECT c.*,
      (SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND status IN ('completed','served')) AS orders_count,
      (SELECT COALESCE(SUM(amount-refunded_amount),0) FROM payments WHERE customer_id = c.id AND status IN ('paid','partially_refunded','refunded')) AS total_spent,
      (SELECT COUNT(*) FROM reservations WHERE customer_id = c.id) AS reservations_count,
      (SELECT MAX(placed_at) FROM orders WHERE customer_id = c.id) AS last_order_at
    FROM customers c`;
  let having = '';
  if (segment === 'loyal') having = ' WHERE orders_count >= 5';
  else if (segment === 'returning') having = ' WHERE orders_count BETWEEN 2 AND 4';
  else if (segment === 'new') having = " WHERE orders_count <= 1 AND created_at >= datetime('now','-30 days')";
  else if (segment === 'inactive') having = " WHERE (last_order_at IS NULL OR last_order_at < datetime('now','-60 days'))";
  const rows = await c.env.DB.prepare(
    `SELECT * FROM (${base}) ${having} ${having ? 'AND' : 'WHERE'} ${where.replace(/^ AND /, '')} ORDER BY last_order_at DESC NULLS LAST, created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM (${base}) ${having} ${having ? 'AND' : 'WHERE'} ${where.replace(/^ AND /, '')}`)
    .bind(...binds)
    .first();
  return c.json({ customers: rows.results, total: total.n, page, limit });
});

admin.get('/customers/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const env = c.env;
  const customer = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!customer) return c.json({ error: 'Customer not found.' }, 404);
  const [orders, reservations, loyalty, reviews, stats] = await Promise.all([
    env.DB.prepare(
      `SELECT o.*, t.label AS table_label FROM orders o LEFT JOIN cafe_tables t ON t.id = o.table_id
        WHERE o.customer_id = ? ORDER BY o.placed_at DESC LIMIT 30`
    ).bind(id).all(),
    env.DB.prepare('SELECT * FROM reservations WHERE customer_id = ? ORDER BY reservation_date DESC LIMIT 20').bind(id).all(),
    env.DB.prepare('SELECT * FROM loyalty_transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 30').bind(id).all(),
    env.DB.prepare('SELECT * FROM reviews WHERE customer_id = ? ORDER BY created_at DESC').bind(id).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS orders_count, COALESCE(SUM(total),0) AS lifetime_value,
              MAX(placed_at) AS last_order_at
         FROM orders WHERE customer_id = ? AND status IN ('completed','served')`
    ).bind(id).first(),
  ]);
  return c.json({ customer, orders: orders.results, reservations: reservations.results, loyalty: loyalty.results, reviews: reviews.results, stats });
});

admin.post('/customers', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, {
    name: { required: true, maxLength: 120 },
    email: { required: true, email: true, maxLength: 180 },
    phone: { maxLength: 30 },
  });
  if (Object.keys(errors).length) return c.json({ error: 'Check the customer details.', errors }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ? OR (phone IS NOT NULL AND phone = ?)').bind(body.email, body.phone || '').first();
  if (dup) return c.json({ error: 'A customer with that email or phone already exists.', existingId: dup.id }, 409);
  const result = await c.env.DB.prepare('INSERT INTO customers (name,email,phone,notes,marketing_opt_in) VALUES (?,?,?,?,?)')
    .bind(body.name, body.email, body.phone || null, body.notes || null, body.marketingOptIn ? 1 : 0)
    .run();
  await audit(c.env, auth, 'create_customer', 'customer', result.meta.last_row_id, { email: body.email }, c.req.header('CF-Connecting-IP'));
  const customer = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(result.meta.last_row_id).first();
  return c.json({ customer }, 201);
});

admin.put('/customers/:id', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Customer not found.' }, 404);
  await c.env.DB.prepare('UPDATE customers SET name=?, email=?, phone=?, notes=?, marketing_opt_in=? WHERE id=?')
    .bind(body.name ?? existing.name, body.email ?? existing.email, body.phone ?? existing.phone, body.notes ?? existing.notes, body.marketingOptIn ? 1 : existing.marketing_opt_in, id)
    .run();
  await audit(c.env, auth, 'update_customer', 'customer', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ customer: await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first() });
});

// ------------------------------------------------------------------ Retention
admin.get('/retention', async (c) => {
  const env = c.env;
  const { from, to, fromIso, toIso } = readRange(c);
  const [summary, segments, loyal, frequency, cohort, trend] = await Promise.all([
    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM customers WHERE created_at BETWEEN ? AND ?) AS new_customers,
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(*) FROM customers c WHERE (SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND status='completed') > 1) AS returning_customers,
        (SELECT COUNT(*) FROM customers c WHERE (SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND status='completed') >= 5) AS loyal_customers,
        (SELECT COUNT(*) FROM customers c WHERE (SELECT MAX(placed_at) FROM orders WHERE customer_id = c.id) BETWEEN ? AND ?) AS active_customers,
        (SELECT COALESCE(SUM(amount-refunded_amount),0) FROM payments WHERE customer_id IS NOT NULL AND status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?) AS member_revenue,
        (SELECT COALESCE(AVG(spend),0) FROM (SELECT SUM(amount-refunded_amount) AS spend FROM payments WHERE customer_id IS NOT NULL AND status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ? GROUP BY customer_id)) AS avg_member_spend`
    ).bind(fromIso, toIso, fromIso, toIso, fromIso, toIso, fromIso, toIso).first(),
    env.DB.prepare(
      `SELECT CASE
        WHEN cnt = 0 THEN 'never'
        WHEN cnt >= 5 THEN 'loyal'
        WHEN cnt >= 2 THEN 'returning'
        WHEN last < datetime('now','-90 days') THEN 'inactive'
        ELSE 'new'
      END AS segment, COUNT(*) AS count FROM (
        SELECT c.id,
          (SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND status IN ('completed','served')) AS cnt,
          COALESCE((SELECT MAX(placed_at) FROM orders WHERE customer_id = c.id), c.created_at) AS last
        FROM customers c) GROUP BY segment ORDER BY count DESC`
    ).all(),
    env.DB.prepare(
      `SELECT c.id, c.name, c.email, c.phone, c.loyalty_points,
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND status IN ('completed','served')) AS orders_count,
        (SELECT COALESCE(SUM(amount-refunded_amount),0) FROM payments WHERE customer_id = c.id AND status IN ('paid','partially_refunded','refunded')) AS spend,
        (SELECT MAX(placed_at) FROM orders WHERE customer_id = c.id) AS last_visit
       FROM customers c ORDER BY orders_count DESC, spend DESC LIMIT 10`
    ).all(),
    env.DB.prepare(
      `SELECT CASE
        WHEN cnt = 0 THEN '0 orders'
        WHEN cnt = 1 THEN '1 order'
        WHEN cnt BETWEEN 2 AND 4 THEN '2–4 orders'
        WHEN cnt BETWEEN 5 AND 9 THEN '5–9 orders'
        ELSE '10+ orders' END AS bucket, COUNT(*) AS customers FROM (
        SELECT c.id, (SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND status IN ('completed','served')) AS cnt FROM customers c
      ) GROUP BY bucket`
    ).all(),
    env.DB.prepare(
      `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count FROM customers GROUP BY month ORDER BY month DESC LIMIT 12`
    ).all(),
    env.DB.prepare(
      `SELECT date(placed_at,'+5 hours','+30 minutes') AS day, COUNT(DISTINCT customer_id) AS customers, COUNT(*) AS orders
         FROM orders WHERE customer_id IS NOT NULL AND placed_at BETWEEN ? AND ? GROUP BY day ORDER BY day`
    ).bind(fromIso, toIso).all(),
  ]);
  const s = summary || {};
  const repeatRate = s.total_customers ? Math.round((s.returning_customers / s.total_customers) * 1000) / 10 : 0;
  return c.json({ range: { from, to }, summary: { ...s, repeatRate }, segments: segments.results, loyalCustomers: loyal.results, frequency: frequency.results, cohort: cohort.results.reverse(), trend: trend.results });
});

// -------------------------------------------------------------------- Finance
admin.get('/finance', async (c) => {
  const env = c.env;
  const { from, to, fromIso, toIso } = readRange(c);
  const [revenue, expense, method, daily, refundRows, expenseRows] = await Promise.all([
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS gross, COALESCE(SUM(refunded_amount),0) AS refunds,
              COALESCE(SUM(amount - refunded_amount),0) AS net, COUNT(*) AS transactions
         FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?`
    ).bind(fromIso, toIso).first(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total,
              COALESCE(SUM(CASE WHEN is_estimated=0 THEN amount ELSE 0 END),0) AS actual,
              COALESCE(SUM(CASE WHEN is_estimated=1 THEN amount ELSE 0 END),0) AS estimated
         FROM expenses WHERE expense_date BETWEEN ? AND ?`
    ).bind(from, to).first(),
    env.DB.prepare(
      `SELECT method, COUNT(*) AS count, COALESCE(SUM(amount-refunded_amount),0) AS total
         FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?
        GROUP BY method ORDER BY total DESC`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare(
      `SELECT date(paid_at,'+5 hours','+30 minutes') AS day, SUM(amount) AS gross, SUM(refunded_amount) AS refunds,
              SUM(amount-refunded_amount) AS value, COUNT(*) AS transactions
         FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?
        GROUP BY day ORDER BY day`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare(
      `SELECT p.*, o.order_number, COALESCE(c.name, o.guest_name) AS customer_name
         FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN customers c ON c.id = p.customer_id
        WHERE p.refunded_amount > 0 AND p.paid_at BETWEEN ? AND ? ORDER BY p.paid_at DESC LIMIT 50`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare('SELECT * FROM expenses WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date DESC, id DESC').bind(from, to).all(),
  ]);
  const tax = await env.DB.prepare(
    "SELECT COALESCE(SUM(tax_amount),0) AS tax, COALESCE(SUM(total),0) AS order_total, COUNT(*) AS orders FROM orders WHERE status IN ('completed','served') AND placed_at BETWEEN ? AND ?"
  ).bind(fromIso, toIso).first();
  const series = fillDays(daily.results, from, to, 'value').map((row) => {
    const src = daily.results.find((r) => r.day === row.day) || {};
    return { ...row, gross: money(src.gross), refunds: money(src.refunds), transactions: src.transactions || 0 };
  });
  const net = money(revenue?.net);
  return c.json({
    range: { from, to },
    summary: {
      grossRevenue: money(revenue?.gross),
      refunds: money(revenue?.refunds),
      netRevenue: net,
      totalExpenses: money(expense?.total),
      actualExpenses: money(expense?.actual),
      estimatedExpenses: money(expense?.estimated),
      netAfterExpenses: money(net - Number(expense?.total || 0)),
      taxCollected: money(tax?.tax),
      orderRevenue: money(tax?.order_total),
      completedOrders: tax?.orders || 0,
      transactions: revenue?.transactions || 0,
      averageTransaction: revenue?.transactions ? money(net / revenue.transactions) : 0,
    },
    paymentMethods: method.results,
    daily: series,
    refunds: refundRows.results,
    expenses: expenseRows.results,
  });
});

admin.post('/expenses', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, {
    category: { required: true, maxLength: 60 },
    description: { required: true, maxLength: 200 },
    amount: { required: true, type: 'number', min: 0 },
    expenseDate: { required: true, date: true },
  });
  if (Object.keys(errors).length) return c.json({ error: 'Check the expense details.', errors }, 400);
  const result = await c.env.DB.prepare(
    'INSERT INTO expenses (category,description,amount,expense_date,is_estimated,vendor,notes,created_by) VALUES (?,?,?,?,?,?,?,?)'
  )
    .bind(body.category, body.description, money(body.amount), body.expenseDate, body.isEstimated ? 1 : 0, body.vendor || null, body.notes || null, auth.id)
    .run();
  await audit(c.env, auth, 'create_expense', 'expense', result.meta.last_row_id, { amount: body.amount }, c.req.header('CF-Connecting-IP'));
  return c.json({ id: result.meta.last_row_id }, 201);
});

admin.put('/expenses/:id', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Expense not found.' }, 404);
  await c.env.DB.prepare('UPDATE expenses SET category=?, description=?, amount=?, expense_date=?, is_estimated=?, vendor=?, notes=? WHERE id=?')
    .bind(body.category ?? existing.category, body.description ?? existing.description, money(body.amount ?? existing.amount),
      body.expenseDate ?? existing.expense_date, body.isEstimated != null ? (body.isEstimated ? 1 : 0) : existing.is_estimated,
      body.vendor ?? existing.vendor, body.notes ?? existing.notes, id)
    .run();
  await audit(c.env, auth, 'update_expense', 'expense', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

admin.delete('/expenses/:id', async (c) => {
  const auth = c.get('auth');
  if (!['owner', 'manager'].includes(auth.role)) return c.json({ error: 'Only management can delete expenses.' }, 403);
  await c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(Number(c.req.param('id'))).run();
  await audit(c.env, auth, 'delete_expense', 'expense', c.req.param('id'), null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Analytics
admin.get('/analytics', async (c) => {
  const env = c.env;
  const { from, to, fromIso, toIso } = readRange(c);
  const [metrics, items, peak, daily, monthly, reservations, retention] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue, COALESCE(AVG(total),0) AS aov,
              COALESCE(AVG(actual_prep_seconds),0) AS avg_prep_seconds,
              COALESCE(AVG((julianday(served_at)-julianday(placed_at))*24*60),0) AS avg_service_minutes,
              SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN status IN ('served','completed') THEN 1 ELSE 0 END) AS served
         FROM orders WHERE placed_at BETWEEN ? AND ?`
    ).bind(fromIso, toIso).first(),
    env.DB.prepare(
      `SELECT oi.name_snapshot AS name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue, COUNT(DISTINCT oi.order_id) AS orders
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status='completed' AND o.placed_at BETWEEN ? AND ?
        GROUP BY oi.name_snapshot ORDER BY qty DESC`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare(
      `SELECT strftime('%H', datetime(placed_at,'+5 hours','+30 minutes')) AS hour, COUNT(*) AS orders, SUM(total) AS revenue
         FROM orders WHERE placed_at BETWEEN ? AND ? AND status != 'cancelled'
        GROUP BY hour ORDER BY hour`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare(
      `SELECT date(placed_at,'+5 hours','+30 minutes') AS day, COUNT(*) AS orders,
              SUM(CASE WHEN status='cancelled' THEN 0 ELSE total END) AS revenue
         FROM orders WHERE placed_at BETWEEN ? AND ? GROUP BY day ORDER BY day`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare(
      `SELECT strftime('%Y-%m', datetime(placed_at,'+5 hours','+30 minutes')) AS month, COUNT(*) AS orders, SUM(total) AS revenue
         FROM orders WHERE placed_at >= datetime('now','-365 days') AND status != 'cancelled' GROUP BY month ORDER BY month`
    ).all(),
    env.DB.prepare(
      `SELECT reservation_date AS day, COUNT(*) AS bookings,
              SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) AS no_shows
         FROM reservations WHERE reservation_date BETWEEN ? AND ? GROUP BY reservation_date ORDER BY reservation_date`
    ).bind(from, to).all(),
    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM customers c WHERE (SELECT COUNT(*) FROM orders WHERE customer_id=c.id AND status='completed') > 1) AS repeat_customers,
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(DISTINCT customer_id) FROM orders WHERE customer_id IS NOT NULL AND placed_at BETWEEN ? AND ?) AS active_members,
        (SELECT COUNT(*) FROM reviews WHERE status='approved' AND created_at BETWEEN ? AND ?) AS reviews,
        (SELECT COALESCE(AVG(overall_rating),0) FROM reviews WHERE status='approved') AS avg_rating`
    ).bind(fromIso, toIso, fromIso, toIso).first(),
  ]);
  const allItems = items.results;
  return c.json({
    range: { from, to },
    metrics: {
      ...metrics,
      avgPrepMinutes: Math.round((metrics.avg_prep_seconds || 0) / 60),
      completionRate: metrics.orders ? Math.round((metrics.served / metrics.orders) * 1000) / 10 : 0,
      repeatRate: retention.total_customers ? Math.round((retention.repeat_customers / retention.total_customers) * 1000) / 10 : 0,
      avgRating: Math.round((retention.avg_rating || 0) * 10) / 10,
    },
    bestSellers: allItems.slice(0, 8),
    leastSellers: [...allItems].reverse().slice(0, 8),
    peakHours: peak.results,
    daily: daily.results,
    monthly: monthly.results,
    reservationTrend: reservations.results,
    retention,
  });
});

admin.get('/reviews', async (c) => {
  const status = c.req.query('status') || 'all';
  let where = '1=1';
  const binds = [];
  if (status !== 'all') { where += ' AND r.status = ?'; binds.push(status); }
  const rows = await c.env.DB.prepare(
    `SELECT r.*, o.order_number, c.name AS customer_name FROM reviews r
       JOIN orders o ON o.id = r.order_id LEFT JOIN customers c ON c.id = r.customer_id
      WHERE ${where} ORDER BY r.created_at DESC LIMIT 100`
  ).bind(...binds).all();
  return c.json({ reviews: rows.results });
});

admin.patch('/reviews/:id', async (c) => {
  const auth = c.get('auth');
  if (!['owner', 'manager', 'supervisor'].includes(auth.role)) return c.json({ error: 'You cannot moderate reviews.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (!['approved', 'rejected', 'pending'].includes(body.status)) return c.json({ error: 'Invalid review status.' }, 400);
  const result = await c.env.DB.prepare('UPDATE reviews SET status=?, moderated_by=?, moderated_at=? WHERE id=?')
    .bind(body.status, auth.id, nowISO(), Number(c.req.param('id')))
    .run();
  if (!result.meta.changes) return c.json({ error: 'Review not found.' }, 404);
  await audit(c.env, auth, `review_${body.status}`, 'review', c.req.param('id'), null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------------ AI
admin.post('/ai', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const question = String(body.question || '').trim();
  if (!question) return c.json({ error: 'Ask a business question.' }, 400);
  if (question.length > 500) return c.json({ error: 'Keep questions under 500 characters.' }, 400);
  const result = await staffAssistant(c.env, question);
  return c.json(result);
});

// ------------------------------------------------------------------- Exports
admin.get('/export', async (c) => {
  const env = c.env;
  const type = c.req.query('type') || 'orders';
  const { from, to, fromIso, toIso } = readRange(c);
  if (type === 'orders') {
    const rows = await env.DB.prepare(
      `SELECT o.order_number, o.placed_at, o.type, o.status, o.payment_status, o.subtotal, o.tax_amount, o.total,
              COALESCE(c.name,o.guest_name) AS customer, t.label AS table_label
         FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN cafe_tables t ON t.id=o.table_id
        WHERE o.placed_at BETWEEN ? AND ? ORDER BY o.placed_at`
    ).bind(fromIso, toIso).all();
    return csvResponse(`orders-${from}-to-${to}.csv`, rows.results, [
      { key: 'order_number', label: 'Order' }, { key: 'placed_at', label: 'Placed at' }, { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' }, { key: 'payment_status', label: 'Payment' }, { key: 'customer', label: 'Customer' },
      { key: 'table_label', label: 'Table' }, { key: 'subtotal', label: 'Subtotal' }, { key: 'tax_amount', label: 'Tax' }, { key: 'total', label: 'Total' },
    ]);
  }
  if (type === 'payments') {
    const rows = await env.DB.prepare(
      `SELECT p.transaction_ref, p.paid_at, p.method, p.status, p.amount, p.refunded_amount, o.order_number, COALESCE(c.name,o.guest_name) AS customer
         FROM payments p LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN customers c ON c.id=p.customer_id
        WHERE p.paid_at BETWEEN ? AND ? ORDER BY p.paid_at`
    ).bind(fromIso, toIso).all();
    return csvResponse(`payments-${from}-to-${to}.csv`, rows.results, [
      { key: 'transaction_ref', label: 'Transaction' }, { key: 'paid_at', label: 'Paid at' }, { key: 'order_number', label: 'Order' },
      { key: 'customer', label: 'Customer' }, { key: 'method', label: 'Method' }, { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' }, { key: 'refunded_amount', label: 'Refunded' },
    ]);
  }
  if (type === 'items') {
    const rows = await env.DB.prepare(
      `SELECT oi.name_snapshot, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
         FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE o.status='completed' AND o.placed_at BETWEEN ? AND ? GROUP BY oi.name_snapshot ORDER BY qty DESC`
    ).bind(fromIso, toIso).all();
    return csvResponse(`menu-sales-${from}-to-${to}.csv`, rows.results, [
      { key: 'name_snapshot', label: 'Item' }, { key: 'qty', label: 'Quantity sold' }, { key: 'revenue', label: 'Revenue' },
    ]);
  }
  if (type === 'customers') {
    const rows = await env.DB.prepare(
      `SELECT c.name, c.email, c.phone, c.created_at, c.loyalty_points,
              (SELECT COUNT(*) FROM orders WHERE customer_id=c.id) AS orders,
              (SELECT COALESCE(SUM(amount-refunded_amount),0) FROM payments WHERE customer_id=c.id AND status IN ('paid','partially_refunded','refunded')) AS spend
         FROM customers c ORDER BY c.created_at DESC`
    ).all();
    return csvResponse(`customers-${istDateStr()}.csv`, rows.results, [
      { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
      { key: 'created_at', label: 'Joined' }, { key: 'orders', label: 'Orders' }, { key: 'spend', label: 'Spend' }, { key: 'loyalty_points', label: 'Points' },
    ]);
  }
  if (type === 'inventory') {
    const rows = await env.DB.prepare('SELECT name, category, unit, stock_qty, min_stock, cost_per_unit, stock_qty * cost_per_unit AS stock_value FROM ingredients ORDER BY name').all();
    return csvResponse(`inventory-${istDateStr()}.csv`, rows.results, [
      { key: 'name', label: 'Ingredient' }, { key: 'category', label: 'Category' }, { key: 'unit', label: 'Unit' },
      { key: 'stock_qty', label: 'Stock' }, { key: 'min_stock', label: 'Minimum' }, { key: 'cost_per_unit', label: 'Cost/unit' }, { key: 'stock_value', label: 'Stock value' },
    ]);
  }
  return c.json({ error: 'Unknown export type.' }, 400);
});

export default admin;
