import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Crown, HeartHandshake, RefreshCw, Repeat, Sparkles, UserPlus, Users, Wallet,
} from 'lucide-react';
import { qs } from '../../lib/api';
import { useFetch } from '../../lib/store';
import { AreaChart, BarChart, Donut } from '../../components/charts';
import { Badge, EmptyState, ErrorState, Loading, PageHeader, SectionCard, Stat, Tabs } from '../../components/ui';
import { addDaysISO, fmtDate, fmtDateShort, inr, num, pct, titleize, todayISO } from '../../lib/format';

const PRESETS = [
  { key: '30d', label: '30 days', days: 29 },
  { key: '90d', label: '90 days', days: 89 },
  { key: '365d', label: '12 months', days: 364 },
];

const SEGMENT_TONE = { loyal: 'green', returning: 'blue', new: 'amber', inactive: 'red', never: '' };

export default function Retention() {
  const [from, setFrom] = useState(addDaysISO(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [preset, setPreset] = useState('30d');
  const [tab, setTab] = useState('segments');

  const path = useMemo(() => `/admin/retention${qs({ from, to })}`, [from, to]);
  const { data, loading, error, reload } = useFetch(path);

  const applyPreset = (p) => {
    setPreset(p.key);
    setTo(todayISO());
    setFrom(addDaysISO(todayISO(), -p.days));
  };

  if (loading && !data) return <Loading label="Loading retention analytics…" minHeight={420} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const s = data.summary || {};
  const segments = (data.segments || []).map((x) => ({ label: titleize(x.segment), value: Number(x.count), color: undefined }));
  const trend = (data.trend || []).map((d) => ({ ...d, label: fmtDateShort(d.day) }));
  const frequency = (data.frequency || []).map((f) => ({ label: f.bucket, value: Number(f.customers) }));
  const cohort = (data.cohort || []).map((c) => ({ label: c.month, value: Number(c.count) }));
  const loyal = data.loyalCustomers || [];

  return (
    <>
      <PageHeader title="Customer Retention" description="Segments, repeat behaviour and loyalty performance calculated from completed orders and verified payments.">
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      <div className="card card-pad" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="flex items-center gap-12 wrap">
          <HeartHandshake size={15} className="muted" />
          {PRESETS.map((p) => (
            <button key={p.key} className={`btn btn-sm ${preset === p.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
          <label className="small muted" style={{ marginLeft: 6 }}>From</label>
          <input type="date" className="input" style={{ width: 150, height: 34 }} value={from} max={to} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} />
          <label className="small muted">To</label>
          <input type="date" className="input" style={{ width: 150, height: 34 }} value={to} min={from} max={todayISO()} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} />
          <Link className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} to="/admin/customers">Customer database <ArrowRight size={13} /></Link>
        </div>
      </div>

      <div className="grid g6" style={{ marginBottom: 16 }}>
        <Stat label="Total customers" icon={Users} value={num(s.total_customers)} meta="All profiles" />
        <Stat label="New in range" icon={UserPlus} tone="blue" value={num(s.new_customers)} meta="Joined in this period" />
        <Stat label="Returning" icon={Repeat} tone="amber" value={num(s.returning_customers)} meta="More than one order" />
        <Stat label="Loyal" icon={Crown} tone="green" value={num(s.loyal_customers)} meta="5+ completed orders" />
        <Stat label="Active in range" icon={Sparkles} value={num(s.active_customers)} meta="Ordered in this period" />
        <Stat label="Member revenue" icon={Wallet} tone="accent" value={inr(s.member_revenue)} meta={`AOV ${inr(s.avg_member_spend)}`} />
      </div>

      <div className="split-2" style={{ marginBottom: 16 }}>
        <SectionCard title="Repeat rate" subtitle="Returning customers ÷ total customers">
          <div className="flex items-center gap-16" style={{ gap: 26, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 130, height: 130, flex: '0 0 auto' }}>
              <svg width="130" height="130" viewBox="0 0 130 130" aria-label="Repeat rate">
                <circle cx="65" cy="65" r="55" fill="none" stroke="var(--surface-3)" strokeWidth="14" />
                <circle
                  cx="65" cy="65" r="55" fill="none" stroke="#3d6a50" strokeWidth="14" strokeLinecap="round"
                  strokeDasharray={`${(Math.min(100, Number(s.repeatRate) || 0) / 100) * 2 * Math.PI * 55} ${2 * Math.PI * 55}`}
                  transform="rotate(-90 65 65)"
                />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: 23, fontWeight: 600 }}>{Number(s.repeatRate) || 0}%</div>
                  <div className="tiny muted">repeat</div>
                </div>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="kv"><dt>Returning customers</dt><dd>{num(s.returning_customers)}</dd></div>
              <div className="kv"><dt>One-time customers</dt><dd>{num(Math.max(0, Number(s.total_customers) - Number(s.returning_customers)))}</dd></div>
              <div className="kv"><dt>Loyal customers</dt><dd>{num(s.loyal_customers)}</dd></div>
              <div className="kv"><dt>Avg member spend</dt><dd>{inr(s.avg_member_spend)}</dd></div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Customer segments" subtitle="Based on completed order counts and recency">
          <Donut segments={segments} centerLabel="customers" centerValue={num(segments.reduce((a, b) => a + b.value, 0))} format={(v) => num(v)} />
          <div className="divider" />
          <div className="grid g2" style={{ gap: 8 }}>
            {segments.map((seg) => (
              <div key={seg.label} className="between small"><span className="flex items-center gap-8"><Badge tone={SEGMENT_TONE[seg.label.toLowerCase()] || ''}>{seg.label}</Badge></span><strong>{num(seg.value)}</strong></div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Member ordering trend"
        subtitle="Distinct customers ordering each day in this range"
        action={<Badge tone="accent">{pct(s.active_customers, s.total_customers)}% of profiles active</Badge>}
      >
        <AreaChart data={trend} valueKey="customers" height={220} format={(v) => num(v)} xLabel={(d) => fmtDateShort(d.day)} empty="No member orders in this range" />
      </SectionCard>

      <div style={{ height: 16 }} />

      <Tabs
        tabs={[
          { key: 'segments', label: 'Top customers', count: loyal.length },
          { key: 'frequency', label: 'Order frequency' },
          { key: 'cohort', label: 'Monthly signups', count: cohort.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div style={{ marginTop: 14 }}>
        {tab === 'segments' && (
          <SectionCard noPad>
            {loyal.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Spend</th><th>Points</th><th>Last visit</th><th>Segment</th></tr></thead>
                  <tbody>
                    {loyal.map((c) => {
                      const orders = Number(c.orders_count) || 0;
                      const segment = orders >= 5 ? 'loyal' : orders >= 2 ? 'returning' : 'new';
                      return (
                        <tr key={c.id}>
                          <td className="primary-cell">{c.name}<div className="sub-cell">#{c.id}</div></td>
                          <td className="small">{c.email}<div className="sub-cell">{c.phone || '—'}</div></td>
                          <td className="num">{num(orders)}</td>
                          <td className="num strong">{inr(c.spend)}</td>
                          <td><Badge tone="accent">{num(c.loyalty_points)} pts</Badge></td>
                          <td className="small">{c.last_visit ? fmtDate(c.last_visit) : '—'}</td>
                          <td><Badge tone={SEGMENT_TONE[segment]}>{titleize(segment)}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={Crown} title="No customer orders yet" description="Once customers order with an account, your top spenders appear here." />}
          </SectionCard>
        )}

        {tab === 'frequency' && (
          <SectionCard title="How often customers order" subtitle="Distribution of completed and served orders per customer">
            <BarChart data={frequency} valueKey="value" height={200} format={(v) => `${num(v)} customers`} color="#3d6a50" />
          </SectionCard>
        )}

        {tab === 'cohort' && (
          <SectionCard title="New customers by month" subtitle="Profile creation, pulled from the customer table">
            <BarChart data={cohort} valueKey="value" height={200} format={(v) => `${num(v)} customers`} color="#9a5b2f" />
          </SectionCard>
        )}
      </div>
    </>
  );
}
