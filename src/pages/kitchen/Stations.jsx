import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ChefHat, Clock, Flame, RefreshCw, Timer, TriangleAlert, UtensilsCrossed,
} from 'lucide-react';
import { useFetch, useRealtime } from '../../lib/store';
import { KdsStat } from './KdsShared';

export default function Stations() {
  const { data, loading, error, reload } = useFetch('/kitchen/bootstrap');
  useRealtime((event) => { if (event?.type === 'order' || event?.type === 'station') reload(); });

  const stations = data?.stations || [];
  const load = data?.stationLoad || [];
  const orders = data?.orders || [];
  const summary = data?.summary || {};

  const loadFor = (id) => load.find((l) => l.station_id === id) || { pending: 0, preparing: 0, ready: 0, total: 0 };
  const itemsFor = (id) => orders.flatMap((o) => o.items.filter((i) => i.station_id === id).map((i) => ({ ...i, order: o })));

  if (loading && !data) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: 360, color: '#8d877c' }}><div className="flex items-center gap-12"><span className="spinner" /> Loading stations…</div></div>;
  }
  if (error) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 320, textAlign: 'center' }}>
        <div>
          <TriangleAlert size={26} style={{ color: '#e07868', marginBottom: 10 }} />
          <div style={{ marginBottom: 12 }}>{error.message}</div>
          <button className="kds-btn primary" style={{ flex: '0 0 auto' }} onClick={reload}><RefreshCw size={13} /> Retry</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 25 }}>Station board</div>
          <div style={{ fontSize: 11.5, color: '#8d877c' }}>Workload by station. Open a station to see only its tickets on the live board.</div>
        </div>
        <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={reload}><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className="kds-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KdsStat label="Active tickets" value={orders.length} />
        <KdsStat label="Items waiting" value={orders.reduce((sum, o) => sum + o.items.filter((i) => i.status === 'pending').length, 0)} tone="warn" />
        <KdsStat label="Items preparing" value={orders.reduce((sum, o) => sum + o.items.filter((i) => i.status === 'preparing').length, 0)} />
        <KdsStat label="Items ready" value={orders.reduce((sum, o) => sum + o.items.filter((i) => i.status === 'ready').length, 0)} tone="good" />
        <KdsStat label="Delayed orders" value={summary.delayed || 0} tone={Number(summary.delayed) ? 'bad' : ''} />
      </div>

      {summary.open_issues ? (
        <div style={{ background: '#332c20', border: '1px solid #4a3c27', color: '#e6c68d', padding: '9px 12px', borderRadius: 8, fontSize: 11.5, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <TriangleAlert size={14} /> {summary.open_issues} open availability issue{Number(summary.open_issues) === 1 ? '' : 's'} reported by the kitchen.
          <Link to="/kitchen/availability" style={{ marginLeft: 'auto', color: '#efd7ab', fontWeight: 600 }}>Review issues <ArrowRight size={12} style={{ verticalAlign: -2 }} /></Link>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {stations.map((station) => {
          const l = loadFor(station.id);
          const items = itemsFor(station.id);
          const oldest = items.map((i) => i.order.placed_at).sort()[0];
          const pressure = l.total > 0 ? Math.min(100, (Number(l.total) / 12) * 100) : 0;
          return (
            <div key={station.id} style={{ background: '#1e1d1a', border: '1px solid #2c2a26', borderRadius: 13, padding: 15 }}>
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, background: `${station.color}22`, border: `1px solid ${station.color}`, display: 'grid', placeItems: 'center', color: station.color }}>
                    <UtensilsCrossed size={16} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{station.name}</div>
                    <div style={{ fontSize: 10, color: '#8d877c' }}>Target {station.target_minutes} min · {station.description || 'No description'}</div>
                  </div>
                </div>
                <span className="n" style={{ background: '#2c2924', color: '#ddd3c4', borderRadius: 20, padding: '1px 8px', fontSize: 10.5 }}>{l.total} live</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
                <MiniStat icon={Timer} label="Waiting" value={l.pending} tone={Number(l.pending) ? '#e0a04a' : ''} />
                <MiniStat icon={Flame} label="Preparing" value={l.preparing} tone={Number(l.preparing) ? '#d5a05f' : ''} />
                <MiniStat icon={ChefHat} label="Ready" value={l.ready} tone={Number(l.ready) ? '#8bb98c' : ''} />
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="between" style={{ fontSize: 9.5, color: '#8d877c', marginBottom: 4 }}>
                  <span>Load</span>
                  <span>{l.total} item{l.total === 1 ? '' : 's'}{oldest ? ` · oldest ${Math.max(0, Math.round((Date.now() - new Date(oldest).getTime()) / 60000))}m` : ''}</span>
                </div>
                <div style={{ height: 5, background: '#2c2924', borderRadius: 8, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${pressure}%`, background: pressure > 75 ? '#e07868' : pressure > 45 ? '#e0a04a' : station.color }} />
                </div>
              </div>

              <Link className="kds-btn primary" style={{ marginTop: 13, textDecoration: 'none' }} to={`/kitchen?station=${station.id}`}>
                Open station board <ArrowRight size={13} />
              </Link>
            </div>
          );
        })}
        {!stations.length && <div className="kds-empty">No active stations. Ask management to create one in Settings.</div>}
      </div>

      <div style={{ marginTop: 14, fontSize: 10.5, color: '#8d877c', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={12} /> Items route automatically to the station assigned on the menu item. Disabling a station with live items is blocked server-side.
      </div>
    </>
  );
}

function MiniStat({ icon: Icon, label, value, tone = '' }) {
  return (
    <div style={{ background: '#24221e', border: '1px solid #2f2c26', borderRadius: 8, padding: '8px 9px' }}>
      <div style={{ fontSize: 9, color: '#8d877c', display: 'flex', alignItems: 'center', gap: 4 }}><Icon size={10} /> {label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: tone || '#f2ede4', marginTop: 1 }}>{value ?? 0}</div>
    </div>
  );
}
