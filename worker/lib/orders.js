// Order lifecycle: validation, pricing, status transitions, inventory + loyalty side effects.
import { randomToken, randomRef } from './auth.js';
import {
  broadcast, istDateStr, istDayStart, money, notify, nowISO, orderNumber, safeJson,
} from './utils.js';

export async function getSettings(env) {
  return env.DB.prepare('SELECT * FROM cafe_settings WHERE id = 1').first();
}

const ALLERGY_RE = /(allerg|nut|peanut|gluten|dairy|lactose|shellfish|soy|egg white|anaphyl)/i;

const TRANSITIONS = {
  pending: ['confirmed', 'cancelled', 'on_hold'],
  confirmed: ['preparing', 'cancelled', 'on_hold'],
  preparing: ['ready', 'cancelled', 'on_hold'],
  ready: ['collected', 'served', 'cancelled'],
  collected: ['served', 'completed'],
  served: ['completed'],
  on_hold: ['confirmed', 'preparing', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function allowedTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export async function getOrderDetail(env, id) {
  const order = await env.DB.prepare(
    `SELECT o.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            t.label AS table_label, r.reference AS reservation_reference,
            w.name AS waiter_name, cb.name AS collected_by_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN cafe_tables t ON t.id = o.table_id
       LEFT JOIN reservations r ON r.id = o.reservation_id
       LEFT JOIN users w ON w.id = o.waiter_id
       LEFT JOIN users cb ON cb.id = o.collected_by
      WHERE o.id = ?`
  )
    .bind(id)
    .first();
  if (!order) return null;
  const [items, payments, history, review] = await Promise.all([
    env.DB.prepare(
      `SELECT oi.*, ks.name AS station_name, ks.color AS station_color, u.name AS assigned_staff_name
         FROM order_items oi
         LEFT JOIN kitchen_stations ks ON ks.id = oi.station_id
         LEFT JOIN users u ON u.id = oi.assigned_staff_id
        WHERE oi.order_id = ? ORDER BY oi.id`
    )
      .bind(id)
      .all(),
    env.DB.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC').bind(id).all(),
    env.DB.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at, id').bind(id).all(),
    env.DB.prepare('SELECT * FROM reviews WHERE order_id = ?').bind(id).first(),
  ]);
  return {
    ...order,
    items: items.results.map((i) => ({ ...i, options: safeJson(i.options_json, []) })),
    payments: payments.results,
    history: history.results,
    review: review || null,
  };
}

export async function createOrder(env, auth, body, meta = {}) {
  const settings = await getSettings(env);
  const source = auth?.type === 'customer' ? 'customer' : meta.source || 'management';
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return { error: 'Add at least one item to the order.', status: 400 };

  const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey).slice(0, 100) : null;
  if (idempotencyKey) {
    const existing = await env.DB.prepare('SELECT id, order_number FROM orders WHERE idempotency_key = ?').bind(idempotencyKey).first();
    if (existing) {
      return { order: await getOrderDetail(env, existing.id), duplicate: true };
    }
  }

  const type = ['dine_in', 'takeaway', 'preorder'].includes(body.type) ? body.type : 'dine_in';
  if (type === 'takeaway' && !settings.takeaway_enabled) {
    return { error: 'Takeaway ordering is currently disabled.', status: 422 };
  }

  const ids = [...new Set(rawItems.map((i) => Number(i.menuItemId)).filter(Boolean))];
  if (!ids.length) return { error: 'No valid menu items were provided.', status: 400 };

  const menuRows = await env.DB.prepare(
    `SELECT mi.*, mc.name AS category_name, ks.name AS station_name, ks.active AS station_active
       FROM menu_items mi
       JOIN menu_categories mc ON mc.id = mi.category_id
       LEFT JOIN kitchen_stations ks ON ks.id = mi.station_id
      WHERE mi.id IN (${ids.map(() => '?').join(',')})`
  )
    .bind(...ids)
    .all();
  const menuMap = new Map(menuRows.results.map((m) => [m.id, m]));

  const optionIds = [...new Set(rawItems.flatMap((i) => (Array.isArray(i.optionIds) ? i.optionIds : [])).map(Number).filter(Boolean))];
  let optionMap = new Map();
  const groups = await env.DB.prepare(
    `SELECT id, menu_item_id, name, required, max_select, selection_type FROM menu_option_groups WHERE menu_item_id IN (${ids.map(() => '?').join(',')})`
  )
    .bind(...ids)
    .all();
  const groupsByItem = new Map();
  for (const g of groups.results) {
    if (!groupsByItem.has(g.menu_item_id)) groupsByItem.set(g.menu_item_id, []);
    groupsByItem.get(g.menu_item_id).push(g);
  }
  if (optionIds.length) {
    const optRows = await env.DB.prepare(
      `SELECT o.*, g.menu_item_id, g.name AS group_name, g.selection_type, g.required, g.max_select
         FROM menu_options o JOIN menu_option_groups g ON g.id = o.group_id
        WHERE o.id IN (${optionIds.map(() => '?').join(',')}) AND o.available = 1`
    )
      .bind(...optionIds)
      .all();
    optionMap = new Map(optRows.results.map((o) => [o.id, o]));
  }

  const validationErrors = [];
  const items = [];

  for (const [index, line] of rawItems.entries()) {
    const menuItemId = Number(line.menuItemId);
    const m = menuMap.get(menuItemId);
    if (!m) {
      validationErrors.push(`Line ${index + 1}: menu item no longer exists.`);
      continue;
    }
    if (!m.available) {
      validationErrors.push(`${m.name} is currently unavailable.`);
      continue;
    }
    if (!m.station_id) {
      validationErrors.push(`${m.name} has no kitchen station assigned. Please contact the cafe.`);
      continue;
    }
    if (!m.station_active) {
      validationErrors.push(`${m.name} is paused while its station is disabled.`);
      continue;
    }
    const qty = Math.max(1, Math.min(20, Number(line.qty) || 1));
    const selected = [];
    let optionsTotal = 0;
    const requested = (Array.isArray(line.optionIds) ? line.optionIds : []).map(Number).filter(Boolean);
    const itemGroups = groupsByItem.get(menuItemId) || [];
    const byGroup = new Map();
    for (const oid of requested) {
      const opt = optionMap.get(oid);
      if (!opt || opt.menu_item_id !== menuItemId) {
        validationErrors.push(`An invalid customization was selected for ${m.name}.`);
        continue;
      }
      if (!byGroup.has(opt.group_id)) byGroup.set(opt.group_id, []);
      byGroup.get(opt.group_id).push(opt);
    }
    for (const g of itemGroups) {
      const chosen = byGroup.get(g.id) || [];
      if (g.required && chosen.length === 0) {
        validationErrors.push(`${m.name}: please choose ${g.name}.`);
      }
      if (chosen.length > g.max_select) {
        validationErrors.push(`${m.name}: too many ${g.name} options selected.`);
      }
    }
    for (const chosen of byGroup.values()) {
      for (const opt of chosen) {
        selected.push({ id: opt.id, group: opt.group_name, name: opt.name, price: opt.price_delta });
        optionsTotal += Number(opt.price_delta) || 0;
      }
    }
    const instructions = String(line.instructions || '').slice(0, 240);
    const allergy = Boolean(line.allergy) || ALLERGY_RE.test(instructions);
    const unitPrice = money(Number(m.price) + optionsTotal);
    items.push({
      menuItemId,
      stationId: m.station_id,
      name: m.name,
      qty,
      unitPrice,
      options: selected,
      optionsTotal: money(optionsTotal),
      lineTotal: money(unitPrice * qty),
      instructions,
      allergy,
      prepTime: m.prep_time,
    });
  }

  if (validationErrors.length) {
    return { error: 'This order needs a few corrections before it can be sent to the kitchen.', details: validationErrors, status: 422 };
  }

  // Customer ownership / reservation checks
  let customerId = null;
  let guestName = String(body.guestName || '').slice(0, 120) || null;
  let guestPhone = String(body.guestPhone || '').slice(0, 30) || null;
  if (auth?.type === 'customer') {
    customerId = auth.id;
    const customer = await env.DB.prepare('SELECT name, phone FROM customers WHERE id = ?').bind(auth.id).first();
    guestName = customer?.name || guestName;
    guestPhone = customer?.phone || guestPhone;
  } else if (body.customerId) {
    const customer = await env.DB.prepare('SELECT id, name, phone FROM customers WHERE id = ?').bind(Number(body.customerId)).first();
    if (customer) {
      customerId = customer.id;
      guestName = customer.name;
      guestPhone = customer.phone || guestPhone;
    }
  }
  if (source === 'customer' && !customerId && !guestName) {
    return { error: 'Please provide your name.', status: 400 };
  }

  let reservationId = null;
  let tableId = body.tableId ? Number(body.tableId) : null;
  if (body.reservationId) {
    const reservation = await env.DB.prepare('SELECT * FROM reservations WHERE id = ?').bind(Number(body.reservationId)).first();
    if (!reservation) return { error: 'That reservation could not be found.', status: 404 };
    if (auth?.type === 'customer' && reservation.customer_id !== auth.id) {
      return { error: 'That reservation belongs to another customer.', status: 403 };
    }
    if (!['confirmed', 'pending'].includes(reservation.status)) {
      return { error: 'That reservation is no longer active.', status: 409 };
    }
    reservationId = reservation.id;
    tableId = reservation.table_id;
  }
  if (type === 'preorder' && !reservationId) {
    return { error: 'A pre-order must be linked to a reservation.', status: 400 };
  }
  if (tableId) {
    const table = await env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(tableId).first();
    if (!table) return { error: 'That table could not be found.', status: 404 };
    if (table.status === 'out_of_service') return { error: 'That table is out of service.', status: 409 };
  } else if (type === 'dine_in' && source === 'customer' && !reservationId) {
    return { error: 'Choose a table or scan the table QR code to order at the cafe.', status: 400 };
  }

  const subtotal = money(items.reduce((s, i) => s + i.lineTotal, 0));
  let taxAmount = 0;
  let serviceCharge = 0;
  if (settings.tax_inclusive) {
    taxAmount = money((subtotal * settings.tax_rate) / (100 + settings.tax_rate));
  } else {
    taxAmount = money((subtotal * settings.tax_rate) / 100);
  }
  serviceCharge = money((subtotal * (settings.service_charge_rate || 0)) / 100);

  let discountAmount = 0;
  let offerCode = null;
  if (body.offerCode) {
    const offer = await env.DB.prepare('SELECT * FROM offers WHERE code = ? COLLATE NOCASE').bind(String(body.offerCode).trim()).first();
    if (!offer || !offer.active) return { error: 'That offer code is not valid.', status: 422 };
    const today = nowISO().slice(0, 10);
    if (offer.starts_at && today < offer.starts_at) return { error: 'That offer has not started yet.', status: 422 };
    if (offer.ends_at && today > offer.ends_at) return { error: 'That offer has expired.', status: 422 };
    if (subtotal < offer.min_order) return { error: `That offer needs a minimum order of ₹${offer.min_order}.`, status: 422 };
    discountAmount = offer.discount_type === 'percent' ? money((subtotal * offer.value) / 100) : money(offer.value);
    if (offer.max_discount) discountAmount = Math.min(discountAmount, money(offer.max_discount));
    discountAmount = Math.min(discountAmount, subtotal);
    offerCode = offer.code;
  }

  let loyaltyDiscount = 0;
  let redeemPoints = 0;
  if (auth?.type === 'customer' && body.redeemPoints) {
    const requested = Math.max(0, Math.floor(Number(body.redeemPoints) || 0));
    if (settings.loyalty_enabled && requested >= settings.loyalty_min_redeem) {
      const customer = await env.DB.prepare('SELECT loyalty_points FROM customers WHERE id = ?').bind(auth.id).first();
      const maxPoints = Math.min(requested, customer?.loyalty_points || 0);
      const maxValue = money(subtotal + taxAmount + serviceCharge - discountAmount);
      const capPoints = Math.floor(maxValue / settings.loyalty_point_value);
      redeemPoints = Math.min(maxPoints, capPoints);
      loyaltyDiscount = money(redeemPoints * settings.loyalty_point_value);
    }
  }

  const total = money(Math.max(0, subtotal + taxAmount + serviceCharge - discountAmount - loyaltyDiscount));
  const eta = Math.max(...items.map((i) => i.prepTime)) + (type === 'preorder' ? 0 : 5);
  const trackingToken = randomToken(16);
  const priority = body.priority === 'high' || body.partySize >= 6 ? 'high' : body.priority === 'low' ? 'low' : 'normal';
  const placedAt = nowISO();
  const notes = String(body.notes || '').slice(0, 500) || null;
  const createdByType = auth?.type === 'customer' ? 'customer' : 'staff';
  const createdById = auth?.id || null;
  const waiterId = auth?.type === 'staff' && auth.role === 'waiter' ? auth.id : null;

  const insert = await env.DB.prepare(
    `INSERT INTO orders (
      customer_id, reservation_id, table_id, type, status, payment_status,
      subtotal, tax_amount, service_charge, discount_amount, loyalty_discount, total,
      guest_name, guest_phone, notes, priority, eta_minutes, estimated_ready_at,
      validated, validation_notes, idempotency_key, source, created_by_type, created_by_id,
      waiter_id, placed_at, tracking_token, offer_code, created_at, updated_at
    ) VALUES (
      ?,?,?,?, 'pending','pending',
      ?,?,?,?,?,?,
      ?,?,?,?,?,?,
      1,?,?,?,?,?,
      ?,?,?,?,?,?
    )`
  )
    .bind(
      customerId, reservationId, tableId, type,
      subtotal, taxAmount, serviceCharge, discountAmount, loyaltyDiscount, total,
      guestName, guestPhone, notes, priority, eta, new Date(Date.now() + eta * 60000).toISOString(),
      `Availability, quantities, pricing and station routing verified at ${placedAt}`,
      idempotencyKey, source, createdByType, createdById, waiterId,
      placedAt, trackingToken, offerCode, placedAt, placedAt
    )
    .run();

  const orderId = insert.meta.last_row_id;
  const number = orderNumber(orderId);
  try {
    const statements = [
      env.DB.prepare('UPDATE orders SET order_number = ? WHERE id = ?').bind(number, orderId),
      env.DB.prepare("INSERT INTO order_status_history (order_id,status,note,actor_type,actor_id,actor_name,created_at) VALUES (?,?,?,?,?,?,?)").bind(
        orderId, 'pending', 'Order validated and sent to the kitchen', createdByType, createdById, auth?.name || guestName || 'Guest', placedAt
      ),
    ];
    for (const it of items) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO order_items (order_id,menu_item_id,station_id,name_snapshot,qty,unit_price,options_json,options_total,line_total,status,special_instructions,allergy_flag,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?)`
        ).bind(
          orderId, it.menuItemId, it.stationId, it.name, it.qty, it.unitPrice, JSON.stringify(it.options), it.optionsTotal,
          it.lineTotal, it.instructions || null, it.allergy ? 1 : 0, placedAt
        )
      );
    }
    if (body.paymentMethod && ['cash', 'upi', 'card', 'other'].includes(body.paymentMethod)) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO payments (transaction_ref,order_id,customer_id,amount,method,status,notes,created_by_type,created_by_id,created_at) VALUES (?,?,?,?,?,'pending',?,?,?,?)"
        ).bind(randomRef('TXN', 4), orderId, customerId, total, body.paymentMethod, 'Awaiting verified payment', createdByType, createdById, placedAt)
      );
    }
    if (redeemPoints > 0) {
      statements.push(
        env.DB.prepare('UPDATE customers SET loyalty_points = loyalty_points - ? WHERE id = ?').bind(redeemPoints, customerId),
        env.DB.prepare("INSERT INTO loyalty_transactions (customer_id,order_id,points,type,note,created_at) VALUES (?,?,?,'redeem',?,?)").bind(
          customerId, orderId, -redeemPoints, `Redeemed on ${number}`, placedAt
        )
      );
    }
    await env.DB.batch(statements);
  } catch (err) {
    await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run().catch(() => {});
    throw err;
  }

  await notify(env, {
    audience: 'kitchen', type: 'order', title: `New order ${number}`,
    body: `${items.length} item${items.length > 1 ? 's' : ''} · ${type.replace('_', ' ')}`, link: '/kitchen',
  });
  await notify(env, {
    audience: 'staff', type: 'order', title: `New order ${number}`,
    body: `${guestName || 'Guest'} · ₹${total.toFixed(0)} · ${type.replace('_', ' ')}`, link: '/admin/orders',
  });
  if (customerId) {
    await notify(env, {
      audience: 'customer', userId: customerId, type: 'order', title: `Order ${number} received`,
      body: 'We have sent your order to the kitchen.', link: `/track/${number}`,
    });
  }
  await broadcast(env, { type: 'order', action: 'created', orderId, orderNumber: number, status: 'pending', orderType: type });

  return { order: await getOrderDetail(env, orderId) };
}

export async function refreshTableStatus(env, tableId) {
  if (!tableId) return;
  const table = await env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(tableId).first();
  if (!table) return;
  if (['out_of_service', 'cleaning'].includes(table.status)) return;
  const today = istDateStr();
  const activeOrder = await env.DB.prepare(
    "SELECT id FROM orders WHERE table_id = ? AND status IN ('confirmed','preparing','ready','collected','served') AND placed_at >= ? LIMIT 1"
  )
    .bind(tableId, istDayStart(today))
    .first();
  const reservation = await env.DB.prepare(
    "SELECT id FROM reservations WHERE table_id = ? AND reservation_date = ? AND status IN ('confirmed','seated') ORDER BY reservation_time LIMIT 1"
  )
    .bind(tableId, today)
    .first();
  let status = 'available';
  if (activeOrder) status = 'occupied';
  else if (reservation) status = 'reserved';
  await env.DB.prepare("UPDATE cafe_tables SET status = ?, updated_at = ? WHERE id = ?").bind(status, nowISO(), tableId).run();
}

export async function transitionOrder(env, auth, orderId, newStatus, opts = {}) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return { error: 'Order not found.', status: 404 };
  if (order.status === newStatus) return { order: await getOrderDetail(env, orderId) };
  if (!allowedTransition(order.status, newStatus)) {
    return { error: `Cannot move an order from ${order.status} to ${newStatus}.`, status: 409 };
  }
  const role = auth?.role;
  const isManager = ['owner', 'manager'].includes(role);
  const isKitchen = ['kitchen', 'supervisor'].includes(role);
  const isWaiter = role === 'waiter';

  if (!isManager) {
    if (['confirmed', 'preparing', 'ready', 'on_hold'].includes(newStatus) && !isKitchen && !isWaiter) {
      return { error: 'Your role cannot perform that kitchen action.', status: 403 };
    }
    if (['collected', 'served', 'completed'].includes(newStatus) && !isWaiter && !isKitchen) {
      return { error: 'Only floor or kitchen staff can update handover.', status: 403 };
    }
    if (newStatus === 'cancelled' && !isKitchen) {
      return { error: 'Only management can cancel an order.', status: 403 };
    }
    if (newStatus === 'collected' && !isWaiter && !isKitchen) {
      return { error: 'Only the waiter or kitchen can record collection.', status: 403 };
    }
  }

  if (newStatus === 'ready') {
    const pendingItems = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status NOT IN ('ready','served','cancelled')"
    )
      .bind(orderId)
      .first();
    if (pendingItems?.n > 0) {
      return { error: `${pendingItems.n} item(s) are still in preparation. Mark every item ready first.`, status: 409 };
    }
  }
  if (newStatus === 'on_hold' && !String(opts.reason || '').trim()) {
    return { error: 'A reason is required to place an order on hold.', status: 400 };
  }
  if (newStatus === 'collected') {
    const readyItems = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status NOT IN ('ready','served','cancelled')"
    )
      .bind(orderId)
      .first();
    if (readyItems?.n > 0) return { error: 'Not every item is ready yet.', status: 409 };
  }

  const ts = nowISO();
  const sets = ['status = ?', 'updated_at = ?'];
  const binds = [newStatus, ts];
  if (newStatus === 'confirmed' && !order.confirmed_at) { sets.push('confirmed_at = ?'); binds.push(ts); }
  if (newStatus === 'preparing' && !order.prep_started_at) {
    sets.push('prep_started_at = ?'); binds.push(ts);
    if (!order.confirmed_at) { sets.push('confirmed_at = ?'); binds.push(ts); }
    await env.DB.prepare("UPDATE order_items SET status = 'preparing', started_at = ? WHERE order_id = ? AND status = 'pending'").bind(ts, orderId).run();
  }
  if (newStatus === 'preparing' && !order.eta_minutes) { /* noop */ }
  if (newStatus === 'ready') { sets.push('ready_at = ?'); binds.push(ts); }
  if (newStatus === 'collected') {
    sets.push('collected_at = ?'); binds.push(ts);
    if (opts.collectedBy) { sets.push('collected_by = ?'); binds.push(opts.collectedBy); }
  }
  if (newStatus === 'served') { sets.push('served_at = ?'); binds.push(ts); }
  if (newStatus === 'completed') {
    sets.push('completed_at = ?');
    binds.push(ts);
    if (order.prep_started_at && order.ready_at) {
      const secs = Math.max(0, Math.round((new Date(order.ready_at) - new Date(order.prep_started_at)) / 1000));
      sets.push('actual_prep_seconds = ?'); binds.push(secs);
    }
  }
  if (newStatus === 'cancelled') {
    sets.push('cancelled_at = ?', 'cancel_reason = ?');
    binds.push(ts, String(opts.reason || 'Cancelled by staff').slice(0, 300));
  }
  if (newStatus === 'on_hold') {
    sets.push('hold_reason = ?');
    binds.push(String(opts.reason).slice(0, 300));
  }
  if (newStatus === 'confirmed' && order.status === 'on_hold') {
    sets.push('hold_reason = NULL');
  }
  binds.push(orderId);
  await env.DB.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  await env.DB.prepare(
    'INSERT INTO order_status_history (order_id,status,note,actor_type,actor_id,actor_name,created_at) VALUES (?,?,?,?,?,?,?)'
  )
    .bind(orderId, newStatus, opts.reason || null, 'staff', auth?.id || null, auth?.name || 'System', ts)
    .run();

  if (newStatus === 'cancelled') {
    await env.DB.prepare("UPDATE order_items SET status = 'cancelled' WHERE order_id = ? AND status != 'served'").bind(orderId).run();
    await notify(env, { audience: 'kitchen', type: 'order_cancelled', title: `Order ${order.order_number} cancelled`, body: opts.reason || '', link: '/kitchen' });
  }
  if (newStatus === 'completed') {
    await consumeInventoryForOrder(env, orderId, order.order_number, auth);
    if (order.payment_status === 'paid') await awardLoyaltyForOrder(env, order);
  }
  if (['confirmed', 'preparing', 'ready', 'collected', 'served', 'completed', 'cancelled'].includes(newStatus)) {
    await refreshTableStatus(env, order.table_id);
  }
  if (newStatus === 'ready' && order.customer_id) {
    await notify(env, {
      audience: 'customer', userId: order.customer_id, type: 'order_ready',
      title: `Order ${order.order_number} is ready`, body: 'Your order is ready for pickup or service.', link: `/track/${order.order_number}`,
    });
  }
  if (['preparing', 'ready', 'collected', 'served', 'completed'].includes(newStatus) && order.customer_id) {
    await notify(env, {
      audience: 'customer', userId: order.customer_id, type: 'order_status',
      title: `Order ${order.order_number} · ${newStatus.replace('_', ' ')}`, body: 'Track live progress from your account.', link: `/track/${order.order_number}`,
    });
  }

  await broadcast(env, {
    type: 'order', action: 'updated', orderId, orderNumber: order.order_number,
    status: newStatus, previousStatus: order.status, priority: order.priority,
  });

  return { order: await getOrderDetail(env, orderId) };
}

export async function updateItemStatus(env, auth, itemId, newStatus) {
  const item = await env.DB.prepare('SELECT oi.*, o.status AS order_status, o.order_number, o.priority, o.customer_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ?')
    .bind(itemId)
    .first();
  if (!item) return { error: 'Order item not found.', status: 404 };
  if (!['preparing', 'ready', 'served'].includes(newStatus)) return { error: 'Invalid item status.', status: 400 };
  if (['completed', 'cancelled'].includes(item.order_status)) return { error: 'This order is closed.', status: 409 };

  const ts = nowISO();
  const sets = ['status = ?'];
  const binds = [newStatus];
  if (newStatus === 'preparing') { sets.push('started_at = COALESCE(started_at, ?)'); binds.push(ts); }
  if (newStatus === 'ready') { sets.push('ready_at = ?'); binds.push(ts); }
  if (newStatus === 'served') { sets.push('served_at = ?'); binds.push(ts); }
  if (!item.assigned_staff_id && auth?.id) { sets.push('assigned_staff_id = ?'); binds.push(auth.id); }
  binds.push(itemId);
  await env.DB.prepare(`UPDATE order_items SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  let orderStatus = item.order_status;
  if (newStatus === 'preparing' && ['pending', 'confirmed'].includes(item.order_status)) {
    const upd = await env.DB.prepare(
      "UPDATE orders SET status = 'preparing', confirmed_at = COALESCE(confirmed_at, ?), prep_started_at = COALESCE(prep_started_at, ?), updated_at = ? WHERE id = ?"
    )
      .bind(ts, ts, ts, item.order_id)
      .run();
    orderStatus = 'preparing';
    await env.DB.prepare(
      'INSERT INTO order_status_history (order_id,status,note,actor_type,actor_id,actor_name,created_at) VALUES (?,?,?,?,?,?,?)'
    )
      .bind(item.order_id, 'preparing', 'Preparation started at station', 'staff', auth?.id || null, auth?.name || 'Kitchen', ts)
      .run();
  }
  if (newStatus === 'ready') {
    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status NOT IN ('ready','served','cancelled')"
    )
      .bind(item.order_id)
      .first();
    if (remaining?.n === 0 && ['pending', 'confirmed', 'preparing'].includes(orderStatus)) {
      await env.DB.prepare("UPDATE orders SET status = 'ready', ready_at = ?, updated_at = ? WHERE id = ?").bind(ts, ts, item.order_id).run();
      orderStatus = 'ready';
      await env.DB.prepare(
        'INSERT INTO order_status_history (order_id,status,note,actor_type,actor_id,actor_name,created_at) VALUES (?,?,?,?,?,?,?)'
      )
        .bind(item.order_id, 'ready', 'All items ready — awaiting collection', 'staff', auth?.id || null, auth?.name || 'Kitchen', ts)
        .run();
      if (item.customer_id) {
        await notify(env, {
          audience: 'customer', userId: item.customer_id, type: 'order_ready',
          title: `Order ${item.order_number} is ready`, body: 'All items are ready.', link: `/track/${item.order_number}`,
        });
      }
    }
  }
  await broadcast(env, {
    type: 'order', action: 'item_updated', orderId: item.order_id, orderNumber: item.order_number, itemId,
    itemStatus: newStatus, status: orderStatus, priority: item.priority,
  });
  return { item: await env.DB.prepare('SELECT * FROM order_items WHERE id = ?').bind(itemId).first(), orderStatus };
}

export async function consumeInventoryForOrder(env, orderId, number, auth) {
  const already = await env.DB.prepare(
    "SELECT id FROM inventory_movements WHERE reference_type = 'order' AND reference_id = ? AND type = 'consumption' LIMIT 1"
  )
    .bind(orderId)
    .first();
  if (already) return;
  const rows = await env.DB.prepare(
    `SELECT r.ingredient_id, SUM(r.quantity * oi.qty) AS qty, i.name, i.unit, i.stock_qty, i.min_stock
       FROM order_items oi
       JOIN recipes r ON r.menu_item_id = oi.menu_item_id
       JOIN ingredients i ON i.id = r.ingredient_id
      WHERE oi.order_id = ? AND oi.status != 'cancelled'
      GROUP BY r.ingredient_id`
  )
    .bind(orderId)
    .all();
  if (!rows.results.length) return;
  const stmts = [];
  for (const row of rows.results) {
    const qty = Math.round(row.qty * 1000) / 1000;
    stmts.push(
      env.DB.prepare('UPDATE ingredients SET stock_qty = MAX(0, stock_qty - ?), updated_at = ? WHERE id = ?').bind(qty, nowISO(), row.ingredient_id),
      env.DB.prepare(
        "INSERT INTO inventory_movements (ingredient_id,type,qty_change,reference_type,reference_id,note,created_by_type,created_by_id,created_at) VALUES (?,'consumption',?, 'order',?,?, 'staff',?,?)"
      ).bind(row.ingredient_id, -qty, orderId, `Consumed by ${number}`, auth?.id || null, nowISO())
    );
    if (Number(row.stock_qty) - qty <= Number(row.min_stock)) {
      stmts.push(
        env.DB.prepare("INSERT INTO notifications (audience,type,title,body,link) VALUES ('staff','inventory',?,?, '/admin/inventory')").bind(
          `${row.name} is low on stock`, `Order ${number} used ${qty}${row.unit}. Reorder soon.`
        )
      );
    }
  }
  await env.DB.batch(stmts);
}

export async function awardLoyaltyForOrder(env, order) {
  if (!order.customer_id) return;
  const settings = await getSettings(env);
  if (!settings.loyalty_enabled) return;
  const existing = await env.DB.prepare(
    "SELECT id FROM loyalty_transactions WHERE order_id = ? AND type = 'earn' LIMIT 1"
  )
    .bind(order.id)
    .first();
  if (existing) return;
  const points = Math.floor(Number(order.total) / 100) * Number(settings.loyalty_points_per_100 || 0);
  if (points <= 0) return;
  await env.DB.batch([
    env.DB.prepare('UPDATE customers SET loyalty_points = loyalty_points + ?, last_visit_at = ? WHERE id = ?').bind(points, nowISO(), order.customer_id),
    env.DB.prepare("INSERT INTO loyalty_transactions (customer_id,order_id,points,type,note,created_at) VALUES (?,?,?,'earn',?,?)").bind(
      order.customer_id, order.id, points, `Earned on ${order.order_number}`, nowISO()
    ),
  ]);
  await notify(env, {
    audience: 'customer', userId: order.customer_id, type: 'loyalty',
    title: `You earned ${points} loyalty points`,
    body: `Added to your account for ${order.order_number}.`, link: '/account',
  });
}

export async function recalcPaymentStatus(env, orderId) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return;
  const payments = await env.DB.prepare(
    "SELECT * FROM payments WHERE order_id = ? AND status IN ('paid','partially_refunded','refunded')"
  )
    .bind(orderId)
    .all();
  const netPaid = payments.results.reduce((s, p) => s + Number(p.amount) - Number(p.refunded_amount), 0);
  const anyRefund = payments.results.some((p) => Number(p.refunded_amount) > 0);
  let status = 'pending';
  if (netPaid >= Number(order.total) - 0.01) status = 'paid';
  else if (netPaid > 0) status = anyRefund ? 'partially_refunded' : 'pending';
  if (netPaid <= 0 && anyRefund) status = 'refunded';
  await env.DB.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?').bind(status, nowISO(), orderId).run();
  if (status === 'paid' && order.status === 'completed') {
    await awardLoyaltyForOrder(env, { ...order, payment_status: 'paid' });
  }
  return status;
}
