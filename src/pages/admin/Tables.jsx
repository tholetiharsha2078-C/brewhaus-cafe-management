import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Armchair, Check, Move, Plus, RefreshCw, RotateCcw, Save, Square, Trash2, Users,
} from 'lucide-react';
import { del, get, patch, post, put, qs } from '../../lib/api';
import { useAuth, useFetch, useToast } from '../../lib/store';
import {
  Badge, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Loading, Modal, PageHeader,
  SectionCard, StatusBadge,
} from '../../components/ui';
import { fmtTime, inr, num, timeAgo, titleize, todayISO } from '../../lib/format';

const STATUSES = ['available', 'reserved', 'occupied', 'cleaning', 'out_of_service'];
const SHAPES = ['round', 'square', 'rect', 'booth'];
const VISUAL_CLASS = { available: 'available', reserved: 'reserved', occupied: 'occupied', cleaning: 'cleaning', out_of_service: 'out_of_service', held: 'reserved' };
const emptyForm = () => ({ label: '', capacity: 2, zone: '', shape: 'round', width: 110, height: 110, status: 'available', notes: '' });

export default function Tables() {
  const toast = useToast();
  const { isManager } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('19:00');
  const [party, setParty] = useState(2);
  const path = useMemo(() => `/admin/floor${qs({ date, time, party })}`, [date, time, party]);
  const { data, loading, error, reload } = useFetch(path);

  const [layout, setLayout] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const movedRef = useRef(false);

  useEffect(() => {
    if (data?.tables) {
      setLayout(data.tables.map((t) => ({ ...t })));
      setDirty(false);
    }
  }, [data]);

  const selected = layout.find((t) => t.id === selectedId) || null;
  const plan = data?.plan;

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d || !plan) return;
      const dx = (e.clientX - d.startClientX) * d.scaleX;
      const dy = (e.clientY - d.startClientY) * d.scaleY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true;
      setLayout((prev) => prev.map((t) => {
        if (t.id !== d.id) return t;
        if (d.mode === 'move') {
          return {
            ...t,
            x: Math.min(Math.max(0, Math.round(d.orig.x + dx)), Math.max(0, plan.width - d.orig.width)),
            y: Math.min(Math.max(0, Math.round(d.orig.y + dy)), Math.max(0, plan.height - d.orig.height)),
          };
        }
        return {
          ...t,
          width: Math.min(Math.max(60, Math.round(d.orig.width + dx)), plan.width - d.orig.x),
          height: Math.min(Math.max(60, Math.round(d.orig.height + dy)), plan.height - d.orig.y),
        };
      }));
    };
    const onUp = () => {
      if (movedRef.current) setDirty(true);
      setDragging(false);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, plan]);

  const startDrag = (e, table, mode) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !plan) return;
    dragRef.current = {
      id: table.id, mode,
      startClientX: e.clientX, startClientY: e.clientY,
      scaleX: plan.width / rect.width, scaleY: plan.height / rect.height,
      orig: { x: table.x, y: table.y, width: table.width, height: table.height },
    };
    movedRef.current = false;
    setSelectedId(table.id);
    setDragging(true);
  };

  const handleTableClick = (table) => {
    if (movedRef.current) { movedRef.current = false; return; }
    setSelectedId(table.id);
  };

  const saveLayout = async () => {
    setSavingLayout(true);
    try {
      await patch('/admin/tables/layout', { tables: layout.map((t) => ({ id: t.id, x: Math.round(t.x), y: Math.round(t.y), width: Math.round(t.width), height: Math.round(t.height) })) });
      toast.success('Floor layout saved');
      setDirty(false);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setSavingLayout(false); }
  };

  const discard = () => {
    setLayout((data?.tables || []).map((t) => ({ ...t })));
    setDirty(false);
  };

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm());
  const [addErrors, setAddErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setAddForm({ ...emptyForm(), x: 40 + Math.round(Math.random() * 20), y: 40 + Math.round(Math.random() * 20) });
    setAddErrors({});
    setAddOpen(true);
  };

  const createTable = async (e) => {
    e.preventDefault();
    if (!addForm.label.trim()) { setAddErrors({ label: 'Label is required.' }); return; }
    setSaving(true);
    try {
      await post('/admin/tables', {
        label: addForm.label.trim().toUpperCase(), capacity: Number(addForm.capacity), zone: addForm.zone || null,
        shape: addForm.shape, width: Number(addForm.width), height: Number(addForm.height),
        status: addForm.status, notes: addForm.notes || null,
        x: Number(addForm.x) || 40, y: Number(addForm.y) || 40,
      });
      toast.success('Table added');
      setAddOpen(false);
      reload();
    } catch (err) {
      setAddErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editErrors, setEditErrors] = useState({});

  const openEdit = () => {
    if (!selected) return;
    setEditForm({
      label: selected.label, capacity: selected.capacity, zone: selected.zone || '', shape: selected.shape,
      width: answered(selected.width), height: answered(selected.height), status: selected.status, notes: selected.notes || '',
      x: selected.x, y: selected.y,
    });
    setEditErrors({});
    setEditOpen(true);
  };
  function answered(v) { return Math.round(Number(v) || 0); }

  const saveEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setEditErrors({});
    try {
      await put(`/admin/tables/${selected.id}`, {
        label: editForm.label.trim(), capacity: Number(editForm.capacity), zone: editForm.zone || null,
        shape: editForm.shape, width: Number(editForm.width), height: Number(editForm.height),
        status: editForm.status, notes: editForm.notes || null, x: Number(editForm.x), y: Number(editForm.y),
      });
      toast.success('Table updated');
      setEditOpen(false);
      reload();
    } catch (err) {
      setEditErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const setStatus = async (status) => {
    try {
      await patch(`/admin/tables/${selected.id}/status`, { status });
      toast.success(`Table ${selected.label} set to ${titleize(status).toLowerCase()}`);
      reload();
    } catch (err) { toast.error(err.message); }
  };

  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const deleteTable = async (table) => {
    setBusy(true);
    try {
      await del(`/admin/tables/${table.id}`);
      toast.success('Table deleted');
      setConfirm(null);
      setSelectedId(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const c = { available: 0, reserved: 0, occupied: 0, cleaning: 0, out_of_service: 0 };
    for (const t of layout) {
      const v = t.visual || t.status;
      if (v === 'held') c.reserved += 1; else if (c[v] != null) c[v] += 1;
    }
    return c;
  }, [layout]);

  return (
    <>
      <PageHeader title="Tables & Seating" description="Drag to arrange, resize from the corner, and persist the floor plan. Availability for the selected slot is checked against bookings, holds and active orders.">
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
        <button className="btn btn-secondary btn-sm" onClick={openAdd}><Plus size={14} /> Add table</button>
        <button className="btn btn-primary btn-sm" onClick={saveLayout} disabled={!dirty || savingLayout}><Save size={14} /> {savingLayout ? 'Saving…' : 'Save layout'}</button>
      </PageHeader>

      <div className="card card-pad" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="flex items-center gap-12 wrap">
          <Armchair size={15} className="muted" />
          <label className="small muted">Date</label>
          <input type="date" className="input" style={{ height: 34, width: 155 }} value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} />
          <label className="small muted">Time</label>
          <input type="time" className="input" style={{ height: 34, width: 120 }} step="900" value={time} onChange={(e) => setTime(e.target.value)} />
          <label className="small muted">Party</label>
          <input type="number" className="input" style={{ height: 34, width: 80 }} min={1} max={30} value={party} onChange={(e) => setParty(Math.max(1, Number(e.target.value) || 1))} />
          <div className="flex gap-12 wrap" style={{ marginLeft: 'auto' }}>
            <Badge tone="green">{counts.available} available</Badge>
            <Badge tone="amber">{counts.reserved} reserved</Badge>
            <Badge tone="accent">{counts.occupied} occupied</Badge>
            <Badge tone="blue">{counts.cleaning} cleaning</Badge>
            <Badge tone="red">{counts.out_of_service} out of service</Badge>
          </div>
          {dirty && (
            <>
              <span className="tiny" style={{ color: 'var(--amber)', fontWeight: 600 }}>Unsaved layout</span>
              <button className="btn btn-ghost btn-xs" onClick={discard}><RotateCcw size={12} /> Discard</button>
            </>
          )}
        </div>
      </div>

      {loading && !data ? <Loading label="Loading floor plan…" minHeight={420} /> : error ? <ErrorState error={error} onRetry={reload} /> : !plan ? (
        <SectionCard><EmptyState icon={Armchair} title="No floor plan configured" /></SectionCard>
      ) : (
        <div className="split-2" style={{ gridTemplateColumns: selected ? 'minmax(0,1.6fr) minmax(0,.7fr)' : '1fr' }}>
          <SectionCard title="Floor plan" subtitle={`${plan.name} · ${plan.width} × ${plan.height} units · drag to move · corner handle to resize`} noPad>
            <div style={{ padding: 14 }}>
              <div
                ref={canvasRef}
                className="floor-editor"
                style={{ width: '100%', aspectRatio: `${plan.width} / ${plan.height}`, maxHeight: 620 }}
                onPointerDown={() => { if (!dragRef.current) setSelectedId(null); }}
              >
                {layout.map((t) => (
                  <div
                    key={t.id}
                    className={`editor-table ${VISUAL_CLASS[t.visual] || t.status} ${t.shape} ${selectedId === t.id ? 'selected' : ''}`}
                    style={{
                      left: `${(t.x / plan.width) * 100}%`,
                      top: `${(t.y / plan.height) * 100}%`,
                      width: `${(t.width / plan.width) * 100}%`,
                      height: `${(t.height / plan.height) * 100}%`,
                      cursor: dragging && dragRef.current?.id === t.id ? 'grabbing' : 'grab',
                    }}
                    onPointerDown={(e) => startDrag(e, t, 'move')}
                    onClick={() => handleTableClick(t)}
                    title={`${t.label} · ${t.capacity} seats · ${titleize(t.visual || t.status)}`}
                  >
                    <div className="t-label">{t.label}</div>
                    <div className="t-cap"><Users size={8} style={{ verticalAlign: -1 }} /> {t.capacity}</div>
                    {t.reservation && <div className="t-cap" style={{ color: 'var(--amber)' }}>{String(t.reservation.time).slice(0, 5)}</div>}
                    {t.activeOrder && <div className="t-cap" style={{ color: 'var(--red)' }}>{t.activeOrder.number?.split('-').pop()}</div>}
                    <div
                      className="resize-handle"
                      onPointerDown={(e) => startDrag(e, t, 'resize')}
                      title="Resize table"
                    />
                  </div>
                ))}
              </div>
              <div className="floor-legend">
                <span><i className="legend-dot" style={{ background: '#fff' }} /> Available</span>
                <span><i className="legend-dot" style={{ background: '#fbf0d9' }} /> Reserved / held</span>
                <span><i className="legend-dot" style={{ background: '#f6e6d9' }} /> Occupied</span>
                <span><i className="legend-dot" style={{ background: '#e9eff2' }} /> Cleaning</span>
                <span><i className="legend-dot" style={{ background: '#efece7' }} /> Out of service</span>
                <span style={{ marginLeft: 'auto' }}><Move size={11} /> Drag tables · <Square size={11} /> Use the corner handle to resize</span>
              </div>
            </div>
          </SectionCard>

          {selected && (
            <SectionCard
              title={`Table ${selected.label}`}
              subtitle={`${selected.capacity} seats · ${selected.zone || 'No zone'}`}
              action={<button className="btn btn-ghost btn-xs" onClick={() => setSelectedId(null)}>Close</button>}
            >
              <div className="flex gap-8 wrap" style={{ marginBottom: 14 }}>
                <StatusBadge status={selected.visual || selected.status} />
                {selected.tooSmall && <Badge tone="red">Too small for {party}</Badge>}
                {selected.holdExpiresAt && <Badge tone="amber">Held until {fmtTime(selected.holdExpiresAt)}</Badge>}
              </div>

              {selected.reservation ? (
                <div className="notice warn" style={{ marginBottom: 10 }}>
                  <Armchair size={15} />
                  <div>
                    <strong>Reservation {selected.reservation.reference || ''}</strong><br />
                    {selected.reservation.guestName || 'Guest'} · {selected.reservation.partySize} guests · {String(selected.reservation.time).slice(0, 5)}
                    {selected.reservation.status ? ` · ${titleize(selected.reservation.status)}` : ''}
                    {selected.reservation.specialRequests ? <div className="tiny" style={{ marginTop: 3 }}>“{selected.reservation.specialRequests}”</div> : null}
                  </div>
                </div>
              ) : <div className="small muted" style={{ marginBottom: 10 }}>No reservation in this slot.</div>}

              {selected.activeOrder ? (
                <div className="notice info" style={{ marginBottom: 10 }}>
                  <Square size={15} />
                  <div><strong>Active order {selected.activeOrder.number}</strong><br />{titleize(selected.activeOrder.status)} · {inr(selected.activeOrder.total)} · {timeAgo(selected.activeOrder.placedAt)}</div>
                </div>
              ) : <div className="small muted" style={{ marginBottom: 10 }}>No active order at this table.</div>}

              <div className="divider" />
              <h4 className="card-title" style={{ marginBottom: 8 }}>Set table status</h4>
              <div className="flex gap-4 wrap" style={{ marginBottom: 14 }}>
                {STATUSES.map((s) => (
                  <button key={s} className={`btn btn-xs ${selected.status === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatus(s)}>
                    {titleize(s)}
                  </button>
                ))}
              </div>
              <div className="notice" style={{ marginBottom: 14 }}><Users size={15} /><span>Status is a manual block. A table with a live order cannot be moved to cleaning or out of service.</span></div>
              <div className="flex gap-8">
                <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={openEdit}>Edit details</button>
                {isManager && <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ table: selected })}><Trash2 size={14} /></button>}
              </div>
              <div className="tiny muted" style={{ marginTop: 10 }}>Position {Math.round(selected.x)}, {Math.round(selected.y)} · size {Math.round(selected.width)} × {Math.round(selected.height)}</div>
            </SectionCard>
          )}
        </div>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a table"
        subtitle="New tables appear on the floor plan immediately and can be dragged into place."
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="add-table-form" type="submit" disabled={saving}><Check size={15} /> Add table</button>
          </>
        )}
      >
        <form id="add-table-form" onSubmit={createTable} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
          <Field label="Label" error={addErrors.label}>
            <input className="input" value={addForm.label} onChange={(e) => setAddForm({ ...addForm, label: e.target.value })} placeholder="T15" />
          </Field>
          <div className="form-grid">
            <Field label="Capacity" error={addErrors.capacity}>
              <input className="input" type="number" min={1} max={30} value={addForm.capacity} onChange={(e) => setAddForm({ ...addForm, capacity: e.target.value })} />
            </Field>
            <Field label="Zone">
              <input className="input" value={addForm.zone} onChange={(e) => setAddForm({ ...addForm, zone: e.target.value })} placeholder="Window, Garden…" />
            </Field>
            <Field label="Shape">
              <select className="select" value={addForm.shape} onChange={(e) => setAddForm({ ...addForm, shape: e.target.value })}>
                {SHAPES.map((s) => <option key={s} value={s}>{titleize(s)}</option>)}
              </select>
            </Field>
            <Field label="Initial status">
              <select className="select" value={addForm.status} onChange={(e) => setAddForm({ ...addForm, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{titleize(s)}</option>)}
              </select>
            </Field>
            <Field label="Width">
              <input className="input" type="number" min={60} value={addForm.width} onChange={(e) => setAddForm({ ...addForm, width: e.target.value })} />
            </Field>
            <Field label="Height">
              <input className="input" type="number" min={60} value={addForm.height} onChange={(e) => setAddForm({ ...addForm, height: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <input className="input" value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} placeholder="Near the window, accessible…" />
          </Field>
        </form>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={selected ? `Edit table ${selected.label}` : 'Edit table'}
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="edit-table-form" type="submit" disabled={saving}><Check size={15} /> Save table</button>
          </>
        )}
      >
        {editForm && (
          <form id="edit-table-form" onSubmit={saveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
            <Field label="Label" error={editErrors.label}>
              <input className="input" value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
            </Field>
            <div className="form-grid">
              <Field label="Capacity" error={editErrors.capacity}>
                <input className="input" type="number" min={1} max={30} value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })} />
              </Field>
              <Field label="Zone">
                <input className="input" value={editForm.zone} onChange={(e) => setEditForm({ ...editForm, zone: e.target.value })} />
              </Field>
              <Field label="Shape">
                <select className="select" value={editForm.shape} onChange={(e) => setEditForm({ ...editForm, shape: e.target.value })}>
                  {SHAPES.map((s) => <option key={s} value={s}>{titleize(s)}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="select" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{titleize(s)}</option>)}
                </select>
              </Field>
              <Field label="Width">
                <input className="input" type="number" min={60} value={editForm.width} onChange={(e) => setEditForm({ ...editForm, width: e.target.value })} />
              </Field>
              <Field label="Height">
                <input className="input" type="number" min={60} value={editForm.height} onChange={(e) => setEditForm({ ...editForm, height: e.target.value })} />
              </Field>
              <Field label="X position">
                <input className="input" type="number" min={0} value={editForm.x} onChange={(e) => setEditForm({ ...editForm, x: e.target.value })} />
              </Field>
              <Field label="Y position">
                <input className="input" type="number" min={0} value={editForm.y} onChange={(e) => setEditForm({ ...editForm, y: e.target.value })} />
              </Field>
            </div>
            <Field label="Notes">
              <input className="input" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </Field>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="Delete table?"
        message={confirm ? `Delete ${confirm.table.label}? Tables with active orders or upcoming reservations cannot be deleted.` : ''}
        confirmLabel="Delete table"
        busy={busy}
        onConfirm={() => deleteTable(confirm.table)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
