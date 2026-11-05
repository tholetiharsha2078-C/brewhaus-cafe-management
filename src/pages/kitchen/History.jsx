import React, { useState } from 'react';
import { CalendarDays, ClipboardList, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { qs } from '../../lib/api';
import { useFetch } from '../../lib/store';
import { fmtDate, fmtDateTime, inr, titleize, todayISO } from '../../lib/format';
import { KdsSelect } from './KdsShared';

const STATUSES = ['all', 'completed', 'served', 'cancelled'];

export default function History() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  const path = `/kitchen/history${qs({ from, to, q: query, status })}`;
  const { data, loading, error, reload } = useFetch(path);
  const orders = data?.orders || [];

  const submit = (e) => { e.preventDefault(); setQuery(q.trim()); };
  const clear = () => { setQ(''); setQuery(''); setStatus('all'); setFrom(todayISO()); setTo(todayISO()); };

  return (
    <>
      <div className="between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 25 }}>Kitchen history</div>
          <div style={{ fontSize: 11.5, color: '#8d877c' }}>Closed tickets for the selected range, newest first. Up to 100 rows.</div>
        </div>
        <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={reload}><RefreshCw size={13} /> Refresh</button>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', background: '#1e1d1a', border: '1px solid #2c2a26', borderRadius: 10, padding: 10, marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a49b8d' }}>
          <CalendarDays size={13} /> From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={dateStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a49b8d' }}>
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={dateStyle} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#191816', border: '1px solid #37332c', borderRadius: 8, padding: '0 10px', height: 34, flex: '1 1 200px', maxWidth: 300 }}>
          <Search size={13} style={{ color: '#8d877c' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number, guest name…" style={inputText} />
        </div>
        <KdsSelect value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140, height: 34 }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : titleize(s)}</option>)}
        </KdsSelect>
        <button className="kds-btn primary" type="submit" style={{ flex: '0 0 auto', height: 34 }}>Apply</button>
        <button className="kds-btn" type="button" onClick={clear} style={{ flex: '0 0 auto', height: 34 }}>Reset</button>
      </form>

      <div style={{ background: '#1c1b18', border: '1px solid #2c2a26', borderRadius: 12, overflow: 'hidden' }}>
        {loading && !data ? (
          <div className="kds-empty" style={{ padding: 50 }}><span className="spinner" /> Loading history…</div>
        ) : error ? (
          <div className="kds-empty" style={{ padding: 40 }}><TriangleAlert size={20} style={{ color: '#e07868' }} /><div style={{ marginTop: 8 }}>{error.message}</div></div>
        ) : orders.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#8d877c', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  {['Ticket', 'Placed', 'Table / type', 'Guest', 'Items', 'Collected by', 'Status', 'Value'].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', borderBottom: '1px solid #2c2a26', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #242220', fontSize: 12 }}>
                    <td style={{ padding: '9px 14px', fontWeight: 700 }}>{o.order_number}</td>
                    <td style={{ padding: '9px 14px', color: '#a49b8d', whiteSpace: 'nowrap' }}>{fmtDateTime(o.placed_at)}</td>
                    <td style={{ padding: '9px 14px', color: '#c9c1b4' }}>{o.table_label ? `Table ${o.table_label}` : titleize(o.type)}</td>
                    <td style={{ padding: '9px 14px', color: '#c9c1b4' }}>{o.customer_name || 'Guest'}</td>
                    <td style={{ padding: '9px 14px', color: '#a49b8d', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#d9a25f', fontWeight: 600 }}>{o.item_count}×</span> {o.items_summary || '—'}
                    </td>
                    <td style={{ padding: '9px 14px', color: '#a49b8d' }}>{o.collected_by_name || (o.status === 'cancelled' ? '—' : 'Kitchen')}</td>
                    <td style={{ padding: '9px 14px' }}>
                      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: o.status === 'cancelled' ? '#e07868' : o.status === 'completed' ? '#8bb98c' : '#7fa2b8' }}>{titleize(o.status)}</span>
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="kds-empty" style={{ padding: 50 }}>
            No closed tickets from {fmtDate(from)} to {fmtDate(to)}.
            <div style={{ marginTop: 6, fontSize: 10.5 }}>Completed, served and cancelled orders appear here.</div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 10.5, color: '#8d877c', display: 'flex', alignItems: 'center', gap: 6 }}>
        <ClipboardList size={12} /> {orders.length} ticket{orders.length === 1 ? '' : 's'} shown. Handover names come from the collection record.
      </div>
    </>
  );
}

const dateStyle = {
  height: 34, borderRadius: 8, border: '1px solid #37332c', background: '#191816', color: '#f2ede4', padding: '0 8px', fontSize: 12,
};
const inputText = { border: 0, outline: 0, background: 'transparent', color: '#f2ede4', fontSize: 12.5, width: '100%' };
