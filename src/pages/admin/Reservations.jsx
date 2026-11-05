import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Check, ChevronDown, ChevronUp, Clock, Edit3, Plus, RefreshCw, Trash2,
  UserCheck, UserX, XCircle, Armchair,
} from 'lucide-react';
import { del, get, patch, post, put, qs } from '../../lib/api';
import { useAuth, useFetch, useRealtime, useToast } from '../../lib/store';
import {
  Badge, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader,
  Pagination, SearchBox, SectionCard, StatusBadge, Tabs,
} from '../../components/ui';
import { fmtDate, fmtDateTime, fmtTime, num, timeAgo, titleize, todayISO } from '../../lib/format';

const STATUS_TABS = ['all', 'pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];
const emptyForm = () => ({
  guestName: '', phone: '', email: '', date: todayISO(), time: '19:00', partySize: 2,
  tableId: '', status: 'confirmed', specialRequests: '',
});

export default function Reservations() {
  const toast = useToast();
  const { isManager } = useAuth();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: 'reservation_date', dir: 'desc' });

  const path = useMemo(
    () => `/admin/reservations${qs({ status: tab, q: query, from, to, page, limit: 15 })}`,
    [tab, query, from, to, page]
  );
  const { data, loading, error, reload } = useFetch(path);

  useRealtime((event) => { if (event?.type === 'reservation') reload(); });

  const [modal, setModal] = useState(null); // { editing, form }
  const [floor, setFloor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPage(1); }, [tab, query, from, to]);

  useEffect(() => {
    if (!modal) return undefined;
    let active = true;
    const { date, time, partySize } = modal.form;
    get(`/admin/floor${qs({ date, time, party: partySize })}`)
      .then((d) => { if (active) setFloor(d); })
      .catch(() => { if (active) setFloor(null); });
    return () => { active = false; };
  }, [modal?.form?.date, modal?.form?.time, modal?.form?.partySize, modal?.open]);

  const counts = useMemo(() => {
    const map = {};
    for (const c of data?.counts || []) map[c.status] = c.n;
    map.all = Object.values(map).reduce((a, b) => a + b, 0);
    return map;
  }, [data]);

  const rows = useMemo(() => {
    const list = [...(data?.reservations || [])];
    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const va = a[sort.key] ?? '';
      const vb = b[sort.key] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return list;
  }, [data, sort]);

  const openNew = useCallback(() => {
    setErrors({});
    setModal({ editing: null, form: emptyForm() });
  }, []);

  const openEdit = (r) => {
    setErrors({});
    setModal({
      editing: r,
      form: {
        guestName: r.guest_name, phone: r.phone || '', email: r.email || '',
        date: r.reservation_date, time: String(r.reservation_time).slice(0, 5), partySize: r.party_size,
        tableId: r.table_id, status: r.status, specialRequests: r.special_requests || '',
      },
    });
  };

  const setField = (key, value) => setModal((m) => ({ ...m, form: { ...m.form, [key]: value } }));

  const save = async (e) => {
    e.preventDefault();
    const f = modal.form;
    const localErrors = {};
    if (!f.guestName.trim()) localErrors.guestName = 'Guest name is required.';
    if (!f.phone.trim()) localErrors.phone = 'Phone number is required.';
    if (!f.date) localErrors.date = 'Choose a date.';
    if (!f.time) localErrors.time = 'Choose a time.';
    if (!f.tableId) localErrors.tableId = 'Choose a table.';
    if (Object.keys(localErrors).length) { setErrors(localErrors); return; }
    setSaving(true);
    setErrors({});
    try {
      const body = {
        guestName: f.guestName.trim(), phone: f.phone.trim(), email: f.email.trim() || null,
        date: f.date, time: f.time, partySize: Number(f.partySize), tableId: Number(f.tableId),
        specialRequests: f.specialRequests, status: f.status,
      };
      if (modal.editing) await put(`/admin/reservations/${modal.editing.id}`, body);
      else await post('/admin/reservations', body);
      toast.success(modal.editing ? 'Reservation updated' : 'Reservation created');
      setModal(null);
      reload();
    } catch (err) {
      setErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const changeStatus = async (r, status, reason) => {
    setBusy(true);
    try {
      await post(`/admin/reservations/${r.id}/status`, { status, reason });
      toast.success(`Reservation ${titleize(status).toLowerCase()}`);
      setCancelTarget(null);
      setConfirm(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (r) => {
    setBusy(true);
    try {
      await del(`/admin/reservations/${r.id}`);
      toast.success('Reservation deleted');
      setConfirm(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const SortIcon = ({ col }) => (sort.key !== col ? null : sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />);

  const actionsFor = (r) => {
    const buttons = [];
    if (r.status === 'pending') buttons.push({ label: 'Confirm', icon: Check, run: () => changeStatus(r, 'confirmed'), primary: true });
    if (r.status === 'confirmed') buttons.push({ label: 'Seat', icon: UserCheck, run: () => changeStatus(r, 'seated'), primary: true });
    if (['confirmed', 'seated'].includes(r.status)) buttons.push({ label: 'Complete', icon: Check, run: () => changeStatus(r, 'completed') });
    if (['confirmed', 'seated'].includes(r.status)) buttons.push({ label: 'No-show', icon: UserX, run: () => setConfirm({ title: 'Mark as no-show?', message: `Guest ${r.guest_name} will be marked as a no-show for ${fmtDate(r.reservation_date)}.`, label: 'Mark no-show', run: () => changeStatus(r, 'no_show') }) });
    if (['pending', 'confirmed', 'seated'].includes(r.status)) buttons.push({ label: 'Cancel', icon: XCircle, run: () => { setCancelReason(''); setCancelTarget(r); }, danger: true });
    return buttons;
  };

  return (
    <>
      <PageHeader title="Reservations" description="Bookings, seating and guest history. Conflicting table slots are rejected by the database.">
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
        <button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={14} /> New reservation</button>
      </PageHeader>

      <Tabs tabs={STATUS_TABS.map((s) => ({ key: s, label: titleize(s === 'no_show' ? 'no-show' : s), count: counts[s] ?? '' }))} value={tab} onChange={(v) => setTab(v)} />

      <div className="toolbar" style={{ marginTop: 14 }}>
        <SearchBox value={q} onChange={setQ} onSubmit={() => setQuery(q.trim())} placeholder="Guest, phone, email or reference…" />
        <label className="small muted">From</label>
        <input type="date" className="input" style={{ width: 150, height: 34 }} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <label className="small muted">To</label>
        <input type="date" className="input" style={{ width: 150, height: 34 }} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        {(from || to || query) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); setQ(''); setQuery(''); }}>Clear</button>
        )}
        <span className="small muted" style={{ marginLeft: 'auto' }}>{num(data?.total)} reservation{data?.total === 1 ? '' : 's'}</span>
      </div>

      <SectionCard noPad>
        {loading && !data ? <Loading label="Loading reservations…" /> : error ? <ErrorState error={error} onRetry={reload} /> : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('guest_name')}>Guest <SortIcon col="guest_name" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('reservation_date')}>Date &amp; time <SortIcon col="reservation_date" /></th>
                    <th>Party</th>
                    <th>Table</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="primary-cell">
                        {r.guest_name}
                        <div className="sub-cell">{r.reference} · {r.phone}{r.email ? ` · ${r.email}` : ''}</div>
                        {r.special_requests && <div className="sub-cell" style={{ color: 'var(--amber)' }}>“{r.special_requests}”</div>}
                      </td>
                      <td>
                        {fmtDate(r.reservation_date)}
                        <div className="sub-cell">{fmtTime(`${r.reservation_date}T${r.reservation_time}`)}</div>
                      </td>
                      <td className="num">{r.party_size} guest{r.party_size === 1 ? '' : 's'}</td>
                      <td>{r.table_label || '—'}{r.zone ? <div className="sub-cell">{r.zone} · seats {r.capacity}</div> : null}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="small muted">{titleize(r.source)}<div className="sub-cell">{timeAgo(r.created_at)}</div></td>
                      <td>
                        <div className="flex gap-4 wrap">
                          {actionsFor(r).map((a) => (
                            <button key={a.label} className={`btn btn-xs ${a.primary ? 'btn-primary' : a.danger ? 'btn-soft-danger' : 'btn-secondary'}`} onClick={a.run}>
                              <a.icon size={12} /> {a.label}
                            </button>
                          ))}
                          <button className="btn btn-secondary btn-xs" onClick={() => openEdit(r)} title="Edit"><Edit3 size={12} /></button>
                          {isManager && <button className="btn btn-ghost btn-xs" title="Delete" onClick={() => setConfirm({ title: 'Delete reservation?', message: `Permanently delete ${r.reference} for ${r.guest_name}? This cannot be undone.`, label: 'Delete', danger: true, run: () => remove(r) })}><Trash2 size={12} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={7}>
                      <EmptyState icon={CalendarDays} title="No reservations found" description="Try a different status or clear the filters, or create a booking." action={<button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={14} /> New reservation</button>} />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={data?.page || page} limit={data?.limit || 15} total={data?.total || 0} onPage={setPage} />
          </>
        )}
      </SectionCard>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.editing ? `Edit ${modal.editing.reference}` : 'New reservation'}
        subtitle="The server blocks double-booking the same table within the reservation slot window."
        size=""
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setModal(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="reservation-form" type="submit" disabled={saving}><Check size={15} /> {saving ? 'Saving…' : modal?.editing ? 'Save changes' : 'Create reservation'}</button>
          </>
        )}
      >
        {modal && (
          <form id="reservation-form" onSubmit={save} className="form-grid" style={{ paddingTop: 6 }}>
            <Field label="Guest name" error={errors.guestName} className="full">
              <input className="input" value={modal.form.guestName} onChange={(e) => setField('guestName', e.target.value)} placeholder="e.g. Ananya Rao" />
            </Field>
            <Field label="Phone" error={errors.phone}>
              <input className="input" value={modal.form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+91 98765 43210" />
            </Field>
            <Field label="Email (optional)" error={errors.email}>
              <input className="input" type="email" value={modal.form.email} onChange={(e) => setField('email', e.target.value)} placeholder="guest@example.com" />
            </Field>
            <Field label="Date" error={errors.date}>
              <input className="input" type="date" min={todayISO()} value={modal.form.date} onChange={(e) => { setField('date', e.target.value); setField('tableId', ''); }} />
            </Field>
            <Field label="Time" error={errors.time}>
              <input className="input" type="time" step="900" min="08:00" max="22:30" value={modal.form.time} onChange={(e) => { setField('time', e.target.value); setField('tableId', ''); }} />
            </Field>
            <Field label="Party size" error={errors.partySize}>
              <input className="input" type="number" min={1} max={30} value={modal.form.partySize} onChange={(e) => { setField('partySize', e.target.value); setField('tableId', ''); }} />
            </Field>
            <Field label="Status">
              <select className="select" value={modal.form.status} onChange={(e) => setField('status', e.target.value)}>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="seated">Seated</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no_show">No-show</option>
              </select>
            </Field>
            <Field label="Table" error={errors.tableId} className="full" hint={floor ? `${floor.tables.filter((t) => t.available).length} of ${floor.tables.length} tables available for this slot. Fewer than party size are disabled.` : 'Checking table availability…'}>
              <select className="select" value={modal.form.tableId} onChange={(e) => setField('tableId', e.target.value)}>
                <option value="">Choose a table…</option>
                {(floor?.tables || []).map((t) => (
                  <option key={t.id} value={t.id} disabled={t.tooSmall || t.visual === 'out_of_service' || t.visual === 'cleaning'}>
                    {t.label} · seats {t.capacity}{t.zone ? ` · ${t.zone}` : ''}{t.available ? ' · available' : t.visual === 'occupied' ? ' · occupied' : t.visual === 'reserved' ? ' · already booked' : t.visual === 'cleaning' ? ' · cleaning' : t.visual === 'out_of_service' ? ' · out of service' : t.visual === 'held' ? ' · on hold' : ''}
                  </option>
                ))}
                {modal.editing && floor && !floor.tables.some((t) => String(t.id) === String(modal.form.tableId)) && (
                  <option value={modal.form.tableId}>Current table (outside this slot)</option>
                )}
              </select>
            </Field>
            <Field label="Special requests" className="full">
              <textarea className="textarea" rows={3} value={modal.form.specialRequests} onChange={(e) => setField('specialRequests', e.target.value)} placeholder="Birthday, high chair, window seat…" />
            </Field>
            {floor && !floor.tables.some((t) => t.available) && (
              <div className="notice warn full"><Armchair size={15} /><span>No table is free for this slot. Try another time or check the Tables &amp; Seating view.</span></div>
            )}
          </form>
        )}
      </Modal>

      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="Cancel reservation"
        subtitle={cancelTarget ? `${cancelTarget.reference} · ${cancelTarget.guest_name}` : undefined}
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setCancelTarget(null)} disabled={busy}>Keep booking</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => changeStatus(cancelTarget, 'cancelled', cancelReason)}><XCircle size={15} /> Cancel reservation</button>
          </>
        )}
      >
        <Field label="Reason (shown to the guest and stored in history)">
          <textarea className="textarea" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Guest called to cancel…" />
        </Field>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.label || 'Confirm'}
        tone={confirm?.danger ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={confirm?.run}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
