export const TZ = 'Asia/Kolkata';

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrFmt2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat('en-IN');

export function inr(value, { decimals = false } = {}) {
  const n = Number(value) || 0;
  return decimals ? inrFmt2.format(n) : inrFmt.format(Math.round(n));
}

export function inrExact(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? inrFmt.format(n) : inrFmt2.format(n);
}

export function num(value) {
  return numFmt.format(Number(value) || 0);
}

export function compact(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return inr(n);
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00+05:30`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return new Date(`${value}:00+05:30`);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value, opts = {}) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: opts.year === false ? undefined : 'numeric' });
}

export function fmtDateShort(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short' });
}

export function fmtWeekday(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
}

export function fmtDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}`;
}

export function timeAgo(value) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 45) return 'just now';
  if (diff < 90) return 'a minute ago';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  return fmtDate(d, { year: false });
}

export function todayISO() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export function addDaysISO(date, days) {
  const d = new Date(`${date}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export function elapsed(startISO) {
  if (!startISO) return 0;
  const start = new Date(startISO).getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

export function duration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

export function mmss(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function titleize(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const STATUS_TONE = {
  pending: 'amber',
  confirmed: 'blue',
  preparing: 'accent',
  ready: 'green',
  collected: 'purple',
  served: 'green',
  completed: 'green',
  cancelled: 'red',
  on_hold: 'red',
  paid: 'green',
  failed: 'red',
  refunded: 'purple',
  partially_refunded: 'amber',
  seated: 'blue',
  no_show: 'red',
  available: 'green',
  reserved: 'amber',
  occupied: 'accent',
  cleaning: 'blue',
  out_of_service: 'red',
  open: 'amber',
  acknowledged: 'blue',
  resolved: 'green',
  approved: 'green',
  rejected: 'red',
  veg: 'green',
  vegan: 'green',
  non_veg: 'red',
  egg: 'amber',
  earn: 'green',
  redeem: 'amber',
  adjust: 'blue',
};

export function toneFor(status) {
  return STATUS_TONE[String(status || '').toLowerCase()] || '';
}

export const DIETARY_LABEL = { veg: 'Vegetarian', vegan: 'Vegan', non_veg: 'Non-veg', egg: 'Contains egg' };

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function pct(value, total) {
  if (!total) return 0;
  return Math.round((Number(value) / Number(total)) * 1000) / 10;
}
