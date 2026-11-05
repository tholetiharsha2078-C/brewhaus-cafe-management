import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CalendarDays, ClipboardList, CreditCard, IndianRupee, Package,
  RefreshCw, TrendingDown, TrendingUp, Users, Armchair,
} from 'lucide-react';
import { get, qs } from '../../lib/api';
import { useFetch, useRealtime } from '../../lib/store';
import { AreaChart, BarChart, Donut } from '../../components/charts';
import {
  Badge, ErrorState, Loading, PageHeader, SectionCard, Stat, StatusBadge,
} from '../../components/ui';
import { addDaysISO, compact, fmtDate, fmtDateShort, fmtTime, inr, num, pct, todayISO } from '../../lib/format';

const PRESETS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7 days', days: 6 },
  { key: '30d', label: '30 days', days: 29 },
  { key: '90d', label: '90 days', days: 89 },
];

const STATUS_COLORS = {
  pending: '#9a6b12', confirmed: '#3d5e76', preparing: '#9a5b2f', ready: '#3d6a50',
  collected: '#6a5478', served: '#4f7a56', completed: '#3d6a50', cancelled: '#a33f3a', on_hold: '#a33f3a',
};

export default function Dashboard() {
  const [preset, setPreset] = useState('30d');
  const [from, setFrom] = useState(addDaysISO(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [series, setSeries] = useState('daily');

  const path = useMemo(() => `/admin/dashboard${qs({ from, to })}`, [from, to]);
  const { data, loading, error, reload } = useFetch(path);

  useRealtime((event) => {
    if (event?.type === 'order' || event?.type === 'payment' || event?.type === 'reservation') reload();
  });

  const applyPreset = (p) => {
    setPreset(p.key);
    const end = todayISO();
    setFrom(addDaysISO(end, -p.days));
    setTo(end);
  };

  if (loading && !data) return <Loading label="Loading live dashboard…" minHeight={480} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const s = data.summary || {};
  const daily = data.revenueSeries?.daily || [];
  const weekly = data.revenueSeries?.weekly || [];
  const monthly = data.revenueSeries?.monthly || [];
  const seriesData = series === 'daily' ? daily : series === 'weekly' ? weekly : monthly;
  const chartData = seriesData.map((d) => ({ ...d, label: d.label || fmtDateShort(d.day) }));
  const statuses = data.orderStatus || [];
  const totalOrders = statuses.reduce((sum, x) => sum + x.count, 0);
  const donut = statuses.map((x) => ({ label: x.status.replace(/_/g, ' '), value: x.count, color: STATUS_COLORS[x.status] || '#b9ad9f' }));
  const delta = Number(s.revenueDelta) || 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Every figure below is calculated from live D1 records — orders, reservations, payments and stock."
      >
        <div className="flex gap-4 wrap">
          {PRESETS.map((p) => (
            <button key={p.key} className={`btn btn-sm ${preset === p.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      <div className="card card-pad" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="flex items-center gap-12 wrap">
          <CalendarDays size={15} className="muted" />
          <label className="small muted">From</label>
          <input type="date" className="input" style={{ width: 155, height: 34 }} value={from} max={to} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} />
          <label className="small muted">To</label>
          <input type="date" className="input" style={{ width: 155, height: 34 }} value={to} min={from} max={todayISO()} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} />
          <span className="small muted" style={{ marginLeft: 'auto' }}>
            {s.revenue_range != null ? <>Revenue in range: <strong style={{ color: 'var(--ink)' }}>{inr(s.revenue_range)}</strong></> : null}
          </span>
        </div>
      </div>

      <div className="grid g6" style={{ marginBottom: 16 }}>
        <Stat
          label="Today’s Reservations" tone="blue" icon={CalendarDays}
          value={num(s.today_reservations)}
          meta={<span>{s.today_reservations ? 'Upcoming & seated today' : 'None booked yet'}</span>}
        />
        <Stat
          label="Today’s Revenue" tone="accent" icon={IndianRupee}
          value={inr(s.today_revenue)}
          meta={(
            <span className={delta >= 0 ? 'trend-up' : 'trend-down'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {inr(Math.abs(delta))} vs yesterday
            </span>
          )}
        />
        <Stat
          label="Active Orders" tone="amber" icon={ClipboardList}
          value={num(s.active_orders)}
          meta={<span>{num(s.today_orders)} placed today</span>}
        />
        <Stat
          label="Customers Served" icon={Users} tone="green"
          value={num(s.customers_served)}
          meta={<span>Distinct guests served today</span>}
        />
        <Stat
          label="Available Tables" icon={Armchair}
          value={`${num(s.available_tables)} / ${num(s.total_tables)}`}
          meta={<span>{num(s.total_tables - s.available_tables)} in service or blocked</span>}
        />
        <Stat
          label="Low Stock Alerts" tone="red" icon={AlertTriangle}
          value={num(s.low_stock)}
          meta={<span>{s.openAvailabilityReports ? `${s.openAvailabilityReports} kitchen issue(s) open` : 'Ingredients below minimum'}</span>}
        />
      </div>

      <div className="split-2" style={{ marginBottom: 16 }}>
        <SectionCard
          title="Revenue"
          subtitle="Net of refunds, from verified payment records"
          action={(
            <div className="flex gap-4">
              {[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([key, label]) => (
                <button key={key} className={`btn btn-xs ${series === key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSeries(key)}>{label}</button>
              ))}
            </div>
          )}
        >
          <div className="between" style={{ marginBottom: 6 }}>
            <div>
              <div className="stat-value serif" style={{ marginTop: 0 }}>{inr(seriesData.reduce((sum, d) => sum + (Number(d.value) || 0), 0))}</div>
              <div className="tiny muted">{series === 'daily' ? `${daily.length} days` : series === 'weekly' ? `${weekly.length} weeks` : `${monthly.length} months`} · net revenue</div>
            </div>
            <Badge tone="accent">{seriesData.reduce((sum, d) => sum + (Number(d.orders) || 0), 0)} payments</Badge>
          </div>
          <AreaChart
            data={chartData}
            valueKey="value"
            height={240}
            labelFor={(d) => d.label}
            label={undefined}
          />
        </SectionCard>

        <SectionCard title="Order status distribution" subtitle={totalOrders ? `${totalOrders} orders in this range` : 'No orders in this range'}>
          <Donut
            segments={donut}
            centerLabel="orders"
            centerValue={num(totalOrders)}
            format={(v) => num(v)}
          />
          <div className="divider" />
          <div className="grid g2" style={{ gap: 8 }}>
            <div className="kv"><dt>Avg. order</dt><dd>{inr(totalOrders ? (data.recentOrders || []).reduce((a, o) => a + Number(o.total), 0) / Math.max(1, data.recentOrders.length) : 0)}</dd></div>
            <div className="kv"><dt>Cancelled</dt><dd>{num(s.cancelled_range)}</dd></div>
          </div>
        </SectionCard>
      </div>

      <div className="split-2" style={{ marginBottom: 16 }}>
        <SectionCard
          title="Upcoming reservations"
          subtitle="Pending and confirmed bookings"
          noPad
          action={<Link className="section-link" to="/admin/reservations">All reservations <ArrowRight size={13} /></Link>}
        >
          {data.upcomingReservations?.length ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Guest</th><th>Date</th><th>Time</th><th>Party</th><th>Table</th><th>Status</th></tr></thead>
                <tbody>
                  {data.upcomingReservations.map((r) => (
                    <tr key={r.id}>
                      <td className="primary-cell">{r.guest_name}<div className="sub-cell">{r.reference}</div></td>
                      <td>{fmtDate(r.reservation_date)}</td>
                      <td className="num">{fmtTime(`${r.reservation_date}T${r.reservation_time}`)}</td>
                      <td>{r.party_size}</td>
                      <td>{r.table_label || '—'}</td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty"><CalendarDays size={20} style={{ marginBottom: 8 }} /><div className="small muted">No upcoming reservations</div></div>}
        </SectionCard>

        <SectionCard title="Recent orders" subtitle="Latest activity across all channels" noPad action={<Link className="section-link" to="/admin/orders">All orders <ArrowRight size={13} /></Link>}>
          <div style={{ padding: '4px 0' }}>
            {data.recentOrders?.length ? data.recentOrders.map((o) => (
              <Link key={o.id} to={`/admin/orders?open=${o.id}`} style={{ display: 'flex', gap: 12, padding: '11px 20px', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--muted)' }}>
                  {o.table_label || (o.type === 'takeaway' ? 'TA' : 'PO')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="between" style={{ gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{o.order_number}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{inr(o.total)}</span>
                  </div>
                  <div className="between" style={{ gap: 8, marginTop: 2 }}>
                    <span className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customer_name || 'Guest'} · {o.item_count ? `${o.item_count} items` : o.type}</span>
                    <StatusBadge status={o.status} />
                  </div>
                </div>
              </Link>
            )) : <div className="empty"><ClipboardList size={20} style={{ marginBottom: 8 }} /><div className="small muted">No orders yet</div></div>}
          </div>
        </SectionCard>
      </div>

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <SectionCard title="Best-selling items" subtitle="Completed orders in this range">
          {data.bestSellers?.length ? (
            <BarChart
              horizontal
              data={data.bestSellers.map((b) => ({ label: b.name, value: b.qty }))}
              format={(v) => `${num(v)} sold`}
            />
          ) : <div className="empty" style={{ padding: '24px 0' }}><div className="small muted">No completed sales in this range</div></div>}
        </SectionCard>

        <SectionCard title="Recent payments" subtitle="Recorded and verified only" noPad>
          {data.recentPayments?.length ? (
            <div>
              {data.recentPayments.map((p) => (
                <div key={p.id} className="between" style={{ padding: '10px 20px', borderBottom: '1px solid var(--line)', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }} className="code">{p.transaction_ref}</div>
                    <div className="tiny muted">{p.order_number || 'No order'} · {p.method?.toUpperCase()} · {p.paid_at ? fmtDateShort(p.paid_at) : 'pending'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{inr(p.amount - p.refunded_amount)}</div>
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="empty"><CreditCard size={20} style={{ marginBottom: 8 }} /><div className="small muted">No payments yet</div></div>}
        </SectionCard>

        <SectionCard
          title="Inventory alerts"
          subtitle="At or below minimum stock"
          action={<Link className="section-link" to="/admin/inventory">Manage <ArrowRight size={13} /></Link>}
        >
          {data.inventoryAlerts?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.inventoryAlerts.map((i) => {
                const ratio = i.min_stock ? Math.min(100, (Number(i.stock_qty) / Number(i.min_stock)) * 100) : 0;
                return (
                  <div key={i.id}>
                    <div className="between" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{i.name}</span>
                      <span className="tiny" style={{ color: 'var(--red)', fontWeight: 600 }}>{Number(i.stock_qty).toFixed(0)}{i.unit} / {Number(i.min_stock).toFixed(0)}{i.unit}</span>
                    </div>
                    <div className="progress" style={{ height: 5 }}>
                      <span style={{ width: `${ratio}%`, background: ratio < 40 ? 'var(--red)' : 'var(--amber)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div className="empty" style={{ padding: '24px 0' }}><Package size={20} style={{ marginBottom: 8 }} /><div className="small muted">All stock above minimum</div></div>}
        </SectionCard>
      </div>

      <SectionCard
        title="Customer activity"
        subtitle="Members with recorded visits"
        action={<Link className="section-link" to="/admin/customers">Customer database <ArrowRight size={13} /></Link>}
      >
        <div className="grid g4" style={{ gap: 12, marginBottom: 14 }}>
          <div className="card card-pad" style={{ padding: 13 }}>
            <div className="tiny muted">New customers (range)</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{num(s.newCustomers)}</div>
          </div>
          <div className="card card-pad" style={{ padding: 13 }}>
            <div className="tiny muted">Repeat customers</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{num(s.repeatCustomers)}</div>
          </div>
          <div className="card card-pad" style={{ padding: 13 }}>
            <div className="tiny muted">Total customers</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{num((data.customerActivity?.recentCustomers || []).length ? data.customerActivity.recentCustomers.length + s.repeatCustomers : s.repeatCustomers)}</div>
          </div>
          <div className="card card-pad" style={{ padding: 13 }}>
            <div className="tiny muted">Repeat rate</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{pct(s.repeatCustomers, s.repeatCustomers || 1)}%</div>
          </div>
        </div>
        <div className="table-wrap card" style={{ border: '1px solid var(--line)' }}>
          <table className="tbl compact">
            <thead><tr><th>Customer</th><th>Joined</th><th>Last visit</th><th>Orders</th><th className="right">Lifetime spend</th></tr></thead>
            <tbody>
              {(data.customerActivity?.recentCustomers || []).map((c) => (
                <tr key={c.id}>
                  <td className="primary-cell">{c.name}<div className="sub-cell">{c.email}</div></td>
                  <td>{fmtDate(c.created_at)}</td>
                  <td>{c.last_visit_at ? fmtDate(c.last_visit_at) : '—'}</td>
                  <td className="num">{c.orders_count}</td>
                  <td className="right num">{inr(c.spend)}</td>
                </tr>
              ))}
              {!(data.customerActivity?.recentCustomers || []).length && (
                <tr><td colSpan={5}><div className="empty" style={{ padding: 22 }}><div className="small muted">No customer activity yet</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}
