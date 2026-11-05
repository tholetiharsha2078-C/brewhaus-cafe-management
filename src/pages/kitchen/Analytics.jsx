import React, { useMemo, useState } from 'react';
import { useFetch } from '../../lib/store';
import { fmtDateTime, fmtTime, num, titleize, todayISO } from '../../lib/format';
import { KdsStat, KdsSelect } from './KdsShared';
import { BarChart3, CalendarDays, Clock, RefreshCw, Timer, TriangleAlert } from 'lucide-react';

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
}

const PRESETS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7 days', days: 6 },
  { key: '30d', label: '30 days', days: 29 },
];

export default function Analytics() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [preset, setPreset] = useState('today');

  const { data, loading, error, reload } = useFetch(`/kitchen/analytics?from=${from}&to=${to}`);
  const s = data?.summary || {};
  const stations = data?.stations || [];
  const topItems = data?.topItems || [];
  const peak = data?.peakHours || [];
  const cancellations = data?.cancellations || [];
  const staff = data?.staff || [];

  const maxStation = useMemo(() => Math.max(1, ...stations.map((x) => Number(x.items) || 0)), [stations]);
  const maxPeak = useMemo(() => Math.max(1, ...peak.map((x) => Number(x.orders) || 0)), [peak]);

  const apply = (p) => {
    setPreset(p.key);
    setTo(todayISO());
    setFrom(addDays(todayISO(), -p.days));
  };

  if (loading && !data) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: 340, color: '#8d877c' }}><div className="flex items-center gap-12"><span className="spinner" /> Crunching kitchen analytics…</div></div>;
  }
  if (error) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 300, textAlign: 'center' }}>
        <div><TriangleAlert size={26} style={{ color: '#e07868', marginBottom: 10 }} /><div style={{ marginBottom: 12 }}>{error.message}</div>
          <button className="kds-btn primary" style={{ flex: '0 0 auto' }} onClick={reload}><RefreshCw size={13} /> Retry</button></div>
      </div>
    );
  }

  return (
    <>
      <div className="between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 25 }}>Kitchen analytics</div>
          <div style={{ fontSize: 11.5, color: '#8d877c' }}>Prep speed, station throughput and staff performance from closed tickets.</div>
        </div>
        <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={reload}><RefreshCw size={13} /> Refresh</button>
      </div>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', background: '#1e1d1a', border: '1px solid #2c2a26', borderRadius: 10, padding: 10, marginBottom: 12 }}>
        <BarChart3 size={14} style={{ color: '#8d877c' }} />
        {PRESETS.map((p) => (
          <button key={p.key} className={`kds-btn ${preset === p.key ? 'primary' : ''}`} style={{ flex: '0 0 auto', height: 32 }} onClick={() => apply(p)}>{p.label}</button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a49b8d', marginLeft: 4 }}>
          <CalendarDays size={13} /> From
          <input type="date" value={from} max={to} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} style={dateStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a49b8d' }}>
          To
          <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} style={dateStyle} />
        </label>
      </div>

      <div className="kds-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KdsStat label="Tickets closed" value={num(s.processed)} />
        <KdsStat label="Completed" value={num(s.completed)} tone="good" />
        <KdsStat label="Cancelled" value={num(s.cancelled)} tone={Number(s.cancelled) ? 'bad' : ''} />
        <KdsStat label="Avg prep" value={`${Number(s.avgPrepMinutes || 0).toFixed(1)}m`} />
        <KdsStat label="On time" value={`${Number(s.onTimeRate || 0)}%`} tone={Number(s.onTimeRate) >= 80 ? 'good' : 'warn'} />
        <KdsStat label="Delayed" value={num(s.delayed)} tone={Number(s.delayed) ? 'warn' : ''} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Panel title="Station throughput" subtitle="Items prepared in this range">
          {stations.length ? stations.map((x) => (
            <div key={x.name} style={{ marginBottom: 11 }}>
              <div className="between" style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 3, background: x.color }} /> {x.name}</span>
                <span style={{ color: '#a49b8d' }}>{num(x.items)} items · {Number(x.avg_minutes || 0).toFixed(1)}m avg</span>
              </div>
              <div style={{ height: 7, background: '#2b2823', borderRadius: 8, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(Number(x.items) / maxStation) * 100}%`, background: x.color }} />
              </div>
            </div>
          )) : <Empty text="No station data for this range." />}
        </Panel>

        <Panel title="Peak hours" subtitle="Orders placed by hour of day">
          {peak.length ? peak.map((x) => (
            <div key={x.hour} style={{ display: 'grid', gridTemplateColumns: '46px 1fr 44px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, color: '#a49b8d' }}>{String(x.hour).padStart(2, '0')}:00</span>
              <div style={{ height: 7, background: '#2b2823', borderRadius: 8, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(Number(x.orders) / maxPeak) * 100}%`, background: '#d5a05f' }} />
              </div>
              <span style={{ fontSize: 10.5, textAlign: 'right', color: '#c9c1b4' }}>{num(x.orders)}</span>
            </div>
          )) : <Empty text="No orders in this range." />}
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12 }}>
        <Panel title="Most prepared items" subtitle="By quantity across non-cancelled tickets" noPad>
          {topItems.length ? (
            <table style={tableStyle}>
              <thead><tr>{['Item', 'Qty', 'Orders'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {topItems.map((item, i) => (
                  <tr key={item.name} style={{ borderBottom: '1px solid #242220' }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}><span style={{ color: '#d9a25f', marginRight: 7 }}>{i + 1}</span>{item.name}</td>
                    <td style={{ ...tdStyle, color: '#c9c1b4' }}>{num(item.qty)}</td>
                    <td style={{ ...tdStyle, color: '#a49b8d' }}>{num(item.orders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty text="No items prepared in this range." />}
        </Panel>

        <Panel title="Staff performance" subtitle="Assigned items and average item prep time" noPad>
          {staff.length ? (
            <table style={tableStyle}>
              <thead><tr>{['Staff', 'Station', 'Orders', 'Items', 'Avg'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {staff.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #242220' }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{u.name}<div style={{ fontSize: 9.5, color: '#8d877c', fontWeight: 400 }}>{titleize(u.role)}</div></td>
                    <td style={{ ...tdStyle, color: '#a49b8d' }}>{u.station_name || '—'}</td>
                    <td style={{ ...tdStyle, color: '#c9c1b4' }}>{num(u.orders_handled)}</td>
                    <td style={{ ...tdStyle, color: '#c9c1b4' }}>{num(u.items_completed)}</td>
                    <td style={{ ...tdStyle, color: '#a49b8d' }}>{Number(u.avg_minutes || 0).toFixed(1)}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty text="No kitchen staff records." />}
        </Panel>

        <Panel title="Cancelled tickets" subtitle="Reason and timing" noPad>
          {cancellations.length ? (
            <div style={{ maxHeight: 330, overflowY: 'auto' }}>
              {cancellations.map((c) => (
                <div key={`${c.order_number}-${c.cancelled_at}`} style={{ padding: '9px 14px', borderBottom: '1px solid #242220' }}>
                  <div className="between">
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{c.order_number}</span>
                    <span style={{ fontSize: 9.5, color: '#8d877c' }}>{c.cancelled_at ? fmtDateTime(c.cancelled_at) : '—'}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: '#e0a08f', marginTop: 2 }}>{c.cancel_reason || 'No reason recorded'}</div>
                  <div style={{ fontSize: 9.5, color: '#7f786c', marginTop: 1 }}>Placed {fmtTime(c.placed_at)}</div>
                </div>
              ))}
            </div>
          ) : <Empty text="No cancellations in this range." />}
        </Panel>
      </div>

      <div style={{ marginTop: 12, fontSize: 10.5, color: '#8d877c', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={12} /> On-time means the order was ready at or before its estimate. Prep time is measured from first item start to last item ready.
      </div>
    </>
  );
}

function Panel({ title, subtitle, children, noPad = false }) {
  return (
    <section style={{ background: '#1c1b18', border: '1px solid #2c2a26', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #2c2a26' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 10, color: '#8d877c', marginTop: 1 }}>{subtitle}</div>
      </div>
      <div style={{ padding: noPad ? 0 : 14 }}>{children}</div>
    </section>
  );
}

function Empty({ text }) {
  return <div className="kds-empty">{text}</div>;
}

const dateStyle = { height: 32, borderRadius: 8, border: '1px solid #37332c', background: '#191816', color: '#f2ede4', padding: '0 7px', fontSize: 11.5 };
const tableStyle = { width: '100%', borderCollapse: 'collapse' };
const thStyle = { textAlign: 'left', padding: '9px 14px', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.07em', color: '#8d877c', borderBottom: '1px solid #2c2a26' };
const tdStyle = { padding: '8px 14px', fontSize: 11.5 };
