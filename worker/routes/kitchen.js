// Kitchen Display System API: central view, stations, item-level prep, handover, history.
import { Hono } from 'hono';
import { transitionOrder, updateItemStatus } from '../lib/orders.js';
import { audit, broadcast, istDateStr, istDayEnd, istDayStart, money, notify, nowISO } from '../lib/utils.js';

const kitchen = new Hono();

const ACTIVE = ['pending', 'confirmed', 'preparing', 'ready', 'collected', 'on_hold'];

function isDelayed(o) {
  if (!['pending', 'confirmed', 'preparing', 'ready'].includes(o.status)) return false;
  return o.estimated_ready_at ? new Date(o.estimated_ready_at) < new Date() : false;
}

kitchen.get('/bootstrap', async (c) => {
  const env = c.env;
  const station = c.req.query('station') ? Number(c.req.query('station')) : null;
  const today = istDateStr();
  const todayStart = istDayStart(today);
  const todayEnd = istDayEnd(today);

  const ordersRes = await env.DB.prepare(
    `SELECT o.*, t.label AS table_label, COALESCE(c.name, o.guest_name) AS customer_name,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS total_items,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'ready') AS ready_items
       FROM orders o LEFT JOIN cafe_tables t ON t.id = o.table_id LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.status IN ('pending','confirmed','preparing','ready','collected','on_hold')
      ORDER BY CASE o.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, o.placed_at ASC`
  ).all();
  const orderIds = ordersRes.results.map((o) => o.id);
  let items = { results: [] };
  if (orderIds.length) {
    const ph = orderIds.map(() => '?').join(',');
    items = await env.DB.prepare(
      `SELECT oi.*, ks.name AS station_name, ks.color AS station_color, ks.target_minutes,
              u.name AS assigned_staff_name
         FROM order_items oi LEFT JOIN kitchen_stations ks ON ks.id = oi.station_id
         LEFT JOIN users u ON u.id = oi.assigned_staff_id
        WHERE oi.order_id IN (${ph}) AND oi.status != 'cancelled' ORDER BY oi.id`
    ).bind(...orderIds).all();
  }
  const itemsByOrder = new Map();
  for (const item of items.results) {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push(item);
  }
  const orders = ordersRes.results
    .map((o) => {
      const all = itemsByOrder.get(o.id) || [];
      const visible = station ? all.filter((i) => i.station_id === station) : all;
      if (station && !visible.length) return null;
      return {
        ...o,
        customer_name: o.customer_name || 'Guest',
        items: visible,
        allItemsSummary: {
          total: all.length,
          ready: all.filter((i) => i.status === 'ready' || i.status === 'served').length,
          preparing: all.filter((i) => i.status === 'preparing').length,
          pending: all.filter((i) => i.status === 'pending').length,
        },
        delayed: isDelayed(o),
      };
    })
    .filter(Boolean);

  const summary = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM orders WHERE status='pending') AS new_orders,
      (SELECT COUNT(*) FROM orders WHERE status='confirmed') AS accepted,
      (SELECT COUNT(*) FROM orders WHERE status='preparing') AS preparing,
      (SELECT COUNT(*) FROM orders WHERE status='ready') AS ready,
      (SELECT COUNT(*) FROM orders WHERE status='collected') AS collected,
      (SELECT COUNT(*) FROM orders WHERE status='on_hold') AS on_hold,
      (SELECT COUNT(*) FROM orders WHERE status IN ('served','completed') AND placed_at BETWEEN ? AND ?) AS completed_today,
      (SELECT COUNT(*) FROM orders WHERE status IN ('pending','confirmed','preparing','ready') AND estimated_ready_at < ?) AS delayed,
      (SELECT COUNT(*) FROM orders WHERE status='cancelled' AND placed_at BETWEEN ? AND ?) AS cancelled_today,
      (SELECT COUNT(*) FROM availability_reports WHERE status='open') AS open_issues
    `
  ).bind(todayStart, todayEnd, nowISO(), todayStart, todayEnd).first();

  const stations = await env.DB.prepare('SELECT * FROM kitchen_stations WHERE active = 1 ORDER BY sort_order, id').all();
  const stationLoad = await env.DB.prepare(
    `SELECT oi.station_id, ks.name, ks.color, ks.target_minutes,
            SUM(CASE WHEN oi.status='pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN oi.status='preparing' THEN 1 ELSE 0 END) AS preparing,
            SUM(CASE WHEN oi.status='ready' THEN 1 ELSE 0 END) AS ready,
            COUNT(*) AS total
       FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN kitchen_stations ks ON ks.id=oi.station_id
      WHERE o.status IN ('pending','confirmed','preparing','ready','on_hold')
      GROUP BY oi.station_id ORDER BY ks.sort_order`
  ).all();
  const waiters = await env.DB.prepare("SELECT id, name FROM users WHERE role IN ('waiter','manager','supervisor') AND active=1 ORDER BY name").all();
  return c.json({
    summary,
    orders,
    stations: stations.results,
    stationLoad: stationLoad.results,
    waiters: waiters.results,
    serverNow: nowISO(),
    activeStation: station,
  });
});

kitchen.get('/orders/:id', async (c) => {
  const env = c.env;
  const order = await env.DB.prepare(
    `SELECT o.*, t.label AS table_label, COALESCE(c.name,o.guest_name) AS customer_name
       FROM orders o LEFT JOIN cafe_tables t ON t.id=o.table_id LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?`
  ).bind(Number(c.req.param('id'))).first();
  if (!order) return c.json({ error: 'Order not found.' }, 404);
  const items = await env.DB.prepare(
    `SELECT oi.*, ks.name AS station_name, ks.color AS station_color, u.name AS assigned_staff_name
       FROM order_items oi LEFT JOIN kitchen_stations ks ON ks.id=oi.station_id LEFT JOIN users u ON u.id=oi.assigned_staff_id
      WHERE oi.order_id=? ORDER BY oi.id`
  ).bind(order.id).all();
  const history = await env.DB.prepare('SELECT * FROM order_status_history WHERE order_id=? ORDER BY created_at').bind(order.id).all();
  return c.json({ order: { ...order, items: items.results, history: history.results } });
});

kitchen.patch('/orders/:id/status', async (c) => {
  const auth = c.get('auth');
  if (auth.role === 'waiter') return c.json({ error: 'Kitchen order transitions require a kitchen account.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (!['confirmed', 'preparing', 'ready', 'on_hold', 'cancelled'].includes(body.status)) {
    return c.json({ error: 'The kitchen cannot perform that transition.' }, 403);
  }
  const result = await transitionOrder(c.env, auth, Number(c.req.param('id')), body.status, { reason: body.reason });
  if (result.error) return c.json({ error: result.error }, result.status || 400);
  await audit(c.env, auth, `kitchen_order_${body.status}`, 'order', result.order.id, { number: result.order.order_number }, c.req.header('CF-Connecting-IP'));
  return c.json({ order: result.order });
});

kitchen.patch('/items/:id/status', async (c) => {
  const auth = c.get('auth');
  if (auth.role === 'waiter') return c.json({ error: 'Only kitchen staff can update item preparation.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const result = await updateItemStatus(c.env, auth, Number(c.req.param('id')), body.status);
  if (result.error) return c.json({ error: result.error }, result.status || 400);
  await audit(c.env, auth, `item_${body.status}`, 'order_item', c.req.param('id'), null, c.req.header('CF-Connecting-IP'));
  return c.json(result);
});

kitchen.post('/orders/:id/collect', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const staffId = body.staffId ? Number(body.staffId) : auth.id;
  const staff = await c.env.DB.prepare("SELECT id,name FROM users WHERE id=? AND active=1 AND role IN ('waiter','manager','supervisor','kitchen')").bind(staffId).first();
  if (!staff) return c.json({ error: 'Choose a valid staff member collecting the order.' }, 400);
  const result = await transitionOrder(c.env, auth, Number(c.req.param('id')), 'collected', { collectedBy: staff.id });
  if (result.error) return c.json({ error: result.error }, result.status || 400);
  await c.env.DB.prepare(
    "INSERT INTO notifications (audience,type,title,body,link) VALUES ('kitchen','handover',?,?, '/kitchen')"
  ).bind(`${result.order.order_number} collected`, `${staff.name} collected the order.`).run();
  await audit(c.env, auth, 'collect_order', 'order', result.order.id, { staff: staff.name }, c.req.header('CF-Connecting-IP'));
  return c.json({ order: result.order, collectedBy: staff.name });
});

kitchen.patch('/orders/:id/eta', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const minutes = Math.max(1, Math.min(180, Number(body.minutes) || 0));
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(Number(c.req.param('id'))).first();
  if (!order) return c.json({ error: 'Order not found.' }, 404);
  if (['completed', 'cancelled'].includes(order.status)) return c.json({ error: 'This order is closed.' }, 409);
  const estimated = new Date(Date.now() + minutes * 60000).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE orders SET eta_minutes=?, estimated_ready_at=?, updated_at=? WHERE id=?').bind(minutes, estimated, nowISO(), order.id),
    c.env.DB.prepare("INSERT INTO order_status_history (order_id,status,note,actor_type,actor_id,actor_name,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(order.id, order.status, `Kitchen updated ETA to ${minutes} minutes`, 'staff', auth.id, auth.name, nowISO()),
  ]);
  await notify(c.env, {
    audience: 'customer', userId: order.customer_id, type: 'order_eta',
    title: `Order ${order.order_number} timing updated`, body: `New preparation estimate: ${minutes} minutes.`, link: `/track/${order.order_number}`,
  });
  await broadcast(c.env, { type: 'order', action: 'eta_updated', orderId: order.id, orderNumber: order.order_number, etaMinutes: minutes });
  await audit(c.env, auth, 'update_order_eta', 'order', order.id, { minutes }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true, etaMinutes: minutes, estimatedReadyAt: estimated });
});

kitchen.post('/orders/:id/issue', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const kinds = ['temporarily_unavailable', 'ingredient_shortage', 'equipment_issue', 'restock_needed'];
  if (!kinds.includes(body.kind)) return c.json({ error: 'Choose the kind of issue.' }, 400);
  if (!String(body.reason || '').trim()) return c.json({ error: 'Describe the issue.' }, 400);
  const item = await c.env.DB.prepare('SELECT oi.*, mi.name FROM order_items oi LEFT JOIN menu_items mi ON mi.id=oi.menu_item_id WHERE oi.id=?').bind(Number(body.orderItemId)).first();
  if (!item) return c.json({ error: 'Order item not found.' }, 404);
  const result = await c.env.DB.prepare(
    "INSERT INTO availability_reports (menu_item_id,station_id,reason,kind,status,reported_by,reported_by_name,created_at) VALUES (?,?,?,?, 'open', ?,?,?)"
  ).bind(item.menu_item_id, item.station_id, String(body.reason).slice(0, 400), body.kind, auth.id, auth.name, nowISO()).run();
  await notify(c.env, {
    audience: 'staff', type: 'kitchen_issue', title: `Kitchen issue: ${item.name}`,
    body: `${auth.name} reported: ${String(body.reason).slice(0, 200)}`, link: '/admin/inventory',
  });
  await broadcast(c.env, { type: 'kitchen_issue', action: 'created', reportId: result.meta.last_row_id, itemId: item.menu_item_id });
  await audit(c.env, auth, 'report_kitchen_issue', 'availability_report', result.meta.last_row_id, { item: item.name, kind: body.kind }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true, id: result.meta.last_row_id });
});

kitchen.get('/availability', async (c) => {
  const env = c.env;
  const [items, reports] = await Promise.all([
    env.DB.prepare(
      `SELECT mi.id, mi.name, mi.available, mi.category_id, mc.name AS category, ks.name AS station_name, ks.id AS station_id
         FROM menu_items mi JOIN menu_categories mc ON mc.id=mi.category_id LEFT JOIN kitchen_stations ks ON ks.id=mi.station_id
        ORDER BY mc.sort_order, mi.name`
    ).all(),
    env.DB.prepare(
      `SELECT ar.*, mi.name AS item_name, ks.name AS station_name FROM availability_reports ar
         JOIN menu_items mi ON mi.id=ar.menu_item_id LEFT JOIN kitchen_stations ks ON ks.id=ar.station_id
        WHERE ar.status != 'resolved' ORDER BY ar.created_at DESC`
    ).all(),
  ]);
  return c.json({ items: items.results, reports: reports.results });
});

// Report an item issue from the availability board (no order item required).
kitchen.post('/availability/reports', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const kinds = ['temporarily_unavailable', 'ingredient_shortage', 'equipment_issue', 'restock_needed'];
  if (!kinds.includes(body.kind)) return c.json({ error: 'Choose the kind of issue.' }, 400);
  if (!String(body.reason || '').trim()) return c.json({ error: 'Describe the issue.' }, 400);
  const item = await c.env.DB.prepare('SELECT id, name, station_id FROM menu_items WHERE id = ?').bind(Number(body.menuItemId)).first();
  if (!item) return c.json({ error: 'Menu item not found.' }, 404);
  const open = await c.env.DB.prepare(
    "SELECT id FROM availability_reports WHERE menu_item_id = ? AND status != 'resolved' LIMIT 1"
  ).bind(item.id).first();
  if (open) return c.json({ error: 'This item already has an open issue report.' }, 409);
  const result = await c.env.DB.prepare(
    "INSERT INTO availability_reports (menu_item_id,station_id,reason,kind,status,reported_by,reported_by_name,created_at) VALUES (?,?,?,?, 'open', ?,?,?)"
  ).bind(item.id, item.station_id, String(body.reason).slice(0, 400), body.kind, auth.id, auth.name, nowISO()).run();
  await notify(c.env, {
    audience: 'staff', type: 'kitchen_issue', title: `Kitchen issue: ${item.name}`,
    body: `${auth.name} reported: ${String(body.reason).slice(0, 200)}`, link: '/admin/inventory',
  });
  await broadcast(c.env, { type: 'kitchen_issue', action: 'created', reportId: result.meta.last_row_id, itemId: item.id });
  await audit(c.env, auth, 'report_kitchen_issue', 'availability_report', result.meta.last_row_id, { item: item.name, kind: body.kind }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true, id: result.meta.last_row_id }, 201);
});

kitchen.get('/history', async (c) => {
  const env = c.env;
  const from = c.req.query('from') || istDateStr();
  const to = c.req.query('to') || from;
  const q = (c.req.query('q') || '').trim();
  const status = c.req.query('status') || 'all';
  let where = "o.status IN ('completed','served','cancelled') AND o.placed_at BETWEEN ? AND ?";
  const binds = [istDayStart(from), istDayEnd(to)];
  if (status !== 'all') { where += ' AND o.status = ?'; binds.push(status); }
  if (q) { where += ' AND (o.order_number LIKE ? OR o.guest_name LIKE ? OR c.name LIKE ?)'; binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = await env.DB.prepare(
    `SELECT o.*, t.label AS table_label, COALESCE(c.name,o.guest_name) AS customer_name,
            (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) AS item_count,
            (SELECT GROUP_CONCAT(name_snapshot, ', ') FROM order_items WHERE order_id=o.id) AS items_summary,
            (SELECT name FROM users WHERE id=o.collected_by) AS collected_by_name
       FROM orders o LEFT JOIN cafe_tables t ON t.id=o.table_id LEFT JOIN customers c ON c.id=o.customer_id
      WHERE ${where} ORDER BY o.placed_at DESC LIMIT 100`
  ).bind(...binds).all();
  return c.json({ orders: rows.results });
});

kitchen.get('/analytics', async (c) => {
  const env = c.env;
  const from = c.req.query('from') || istDateStr();
  const to = c.req.query('to') || from;
  const fromIso = istDayStart(from);
  const toIso = istDayEnd(to);
  const [summary, stations, items, hours, cancellations, staff] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS processed,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
              COALESCE(AVG(actual_prep_seconds),0) AS avg_prep_seconds,
              SUM(CASE WHEN ready_at IS NOT NULL AND estimated_ready_at IS NOT NULL AND ready_at <= estimated_ready_at THEN 1 ELSE 0 END) AS on_time,
              SUM(CASE WHEN ready_at IS NOT NULL AND estimated_ready_at IS NOT NULL AND ready_at > estimated_ready_at THEN 1 ELSE 0 END) AS delayed
         FROM orders WHERE placed_at BETWEEN ? AND ? AND status IN ('completed','served','cancelled')`
    ).bind(fromIso, toIso).first(),
    env.DB.prepare(
      `SELECT ks.name, ks.color, COUNT(*) AS items,
              COALESCE(AVG(CASE WHEN oi.ready_at IS NOT NULL AND oi.started_at IS NOT NULL THEN (julianday(oi.ready_at)-julianday(oi.started_at))*24*60 END),0) AS avg_minutes
         FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN kitchen_stations ks ON ks.id=oi.station_id
        WHERE o.placed_at BETWEEN ? AND ? GROUP BY ks.id ORDER BY items DESC`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare(
      `SELECT oi.name_snapshot AS name, SUM(oi.qty) AS qty, COUNT(DISTINCT oi.order_id) AS orders
         FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE o.placed_at BETWEEN ? AND ? AND o.status != 'cancelled'
        GROUP BY oi.name_snapshot ORDER BY qty DESC LIMIT 10`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare(
      `SELECT strftime('%H', datetime(o.placed_at,'+5 hours','+30 minutes')) AS hour, COUNT(*) AS orders
         FROM orders o WHERE o.placed_at BETWEEN ? AND ? GROUP BY hour ORDER BY orders DESC LIMIT 8`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare(
      `SELECT order_number, cancel_reason, cancelled_at, placed_at FROM orders
        WHERE status='cancelled' AND placed_at BETWEEN ? AND ? ORDER BY cancelled_at DESC LIMIT 20`
    ).bind(fromIso, toIso).all(),
    env.DB.prepare(
      `SELECT u.id, u.name, u.role, ks.name AS station_name,
              COUNT(DISTINCT oi.order_id) AS orders_handled, SUM(CASE WHEN oi.status='served' THEN 1 ELSE 0 END) AS items_completed,
              COALESCE(AVG(CASE WHEN oi.ready_at IS NOT NULL AND oi.started_at IS NOT NULL THEN (julianday(oi.ready_at)-julianday(oi.started_at))*24*60 END),0) AS avg_minutes
         FROM users u LEFT JOIN kitchen_stations ks ON ks.id=u.station_id
         LEFT JOIN order_items oi ON oi.assigned_staff_id=u.id
         LEFT JOIN orders o ON o.id=oi.order_id AND o.placed_at BETWEEN ? AND ?
        WHERE u.role IN ('kitchen','supervisor')
        GROUP BY u.id ORDER BY items_completed DESC`
    ).bind(fromIso, toIso).all(),
  ]);
  return c.json({
    range: { from, to },
    summary: {
      ...summary,
      avgPrepMinutes: Math.round(((summary?.avg_prep_seconds || 0) / 60) * 10) / 10,
      onTimeRate: summary?.on_time + summary?.delayed ? Math.round((summary.on_time / (summary.on_time + summary.delayed)) * 1000) / 10 : 0,
    },
    stations: stations.results,
    topItems: items.results,
    peakHours: hours.results,
    cancellations: cancellations.results,
    staff: staff.results,
  });
});

kitchen.get('/staff', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.station_id, ks.name AS station_name, ks.color,
            (SELECT COUNT(*) FROM order_items WHERE assigned_staff_id=u.id AND status IN ('preparing','ready')) AS active_items,
            (SELECT COUNT(*) FROM order_items WHERE assigned_staff_id=u.id AND status='served') AS completed_items
       FROM users u LEFT JOIN kitchen_stations ks ON ks.id=u.station_id
      WHERE u.role IN ('kitchen','supervisor','manager','owner') ORDER BY u.role, u.name`
  ).all();
  return c.json({ staff: rows.results });
});

kitchen.post('/messages', async (c) => {
  const auth = c.get('auth');
  if (!['owner', 'manager', 'supervisor'].includes(auth.role)) return c.json({ error: 'Not permitted.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (!String(body.title || '').trim()) return c.json({ error: 'Add a message title.' }, 400);
  await c.env.DB.prepare("INSERT INTO notifications (audience,type,title,body,link) VALUES ('kitchen','message',?,?, '/kitchen')")
    .bind(String(body.title).slice(0, 160), String(body.body || '').slice(0, 500)).run();
  await broadcast(c.env, { type: 'notification', action: 'message', title: body.title });
  await audit(c.env, auth, 'kitchen_message', 'notification', null, { title: body.title }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

export default kitchen;
