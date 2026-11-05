import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, Search,
  Settings2, TriangleAlert, UtensilsCrossed,
} from 'lucide-react';
import { post } from '../../lib/api';
import { useFetch, useRealtime, useToast } from '../../lib/store';
import { fmtDateTime, titleize } from '../../lib/format';
import { Field, KdsInput, KdsModal, KdsStat, KdsSelect } from './KdsShared';

const KINDS = [
  ['temporarily_unavailable', 'Temporarily unavailable'],
  ['ingredient_shortage', 'Ingredient shortage'],
  ['equipment_issue', 'Equipment issue'],
  ['restock_needed', 'Restock needed'],
];

export default function Availability() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch('/kitchen/availability');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [station, setStation] = useState('all');
  const [collapsed, setCollapsed] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ kind: 'temporarily_unavailable', reason: '' });
  const [saving, setSaving] = useState(false);

  useRealtime((event) => { if (event?.type === 'kitchen_issue' || event?.type === 'station') reload(); });

  const items = data?.items || [];
  const reports = data?.reports || [];
  const stations = useMemo(() => [...new Set(items.map((i) => i.station_name).filter(Boolean))], [items]);

  const reportFor = (itemId) => reports.find((r) => r.menu_item_id === itemId);
  const openIds = useMemo(() => new Set(reports.filter((r) => r.status !== 'resolved').map((r) => r.menu_item_id)), [reports]);

  const filtered = useMemo(() => items.filter((i) => {
    if (filter === 'unavailable' && i.available) return false;
    if (filter === 'available' && !i.available) return false;
    if (filter === 'reported' && !openIds.has(i.id)) return false;
    if (station !== 'all' && i.station_name !== station) return false;
    if (q.trim()) {
      const hay = `${i.name} ${i.category} ${i.station_name || ''}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }), [items, filter, station, q, openIds]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of filtered) {
      const key = item.station_name || 'Unassigned station';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, [filtered]);

  const openReport = (item) => {
    setForm({ kind: 'temporarily_unavailable', reason: '' });
    setModal(item);
  };

  const submit = async () => {
    if (!form.reason.trim()) { toast.error('Describe the issue for management.'); return; }
    setSaving(true);
    try {
      await post('/kitchen/availability/reports', { menuItemId: modal.id, kind: form.kind, reason: form.reason.trim() });
      toast.success(`${modal.name} reported to management`);
      setModal(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  if (loading && !data) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: 340, color: '#8d877c' }}><div className="flex items-center gap-12"><span className="spinner" /> Loading menu availability…</div></div>;
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
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 25 }}>Availability board</div>
          <div style={{ fontSize: 11.5, color: '#8d877c' }}>Report items you cannot serve. Management resolves the issue and updates the menu.</div>
        </div>
        <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={reload}><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className="kds-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KdsStat label="Menu items" value={items.length} />
        <KdsStat label="Available" value={items.filter((i) => i.available).length} tone="good" />
        <KdsStat label="Paused on menu" value={items.filter((i) => !i.available).length} tone={items.some((i) => !i.available) ? 'warn' : ''} />
        <KdsStat label="Open issues" value={reports.length} tone={reports.length ? 'bad' : ''} />
      </div>

      {reports.length > 0 && (
        <div style={{ background: '#221e19', border: '1px solid #40352a', borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div className="between" style={{ marginBottom: 9 }}>
            <strong style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} style={{ color: '#e0a04a' }} /> Open availability reports</strong>
            <span style={{ fontSize: 10, color: '#8d877c' }}>Resolved by management in Settings</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {reports.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#1b1a17', border: '1px solid #2f2b25', borderRadius: 8, padding: '8px 10px' }}>
                <span style={{ color: '#e0a04a', marginTop: 1 }}><AlertTriangle size={13} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{r.item_name} <span style={{ color: '#8d877c', fontWeight: 400 }}>· {titleize(r.kind)}</span></div>
                  <div style={{ fontSize: 10.5, color: '#a49b8d', marginTop: 1 }}>{r.reason}</div>
                  <div style={{ fontSize: 9.5, color: '#7f786c', marginTop: 2 }}>{r.reported_by_name || 'Kitchen'} · {fmtDateTime(r.created_at)}{r.station_name ? ` · ${r.station_name}` : ''}</div>
                </div>
                <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.06em', color: r.status === 'open' ? '#e0a04a' : '#7fa2b8' }}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1e1d1a', border: '1px solid #332f29', borderRadius: 8, padding: '0 10px', height: 36, flex: '1 1 220px', maxWidth: 340 }}>
          <Search size={14} style={{ color: '#8d877c' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menu items…" style={{ border: 0, outline: 0, background: 'transparent', color: '#f2ede4', fontSize: 12.5, width: '100%' }} />
        </div>
        <KdsSelect value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 170 }}>
          <option value="all">All items</option>
          <option value="available">Available only</option>
          <option value="unavailable">Paused on menu</option>
          <option value="reported">Reported issues</option>
        </KdsSelect>
        <KdsSelect value={station} onChange={(e) => setStation(e.target.value)} style={{ width: 180 }}>
          <option value="all">All stations</option>
          {stations.map((s) => <option key={s} value={s}>{s}</option>)}
        </KdsSelect>
        <span style={{ fontSize: 11, color: '#8d877c', alignSelf: 'center', marginLeft: 'auto' }}>{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groups.map(([name, list]) => {
          const isCollapsed = collapsed.includes(name);
          const openCount = list.filter((i) => openIds.has(i.id)).length;
          return (
            <section key={name} style={{ background: '#1c1b18', border: '1px solid #2c2a26', borderRadius: 12, overflow: 'hidden' }}>
              <button
                onClick={() => setCollapsed((prev) => (isCollapsed ? prev.filter((n) => n !== name) : [...prev, name]))}
                style={{ width: '100%', background: 'transparent', border: 0, color: '#f2ede4', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: isCollapsed ? '1px solid #262420' : '1px solid #2c2a26' }}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <UtensilsCrossed size={13} style={{ color: '#b08a5f' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{name}</span>
                <span style={{ fontSize: 10, color: '#8d877c' }}>{list.length}</span>
                {openCount > 0 && <span style={{ marginLeft: 'auto', fontSize: 9.5, color: '#e0a04a' }}>{openCount} issue{openCount === 1 ? '' : 's'}</span>}
              </button>
              {!isCollapsed && (
                <div>
                  {list.map((item) => {
                    const report = reportFor(item.id);
                    return (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid #262420' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.available ? '#8bb98c' : '#e07868', flex: '0 0 auto' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, color: item.available ? '#f2ede4' : '#a49b8d' }}>{item.name}</div>
                          <div style={{ fontSize: 9.5, color: '#7f786c' }}>
                            {item.category}{item.station_name ? ` · ${item.station_name}` : ''}
                            {report ? ` · reported: ${titleize(report.kind)}` : ''}
                          </div>
                        </div>
                        <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.06em', color: item.available ? '#8bb98c' : '#e07868' }}>
                          {item.available ? 'Available' : 'Paused'}
                        </span>
                        {report ? (
                          <span style={{ fontSize: 9.5, color: report.status === 'open' ? '#e0a04a' : '#7fa2b8', minWidth: 70, textAlign: 'right' }}>{report.status === 'open' ? 'Reported' : titleize(report.status)}</span>
                        ) : (
                          <button className="kds-btn warn" style={{ flex: '0 0 auto', minWidth: 0, padding: '5px 9px', fontSize: 10 }} onClick={() => openReport(item)}>
                            <AlertTriangle size={10} /> Report
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {!groups.length && (
          <div className="kds-empty" style={{ border: '1px dashed #332f29', borderRadius: 12, padding: 40 }}>
            <div style={{ marginBottom: 6 }}><CheckCircle2 size={20} style={{ color: '#8bb98c' }} /></div>
            No menu items match this view.
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 10.5, color: '#8d877c', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Settings2 size={12} /> Marking an item unavailable on the customer menu is a management action in Menu Management. Reporting creates an open issue for follow-up.
      </div>

      <KdsModal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal ? `Report · ${modal.name}` : 'Report issue'}
        subtitle="Management receives this in Settings and Inventory. Use it when an item cannot be served."
        footer={(
          <>
            <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={() => setModal(null)} disabled={saving}>Cancel</button>
            <button className="kds-btn warn" style={{ flex: '0 0 auto' }} onClick={submit} disabled={saving}><AlertTriangle size={13} /> {saving ? 'Reporting…' : 'Report issue'}</button>
          </>
        )}
      >
        <Field label="Issue type">
          <KdsSelect value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </KdsSelect>
        </Field>
        <Field label="What happened?" hint="Required. Include what you need from management.">
          <textarea
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            rows={4}
            maxLength={400}
            autoFocus
            placeholder="Out of paneer until the evening delivery; please pause the item or offer a substitution."
            style={{ width: '100%', borderRadius: 8, border: '1px solid #3d3830', background: '#191816', color: '#f2ede4', padding: 10, fontSize: 13, resize: 'vertical' }}
          />
        </Field>
      </KdsModal>
    </>
  );
}
