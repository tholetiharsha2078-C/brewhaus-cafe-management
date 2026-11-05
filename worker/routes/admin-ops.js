// Management API: menu, payments, inventory/procurement, settings, staff, stations.
import { Hono } from 'hono';
import { hashPassword } from '../lib/auth.js';
import { recalcPaymentStatus } from '../lib/orders.js';
import { audit, broadcast, money, notify, nowISO, safeJson, slugify, validate } from '../lib/utils.js';

const ops = new Hono();

function managerOnly(auth) {
  return ['owner', 'manager'].includes(auth?.role);
}

// --------------------------------------------------------------------- Menu
ops.get('/menu', async (c) => {
  const env = c.env;
  const [categories, items, groups, options, stations] = await Promise.all([
    env.DB.prepare('SELECT *, (SELECT COUNT(*) FROM menu_items mi WHERE mi.category_id = menu_categories.id) AS item_count FROM menu_categories ORDER BY sort_order, name').all(),
    env.DB.prepare(
      `SELECT mi.*, mc.name AS category_name, ks.name AS station_name, ks.color AS station_color,
              (SELECT COUNT(*) FROM recipes r WHERE r.menu_item_id = mi.id) AS recipe_count
         FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
         LEFT JOIN kitchen_stations ks ON ks.id = mi.station_id ORDER BY mc.sort_order, mi.name`
    ).all(),
    env.DB.prepare('SELECT * FROM menu_option_groups ORDER BY menu_item_id, sort_order, id').all(),
    env.DB.prepare('SELECT * FROM menu_options ORDER BY group_id, sort_order, id').all(),
    env.DB.prepare('SELECT * FROM kitchen_stations ORDER BY sort_order, id').all(),
  ]);
  return c.json({
    categories: categories.results,
    items: items.results,
    optionGroups: groups.results,
    options: options.results,
    stations: stations.results,
  });
});

ops.post('/menu/items', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, {
    name: { required: true, maxLength: 120 },
    price: { required: true, type: 'number', min: 0 },
    categoryId: { required: true, type: 'number' },
    prepTime: { type: 'number', min: 1, max: 180 },
  });
  if (Object.keys(errors).length) return c.json({ error: 'Check the menu item details.', errors }, 400);
  const cat = await c.env.DB.prepare('SELECT id FROM menu_categories WHERE id = ?').bind(Number(body.categoryId)).first();
  if (!cat) return c.json({ error: 'Category not found.' }, 400);
  const result = await c.env.DB.prepare(
    `INSERT INTO menu_items (category_id,station_id,name,description,price,prep_time,image_url,available,dietary,tags,ingredients_text,is_special,is_recommended,sku,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      Number(body.categoryId), body.stationId ? Number(body.stationId) : null, body.name, body.description || null,
      money(body.price), Number(body.prepTime) || 10, body.imageUrl || null, body.available === false ? 0 : 1,
      body.dietary || null, body.tags || null, body.ingredientsText || null,
      body.isSpecial ? 1 : 0, body.isRecommended ? 1 : 0, body.sku || null, nowISO()
    )
    .run();
  await audit(c.env, auth, 'create_menu_item', 'menu_item', result.meta.last_row_id, { name: body.name }, c.req.header('CF-Connecting-IP'));
  const item = await c.env.DB.prepare('SELECT * FROM menu_items WHERE id = ?').bind(result.meta.last_row_id).first();
  await broadcast(c.env, { type: 'menu', action: 'created', itemId: item.id });
  return c.json({ item }, 201);
});

ops.put('/menu/items/:id', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const existing = await c.env.DB.prepare('SELECT * FROM menu_items WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Menu item not found.' }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (body.price != null && (Number(body.price) < 0 || !Number.isFinite(Number(body.price)))) return c.json({ error: 'Price must be a positive number.' }, 400);
  await c.env.DB.prepare(
    `UPDATE menu_items SET category_id=?, station_id=?, name=?, description=?, price=?, prep_time=?, image_url=?, available=?, dietary=?,
       tags=?, ingredients_text=?, is_special=?, is_recommended=?, sku=?, updated_at=? WHERE id=?`
  )
    .bind(
      body.categoryId ? Number(body.categoryId) : existing.category_id,
      body.stationId !== undefined ? (body.stationId ? Number(body.stationId) : null) : existing.station_id,
      body.name ?? existing.name, body.description ?? existing.description, money(body.price ?? existing.price),
      Number(body.prepTime ?? existing.prep_time) || 10, body.imageUrl ?? existing.image_url,
      body.available != null ? (body.available ? 1 : 0) : existing.available,
      body.dietary !== undefined ? body.dietary || null : existing.dietary,
      body.tags !== undefined ? body.tags : existing.tags,
      body.ingredientsText !== undefined ? body.ingredientsText : existing.ingredients_text,
      body.isSpecial != null ? (body.isSpecial ? 1 : 0) : existing.is_special,
      body.isRecommended != null ? (body.isRecommended ? 1 : 0) : existing.is_recommended,
      body.sku !== undefined ? body.sku : existing.sku, nowISO(), id
    )
    .run();
  if (body.available === true) {
    await c.env.DB.prepare("UPDATE availability_reports SET status='resolved', resolved_at=? WHERE menu_item_id=? AND status IN ('open','acknowledged')").bind(nowISO(), id).run();
  }
  await audit(c.env, auth, 'update_menu_item', 'menu_item', id, { available: body.available }, c.req.header('CF-Connecting-IP'));
  await broadcast(c.env, { type: 'menu', action: 'updated', itemId: id, available: body.available });
  return c.json({ item: await c.env.DB.prepare('SELECT * FROM menu_items WHERE id = ?').bind(id).first() });
});

ops.patch('/menu/items/:id/availability', async (c) => {
  const auth = c.get('auth');
  if (!['owner', 'manager', 'supervisor'].includes(auth.role)) return c.json({ error: 'Only management can change permanent availability.' }, 403);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const item = await c.env.DB.prepare('SELECT * FROM menu_items WHERE id = ?').bind(id).first();
  if (!item) return c.json({ error: 'Menu item not found.' }, 404);
  await c.env.DB.prepare('UPDATE menu_items SET available=?, updated_at=? WHERE id=?').bind(body.available ? 1 : 0, nowISO(), id).run();
  if (body.available) {
    await c.env.DB.prepare("UPDATE availability_reports SET status='resolved', resolved_at=? WHERE menu_item_id=? AND status IN ('open','acknowledged')").bind(nowISO(), id).run();
  }
  await audit(c.env, auth, 'toggle_availability', 'menu_item', id, { available: Boolean(body.available) }, c.req.header('CF-Connecting-IP'));
  await broadcast(c.env, { type: 'menu', action: 'availability', itemId: id, available: Boolean(body.available) });
  return c.json({ ok: true, available: Boolean(body.available) });
});

ops.delete('/menu/items/:id', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can delete menu items.' }, 403);
  const id = Number(c.req.param('id'));
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM order_items WHERE menu_item_id = ?').bind(id).first();
  await c.env.DB.prepare('DELETE FROM menu_items WHERE id = ?').bind(id).run();
  await audit(c.env, auth, 'delete_menu_item', 'menu_item', id, { historicalOrders: used?.n || 0 }, c.req.header('CF-Connecting-IP'));
  await broadcast(c.env, { type: 'menu', action: 'deleted', itemId: id });
  return c.json({ ok: true, note: used?.n ? 'Historical order lines keep their snapshot.' : undefined });
});

// Categories
ops.post('/menu/categories', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  if (!String(body.name || '').trim()) return c.json({ error: 'Category name is required.' }, 400);
  const slug = slugify(body.name);
  const dup = await c.env.DB.prepare('SELECT id FROM menu_categories WHERE slug = ?').bind(slug).first();
  if (dup) return c.json({ error: 'A category with a similar name already exists.' }, 409);
  const result = await c.env.DB.prepare(
    'INSERT INTO menu_categories (name,slug,description,image_url,sort_order,active) VALUES (?,?,?,?,?,?)'
  ).bind(body.name, slug, body.description || null, body.imageUrl || null, Number(body.sortOrder) || 0, body.active === false ? 0 : 1).run();
  await audit(c.env, auth, 'create_category', 'menu_category', result.meta.last_row_id, { name: body.name }, c.req.header('CF-Connecting-IP'));
  return c.json({ category: await c.env.DB.prepare('SELECT * FROM menu_categories WHERE id = ?').bind(result.meta.last_row_id).first() }, 201);
});

ops.put('/menu/categories/:id', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare('SELECT * FROM menu_categories WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Category not found.' }, 404);
  const name = body.name ?? existing.name;
  await c.env.DB.prepare('UPDATE menu_categories SET name=?, description=?, image_url=?, sort_order=?, active=? WHERE id=?')
    .bind(name, body.description ?? existing.description, body.imageUrl ?? existing.image_url,
      body.sortOrder != null ? Number(body.sortOrder) : existing.sort_order, body.active != null ? (body.active ? 1 : 0) : existing.active, id)
    .run();
  await audit(c.env, auth, 'update_category', 'menu_category', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ category: await c.env.DB.prepare('SELECT * FROM menu_categories WHERE id = ?').bind(id).first() });
});

ops.delete('/menu/categories/:id', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can delete categories.' }, 403);
  const id = Number(c.req.param('id'));
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ?').bind(id).first();
  if (count?.n) return c.json({ error: 'Move or delete the items in this category first.' }, 409);
  await c.env.DB.prepare('DELETE FROM menu_categories WHERE id = ?').bind(id).run();
  await audit(c.env, auth, 'delete_category', 'menu_category', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// Options: replace the full option configuration for one item.
ops.put('/menu/items/:id/options', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const item = await c.env.DB.prepare('SELECT id FROM menu_items WHERE id = ?').bind(id).first();
  if (!item) return c.json({ error: 'Menu item not found.' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const groups = Array.isArray(body.groups) ? body.groups : [];
  await c.env.DB.prepare('DELETE FROM menu_option_groups WHERE menu_item_id = ?').bind(id).run();
  const stmts = [];
  let sort = 0;
  for (const g of groups) {
    if (!String(g.name || '').trim()) continue;
    const gid = crypto.randomUUID();
    // Use AUTOINCREMENT via insert then find id — D1 doesn't expose per-batch ids, so insert sequentially.
    const res = await c.env.DB.prepare(
      'INSERT INTO menu_option_groups (menu_item_id,name,selection_type,required,max_select,sort_order) VALUES (?,?,?,?,?,?)'
    ).bind(id, g.name, g.selectionType === 'multi' ? 'multi' : 'single', g.required ? 1 : 0, Number(g.maxSelect) || 1, sort++).run();
    const gidReal = res.meta.last_row_id;
    const optionStmts = (Array.isArray(g.options) ? g.options : []).filter((o) => String(o.name || '').trim()).map((o, idx) =>
      c.env.DB.prepare('INSERT INTO menu_options (group_id,name,price_delta,is_default,available,sort_order) VALUES (?,?,?,?,1,?)')
        .bind(gidReal, o.name, money(o.priceDelta || 0), o.isDefault ? 1 : 0, idx)
    );
    stmts.push(...optionStmts);
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env, auth, 'update_menu_options', 'menu_item', id, { groups: groups.length }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// ----------------------------------------------------------------- Payments
ops.get('/payments', async (c) => {
  const env = c.env;
  const status = c.req.query('status');
  const method = c.req.query('method');
  const q = (c.req.query('q') || '').trim();
  const from = c.req.query('from');
  const to = c.req.query('to');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20));
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  let where = '1=1';
  const binds = [];
  if (status && status !== 'all') { where += ' AND p.status = ?'; binds.push(status); }
  if (method && method !== 'all') { where += ' AND p.method = ?'; binds.push(method); }
  if (from) { where += ' AND p.created_at >= ?'; binds.push(`${from}T00:00:00.000Z`); }
  if (to) { where += ' AND p.created_at <= ?'; binds.push(`${to}T23:59:59.999Z`); }
  if (q) {
    where += ' AND (p.transaction_ref LIKE ? OR o.order_number LIKE ? OR c.name LIKE ? OR o.guest_name LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = await env.DB.prepare(
    `SELECT p.*, o.order_number, o.total AS order_total, COALESCE(c.name, o.guest_name) AS customer_name
       FROM payments p LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN customers c ON c.id=p.customer_id
      WHERE ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, (page - 1) * limit).all();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM payments p LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN customers c ON c.id=p.customer_id WHERE ${where}`
  ).bind(...binds).first();
  const summary = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount FROM payments GROUP BY status`
  ).all();
  return c.json({ payments: rows.results, total: total.n, page, limit, summary: summary.results });
});

ops.get('/payments/:id', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  const payment = await env.DB.prepare(
    `SELECT p.*, o.order_number, o.total AS order_total, COALESCE(c.name,o.guest_name) AS customer_name
       FROM payments p LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN customers c ON c.id=p.customer_id WHERE p.id=?`
  ).bind(id).first();
  if (!payment) return c.json({ error: 'Payment not found.' }, 404);
  const events = await env.DB.prepare('SELECT * FROM payment_events WHERE payment_id = ? ORDER BY created_at DESC').bind(id).all();
  return c.json({ payment, events: events.results });
});

ops.post('/payments', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, {
    orderId: { required: true, type: 'number' },
    amount: { required: true, type: 'number', min: 0.01 },
    method: { required: true, enum: ['cash', 'upi', 'card', 'other'] },
  });
  if (Object.keys(errors).length) return c.json({ error: 'Check the payment details.', errors }, 400);
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(Number(body.orderId)).first();
  if (!order) return c.json({ error: 'Order not found.' }, 404);
  if (order.status === 'cancelled') return c.json({ error: 'A cancelled order cannot take a payment.' }, 409);
  const already = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount-refunded_amount),0) AS paid FROM payments WHERE order_id=? AND status IN ('paid','partially_refunded','refunded')"
  ).bind(order.id).first();
  const remaining = money(Number(order.total) - Number(already.paid));
  if (money(body.amount) > remaining + 0.01) return c.json({ error: `Only ₹${remaining.toFixed(2)} remains unpaid on this order.` }, 422);
  const markPaid = body.markPaid === true;
  const ref = `TXN-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const result = await c.env.DB.prepare(
    "INSERT INTO payments (transaction_ref,order_id,customer_id,amount,method,status,gateway_ref,notes,paid_at,created_by_type,created_by_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'staff',?,?,?)"
  )
    .bind(
      ref, order.id, order.customer_id, money(body.amount), body.method, markPaid ? 'paid' : 'pending',
      body.reference || null, String(body.notes || '').slice(0, 300) || (markPaid ? 'Manually verified payment' : 'Awaiting verified payment'),
      markPaid ? nowISO() : null, auth.id, nowISO(), nowISO()
    )
    .run();
  if (markPaid) {
    await c.env.DB.prepare("INSERT INTO payment_events (payment_id,event_type,amount,note,actor_type,actor_id,created_at) VALUES (?,'payment',?,?, 'staff',?,?)")
      .bind(result.meta.last_row_id, money(body.amount), body.reference ? `Reference: ${body.reference}` : 'Recorded as verified', auth.id, nowISO())
      .run();
  }
  await recalcPaymentStatus(c.env, order.id);
  await audit(c.env, auth, 'record_payment', 'payment', result.meta.last_row_id, { orderId: order.id, amount: body.amount, markPaid }, c.req.header('CF-Connecting-IP'));
  await broadcast(c.env, { type: 'payment', action: markPaid ? 'paid' : 'pending', orderId: order.id, orderNumber: order.order_number });
  return c.json({ id: result.meta.last_row_id, transactionRef: ref }, 201);
});

ops.patch('/payments/:id/status', async (c) => {
  const auth = c.get('auth');
  if (!['owner', 'manager'].includes(auth.role)) return c.json({ error: 'Only management can verify payments.' }, 403);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  if (!['paid', 'failed', 'pending'].includes(body.status)) return c.json({ error: 'Invalid payment status.' }, 400);
  const payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first();
  if (!payment) return c.json({ error: 'Payment not found.' }, 404);
  if (Number(payment.refunded_amount) > 0) return c.json({ error: 'Refunded payments cannot be re-opened here.' }, 409);
  await c.env.DB.prepare('UPDATE payments SET status=?, paid_at=?, notes=?, updated_at=? WHERE id=?')
    .bind(body.status, body.status === 'paid' ? nowISO() : payment.paid_at, body.note || payment.notes, nowISO(), id)
    .run();
  if (body.status === 'paid') {
    await c.env.DB.prepare("INSERT INTO payment_events (payment_id,event_type,amount,note,actor_type,actor_id,created_at) VALUES (?,'payment',?,?, 'staff',?,?)")
      .bind(id, payment.amount, body.note || 'Manually verified', auth.id, nowISO()).run();
  }
  await recalcPaymentStatus(c.env, payment.order_id);
  await audit(c.env, auth, `payment_${body.status}`, 'payment', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

ops.post('/payments/:id/refund', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can issue refunds.' }, 403);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const amount = money(body.amount);
  if (!(amount > 0)) return c.json({ error: 'Enter a refund amount.' }, 400);
  const payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first();
  if (!payment) return c.json({ error: 'Payment not found.' }, 404);
  if (!['paid', 'partially_refunded'].includes(payment.status)) return c.json({ error: 'Only a paid payment can be refunded.' }, 409);
  const refundable = money(Number(payment.amount) - Number(payment.refunded_amount));
  if (amount > refundable + 0.01) return c.json({ error: `At most ₹${refundable.toFixed(2)} can still be refunded.` }, 422);
  const newRefunded = money(Number(payment.refunded_amount) + amount);
  const newStatus = newRefunded >= Number(payment.amount) - 0.01 ? 'refunded' : 'partially_refunded';
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE payments SET refunded_amount=?, status=?, updated_at=? WHERE id=?').bind(newRefunded, newStatus, nowISO(), id),
    c.env.DB.prepare("INSERT INTO payment_events (payment_id,event_type,amount,note,actor_type,actor_id,created_at) VALUES (?,'refund',?,?, 'staff',?,?)")
      .bind(id, amount, String(body.reason || 'Refund issued').slice(0, 300), auth.id, nowISO()),
  ]);
  await recalcPaymentStatus(c.env, payment.order_id);
  await audit(c.env, auth, 'refund_payment', 'payment', id, { amount, newStatus }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true, refundedAmount: newRefunded, status: newStatus });
});

// ----------------------------------------------------------------- Inventory
ops.get('/inventory', async (c) => {
  const env = c.env;
  const [ingredients, suppliers, purchases, purchaseItems, recipes, movements, recipesMenu, reports] = await Promise.all([
    env.DB.prepare('SELECT i.*, s.name AS supplier_name FROM ingredients i LEFT JOIN suppliers s ON s.id=i.supplier_id ORDER BY i.name').all(),
    env.DB.prepare('SELECT * FROM suppliers ORDER BY name').all(),
    env.DB.prepare(
      `SELECT p.*, s.name AS supplier_name, (SELECT COUNT(*) FROM purchase_items WHERE purchase_id=p.id) AS item_count
         FROM purchase_records p LEFT JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.purchase_date DESC, p.id DESC LIMIT 50`
    ).all(),
    env.DB.prepare(
      `SELECT pi.*, i.name AS ingredient_name, i.unit, p.reference FROM purchase_items pi
         JOIN ingredients i ON i.id=pi.ingredient_id JOIN purchase_records p ON p.id=pi.purchase_id ORDER BY pi.id DESC LIMIT 200`
    ).all(),
    env.DB.prepare(
      `SELECT r.*, i.name AS ingredient_name, i.unit, i.stock_qty FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id ORDER BY r.menu_item_id`
    ).all(),
    env.DB.prepare(
      `SELECT m.*, i.name AS ingredient_name, i.unit FROM inventory_movements m JOIN ingredients i ON i.id=m.ingredient_id ORDER BY m.created_at DESC LIMIT 80`
    ).all(),
    env.DB.prepare('SELECT id,name,available FROM menu_items ORDER BY name').all(),
    env.DB.prepare(
      `SELECT ar.*, mi.name AS item_name, ks.name AS station_name FROM availability_reports ar
         JOIN menu_items mi ON mi.id=ar.menu_item_id LEFT JOIN kitchen_stations ks ON ks.id=ar.station_id
        WHERE ar.status != 'resolved' ORDER BY ar.created_at DESC`
    ).all(),
  ]);
  const lowStock = ingredients.results.filter((i) => Number(i.stock_qty) <= Number(i.min_stock));
  const stockValue = ingredients.results.reduce((s, i) => s + Number(i.stock_qty) * Number(i.cost_per_unit), 0);
  return c.json({
    ingredients: ingredients.results,
    suppliers: suppliers.results,
    purchases: purchases.results,
    purchaseItems: purchaseItems.results,
    recipes: recipes.results,
    movements: movements.results,
    menuItems: recipesMenu.results,
    availabilityReports: reports.results,
    stats: { lowStock: lowStock.length, totalItems: ingredients.results.length, stockValue: money(stockValue) },
  });
});

ops.post('/inventory/ingredients', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, { name: { required: true, maxLength: 100 }, stockQty: { type: 'number', min: 0 }, minStock: { type: 'number', min: 0 } });
  if (Object.keys(errors).length) return c.json({ error: 'Check the ingredient details.', errors }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM ingredients WHERE name = ?').bind(body.name).first();
  if (dup) return c.json({ error: 'That ingredient already exists.' }, 409);
  const result = await c.env.DB.prepare(
    'INSERT INTO ingredients (name,category,unit,stock_qty,min_stock,cost_per_unit,supplier_id,active) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(body.name, body.category || 'General', body.unit || 'g', Number(body.stockQty) || 0, Number(body.minStock) || 0, Number(body.costPerUnit) || 0, body.supplierId ? Number(body.supplierId) : null, 1).run();
  if (Number(body.stockQty) > 0) {
    await c.env.DB.prepare(
      "INSERT INTO inventory_movements (ingredient_id,type,qty_change,unit_cost,note,created_by_type,created_by_id,created_at) VALUES (?,'adjustment',?,?, 'Opening stock', 'staff',?,?)"
    ).bind(result.meta.last_row_id, Number(body.stockQty), Number(body.costPerUnit) || 0, auth.id, nowISO()).run();
  }
  await audit(c.env, auth, 'create_ingredient', 'ingredient', result.meta.last_row_id, { name: body.name }, c.req.header('CF-Connecting-IP'));
  return c.json({ id: result.meta.last_row_id }, 201);
});

ops.put('/inventory/ingredients/:id', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare('SELECT * FROM ingredients WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Ingredient not found.' }, 404);
  await c.env.DB.prepare('UPDATE ingredients SET name=?, category=?, unit=?, min_stock=?, cost_per_unit=?, supplier_id=?, active=?, updated_at=? WHERE id=?')
    .bind(body.name ?? existing.name, body.category ?? existing.category, body.unit ?? existing.unit,
      body.minStock != null ? Number(body.minStock) : existing.min_stock, body.costPerUnit != null ? Number(body.costPerUnit) : existing.cost_per_unit,
      body.supplierId !== undefined ? (body.supplierId ? Number(body.supplierId) : null) : existing.supplier_id,
      body.active != null ? (body.active ? 1 : 0) : existing.active, nowISO(), id)
    .run();
  await audit(c.env, auth, 'update_ingredient', 'ingredient', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

ops.post('/inventory/suppliers', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  if (!String(body.name || '').trim()) return c.json({ error: 'Supplier name is required.' }, 400);
  const result = await c.env.DB.prepare('INSERT INTO suppliers (name,contact_name,phone,email,address,notes,active) VALUES (?,?,?,?,?,?,?)')
    .bind(body.name, body.contactName || null, body.phone || null, body.email || null, body.address || null, body.notes || null, 1).run();
  await audit(c.env, auth, 'create_supplier', 'supplier', result.meta.last_row_id, { name: body.name }, c.req.header('CF-Connecting-IP'));
  return c.json({ id: result.meta.last_row_id }, 201);
});

ops.put('/inventory/suppliers/:id', async (c) => {
  const auth = c.get('auth');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Supplier not found.' }, 404);
  await c.env.DB.prepare('UPDATE suppliers SET name=?, contact_name=?, phone=?, email=?, address=?, notes=?, active=? WHERE id=?')
    .bind(body.name ?? existing.name, body.contactName ?? existing.contact_name, body.phone ?? existing.phone,
      body.email ?? existing.email, body.address ?? existing.address, body.notes ?? existing.notes,
      body.active != null ? (body.active ? 1 : 0) : existing.active, id).run();
  await audit(c.env, auth, 'update_supplier', 'supplier', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

ops.post('/inventory/purchases', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.items) || !body.items.length) return c.json({ error: 'Add at least one purchase line.' }, 400);
  const supplier = body.supplierId ? await c.env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(Number(body.supplierId)).first() : null;
  const ref = `PO-${Date.now().toString().slice(-6)}`;
  const purchase = await c.env.DB.prepare(
    'INSERT INTO purchase_records (reference,supplier_id,purchase_date,total,status,notes,created_by) VALUES (?,?,?,0,?,?,?)'
  ).bind(ref, supplier?.id || null, body.date || nowISO().slice(0, 10), 'received', body.notes || null, auth.id).run();
  const purchaseId = purchase.meta.last_row_id;
  let total = 0;
  const stmts = [];
  for (const line of body.items) {
    const ing = await c.env.DB.prepare('SELECT * FROM ingredients WHERE id = ?').bind(Number(line.ingredientId)).first();
    if (!ing) continue;
    const qty = Math.max(0.001, Number(line.qty) || 0);
    const cost = Math.max(0, Number(line.unitCost ?? ing.cost_per_unit) || 0);
    const lineTotal = money(qty * cost);
    total += lineTotal;
    stmts.push(
      c.env.DB.prepare('INSERT INTO purchase_items (purchase_id,ingredient_id,qty,unit_cost,line_total) VALUES (?,?,?,?,?)').bind(purchaseId, ing.id, qty, cost, lineTotal),
      c.env.DB.prepare('UPDATE ingredients SET stock_qty = stock_qty + ?, cost_per_unit = ?, updated_at = ? WHERE id = ?').bind(qty, cost, nowISO(), ing.id),
      c.env.DB.prepare("INSERT INTO inventory_movements (ingredient_id,type,qty_change,unit_cost,reference_type,reference_id,note,created_by_type,created_by_id,created_at) VALUES (?,'purchase',?,?, 'purchase',?,?, 'staff',?,?)")
        .bind(ing.id, qty, cost, purchaseId, `Restock ${ref}`, auth.id, nowISO())
    );
  }
  if (!stmts.length) {
    await c.env.DB.prepare('DELETE FROM purchase_records WHERE id = ?').bind(purchaseId).run();
    return c.json({ error: 'No valid ingredients on this purchase.' }, 400);
  }
  await c.env.DB.prepare('UPDATE purchase_records SET total = ? WHERE id = ?').bind(money(total), purchaseId).run();
  await c.env.DB.batch(stmts);
  await audit(c.env, auth, 'record_purchase', 'purchase', purchaseId, { reference: ref, total: money(total) }, c.req.header('CF-Connecting-IP'));
  return c.json({ id: purchaseId, reference: ref, total: money(total) }, 201);
});

ops.post('/inventory/movements', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));
  const allowed = ['wastage', 'adjustment', 'return'];
  if (!allowed.includes(body.type)) return c.json({ error: 'Choose wastage, adjustment or return.' }, 400);
  const ing = await c.env.DB.prepare('SELECT * FROM ingredients WHERE id = ?').bind(Number(body.ingredientId)).first();
  if (!ing) return c.json({ error: 'Ingredient not found.' }, 404);
  let qty = Math.abs(Number(body.qty) || 0);
  if (!qty) return c.json({ error: 'Enter a quantity.' }, 400);
  const direction = body.type === 'return' ? 1 : -1;
  if (direction < 0 && qty > Number(ing.stock_qty)) return c.json({ error: `Only ${ing.stock_qty}${ing.unit} is in stock.` }, 422);
  const change = direction * qty;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE ingredients SET stock_qty = MAX(0, stock_qty + ?), updated_at = ? WHERE id = ?').bind(change, nowISO(), ing.id),
    c.env.DB.prepare("INSERT INTO inventory_movements (ingredient_id,type,qty_change,note,created_by_type,created_by_id,created_at) VALUES (?,?,?,?, 'staff',?,?)")
      .bind(ing.id, body.type, change, String(body.note || body.type).slice(0, 300), auth.id, nowISO()),
  ]);
  await audit(c.env, auth, `inventory_${body.type}`, 'ingredient', ing.id, { qty: change }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true, stock: Math.max(0, Number(ing.stock_qty) + change) });
});

ops.put('/inventory/recipes/:menuItemId', async (c) => {
  const auth = c.get('auth');
  const menuItemId = Number(c.req.param('menuItemId'));
  const body = await c.req.json().catch(() => ({}));
  const lines = Array.isArray(body.ingredients) ? body.ingredients : [];
  await c.env.DB.prepare('DELETE FROM recipes WHERE menu_item_id = ?').bind(menuItemId).run();
  const stmts = [];
  for (const line of lines) {
    if (!line.ingredientId || !(Number(line.quantity) > 0)) continue;
    stmts.push(
      c.env.DB.prepare('INSERT INTO recipes (menu_item_id,ingredient_id,quantity,unit) VALUES (?,?,?,?)')
        .bind(menuItemId, Number(line.ingredientId), Number(line.quantity), line.unit || 'g')
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env, auth, 'update_recipe', 'menu_item', menuItemId, { lines: lines.length }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

ops.patch('/availability-reports/:id', async (c) => {
  const auth = c.get('auth');
  if (!['owner', 'manager', 'supervisor'].includes(auth.role)) return c.json({ error: 'Not permitted.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare('UPDATE availability_reports SET status=?, resolved_by=?, resolved_at=? WHERE id=?')
    .bind(body.status === 'resolved' ? 'resolved' : body.status || 'acknowledged', auth.id, nowISO(), Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Settings
ops.get('/settings', async (c) => {
  const env = c.env;
  const [settings, staff, stations, offers, auditRows, reports] = await Promise.all([
    env.DB.prepare('SELECT * FROM cafe_settings WHERE id = 1').first(),
    env.DB.prepare('SELECT id,name,email,role,phone,station_id,active,last_login_at,created_at FROM users ORDER BY role, name').all(),
    env.DB.prepare('SELECT * FROM kitchen_stations ORDER BY sort_order, id').all(),
    env.DB.prepare('SELECT * FROM offers ORDER BY active DESC, id DESC').all(),
    env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60').all(),
    env.DB.prepare(
      "SELECT ar.*, mi.name AS item_name FROM availability_reports ar JOIN menu_items mi ON mi.id=ar.menu_item_id WHERE ar.status != 'resolved' ORDER BY ar.created_at DESC"
    ).all(),
  ]);
  return c.json({ settings, staff: staff.results, stations: stations.results, offers: offers.results, audit: auditRows.results, availabilityReports: reports.results });
});

ops.put('/settings', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can change cafe settings.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const s = await c.env.DB.prepare('SELECT * FROM cafe_settings WHERE id = 1').first();
  const numOr = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
  await c.env.DB.prepare(
    `UPDATE cafe_settings SET name=?,tagline=?,description=?,address=?,phone=?,email=?,latitude=?,longitude=?,tax_rate=?,service_charge_rate=?,
      tax_inclusive=?,prepayment_required=?,takeaway_enabled=?,reservation_hold_minutes=?,reservation_slot_minutes=?,opening_time=?,closing_time=?,
      loyalty_enabled=?,loyalty_points_per_100=?,loyalty_point_value=?,loyalty_min_redeem=?,review_moderation=?,ai_enabled=?,updated_at=? WHERE id=1`
  )
    .bind(
      body.name ?? s.name, body.tagline ?? s.tagline, body.description ?? s.description, body.address ?? s.address,
      body.phone ?? s.phone, body.email ?? s.email,
      body.latitude != null ? numOr(body.latitude, s.latitude) : s.latitude,
      body.longitude != null ? numOr(body.longitude, s.longitude) : s.longitude,
      numOr(body.taxRate, s.tax_rate), numOr(body.serviceChargeRate, s.service_charge_rate),
      body.taxInclusive != null ? (body.taxInclusive ? 1 : 0) : s.tax_inclusive,
      body.prepaymentRequired != null ? (body.prepaymentRequired ? 1 : 0) : s.prepayment_required,
      body.takeawayEnabled != null ? (body.takeawayEnabled ? 1 : 0) : s.takeaway_enabled,
      numOr(body.reservationHoldMinutes, s.reservation_hold_minutes),
      numOr(body.reservationSlotMinutes, s.reservation_slot_minutes),
      body.openingTime ?? s.opening_time, body.closingTime ?? s.closing_time,
      body.loyaltyEnabled != null ? (body.loyaltyEnabled ? 1 : 0) : s.loyalty_enabled,
      numOr(body.loyaltyPointsPer100, s.loyalty_points_per_100),
      numOr(body.loyaltyPointValue, s.loyalty_point_value),
      numOr(body.loyaltyMinRedeem, s.loyalty_min_redeem),
      body.reviewModeration != null ? (body.reviewModeration ? 1 : 0) : s.review_moderation,
      body.aiEnabled != null ? (body.aiEnabled ? 1 : 0) : s.ai_enabled,
      nowISO()
    )
    .run();
  await audit(c.env, auth, 'update_settings', 'settings', 1, null, c.req.header('CF-Connecting-IP'));
  return c.json({ settings: await c.env.DB.prepare('SELECT * FROM cafe_settings WHERE id = 1').first() });
});

ops.post('/staff', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can add staff.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const errors = validate(body, {
    name: { required: true, maxLength: 120 },
    email: { required: true, email: true, maxLength: 180 },
    password: { required: true, maxLength: 200 },
    role: { required: true, enum: ['owner', 'manager', 'supervisor', 'kitchen', 'waiter'] },
  });
  if (Object.keys(errors).length) return c.json({ error: 'Check the staff details.', errors }, 400);
  if (String(body.password).length < 8) return c.json({ error: 'Password must be at least 8 characters.' }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email).first();
  if (dup) return c.json({ error: 'That email is already registered.' }, 409);
  const hash = await hashPassword(String(body.password));
  const result = await c.env.DB.prepare(
    'INSERT INTO users (name,email,password_hash,role,phone,station_id,active) VALUES (?,?,?,?,?,?,1)'
  ).bind(body.name, body.email, hash, body.role, body.phone || null, body.stationId ? Number(body.stationId) : null).run();
  await audit(c.env, auth, 'create_staff', 'user', result.meta.last_row_id, { role: body.role }, c.req.header('CF-Connecting-IP'));
  return c.json({ id: result.meta.last_row_id }, 201);
});

ops.put('/staff/:id', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can edit staff.' }, 403);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Staff member not found.' }, 404);
  if (existing.role === 'owner' && body.role && body.role !== 'owner' && id === auth.id) return c.json({ error: 'You cannot remove your own owner role.' }, 409);
  await c.env.DB.prepare('UPDATE users SET name=?, email=?, role=?, phone=?, station_id=?, active=? WHERE id=?')
    .bind(body.name ?? existing.name, body.email ?? existing.email, body.role ?? existing.role,
      body.phone ?? existing.phone, body.stationId !== undefined ? (body.stationId ? Number(body.stationId) : null) : existing.station_id,
      body.active != null ? (body.active ? 1 : 0) : existing.active, id).run();
  await audit(c.env, auth, 'update_staff', 'user', id, { active: body.active, role: body.role }, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

ops.post('/staff/:id/password', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can reset staff passwords.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (String(body.password || '').length < 8) return c.json({ error: 'Password must be at least 8 characters.' }, 400);
  const id = Number(c.req.param('id'));
  const hash = await hashPassword(String(body.password));
  const result = await c.env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hash, id).run();
  if (!result.meta.changes) return c.json({ error: 'Staff member not found.' }, 404);
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_type='staff' AND user_id=?").bind(id).run();
  await audit(c.env, auth, 'reset_staff_password', 'user', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// Stations
ops.post('/stations', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can create stations.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (!String(body.name || '').trim()) return c.json({ error: 'Station name is required.' }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM kitchen_stations WHERE name = ?').bind(body.name).first();
  if (dup) return c.json({ error: 'A station with that name already exists.' }, 409);
  const result = await c.env.DB.prepare(
    'INSERT INTO kitchen_stations (name,description,color,target_minutes,active,sort_order) VALUES (?,?,?,?,?,?)'
  ).bind(body.name, body.description || null, body.color || '#b07d4f', Number(body.targetMinutes) || 12, body.active === false ? 0 : 1, Number(body.sortOrder) || 0).run();
  await audit(c.env, auth, 'create_station', 'station', result.meta.last_row_id, { name: body.name }, c.req.header('CF-Connecting-IP'));
  return c.json({ id: result.meta.last_row_id }, 201);
});

ops.put('/stations/:id', async (c) => {
  const auth = c.get('auth');
  if (!['owner', 'manager', 'supervisor'].includes(auth.role)) return c.json({ error: 'Not permitted.' }, 403);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare('SELECT * FROM kitchen_stations WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Station not found.' }, 404);
  const disable = body.active === false && existing.active;
  if (disable) {
    const active = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.station_id=? AND o.status IN ('pending','confirmed','preparing','ready')"
    ).bind(id).first();
    if (active?.n) return c.json({ error: `This station still has ${active.n} live item(s). Reassign or finish them before disabling.` }, 409);
  }
  await c.env.DB.prepare('UPDATE kitchen_stations SET name=?, description=?, color=?, target_minutes=?, active=?, sort_order=? WHERE id=?')
    .bind(body.name ?? existing.name, body.description ?? existing.description, body.color ?? existing.color,
      body.targetMinutes != null ? Number(body.targetMinutes) : existing.target_minutes,
      body.active != null ? (body.active ? 1 : 0) : existing.active,
      body.sortOrder != null ? Number(body.sortOrder) : existing.sort_order, id).run();
  await audit(c.env, auth, 'update_station', 'station', id, { active: body.active }, c.req.header('CF-Connecting-IP'));
  await broadcast(c.env, { type: 'station', action: 'updated', stationId: id, active: body.active });
  return c.json({ ok: true });
});

ops.delete('/stations/:id', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can delete stations.' }, 403);
  const id = Number(c.req.param('id'));
  const items = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE station_id = ?').bind(id).first();
  if (items?.n) return c.json({ error: `${items.n} menu item(s) are assigned to this station. Reassign them first.` }, 409);
  await c.env.DB.prepare('DELETE FROM kitchen_stations WHERE id = ?').bind(id).run();
  await audit(c.env, auth, 'delete_station', 'station', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// Offers
ops.post('/offers', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can create offers.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (!body.title || !body.code || !Number(body.value)) return c.json({ error: 'Title, code and value are required.' }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM offers WHERE code = ? COLLATE NOCASE').bind(body.code).first();
  if (dup) return c.json({ error: 'That offer code already exists.' }, 409);
  const result = await c.env.DB.prepare(
    'INSERT INTO offers (title,description,code,discount_type,value,min_order,max_discount,active,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(body.title, body.description || null, String(body.code).toUpperCase(), body.discountType === 'flat' ? 'flat' : 'percent',
    Number(body.value), Number(body.minOrder) || 0, body.maxDiscount ? Number(body.maxDiscount) : null,
    body.active === false ? 0 : 1, body.startsAt || null, body.endsAt || null).run();
  await audit(c.env, auth, 'create_offer', 'offer', result.meta.last_row_id, { code: body.code }, c.req.header('CF-Connecting-IP'));
  return c.json({ id: result.meta.last_row_id }, 201);
});

ops.put('/offers/:id', async (c) => {
  const auth = c.get('auth');
  if (!managerOnly(auth)) return c.json({ error: 'Only management can edit offers.' }, 403);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Offer not found.' }, 404);
  await c.env.DB.prepare('UPDATE offers SET title=?, description=?, code=?, discount_type=?, value=?, min_order=?, max_discount=?, active=?, starts_at=?, ends_at=? WHERE id=?')
    .bind(body.title ?? existing.title, body.description ?? existing.description, (body.code ?? existing.code).toUpperCase(),
      body.discountType ?? existing.discount_type, body.value != null ? Number(body.value) : existing.value,
      body.minOrder != null ? Number(body.minOrder) : existing.min_order,
      body.maxDiscount !== undefined ? (body.maxDiscount ? Number(body.maxDiscount) : null) : existing.max_discount,
      body.active != null ? (body.active ? 1 : 0) : existing.active,
      body.startsAt !== undefined ? body.startsAt || null : existing.starts_at,
      body.endsAt !== undefined ? body.endsAt || null : existing.ends_at, id).run();
  await audit(c.env, auth, 'update_offer', 'offer', id, null, c.req.header('CF-Connecting-IP'));
  return c.json({ ok: true });
});

// Image uploads (R2)
ops.post('/upload', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'Sign in first.' }, 401);
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: 'Upload a file.' }, 400);
  const file = form.get('file');
  if (!file || typeof file === 'string') return c.json({ error: 'No file received.' }, 400);
  const allowed = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ext = allowed[file.type];
  if (!ext) return c.json({ error: 'Use a JPG, PNG, WEBP or GIF image.' }, 415);
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'Images must be under 5 MB.' }, 413);
  const folder = form.get('folder') === 'reviews' ? 'reviews' : 'menu';
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;
  const bytes = await file.arrayBuffer();
  await c.env.IMAGES.put(key, bytes, {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });
  await audit(c.env, auth, 'upload_image', 'image', key, { size: file.size }, c.req.header('CF-Connecting-IP'));
  return c.json({ url: `/api/images/${key}`, key }, 201);
});

export default ops;
