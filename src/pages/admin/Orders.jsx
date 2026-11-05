import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Armchair, Check, ChevronDown, ChevronUp, Clock, CreditCard, Eye, Minus,
  PauseCircle, Plus, RefreshCw, Search, Send, ShoppingBag, Trash2, UtensilsCrossed, XCircle,
} from 'lucide-react';
import { get, patch, post, qs } from '../../lib/api';
import { useAuth, useFetch, useRealtime, useToast } from '../../lib/store';
import {
  Badge, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Loading, Modal, PageHeader,
  Pagination, SearchBox, SectionCard, StatusBadge, Tabs, Toggle,
} from '../../components/ui';
import { fmtDate, fmtDateTime, fmtTime, inr, num, timeAgo, titleize, todayISO } from '../../lib/format';

const STATUS_TABS = ['all', 'pending', 'confirmed', 'preparing', 'ready', 'collected', 'served', 'completed', 'on_hold', 'cancelled'];
const TYPE_LABEL = { dine_in: 'Dine-in', takeaway: 'Takeaway', preorder: 'Pre-order' };
const NEXT_ACTIONS = {
  pending: [{ status: 'confirmed', label: 'Accept order', icon: Check, primary: true }],
  confirmed: [{ status: 'preparing', label: 'Start preparing', icon: UtensilsCrossed, primary: true }],
  preparing: [{ status: 'ready', label: 'Mark ready', icon: Check, primary: true }],
  ready: [{ status: 'collected', label: 'Collected', icon: ShoppingBag, primary: true }, { status: 'served', label: 'Served', icon: UtensilsCrossed }],
  collected: [{ status: 'served', label: 'Mark served', icon: UtensilsCrossed, primary: true }, { status: 'completed', label: 'Complete', icon: Check }],
  served: [{ status: 'completed', label: 'Complete order', icon: Check, primary: true }],
  on_hold: [{ status: 'confirmed', label: 'Resume order', icon: Check, primary: true }],
};
const ITEM_NEXT = { pending: 'preparing', preparing: 'ready', ready: 'served' };

export default function Orders() {
  const toast = useToast();
  const { isManager } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('all');
  const [type, setType] = useState('all');
  const [payment, setPayment] = useState('all');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: 'placed_at', dir: 'desc' });

  const path = useMemo(
    () => `/admin/orders${qs({ status: tab, type, payment, q: query, from, to, page, limit: 15 })}`,
    [tab, type, payment, query, from, to, page]
  );
  const { data, loading, error, reload } = useFetch(path);

  const [detailId, setDetailId] = useState(() => (searchParams.get('open') ? Number(searchParams.get('open')) : null));
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadDetail = useCallback(async (id) => {
    if (!id) return;
    setDetailLoading(true);
    try {
      const res = await get(`/admin/orders/${id}`);
      setDetail(res.order);
    } catch (err) {
      toast.error(err.message);
      setDetailId(null);
    } finally { setDetailLoading(false); }
  }, [toast]);

  useEffect(() => { if (detailId) loadDetail(detailId); }, [detailId, loadDetail]);

  useEffect(() => {
    if (!detailId && searchParams.get('open')) {
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
    }
  }, [detailId, searchParams, setSearchParams]);

  useRealtime((event) => {
    if (event?.type === 'order') {
      reload();
      if (detailId && event.orderId === detailId) loadDetail(detailId);
    }
  });

  useEffect(() => { setPage(1); }, [tab, type, payment, query, from, to]);

  const counts = useMemo(() => {
    const map = {};
    for (const c of data?.counts || []) map[c.status] = c.n;
    map.all = Object.values(map).reduce((a, b) => a + b, 0);
    return map;
  }, [data]);

  const rows = useMemo(() => {
    const list = [...(data?.orders || [])];
    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const va = a[sort.key] ?? '';
      const vb = b[sort.key] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return list;
  }, [data, sort]);

  const openDetail = (id) => {
    setDetailId(id);
    const next = new URLSearchParams(searchParams);
    next.set('open', String(id));
    setSearchParams(next, { replace: true });
  };

  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
    if (searchParams.get('open')) {
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
    }
  };

  const transition = async (order, status, reason) => {
    setBusy(true);
    try {
      await patch(`/admin/orders/${order.id}/status`, { status, reason });
      toast.success(`Order moved to ${titleize(status)}`);
      await loadDetail(order.id);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const itemTransition = async (order, item, status) => {
    setBusy(true);
    try {
      await patch(`/admin/orders/${order.id}/items/${item.id}/status`, { status });
      await loadDetail(order.id);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const [holdOrder, setHoldOrder] = useState(null);
  const [holdReason, setHoldReason] = useState('');
  const [cancelOrder, setCancelOrder] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [confirm, setConfirm] = useState(null);

  const [composer, setComposer] = useState(false);
  const [menu, setMenu] = useState(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [tabMenu, setTabMenu] = useState('all');
  const [menuSearch, setMenuSearch] = useState('');
  const [form, setForm] = useState({ guestName: '', guestPhone: '', type: 'dine_in', tableId: '', notes: '', priority: 'normal', offerCode: '' });
  const [lines, setLines] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createErrors, setCreateErrors] = useState([]);

  const openComposer = async () => {
    setComposer(true);
    setLines([]);
    setCreateErrors([]);
    setForm({ guestName: '', guestPhone: '', type: 'dine_in', tableId: '', notes: '', priority: 'normal', offerCode: '' });
    if (!menu) {
      setMenuLoading(true);
      try { setMenu(await get('/admin/menu')); }
      catch (err) { toast.error(err.message); }
      finally { setMenuLoading(false); }
    }
  };

  const groupsFor = (itemId) => (menu?.optionGroups || []).filter((g) => g.menu_item_id === itemId);
  const optionsFor = (groupId) => (menu?.options || []).filter((o) => o.group_id === groupId);
  const itemById = (id) => (menu?.items || []).find((i) => i.id === id);

  const addLine = (item, existingIndex = null) => {
    const groups = groupsFor(item.id);
    const selection = {};
    for (const g of groups) {
      const opts = optionsFor(g.id);
      if (!opts.length) continue;
      if (g.required) selection[g.id] = [opts.find((o) => o.is_default)?.id || opts[0].id];
      else if (g.selection_type === 'single' && opts.some((o) => o.is_default)) selection[g.id] = [opts.find((o) => o.is_default).id];
      else selection[g.id] = [];
    }
    const line = { key: `${item.id}-${Date.now()}`, menuItemId: item.id, name: item.name, price: Number(item.price), image: item.image_url, qty: 1, selection, instructions: '', allergy: false };
    setLines((prev) => existingIndex != null ? prev.map((l, i) => (i === existingIndex ? line : l)) : [...prev, line]);
  };

  const updateLine = (key, patchObj) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patchObj } : l)));

  const selectedOptions = (line) => {
    const ids = Object.values(line.selection || {}).flat();
    const opts = (menu?.options || []).filter((o) => ids.includes(o.id));
    return { ids, opts, delta: opts.reduce((s, o) => s + Number(o.price_delta), 0) };
  };

  const estimatedSubtotal = lines.reduce((sum, line) => {
    const { delta } = selectedOptions(line);
    return sum + (line.price + delta) * line.qty;
  }, 0);

  const submitComposer = async (e) => {
    e.preventDefault();
    if (!lines.length) { setCreateErrors(['Add at least one menu item.']); return; }
    const problems = [];
    for (const line of lines) {
      for (const g of groupsFor(line.menuItemId)) {
        if (g.required && !(line.selection?.[g.id] || []).length) problems.push(`${line.name}: choose ${g.name}.`);
        if ((line.selection?.[g.id] || []).length > g.max_select) problems.push(`${line.name}: too many ${g.name} options.`);
      }
    }
    if (problems.length) { setCreateErrors(problems); return; }
    setCreating(true);
    setCreateErrors([]);
    try {
      const body = {
        type: form.type,
        guestName: form.guestName.trim() || null,
        guestPhone: form.guestPhone.trim() || null,
        tableId: form.tableId ? Number(form.tableId) : null,
        notes: form.notes,
        priority: form.priority,
        offerCode: form.offerCode.trim() || undefined,
        items: lines.map((line) => ({
          menuItemId: line.menuItemId,
          qty: line.qty,
          optionIds: selectedOptions(line).ids,
          instructions: line.instructions,
          allergy: line.allergy,
        })),
      };
      const res = await post('/admin/orders', body);
      toast.success(`Order ${res.order.order_number} sent to the kitchen`);
      setComposer(false);
      reload();
      openDetail(res.order.id);
    } catch (err) {
      setCreateErrors(err.data?.details || [err.message]);
      toast.error(err.message);
    } finally { setCreating(false); }
  };

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const SortIcon = ({ col }) => (sort.key !== col ? null : sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />);

  const categories = menu?.categories || [];
  const filteredMenuItems = (menu?.items || []).filter((i) => {
    if (!i.available) return false;
    if (tabMenu !== 'all' && i.category_id !== Number(tabMenu)) return false;
    if (menuSearch && !`${i.name} ${i.category_name}`.toLowerCase().includes(menuSearch.toLowerCase())) return false;
    return true;
  });

  const detailActions = detail ? (NEXT_ACTIONS[detail.status] || []) : [];
  const canHold = detail && ['pending', 'confirmed', 'preparing'].includes(detail.status);
  const canCancel = detail && ['pending', 'confirmed', 'preparing', 'ready', 'collected', 'on_hold'].includes(detail.status);

  return (
    <>
      <PageHeader title="Orders" description="Every order from the first tap to the final handover, with a complete history trail.">
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
        <button className="btn btn-primary btn-sm" onClick={openComposer}><Plus size={14} /> New order</button>
      </PageHeader>

      <Tabs tabs={STATUS_TABS.map((s) => ({ key: s, label: titleize(s), count: counts[s] ?? '' }))} value={tab} onChange={setTab} />

      <div className="toolbar" style={{ marginTop: 14 }}>
        <SearchBox value={q} onChange={setQ} onSubmit={() => setQuery(q.trim())} placeholder="Order number, guest, phone…" />
        <select className="select" style={{ height: 34, width: 140 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          <option value="dine_in">Dine-in</option>
          <option value="takeaway">Takeaway</option>
          <option value="preorder">Pre-order</option>
        </select>
        <select className="select" style={{ height: 34, width: 170 }} value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="all">Any payment status</option>
          <option value="pending">Payment pending</option>
          <option value="paid">Paid</option>
          <option value="partially_refunded">Partially refunded</option>
          <option value="refunded">Refunded</option>
          <option value="failed">Failed</option>
        </select>
        <label className="small muted">From</label>
        <input type="date" className="input" style={{ width: 148, height: 34 }} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <label className="small muted">To</label>
        <input type="date" className="input" style={{ width: 148, height: 34 }} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        {(from || to || query || type !== 'all' || payment !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); setQ(''); setQuery(''); setType('all'); setPayment('all'); }}>Clear</button>
        )}
        <span className="small muted" style={{ marginLeft: 'auto' }}>{num(data?.total)} order{data?.total === 1 ? '' : 's'}</span>
      </div>

      <SectionCard noPad>
        {loading && !data ? <Loading label="Loading orders…" /> : error ? <ErrorState error={error} onRetry={reload} /> : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('order_number')}>Order <SortIcon col="order_number" /></th>
                    <th>Guest / table</th>
                    <th>Type</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('placed_at')}>Placed <SortIcon col="placed_at" /></th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th className="right" style={{ cursor: 'pointer' }} onClick={() => toggleSort('total')}>Total <SortIcon col="total" /></th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="row-click" onClick={() => openDetail(o.id)}>
                      <td className="primary-cell">
                        {o.order_number}
                        <div className="sub-cell">{titleize(o.source)} · {o.item_count} line{o.item_count === 1 ? '' : 's'}{o.item_qty ? ` · ${o.item_qty} items` : ''}</div>
                      </td>
                      <td>
                        {o.customer_name || o.guest_name || 'Guest'}
                        <div className="sub-cell">{o.table_label ? `Table ${o.table_label}` : TYPE_LABEL[o.type]}{o.guest_phone ? ` · ${o.guest_phone}` : ''}</div>
                      </td>
                      <td className="small">{TYPE_LABEL[o.type] || o.type}{o.priority === 'high' ? <div className="sub-cell" style={{ color: 'var(--red)', fontWeight: 600 }}>Priority</div> : null}</td>
                      <td className="small">{fmtTime(o.placed_at)}<div className="sub-cell">{fmtDate(o.placed_at)} · {timeAgo(o.placed_at)}</div></td>
                      <td><StatusBadge status={o.status} />{o.status === 'preparing' && o.item_qty ? <div className="sub-cell">{o.ready_items || 0}/{o.item_qty} ready</div> : null}</td>
                      <td><StatusBadge status={o.payment_status} /></td>
                      <td className="right num strong">{inr(o.total)}</td>
                      <td className="right"><button className="btn btn-secondary btn-xs" onClick={(e) => { e.stopPropagation(); openDetail(o.id); }}><Eye size={12} /> View</button></td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={8}><EmptyState icon={ShoppingBag} title="No orders in this view" description="Change the filters or create a new order." action={<button className="btn btn-primary btn-sm" onClick={openComposer}><Plus size={14} /> New order</button>} /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={data?.page || page} limit={data?.limit || 15} total={data?.total || 0} onPage={setPage} />
          </>
        )}
      </SectionCard>

      {/* Order detail */}
      <Drawer
        open={!!detailId}
        onClose={closeDetail}
        title={detail ? detail.order_number : 'Order detail'}
        subtitle={detail ? `${fmtDateTime(detail.placed_at)} · ${TYPE_LABEL[detail.type] || detail.type}` : 'Loading…'}
        footer={detail ? (
          <>
            <button className="btn btn-secondary" onClick={() => loadDetail(detail.id)} disabled={busy}><RefreshCw size={14} /> Refresh</button>
            {canHold && <button className="btn btn-secondary" onClick={() => { setHoldReason(''); setHoldOrder(detail); }}><PauseCircle size={14} /> Hold</button>}
            {canCancel && <button className="btn btn-soft-danger" onClick={() => { setCancelReason(''); setCancelOrder(detail); }}><XCircle size={14} /> Cancel</button>}
            {detailActions.map((a) => (
              <button key={a.status} className={`btn ${a.primary ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} onClick={() => transition(detail, a.status)}>
                <a.icon size={14} /> {a.label}
              </button>
            ))}
          </>
        ) : null}
      >
        {detailLoading && !detail ? <Loading label="Loading order…" /> : detail ? (
          <>
            <div className="between" style={{ marginBottom: 12 }}>
              <div className="flex gap-8 items-center"><StatusBadge status={detail.status} /><StatusBadge status={detail.payment_status} /><Badge tone={detail.priority === 'high' ? 'red' : ''}>{titleize(detail.priority)} priority</Badge></div>
              <span className="small muted">{timeAgo(detail.placed_at)}</span>
            </div>

            {detail.status === 'on_hold' && detail.hold_reason && <div className="notice warn" style={{ marginBottom: 14 }}><PauseCircle size={15} /><div><strong>On hold.</strong> {detail.hold_reason}</div></div>}
            {detail.status === 'cancelled' && <div className="notice danger" style={{ marginBottom: 14 }}><XCircle size={15} /><div><strong>Cancelled.</strong> {detail.cancel_reason || 'No reason recorded.'}</div></div>}

            <div className="grid g2" style={{ gap: 10, marginBottom: 14 }}>
              <div className="card card-pad" style={{ padding: 13 }}>
                <div className="tiny muted">Guest</div>
                <div className="strong">{detail.customer_name || detail.guest_name || 'Walk-in guest'}</div>
                <div className="tiny muted">{detail.customer_phone || detail.guest_phone || 'No phone'}{detail.customer_email ? ` · ${detail.customer_email}` : ''}</div>
              </div>
              <div className="card card-pad" style={{ padding: 13 }}>
                <div className="tiny muted">{detail.table_label ? 'Table' : 'Service'}</div>
                <div className="strong">{detail.table_label || TYPE_LABEL[detail.type]}</div>
                <div className="tiny muted">{detail.waiter_name ? `Waiter: ${detail.waiter_name}` : detail.collected_by_name ? `Collected by ${detail.collected_by_name}` : `Source: ${titleize(detail.source)}`}</div>
              </div>
            </div>

            <SectionCard title="Items" subtitle="Item-level preparation status" noPad className="" >
              <div style={{ padding: '0 16px' }}>
                {detail.items.map((item) => (
                  <div key={item.id} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="between" style={{ alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.qty} × {item.name_snapshot}</div>
                        <div className="tiny muted">
                          {inr(item.unit_price)} each · {inr(item.line_total)}
                          {item.station_name ? ` · ${item.station_name}` : ''}
                          {item.assigned_staff_name ? ` · ${item.assigned_staff_name}` : ''}
                        </div>
                        {item.options?.length ? <div className="tiny muted">{item.options.map((o) => `${o.group}: ${o.name}`).join(' · ')}</div> : null}
                        {item.special_instructions && <div className="tiny" style={{ color: 'var(--amber)', marginTop: 2 }}>“{item.special_instructions}”</div>}
                        {item.allergy_flag ? <Badge tone="red" className="tiny" style={{ marginTop: 4 }}><AlertTriangle size={10} /> Allergen alert</Badge> : null}
                      </div>
                      <div className="flex gap-4 items-center">
                        <StatusBadge status={item.status} />
                        {ITEM_NEXT[item.status] && !['completed', 'cancelled'].includes(detail.status) && (
                          <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => itemTransition(detail, item, ITEM_NEXT[item.status])}>
                            {titleize(ITEM_NEXT[item.status])}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <div className="divider" />

            <div className="grid g2" style={{ gap: 16 }}>
              <div>
                <h4 className="card-title" style={{ marginBottom: 8 }}>Totals</h4>
                <div className="kv"><dt>Subtotal</dt><dd>{inr(detail.subtotal)}</dd></div>
                <div className="kv"><dt>Tax</dt><dd>{inr(detail.tax_amount)}</dd></div>
                {Number(detail.service_charge) > 0 && <div className="kv"><dt>Service charge</dt><dd>{inr(detail.service_charge)}</dd></div>}
                {Number(detail.discount_amount) > 0 && <div className="kv"><dt>Offer {detail.offer_code ? `(${detail.offer_code})` : ''}</dt><dd style={{ color: 'var(--green)' }}>−{inr(detail.discount_amount)}</dd></div>}
                {Number(detail.loyalty_discount) > 0 && <div className="kv"><dt>Loyalty</dt><dd style={{ color: 'var(--green)' }}>−{inr(detail.loyalty_discount)}</dd></div>}
                <div className="kv" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 10, fontSize: 14 }}><dt><strong>Total</strong></dt><dd><strong>{inr(detail.total)}</strong></dd></div>
                {detail.notes && <div className="notice" style={{ marginTop: 12 }}><UtensilsCrossed size={14} /><span>{detail.notes}</span></div>}
              </div>
              <div>
                <h4 className="card-title" style={{ marginBottom: 8 }}>Payments</h4>
                {detail.payments?.length ? detail.payments.map((p) => (
                  <div key={p.id} className="between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                    <div><div className="code tiny">{p.transaction_ref}</div><div className="tiny muted">{titleize(p.method)} · {p.paid_at ? fmtDateTime(p.paid_at) : 'Not verified'}</div></div>
                    <div style={{ textAlign: 'right' }}><div className="strong tiny">{inr(p.amount - p.refunded_amount)}</div><StatusBadge status={p.status} /></div>
                  </div>
                )) : <div className="small muted" style={{ padding: '10px 0' }}>No payment recorded yet.</div>}
                <a className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} href="/admin/payments"><CreditCard size={14} /> Go to payments</a>
              </div>
            </div>

            <div className="divider" />
            <h4 className="card-title" style={{ marginBottom: 10 }}>Order history</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {(detail.history || []).map((h, i) => (
                <div key={h.id} style={{ display: 'flex', gap: 10, paddingBottom: 12, position: 'relative' }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: i === detail.history.length - 1 ? 'var(--accent)' : 'var(--line-strong)', marginTop: 4, flex: '0 0 auto' }} />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{titleize(h.status)}{h.actor_name ? ` · ${h.actor_name}` : ''}</div>
                    <div className="tiny muted">{fmtDateTime(h.created_at)}{h.note ? ` · ${h.note}` : ''}</div>
                  </div>
                </div>
              ))}
              {!detail.history?.length && <div className="small muted">No history recorded.</div>}
            </div>
          </>
        ) : null}
      </Drawer>

      <Modal
        open={!!holdOrder}
        onClose={() => setHoldOrder(null)}
        title="Place order on hold"
        subtitle={holdOrder?.order_number}
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setHoldOrder(null)} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !holdReason.trim()} onClick={async () => { await transition(holdOrder, 'on_hold', holdReason.trim()); setHoldOrder(null); }}><PauseCircle size={15} /> Hold order</button>
          </>
        )}
      >
        <Field label="Reason (required)" hint="The kitchen and floor staff will see this reason.">
          <textarea className="textarea" rows={3} value={holdReason} onChange={(e) => setHoldReason(e.target.value)} placeholder="Waiting on guest confirmation…" />
        </Field>
      </Modal>

      <Modal
        open={!!cancelOrder}
        onClose={() => setCancelOrder(null)}
        title="Cancel order"
        subtitle={cancelOrder?.order_number}
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setCancelOrder(null)} disabled={busy}>Keep order</button>
            <button className="btn btn-danger" disabled={busy} onClick={async () => { await transition(cancelOrder, 'cancelled', cancelReason || 'Cancelled by staff'); setCancelOrder(null); }}><XCircle size={15} /> Cancel order</button>
          </>
        )}
      >
        <div className="notice warn" style={{ marginBottom: 12 }}><AlertTriangle size={15} /><span>Cancellation is recorded in order history. A paid order keeps its payment record for refund processing.</span></div>
        <Field label="Reason">
          <textarea className="textarea" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Out of stock, guest request…" />
        </Field>
      </Modal>

      {/* New order composer */}
      <Modal
        open={composer}
        onClose={() => setComposer(false)}
        title="New order"
        subtitle="Prices and stations are re-validated on the server before the kitchen receives it."
        size="wide"
        footer={(
          <>
            <div className="small muted" style={{ marginRight: 'auto' }}>{lines.length} line{lines.length === 1 ? '' : 's'} · subtotal <strong style={{ color: 'var(--ink)' }}>{inr(estimatedSubtotal)}</strong> <span className="tiny">(+ tax &amp; charges calculated server-side)</span></div>
            <button className="btn btn-secondary" onClick={() => setComposer(false)} disabled={creating}>Cancel</button>
            <button className="btn btn-primary" form="new-order-form" type="submit" disabled={creating || !lines.length}><Send size={15} /> {creating ? 'Sending…' : 'Send to kitchen'}</button>
          </>
        )}
      >
        {menuLoading ? <Loading label="Loading menu…" /> : menu ? (
          <form id="new-order-form" onSubmit={submitComposer}>
            <div className="form-grid" style={{ marginBottom: 14 }}>
              <Field label="Guest name">
                <input className="input" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} placeholder="Optional walk-in name" />
              </Field>
              <Field label="Guest phone">
                <input className="input" value={form.guestPhone} onChange={(e) => setForm({ ...form, guestPhone: e.target.value })} placeholder="Optional" />
              </Field>
              <Field label="Order type">
                <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="dine_in">Dine-in</option>
                  <option value="takeaway">Takeaway</option>
                </select>
              </Field>
              <Field label="Table (optional)">
                <input className="input" type="number" min={1} value={form.tableId} onChange={(e) => setForm({ ...form, tableId: e.target.value })} placeholder="Table ID" />
              </Field>
              <Field label="Priority">
                <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="low">Low</option>
                </select>
              </Field>
              <Field label="Offer code (optional)">
                <input className="input" value={form.offerCode} onChange={(e) => setForm({ ...form, offerCode: e.target.value })} placeholder="BREW10" />
              </Field>
              <Field label="Kitchen notes" className="full">
                <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Allergies, timing, service notes…" />
              </Field>
            </div>

            {createErrors.length > 0 && (
              <div className="notice danger" style={{ marginBottom: 12 }}>
                <AlertTriangle size={15} />
                <div>{createErrors.map((e, i) => <div key={i}>{e}</div>)}</div>
              </div>
            )}

            <div className="split-2" style={{ gap: 16 }}>
              <div>
                <div className="between" style={{ marginBottom: 8 }}>
                  <h4 className="card-title">Menu</h4>
                  <div className="search" style={{ height: 32, minWidth: 140 }}><Search size={14} /><input value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} placeholder="Search menu…" /></div>
                </div>
                <div className="chip-row" style={{ marginBottom: 10 }}>
                  <button type="button" className={`chip ${tabMenu === 'all' ? 'active' : ''}`} onClick={() => setTabMenu('all')}>All</button>
                  {categories.map((c) => <button type="button" key={c.id} className={`chip ${tabMenu === String(c.id) ? 'active' : ''}`} onClick={() => setTabMenu(String(c.id))}>{c.name}</button>)}
                </div>
                <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
                  {filteredMenuItems.map((item) => (
                    <div key={item.id} className="between" style={{ padding: '8px 11px', borderBottom: '1px solid var(--line)', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.name}</div>
                        <div className="tiny muted">{item.category_name} · {inr(item.price)} · {item.prep_time}m</div>
                      </div>
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => addLine(item)}><Plus size={12} /> Add</button>
                    </div>
                  ))}
                  {!filteredMenuItems.length && <div className="empty" style={{ padding: 24 }}><div className="small muted">No available items match.</div></div>}
                </div>
              </div>

              <div>
                <h4 className="card-title" style={{ marginBottom: 8 }}>Order lines ({lines.length})</h4>
                <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {lines.map((line, idx) => {
                    const { ids, delta } = selectedOptions(line);
                    return (
                      <div key={line.key} className="card card-pad" style={{ padding: 11 }}>
                        <div className="between" style={{ gap: 8 }}>
                          <div className="strong small">{line.name}</div>
                          <div className="flex gap-4 items-center">
                            <div className="qty-stepper" style={{ height: 28, borderRadius: 7 }}>
                              <button type="button" onClick={() => updateLine(line.key, { qty: Math.max(1, line.qty - 1) })} style={{ height: 20 }}><Minus size={11} /></button>
                              <span style={{ fontSize: 11.5, minWidth: 18 }}>{line.qty}</span>
                              <button type="button" onClick={() => updateLine(line.key, { qty: Math.min(20, line.qty + 1) })} style={{ height: 20 }}><Plus size={11} /></button>
                            </div>
                            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}><Trash2 size={12} /></button>
                          </div>
                        </div>
                        {groupsFor(line.menuItemId).map((g) => {
                          const opts = optionsFor(g.id);
                          if (!opts.length) return null;
                          const chosen = line.selection?.[g.id] || [];
                          if (g.selection_type === 'multi') {
                            return (
                              <div key={g.id} style={{ marginTop: 6 }}>
                                <div className="tiny muted">{g.name}{g.required ? ' *' : ''} (up to {g.max_select})</div>
                                <div className="flex gap-4 wrap" style={{ marginTop: 3 }}>
                                  {opts.map((o) => {
                                    const on = chosen.includes(o.id);
                                    return (
                                      <button type="button" key={o.id} className={`chip ${on ? 'active' : ''}`} style={{ padding: '3px 8px', fontSize: 10.5 }}
                                        onClick={() => {
                                          let next = on ? chosen.filter((id) => id !== o.id) : [...chosen, o.id];
                                          if (next.length > g.max_select) next = next.slice(-g.max_select);
                                          updateLine(line.key, { selection: { ...line.selection, [g.id]: next } });
                                        }}>
                                        {o.name}{Number(o.price_delta) ? ` +${inr(o.price_delta)}` : ''}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div key={g.id} style={{ marginTop: 6 }}>
                              <div className="tiny muted">{g.name}{g.required ? ' *' : ''}</div>
                              <select className="select" style={{ height: 30, fontSize: 12, marginTop: 3 }} value={chosen[0] || ''}
                                onChange={(e) => updateLine(line.key, { selection: { ...line.selection, [g.id]: e.target.value ? [Number(e.target.value)] : [] } })}>
                                <option value="">{g.required ? 'Choose…' : 'No selection'}</option>
                                {opts.map((o) => <option key={o.id} value={o.id}>{o.name}{Number(o.price_delta) ? ` (+${inr(o.price_delta)})` : ''}</option>)}
                              </select>
                            </div>
                          );
                        })}
                        <div className="flex gap-8 items-center" style={{ marginTop: 7 }}>
                          <input className="input" style={{ height: 30, fontSize: 12 }} value={line.instructions} onChange={(e) => updateLine(line.key, { instructions: e.target.value })} placeholder="Item notes…" />
                          <label className="check tiny nowrap"><input type="checkbox" checked={line.allergy} onChange={(e) => updateLine(line.key, { allergy: e.target.checked })} /> Allergy</label>
                        </div>
                        <div className="between tiny" style={{ marginTop: 6 }}>
                          <span className="muted">{ids.length} option{ids.length === 1 ? '' : 's'}</span>
                          <strong>{inr((line.price + delta) * line.qty)}</strong>
                        </div>
                      </div>
                    );
                  })}
                  {!lines.length && <div className="empty" style={{ padding: 26 }}><div className="small muted">Add items from the menu to build the order.</div></div>}
                </div>
              </div>
            </div>
          </form>
        ) : <div className="empty"><div className="small muted">Menu could not be loaded.</div></div>}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel="Confirm"
        busy={busy}
        onConfirm={confirm?.run}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
