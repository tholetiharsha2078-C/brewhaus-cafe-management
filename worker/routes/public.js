// Public storefront API: discovery, menu, floor plan, offers, guest order tracking.
import { Hono } from 'hono';
import { createOrder, getOrderDetail } from '../lib/orders.js';
import { createHold, getFloorPlan } from '../lib/floor.js';
import { menuAssistant } from '../lib/ai.js';
import { istDateStr, safeJson } from '../lib/utils.js';

const publicRoutes = new Hono();

const SAFE_SETTINGS = `name, tagline, description, address, phone, email, latitude, longitude, currency,
  tax_rate, service_charge_rate, prepayment_required, takeaway_enabled, reservation_hold_minutes,
  reservation_slot_minutes, opening_time, closing_time, loyalty_enabled, loyalty_points_per_100,
  loyalty_point_value, loyalty_min_redeem, review_moderation, ai_enabled`;

function publicItem(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    prepTime: row.prep_time,
    image: row.image_url,
    dietary: row.dietary,
    tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    available: Boolean(row.available),
    isSpecial: Boolean(row.is_special),
    isRecommended: Boolean(row.is_recommended),
    categoryId: row.category_id,
    category: row.category_name,
    categorySlug: row.category_slug,
    sold: row.sold || 0,
  };
}

publicRoutes.get('/public/home', async (c) => {
  const env = c.env;
  const settings = await env.DB.prepare(`SELECT ${SAFE_SETTINGS} FROM cafe_settings WHERE id = 1`).first();
  const categories = await env.DB.prepare(
    `SELECT mc.*, COUNT(mi.id) AS item_count FROM menu_categories mc
       LEFT JOIN menu_items mi ON mi.category_id = mc.id AND mi.available = 1
      WHERE mc.active = 1 GROUP BY mc.id ORDER BY mc.sort_order`
  ).all();
  const base = `SELECT mi.*, mc.name AS category_name, mc.slug AS category_slug,
      COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.menu_item_id = mi.id AND o.status = 'completed' AND o.placed_at >= datetime('now','-30 days')), 0) AS sold
      FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE mi.available = 1`;
  const [specials, recommended, popular, newArrivals, offers, reviews] = await Promise.all([
    env.DB.prepare(`${base} AND mi.is_special = 1 ORDER BY mi.id LIMIT 6`).all(),
    env.DB.prepare(`${base} AND mi.is_recommended = 1 ORDER BY mi.name LIMIT 8`).all(),
    env.DB.prepare(`${base} ORDER BY sold DESC, mi.name LIMIT 8`).all(),
    env.DB.prepare(`${base} ORDER BY mi.id DESC LIMIT 4`).all(),
    env.DB.prepare("SELECT * FROM offers WHERE active = 1 AND (starts_at IS NULL OR starts_at <= date('now')) AND (ends_at IS NULL OR ends_at >= date('now')) ORDER BY id DESC").all(),
    env.DB.prepare(
      `SELECT r.*, SUBSTR(c.name, 1, INSTR(c.name || ' ', ' ') - 1) AS first_name
         FROM reviews r LEFT JOIN customers c ON c.id = r.customer_id
        WHERE r.status = 'approved' ORDER BY r.created_at DESC LIMIT 4`
    ).all(),
  ]);
  return c.json({
    settings,
    categories: categories.results,
    specials: specials.results.map(publicItem),
    recommended: recommended.results.map(publicItem),
    popular: popular.results.map(publicItem),
    newArrivals: newArrivals.results.map(publicItem),
    offers: offers.results,
    reviews: reviews.results,
    date: istDateStr(),
  });
});

publicRoutes.get('/public/menu', async (c) => {
  const env = c.env;
  const category = c.req.query('category');
  const q = (c.req.query('q') || '').trim();
  const dietary = c.req.query('dietary');
  const sort = c.req.query('sort') || 'recommended';
  const categories = await env.DB.prepare('SELECT *, (SELECT COUNT(*) FROM menu_items mi WHERE mi.category_id = menu_categories.id AND mi.available = 1) AS item_count FROM menu_categories WHERE active = 1 ORDER BY sort_order').all();

  let sql = `SELECT mi.*, mc.name AS category_name, mc.slug AS category_slug,
      COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.menu_item_id = mi.id AND o.status = 'completed' AND o.placed_at >= datetime('now','-30 days')), 0) AS sold
    FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
    WHERE mi.available = 1 AND mc.active = 1`;
  const binds = [];
  if (category) { sql += ' AND mc.slug = ?'; binds.push(category); }
  if (dietary) {
    if (dietary === 'veg') { sql += " AND mi.dietary IN ('veg','vegan')"; }
    else { sql += ' AND mi.dietary = ?'; binds.push(dietary); }
  }
  if (q) {
    sql += ' AND (mi.name LIKE ? OR mi.description LIKE ? OR mi.tags LIKE ? OR mi.ingredients_text LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (sort === 'price_asc') sql += ' ORDER BY mi.price ASC';
  else if (sort === 'price_desc') sql += ' ORDER BY mi.price DESC';
  else if (sort === 'name') sql += ' ORDER BY mi.name ASC';
  else if (sort === 'popular') sql += ' ORDER BY sold DESC, mi.name';
  else sql += ' ORDER BY mi.is_recommended DESC, mi.is_special DESC, mc.sort_order, mi.name';

  const items = await env.DB.prepare(sql).bind(...binds).all();
  return c.json({ categories: categories.results, items: items.results.map(publicItem) });
});

publicRoutes.get('/public/menu/:id', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  const item = await env.DB.prepare(
    `SELECT mi.*, mc.name AS category_name, mc.slug AS category_slug FROM menu_items mi
       JOIN menu_categories mc ON mc.id = mi.category_id WHERE mi.id = ?`
  )
    .bind(id)
    .first();
  if (!item) return c.json({ error: 'Menu item not found.' }, 404);
  const groups = await env.DB.prepare('SELECT * FROM menu_option_groups WHERE menu_item_id = ? ORDER BY sort_order, id').bind(id).all();
  const options = await env.DB.prepare(
    'SELECT o.* FROM menu_options o JOIN menu_option_groups g ON g.id = o.group_id WHERE g.menu_item_id = ? AND o.available = 1 ORDER BY o.sort_order, o.id'
  )
    .bind(id)
    .all();
  const reviews = await env.DB.prepare(
    `SELECT r.overall_rating, r.comment, r.created_at, SUBSTR(c.name, 1, INSTR(c.name || ' ', ' ') - 1) AS first_name
       FROM reviews r LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.status = 'approved' AND r.order_id IN (SELECT id FROM orders WHERE id IN (SELECT order_id FROM order_items WHERE menu_item_id = ?))
      ORDER BY r.created_at DESC LIMIT 5`
  )
    .bind(id)
    .all();
  const ratings = await env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(AVG(r.overall_rating), 0) AS average FROM reviews r
      WHERE r.status = 'approved' AND r.order_id IN (SELECT order_id FROM order_items WHERE menu_item_id = ?)`
  )
    .bind(id)
    .first();
  const grouped = groups.results.map((g) => ({
    id: g.id,
    name: g.name,
    selectionType: g.selection_type,
    required: Boolean(g.required),
    maxSelect: g.max_select,
    options: options.results.filter((o) => o.group_id === g.id).map((o) => ({
      id: o.id, name: o.name, priceDelta: o.price_delta, isDefault: Boolean(o.is_default),
    })),
  }));
  const related = await env.DB.prepare(
    `SELECT mi.*, mc.name AS category_name, mc.slug AS category_slug FROM menu_items mi
       JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE mi.category_id = ? AND mi.id != ? AND mi.available = 1 LIMIT 4`
  )
    .bind(item.category_id, id)
    .all();
  return c.json({
    item: {
      ...publicItem(item),
      ingredientsText: item.ingredients_text,
      optionGroups: grouped,
    },
    reviews: reviews.results,
    rating: ratings,
    related: related.results.map(publicItem),
  });
});

publicRoutes.get('/public/offers', async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM offers WHERE active = 1 ORDER BY id DESC").all();
  return c.json({ offers: rows.results });
});

publicRoutes.get('/public/availability', async (c) => {
  const date = c.req.query('date') || istDateStr();
  const time = c.req.query('time') || '19:00';
  const party = Math.max(1, Number(c.req.query('party')) || 2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'Invalid date.' }, 400);
  const data = await getFloorPlan(c.env, { date, time, party, includeDetails: false });
  return c.json(data);
});

publicRoutes.post('/public/holds', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const date = body.date;
  const time = body.time;
  const party = Number(body.party);
  if (!date || !time || !party) return c.json({ error: 'Date, time and party size are required.' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return c.json({ error: 'Invalid date or time.' }, 400);
  if (date < istDateStr()) return c.json({ error: 'Reservations cannot be made in the past.' }, 422);
  const settings = await c.env.DB.prepare('SELECT reservation_hold_minutes FROM cafe_settings WHERE id = 1').first();
  const hold = await createHold(c.env, {
    tableId: body.tableId, date, time, party,
    minutes: settings?.reservation_hold_minutes || 10,
  });
  if (hold.error) return c.json({ error: hold.error }, hold.status || 409);
  return c.json(hold, 201);
});

publicRoutes.delete('/public/holds/:token', async (c) => {
  await c.env.DB.prepare('DELETE FROM table_holds WHERE token = ?').bind(c.req.param('token')).run();
  return c.json({ ok: true });
});

publicRoutes.get('/public/track/:number', async (c) => {
  const env = c.env;
  const number = c.req.param('number');
  const token = c.req.query('token');
  const order = await env.DB.prepare(
    `SELECT o.*, t.label AS table_label FROM orders o LEFT JOIN cafe_tables t ON t.id = o.table_id WHERE o.order_number = ?`
  )
    .bind(number)
    .first();
  if (!order) return c.json({ error: 'Order not found.' }, 404);
  const auth = c.get('auth');
  const owns = auth?.type === 'customer' && auth.id === order.customer_id;
  if (!owns && token && token !== order.tracking_token) return c.json({ error: 'Order not found.' }, 404);
  if (!owns && !token) return c.json({ error: 'A tracking link is required.', requiresToken: true }, 401);
  const detail = await getOrderDetail(env, order.id);
  return c.json({
    order: {
      id: detail.id,
      number: detail.order_number,
      status: detail.status,
      payment_status: detail.payment_status,
      type: detail.type,
      table_label: detail.table_label,
      guest_name: detail.guest_name ? detail.guest_name.split(' ')[0] : detail.customer_name?.split(' ')[0] || 'Guest',
      placed_at: detail.placed_at,
      eta_minutes: detail.eta_minutes,
      estimated_ready_at: detail.estimated_ready_at,
      ready_at: detail.ready_at,
      served_at: detail.served_at,
      completed_at: detail.completed_at,
      subtotal: detail.subtotal,
      tax_amount: detail.tax_amount,
      service_charge: detail.service_charge,
      discount_amount: detail.discount_amount,
      loyalty_discount: detail.loyalty_discount,
      total: detail.total,
      notes: detail.notes,
      items: detail.items.map((i) => ({
        id: i.id, name: i.name_snapshot, qty: i.qty, unit_price: i.unit_price,
        line_total: i.line_total, status: i.status,
        options: safeJson(i.options_json, []), special_instructions: i.special_instructions,
        allergy_flag: i.allergy_flag, station: i.station_name,
      })),
      payments: detail.payments.map((p) => ({ ref: p.transaction_ref, amount: p.amount, method: p.method, status: p.status, refunded: p.refunded_amount })),
      history: detail.history.map((h) => ({ status: h.status, at: h.created_at })),
    },
  });
});

// Guest/direct ordering is allowed with a valid table; customer auth adds history + loyalty.
publicRoutes.post('/public/ai', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const question = String(body.question || '').trim();
  if (!question) return c.json({ error: 'Ask a question about the menu.' }, 400);
  if (question.length > 500) return c.json({ error: 'Please keep questions under 500 characters.' }, 400);
  return c.json(await menuAssistant(c.env, question));
});

publicRoutes.post('/public/orders', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await createOrder(c.env, c.get('auth'), body, { source: 'customer' });
  if (result.error) return c.json({ error: result.error, details: result.details }, result.status || 400);
  const token = result.order.tracking_token;
  return c.json({ order: { ...result.order, tracking_token: undefined, trackUrl: `/track/${result.order.order_number}?token=${token}` }, trackingToken: token }, 201);
});

export default publicRoutes;
