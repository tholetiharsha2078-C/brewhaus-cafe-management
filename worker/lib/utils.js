// Shared server helpers: timezone-aware dates, money, validation, audit, events.

export const TZ = 'Asia/Kolkata';
const OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function nowISO() {
  return new Date().toISOString();
}

export function istDateStr(d = new Date()) {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function istTimeStr(d = new Date()) {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

export function istDayStart(dateStr) {
  return new Date(`${dateStr}T00:00:00+05:30`).toISOString();
}

export function istDayEnd(dateStr) {
  return new Date(`${dateStr}T23:59:59.999+05:30`).toISOString();
}

export function istDateTimeISO(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00+05:30`).toISOString();
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + days);
  return istDateStr(d);
}

export function money(n) {
  const v = Number(n) || 0;
  return Math.round(v * 100) / 100;
}

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function int(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function clean(value, max = 2000) {
  if (value == null) return '';
  return String(value).trim().slice(0, max);
}

export function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function pagination(c, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, int(c.req.query('page'), 1));
  const limit = Math.min(maxLimit, Math.max(1, int(c.req.query('limit'), defaultLimit)));
  return { page, limit, offset: (page - 1) * limit };
}

export function csvResponse(filename, rows, columns) {
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((col) => escape(col.label)).join(',');
  const body = rows.map((row) => columns.map((col) => escape(row[col.key])).join(',')).join('\n');
  return new Response(`${header}\n${body}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function audit(env, auth, action, entity, entityId, meta, ip) {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, entity, entity_id, meta, ip) VALUES (?,?,?,?,?,?,?,?)'
    )
      .bind(
        auth?.type || 'system',
        auth?.id || null,
        auth?.name || 'System',
        action,
        entity || null,
        entityId == null ? null : String(entityId),
        meta ? JSON.stringify(meta) : null,
        ip || null
      )
      .run();
  } catch {
    /* audit logging must never break the request */
  }
}

export async function notify(env, { audience, userId = null, type, title, body = null, link = null }) {
  try {
    await env.DB.prepare(
      'INSERT INTO notifications (audience, user_id, type, title, body, link) VALUES (?,?,?,?,?,?)'
    )
      .bind(audience, userId, type, title, body, link)
      .run();
  } catch {
    /* non-critical */
  }
}

export async function broadcast(env, payload) {
  try {
    const id = env.HUB.idFromName('global');
    await env.HUB.get(id).fetch('https://hub/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch {
    /* realtime is best-effort; clients also poll */
  }
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function errorsToMessage(errors) {
  return Object.entries(errors)
    .map(([field, msg]) => `${field}: ${msg}`)
    .join(', ');
}

export function validate(body, rules) {
  const errors = {};
  for (const [field, rule] of Object.entries(rules)) {
    const value = body?.[field];
    if (rule.required && (value == null || String(value).trim() === '')) {
      errors[field] = 'is required';
      continue;
    }
    if (value == null || value === '') continue;
    if (rule.type === 'number' && !Number.isFinite(Number(value))) errors[field] = 'must be a number';
    if (rule.min != null && Number(value) < rule.min) errors[field] = `must be at least ${rule.min}`;
    if (rule.max != null && Number(value) > rule.max) errors[field] = `must be at most ${rule.max}`;
    if (rule.maxLength && String(value).length > rule.maxLength) errors[field] = `must be under ${rule.maxLength} characters`;
    if (rule.enum && !rule.enum.includes(value)) errors[field] = 'has an invalid value';
    if (rule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors[field] = 'must be a valid email';
    if (rule.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) errors[field] = 'must be a valid date';
    if (rule.time && !/^\d{2}:\d{2}$/.test(String(value))) errors[field] = 'must be a valid time';
  }
  return errors;
}

export function orderNumber(id) {
  return `ORD-${1000 + Number(id)}`;
}
