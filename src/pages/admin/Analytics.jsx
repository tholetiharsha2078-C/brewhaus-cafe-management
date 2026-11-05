import React, { useMemo, useState } from 'react';
import {
  Award, BarChart3, Clock, Download, Percent, RefreshCw, Star, ThumbsDown, TrendingUp,
  Users, UtensilsCrossed, Wallet,
} from 'lucide-react';
import { qs } from '../../lib/api';
import { useFetch } from '../../lib/store';
import { AreaChart, BarChart, Donut } from '../../components/charts';
import { Badge, EmptyState, ErrorState, Loading, PageHeader, SectionCard, Stat, Tabs } from '../../components/ui';
import { addDaysISO, fmtDateShort, inr, num, titleize, todayISO } from '../../lib/format';

const PRESETS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7 days', days: 6 },
  { key: '30d', label: '30 days', days: 29 },
  { key: '90d', label: '90 days', days: 89 },
  { key: '365d', label: '12 months', days: 364 },
];

export default function Analytics() {
  const [from, setFrom] = useState(addDaysISO(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [preset, setPreset] = useState('30d');
  const [tab, setTab] = useState('items');

  const path = useMemo(() => `/admin/analytics${qs({ from, to })}`, [from, to]);
  const { data, loading, error, reload } = useFetch(path);

  const applyPreset = (p) => {
    setPreset(p.key);
    setTo(todayISO());
    setFrom(addDaysISO(todayISO(), -p.days));
  };

  if (loading && !data) return <Loading label="Crunching analytics…" minHeight={420} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const m = data.metrics || {};
  const best = data.bestSellers || [];
  const least = data.leastSellers || [];
  const peak = (data.peakHours || []).map((h) => ({ label: `${h.hour}:00`, value: Number(h.orders), revenue: Number(h.revenue || 0) }));
  const daily = (data.daily || []).map((d) => ({ ...d, label: fmtDateShort(d.day) }));
  const monthly = (data.monthly || []).map((d) => ({ label: d.month, value: Number(d.revenue), orders: d.orders }));
  const reservationTrend = (data.reservationTrend || []).map((r) => ({ label: fmtDateShort(r.day), value: Number(r.bookings), cancelled: r.cancelled, no_shows: r.no_shows }));
  const retention = data.retention || {};
  const completed = Number(m.served) || 0;

  const downloads = [
    ['orders', 'Orders'],
    ['payments', 'Payments'],
    ['items', 'Menu items'],
    ['customers', 'Customers'],
    ['inventory', 'Inventory'],
  ];

  return (
    <>
      <PageHeader title="Analytics & Reports" description="Item performance, peak hours, trends, retention and reservation behaviour — all queried from D1 for the selected range.">
        <div className="flex gap-4 wrap">
          {downloads.slice(0, 3).map(([type, label]) => (
            <a key={type} className="btn btn-secondary btn-sm" href={`/api/admin/export${qs({ type, from, to })}`} target="_blank" rel="noreferrer">
              <Download size={13} /> {label} CSV
            </a>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      <div className="card card-pad" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="flex items-center gap-12 wrap">
          <BarChart3 size={15} className="muted" />
          {PRESETS.map((p) => (
            <button key={p.key} className={`btn btn-sm ${preset === p.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
          <label className="small muted" style={{ marginLeft: 6 }}>From</label>
          <input type="date" className="input" style={{ width: 148, height: 34 }} value={from} max={to} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} />
          <label className="small muted">To</label>
          <input type="date" className="input" style={{ width: 148, height: 34 }} value={to} min={from} max={todayISO()} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} />
          <div className="flex gap-4 wrap" style={{ marginLeft: 'auto' }}>
            {downloads.slice(3).map(([type, label]) => (
              <a key={type} className="btn btn-ghost btn-xs" href={`/api/admin/export${qs({ type, from, to })}`} target="_blank" rel="noreferrer"><Download size={11} /> {label}</a>
            ))}
          </div>
        </div>
      </div>

      <div className="grid g6" style={{ marginBottom: 16 }}>
        <Stat label="Orders" icon={BarChart3} value={num(m.orders)} meta={`${num(completed)} served or completed`} />
        <Stat label="Order revenue" icon={Wallet} tone="accent" value={inr(m.revenue)} meta="Gross order value" />
        <Stat label="Average order" icon={TrendingUp} tone="green" value={inr(m.aov)} meta="AOV for this range" />
        <Stat label="Completion rate" icon={Percent} tone="blue" value={`${Number(m.completionRate) || 0}%`} meta={`${num(m.cancelled)} cancelled`} />
        <Stat label="Avg prep time" icon={Clock} tone="amber" value={`${Number(m.avgPrepMinutes) || 0} min`} meta={m.avg_service_minutes ? `${Number(m.avg_service_minutes).toFixed(0)} min table-to-serve` : 'From kitchen timestamps'} />
        <Stat label="Guest rating" icon={Star} tone="green" value={Number(m.avgRating) || 0} meta={`${num(retention.reviews)} approved reviews`} />
      </div>

      <div className="split-2" style={{ marginBottom: 16 }}>
        <SectionCard
          title="Daily performance"
          subtitle="Orders placed and revenue per day"
          action={<Badge tone="accent">{num(daily.reduce((a, d) => a + Number(d.orders || 0), 0))} orders</Badge>}
        >
          <AreaChart data={daily} valueKey="revenue" height={230} xLabel={(d) => fmtDateShort(d.day)} empty="No orders in this range" />
        </SectionCard>
        <SectionCard title="Peak hours" subtitle="Orders placed by hour of day (IST)">
          {peak.length ? (
            <BarChart data={peak} valueKey="value" height={200} format={(v) => `${num(v)} orders`} color="#9a5b2f" />
          ) : <EmptyState icon={Clock} title="No hourly data" description="Orders in this range will reveal your busy periods." />}
          <div className="divider" />
          <div className="between small muted">
            <span>Busiest hour</span>
            <strong style={{ color: 'var(--ink)' }}>{peak.length ? peak.reduce((a, b) => (b.value > a.value ? b : a)).label : '—'}</strong>
          </div>
        </SectionCard>
      </div>

      <div className="split-2" style={{ marginBottom: 16 }}>
        <SectionCard title="Retention snapshot" subtitle="Repeat behaviour and member activity in this range">
          <Donut
            segments={[
              { label: 'Repeat customers', value: Number(retention.repeat_customers) || 0, color: '#3d6a50' },
              { label: 'One-time customers', value: Math.max(0, (Number(retention.total_customers) || 0) - (Number(retention.repeat_customers) || 0)), color: '#d8cbb8' },
            ]}
            centerLabel="repeat rate"
            centerValue={`${Number(m.repeatRate) || 0}%`}
            format={(v) => num(v)}
          />
          <div className="divider" />
          <div className="grid g2" style={{ gap: 8 }}>
            <div className="kv"><dt>Active members</dt><dd>{num(retention.active_members)}</dd></div>
            <div className="kv"><dt>Total customers</dt><dd>{num(retention.total_customers)}</dd></div>
            <div className="kv"><dt>Approved reviews</dt><dd>{num(retention.reviews)}</dd></div>
            <div className="kv"><dt>Average rating</dt><dd>{Number(retention.avg_rating || 0).toFixed(1)} / 5</dd></div>
          </div>
        </SectionCard>

        <SectionCard title="Monthly revenue" subtitle="Trailing 12 months of order value">
          <AreaChart data={monthly} valueKey="value" height={230} xLabel={(d) => d.month} empty="No monthly history yet" />
        </SectionCard>
      </div>

      <Tabs
        tabs={[
          { key: 'items', label: 'Item performance', count: best.length },
          { key: 'reservations', label: 'Reservation trends', count: reservationTrend.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div style={{ marginTop: 14 }}>
        {tab === 'items' && (
          <div className="split-2">
            <SectionCard title="Best sellers" subtitle="Completed orders in this range" noPad>
              {best.length ? (
                <div className="table-wrap">
                  <table className="tbl compact">
                    <thead><tr><th>Item</th><th>Qty sold</th><th>Orders</th><th className="right">Revenue</th></tr></thead>
                    <tbody>
                      {best.map((item, i) => (
                        <tr key={item.name}>
                          <td className="primary-cell"><span className="flex items-center gap-8"><Badge tone={i === 0 ? 'green' : ''}>{i + 1}</Badge>{item.name}</span></td>
                          <td className="num">{num(item.qty)}</td>
                          <td className="num">{num(item.orders)}</td>
                          <td className="right num strong">{inr(item.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon={Award} title="No completed sales" description="Complete orders to build item performance data." />}
            </SectionCard>

            <SectionCard title="Lowest sellers" subtitle="Items with the fewest completed sales" noPad>
              {least.length ? (
                <div className="table-wrap">
                  <table className="tbl compact">
                    <thead><tr><th>Item</th><th>Qty sold</th><th>Orders</th><th className="right">Revenue</th></tr></thead>
                    <tbody>
                      {least.map((item) => (
                        <tr key={item.name}>
                          <td className="primary-cell">{item.name}</td>
                          <td className="num">{num(item.qty)}</td>
                          <td className="num">{num(item.orders)}</td>
                          <td className="right num">{inr(item.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon={ThumbsDown} title="No item data" description="Sales data appears after orders are completed." />}
            </SectionCard>
          </div>
        )}

        {tab === 'reservations' && (
          <SectionCard title="Reservation trends" subtitle="Bookings, cancellations and no-shows by date" noPad>
            {reservationTrend.length ? (
              <>
                <div style={{ padding: '16px 20px 4px' }}>
                  <BarChart data={reservationTrend.slice(-21)} valueKey="value" height={180} format={(v) => `${num(v)} bookings`} color="#3d5e76" />
                </div>
                <div className="table-wrap">
                  <table className="tbl compact">
                    <thead><tr><th>Date</th><th>Bookings</th><th>Cancelled</th><th>No-shows</th><th>Completion</th></tr></thead>
                    <tbody>
                      {reservationTrend.map((r) => {
                        const done = Math.max(0, Number(r.value) - Number(r.cancelled) - Number(r.no_shows));
                        return (
                          <tr key={r.label}>
                            <td className="primary-cell">{r.label}</td>
                            <td className="num">{num(r.value)}</td>
                            <td className="num">{num(r.cancelled)}</td>
                            <td className="num">{num(r.no_shows)}</td>
                            <td><Badge tone={done === Number(r.value) ? 'green' : done > 0 ? 'amber' : 'red'}>{done} / {r.value}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <EmptyState icon={Users} title="No reservations in range" description="Reservation behaviour appears once bookings exist." />}
          </SectionCard>
        )}
      </div>
    </>
  );
}
