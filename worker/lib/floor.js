// Floor plan + table availability. Shared by management, customer, and reservations.
import { istDateStr, istDayStart } from './utils.js';

export function minutesOf(time) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export async function getFloorPlan(env, { date, time, party = 1, includeDetails = false } = {}) {
  const plan = await env.DB.prepare('SELECT * FROM floor_plans WHERE active = 1 ORDER BY id LIMIT 1').first();
  if (!plan) return { plan: null, tables: [] };
  const today = istDateStr();
  const selectedDate = date || today;
  const selectedTime = time || '19:00';
  const now = new Date().toISOString();

  const [tablesRes, resRes, holdsRes, ordersRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM cafe_tables WHERE floor_plan_id = ? ORDER BY label').bind(plan.id).all(),
    env.DB.prepare(
      "SELECT * FROM reservations WHERE reservation_date = ? AND table_id IS NOT NULL AND status IN ('pending','confirmed','seated') ORDER BY reservation_time"
    )
      .bind(selectedDate)
      .all(),
    env.DB.prepare('SELECT * FROM table_holds WHERE slot_date = ? AND expires_at > ?').bind(selectedDate, now).all(),
    selectedDate === today
      ? env.DB.prepare(
          `SELECT o.*, c.name AS customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
            WHERE date(placed_at) = ? AND o.table_id IS NOT NULL
              AND o.status IN ('pending','confirmed','preparing','ready','collected','served')`
        )
          .bind(today)
          .all()
      : Promise.resolve({ results: [] }),
  ]);

  const slot = 90;
  const tables = tablesRes.results.map((table) => {
    const conflicts = resRes.results.filter(
      (r) => r.table_id === table.id && Math.abs(minutesOf(r.reservation_time) - minutesOf(selectedTime)) < slot
    );
    const holds = holdsRes.results.filter((h) => h.table_id === table.id);
    const activeOrder = ordersRes.results.find((o) => o.table_id === table.id);
    const tooSmall = Number(table.capacity) < Number(party);
    const manualBlock = ['out_of_service', 'cleaning'].includes(table.status);
    const available = !tooSmall && !manualBlock && conflicts.length === 0 && holds.length === 0 && !activeOrder;

    let visual = 'available';
    if (table.status === 'out_of_service') visual = 'out_of_service';
    else if (activeOrder) visual = 'occupied';
    else if (conflicts.length) visual = 'reserved';
    else if (holds.length) visual = 'held';
    else if (table.status === 'cleaning') visual = 'cleaning';

    const upcoming = conflicts[0] || null;
    return {
      id: table.id,
      label: table.label,
      capacity: table.capacity,
      x: table.x,
      y: table.y,
      width: table.width,
      height: table.height,
      shape: table.shape,
      zone: table.zone,
      status: table.status,
      visual,
      available,
      tooSmall,
      holdExpiresAt: holds[0]?.expires_at || null,
      reservation: includeDetails && upcoming
        ? {
            id: upcoming.id,
            reference: upcoming.reference,
            guestName: upcoming.guest_name,
            phone: upcoming.phone,
            partySize: upcoming.party_size,
            time: upcoming.reservation_time,
            status: upcoming.status,
            specialRequests: upcoming.special_requests,
          }
        : upcoming
          ? { time: upcoming.reservation_time, status: upcoming.status, partySize: upcoming.party_size }
          : null,
      activeOrder: includeDetails && activeOrder
        ? {
            id: activeOrder.id,
            number: activeOrder.order_number,
            status: activeOrder.status,
            total: activeOrder.total,
            guestName: activeOrder.customer_name || activeOrder.guest_name,
            placedAt: activeOrder.placed_at,
          }
        : activeOrder
          ? { number: activeOrder.order_number, status: activeOrder.status }
          : null,
    };
  });

  return {
    plan: { id: plan.id, name: plan.name, width: plan.width, height: plan.height },
    date: selectedDate,
    time: selectedTime,
    party,
    tables,
  };
}

export async function createHold(env, { tableId, date, time, party, minutes = 10 }) {
  const now = new Date();
  await env.DB.prepare('DELETE FROM table_holds WHERE expires_at < ?').bind(now.toISOString()).run();
  const plan = await getFloorPlan(env, { date, time, party });
  const table = plan.tables.find((t) => t.id === Number(tableId));
  if (!table) return { error: 'Table not found.', status: 404 };
  if (table.tooSmall) return { error: `That table seats up to ${table.capacity} guests.`, status: 409 };
  if (!table.available) return { error: 'That table is no longer available for this slot.', status: 409 };
  const token = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + minutes * 60000).toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO table_holds (id,table_id,slot_date,slot_time,party_size,token,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)'
  )
    .bind(crypto.randomUUID(), tableId, date, time, party, token, expiresAt, now.toISOString())
    .run();
  if (res.meta.changes === 0) return { error: 'That table was just taken. Please pick another.', status: 409 };
  return { token, expiresAt, tableId: Number(tableId), date, time, party };
}

export async function tableForSlot(env, tableId, date, time, slot, excludeReference = null) {
  const table = await env.DB.prepare('SELECT * FROM cafe_tables WHERE id = ?').bind(tableId).first();
  if (!table) return { error: 'Table not found.', status: 404 };
  if (table.status === 'out_of_service') return { error: 'That table is out of service.', status: 409 };
  const rows = await env.DB.prepare(
    "SELECT reference, reservation_time FROM reservations WHERE table_id = ? AND reservation_date = ? AND status IN ('pending','confirmed','seated')"
  )
    .bind(tableId, date)
    .all();
  const conflict = rows.results.find(
    (r) => r.reference !== excludeReference && Math.abs(minutesOf(r.reservation_time) - minutesOf(time)) < slot
  );
  if (conflict) return { error: `That table is already booked around ${conflict.reservation_time}.`, status: 409 };
  const hold = await env.DB.prepare(
    'SELECT token FROM table_holds WHERE table_id = ? AND slot_date = ? AND expires_at > ?'
  )
    .bind(tableId, date, new Date().toISOString())
    .all();
  const holdConflict = hold.results.some(() => true);
  return { table, holdConflict };
}

export async function activeTablesToday(env) {
  return env.DB.prepare(
    "SELECT table_id FROM orders WHERE date(placed_at) = ? AND table_id IS NOT NULL AND status IN ('confirmed','preparing','ready','collected','served')"
  )
    .bind(istDateStr())
    .all();
}

export { istDayStart };
