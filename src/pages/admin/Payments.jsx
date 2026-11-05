import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Check, CreditCard, Download, Eye, IndianRupee, Plus, Receipt, RefreshCw,
  RotateCcw, Search, ShieldCheck, XCircle,
} from 'lucide-react';
import { get, patch, post, qs } from '../../lib/api';
import { useAuth, useFetch, useRealtime, useToast } from '../../lib/store';
import {
  Badge, Drawer, EmptyState, ErrorState, Field, Loading, Modal, PageHeader, Pagination,
  SearchBox, SectionCard, StatusBadge, Tabs, Toggle,
} from '../../components/ui';
import { fmtDate, fmtDateTime, inr, num, timeAgo, titleize, todayISO } from '../../lib/format';

const STATUS_TABS = ['all', 'paid', 'pending', 'failed', 'partially_refunded', 'refunded'];
const METHODS = ['cash', 'upi', 'card', 'other'];

export default function Payments() {
  const toast = useToast();
  const { isManager } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('all');
  const [method, setMethod] = useState('all');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const path = useMemo(
    () => `/admin/payments${qs({ status: tab, method, q: query, from, to, page, limit: 20 })}`,
    [tab, method, query, from, to, page]
  );
  const { data, loading, error, reload } = useFetch(path);
  useRealtime((event) => { if (event?.type === 'payment') reload(); });
  useEffect(() => { setPage(1); }, [tab, method, query, from, to]);

  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadDetail = async (id) => {
    setDetailLoading(true);
    try {
      const res = await get(`/admin/payments/${id}`);
      setDetail(res);
    } catch (err) { toast.error(err.message); setDetailId(null); }
    finally { setDetailLoading(false); }
  };
  useEffect(() => { if (detailId) loadDetail(detailId); }, [detailId]);

  const summary = useMemo(() => {
    const map = {};
    for (const s of data?.summary || []) map[s.status] = { count: s.count, amount: Number(s.amount) };
    return map;
  }, [data]);

  // ---------------------------------------------------------- Record payment
  const [recordOpen, setRecordOpen] = useState(false);
  const [orderQuery, setOrderQuery] = useState('');
  const [orderResults, setOrderResults] = useState([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [payForm, setPayForm] = useState({ amount: '', method: 'upi', reference: '', notes: '', verified: false });
  const [saving, setSaving] = useState(false);
  const [payErrors, setPayErrors] = useState({});

  const searchOrders = async (term) => {
    setOrderLoading(true);
    try {
      const res = await get(`/admin/orders${qs({ q: term, payment: 'pending', limit: 8 })}`);
      setOrderResults(res.orders || []);
    } catch (err) { toast.error(err.message); }
    finally { setOrderLoading(false); }
  };

  const openRecord = async () => {
    setRecordOpen(true);
    setOrderQuery('');
    setSelectedOrder(null);
    setPayForm({ amount: '', method: 'upi', reference: '', notes: '', verified: false });
    setPayErrors({});
    await searchOrders('');
  };

  useEffect(() => {
    const orderId = searchParams.get('order');
    if (!orderId) return;
    (async () => {
      try {
        const res = await get(`/admin/orders/${orderId}`);
        setSelectedOrder(res.order);
        setPayForm((f) => ({ ...f, amount: Number(res.order.total) - Number((res.order.payments || []).reduce((s, p) => s + Number(p.amount) - Number(p.refunded_amount), 0)) }));
        setRecordOpen(true);
        await searchOrders('');
      } catch { /* ignore */ }
    })();
    const next = new URLSearchParams(searchParams);
    next.delete('order');
    setSearchParams(next, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseOrder = (order) => {
    setSelectedOrder(order);
    setPayForm((f) => ({ ...f, amount: Number(order.total) }));
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    const localErrors = {};
    if (!selectedOrder) localErrors.orderId = 'Choose an order.';
    if (!(Number(payForm.amount) > 0)) localErrors.amount = 'Enter the amount received.';
    if (Object.keys(localErrors).length) { setPayErrors(localErrors); return; }
    setSaving(true);
    setPayErrors({});
    try {
      await post('/admin/payments', {
        orderId: selectedOrder.id,
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined,
        notes: payForm.notes || undefined,
        markPaid: payForm.verified,
      });
      toast.success(payForm.verified ? 'Verified payment recorded' : 'Pending payment recorded');
      setRecordOpen(false);
      reload();
    } catch (err) {
      setPayErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const updateStatus = async (payment, status) => {
    setBusy(true);
    try {
      await patch(`/admin/payments/${payment.id}/status`, { status, note: status === 'paid' ? 'Payment verified by management' : 'Marked failed by management' });
      toast.success(`Payment marked ${status}`);
      await loadDetail(payment.id);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const [refundTarget, setRefundTarget] = useState(null);
  const [refundForm, setRefundForm] = useState({ amount: '', reason: '' });
  const openRefund = (p) => {
    setRefundForm({ amount: Number(p.amount) - Number(p.refunded_amount), reason: '' });
    setRefundTarget(p);
  };
  const submitRefund = async () => {
    setBusy(true);
    try {
      await post(`/admin/payments/${refundTarget.id}/refund`, { amount: Number(refundForm.amount), reason: refundForm.reason });
      toast.success('Refund recorded');
      setRefundTarget(null);
      await loadDetail(detailId);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const netPaid = Number(summary.paid?.amount || 0) + Number(summary.partially_refunded?.amount || 0);

  return (
    <>
      <PageHeader title="Payments" description="Verified transactions, refunds and gateway-ready records. A payment is never marked successful without an explicit staff action.">
        <a className="btn btn-secondary btn-sm" href={`/api/admin/export${qs({ type: 'payments', from: from || todayISO(), to: to || todayISO() })}`}><Download size={14} /> Export CSV</a>
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
        <button className="btn btn-primary btn-sm" onClick={openRecord}><Plus size={14} /> Record payment</button>
      </PageHeader>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card card-pad" style={{ padding: 14 }}><div className="tiny muted">Paid (all time)</div><div style={{ fontSize: 22, fontWeight: 600 }}>{inr(netPaid)}</div><div className="tiny muted">{num((summary.paid?.count || 0) + (summary.partially_refunded?.count || 0))} verified transaction(s)</div></div>
        <div className="card card-pad" style={{ padding: 14 }}><div className="tiny muted">Awaiting verification</div><div style={{ fontSize: 22, fontWeight: 600, color: 'var(--amber)' }}>{inr(summary.pending?.amount)}</div><div className="tiny muted">{num(summary.pending?.count)} pending</div></div>
        <div className="card card-pad" style={{ padding: 14 }}><div className="tiny muted">Refunded</div><div style={{ fontSize: 22, fontWeight: 600, color: 'var(--purple)' }}>{inr(summary.refunded?.amount)}</div><div className="tiny muted">{num(summary.refunded?.count)} fully refunded</div></div>
        <div className="card card-pad" style={{ padding: 14 }}><div className="tiny muted">Failed</div><div style={{ fontSize: 22, fontWeight: 600, color: 'var(--red)' }}>{inr(summary.failed?.amount)}</div><div className="tiny muted">{num(summary.failed?.count)} failed attempts</div></div>
      </div>

      <Tabs tabs={STATUS_TABS.map((s) => ({ key: s, label: titleize(s), count: s === 'all' ? Object.values(summary).reduce((a, b) => a + b.count, 0) : summary[s]?.count ?? '' }))} value={tab} onChange={setTab} />

      <div className="toolbar" style={{ marginTop: 14 }}>
        <SearchBox value={q} onChange={setQ} onSubmit={() => setQuery(q.trim())} placeholder="Transaction, order or customer…" />
        <select className="select" style={{ height: 34, width: 140 }} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="all">All methods</option>
          {METHODS.map((m) => <option key={m} value={m}>{titleize(m)}</option>)}
        </select>
        <label className="small muted">From</label>
        <input type="date" className="input" style={{ width: 148, height: 34 }} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <label className="small muted">To</label>
        <input type="date" className="input" style={{ width: 148, height: 34 }} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        {(from || to || query || method !== 'all') && <button className="btn btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); setQ(''); setQuery(''); setMethod('all'); }}>Clear</button>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>{num(data?.total)} record{data?.total === 1 ? '' : 's'}</span>
      </div>

      <SectionCard noPad>
        {loading && !data ? <Loading label="Loading payments…" /> : error ? <ErrorState error={error} onRetry={reload} /> : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Transaction</th><th>Order</th><th>Customer</th><th>Method</th><th>Status</th><th className="right">Amount</th><th className="right">Refunded</th><th>When</th><th /></tr></thead>
                <tbody>
                  {(data?.payments || []).map((p) => (
                    <tr key={p.id} className="row-click" onClick={() => setDetailId(p.id)}>
                      <td className="primary-cell code">{p.transaction_ref}<div className="sub-cell">{p.gateway_ref ? `Gateway ${p.gateway_ref}` : p.notes || 'Manual record'}</div></td>
                      <td className="small">{p.order_number || '—'}<div className="sub-cell">Order total {inr(p.order_total)}</div></td>
                      <td className="small">{p.customer_name || 'Guest'}</td>
                      <td><Badge tone="blue">{titleize(p.method)}</Badge></td>
                      <td><StatusBadge status={p.status} /></td>
                      <td className="right num strong">{inr(p.amount)}</td>
                      <td className="right num" style={{ color: Number(p.refunded_amount) ? 'var(--purple)' : 'var(--faint)' }}>{Number(p.refunded_amount) ? `−${inr(p.refunded_amount)}` : '—'}</td>
                      <td className="small">{p.paid_at ? fmtDateTime(p.paid_at) : <span className="muted">Not verified</span>}<div className="sub-cell">{timeAgo(p.created_at)}</div></td>
                      <td className="right"><button className="btn btn-secondary btn-xs" onClick={(e) => { e.stopPropagation(); setDetailId(p.id); }}><Eye size={12} /> View</button></td>
                    </tr>
                  ))}
                  {!data?.payments?.length && <tr><td colSpan={9}><EmptyState icon={CreditCard} title="No payments in this view" description="Record a verified payment or change the filters." action={<button className="btn btn-primary btn-sm" onClick={openRecord}><Plus size={14} /> Record payment</button>} /></td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination page={data?.page || page} limit={data?.limit || 20} total={data?.total || 0} onPage={setPage} />
          </>
        )}
      </SectionCard>

      <Drawer
        open={!!detailId}
        onClose={() => { setDetailId(null); setDetail(null); }}
        title={detail ? detail.payment.transaction_ref : 'Payment detail'}
        subtitle={detail ? `${titleize(detail.payment.method)} · ${fmtDateTime(detail.payment.created_at)}` : 'Loading…'}
        footer={detail ? (
          <>
            <button className="btn btn-secondary" onClick={() => loadDetail(detailId)}><RefreshCw size={14} /> Refresh</button>
            {isManager && detail.payment.status === 'pending' && (
              <>
                <button className="btn btn-soft-danger" disabled={busy} onClick={() => updateStatus(detail.payment, 'failed')}><XCircle size={14} /> Mark failed</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => updateStatus(detail.payment, 'paid')}><ShieldCheck size={14} /> Verify as paid</button>
              </>
            )}
            {isManager && ['paid', 'partially_refunded'].includes(detail.payment.status) && (
              <button className="btn btn-secondary" disabled={busy} onClick={() => openRefund(detail.payment)}><RotateCcw size={14} /> Refund</button>
            )}
          </>
        ) : null}
      >
        {detailLoading && !detail ? <Loading label="Loading payment…" /> : detail ? (
          <>
            <div className="between" style={{ marginBottom: 14 }}>
              <StatusBadge status={detail.payment.status} /><Badge tone="blue">{titleize(detail.payment.method)}</Badge>
              <span className="small muted">{timeAgo(detail.payment.created_at)}</span>
            </div>
            <div className="card card-pad" style={{ background: 'var(--surface-2)', textAlign: 'center', marginBottom: 14 }}>
              <div className="tiny muted">Amount recorded</div>
              <div className="stat-value serif" style={{ marginTop: 4 }}>{inr(detail.payment.amount)}</div>
              {Number(detail.payment.refunded_amount) > 0 && <div className="small" style={{ color: 'var(--purple)', fontWeight: 600 }}>Refunded {inr(detail.payment.refunded_amount)} · net {inr(Number(detail.payment.amount) - Number(detail.payment.refunded_amount))}</div>}
            </div>
            <div className="kv"><dt>Order</dt><dd>{detail.payment.order_number || '—'}</dd></div>
            <div className="kv"><dt>Customer</dt><dd>{detail.payment.customer_name || 'Guest'}</dd></div>
            <div className="kv"><dt>Order total</dt><dd>{inr(detail.payment.order_total)}</dd></div>
            <div className="kv"><dt>Reference</dt><dd className="code">{detail.payment.gateway_ref || '—'}</dd></div>
            <div className="kv"><dt>Verified at</dt><dd>{detail.payment.paid_at ? fmtDateTime(detail.payment.paid_at) : 'Not verified'}</dd></div>
            <div className="kv"><dt>Notes</dt><dd>{detail.payment.notes || '—'}</dd></div>
            <div className="notice info" style={{ marginTop: 12 }}><ShieldCheck size={15} /><span>This record is created by staff. Gateway integration points are isolated so a real provider can confirm or fail the transaction without changing stored figures.</span></div>
            <div className="divider" />
            <h4 className="card-title" style={{ marginBottom: 10 }}>Event log</h4>
            {(detail.events || []).map((ev) => (
              <div key={ev.id} style={{ display: 'flex', gap: 10, paddingBottom: 11 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: ev.event_type === 'refund' ? 'var(--purple)' : 'var(--green)', marginTop: 4 }} />
                <div>
                  <div className="small strong">{titleize(ev.event_type)} · {inr(ev.amount)}</div>
                  <div className="tiny muted">{fmtDateTime(ev.created_at)}{ev.note ? ` · ${ev.note}` : ''}</div>
                </div>
              </div>
            ))}
            {!detail.events?.length && <div className="small muted">No events recorded yet.</div>}
          </>
        ) : null}
      </Drawer>

      <Modal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        title="Record a payment"
        subtitle="A payment is only marked paid when you explicitly confirm it was verified."
        size="wide"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setRecordOpen(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="payment-form" type="submit" disabled={saving}><Check size={15} /> {saving ? 'Saving…' : payForm.verified ? 'Record verified payment' : 'Record pending payment'}</button>
          </>
        )}
      >
        <form id="payment-form" onSubmit={submitPayment} className="split-2" style={{ paddingTop: 6, gap: 16 }}>
          <div>
            <Field label="Find an order" error={payErrors.orderId}>
              <div className="search" style={{ marginBottom: 8 }}><Search size={15} /><input value={orderQuery} onChange={(e) => { setOrderQuery(e.target.value); searchOrders(e.target.value); }} placeholder="Order number, guest or phone…" /></div>
            </Field>
            <div style={{ maxHeight: 250, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
              {orderLoading ? <Loading label="Searching…" minHeight={100} /> : (orderResults || []).map((o) => (
                <button type="button" key={o.id} onClick={() => chooseOrder(o)} className="between" style={{ width: '100%', border: 0, background: selectedOrder?.id === o.id ? 'var(--accent-soft)' : 'transparent', padding: '9px 11px', borderBottom: '1px solid var(--line)', textAlign: 'left', gap: 8 }}>
                  <span>
                    <span className="small strong">{o.order_number}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>{o.customer_name || o.guest_name || 'Guest'} · {fmtDate(o.placed_at)}</span>
                  </span>
                  <span className="tiny">{inr(o.total)} · {titleize(o.payment_status)}</span>
                </button>
              ))}
              {!orderLoading && !orderResults.length && <div className="empty" style={{ padding: 20 }}><div className="small muted">No unpaid orders found. Search by order number.</div></div>}
            </div>
            {selectedOrder && (
              <div className="notice info" style={{ marginTop: 10 }}>
                <Receipt size={15} />
                <div><strong>{selectedOrder.order_number}</strong><br />Order total {inr(selectedOrder.total)} · payment {titleize(selectedOrder.payment_status)}</div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Amount received (₹)" error={payErrors.amount}>
              <input className="input" type="number" min="0.01" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} placeholder="0.00" />
            </Field>
            <Field label="Method" error={payErrors.method}>
              <select className="select" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                {METHODS.map((m) => <option key={m} value={m}>{titleize(m)}</option>)}
              </select>
            </Field>
            <Field label="Reference / UPI ID (optional)">
              <input className="input" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="e.g. UPI 4162…" />
            </Field>
            <Field label="Notes">
              <input className="input" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} placeholder="Cash at counter, card terminal…" />
            </Field>
            <div className={`notice ${payForm.verified ? 'info' : 'warn'}`}>
              <ShieldCheck size={15} />
              <div>
                <div className="between" style={{ gap: 10 }}>
                  <strong>I have verified this payment</strong>
                  <Toggle checked={payForm.verified} onChange={(v) => setPayForm({ ...payForm, verified: v })} label="Payment verified" />
                </div>
                <div className="tiny" style={{ marginTop: 3 }}>{payForm.verified ? 'This will be stored as paid with the current time.' : 'Leave off to record it as pending until the money is confirmed.'}</div>
              </div>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!refundTarget}
        onClose={() => setRefundTarget(null)}
        title="Issue refund"
        subtitle={refundTarget ? `${refundTarget.transaction_ref} · ${titleize(refundTarget.method)}` : undefined}
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setRefundTarget(null)} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !(Number(refundForm.amount) > 0)} onClick={submitRefund}><RotateCcw size={15} /> Record refund</button>
          </>
        )}
      >
        <div className="notice warn" style={{ marginBottom: 12 }}><AlertTriangle size={15} /><span>Refunds update the payment status and reduce net revenue. This action is recorded in the event log.</span></div>
        <Field label="Refund amount (₹)" hint={`Maximum ${refundTarget ? inr(Number(refundTarget.amount) - Number(refundTarget.refunded_amount)) : '—'}`}>
          <input className="input" type="number" min="0.01" step="0.01" value={refundForm.amount} onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })} />
        </Field>
        <Field label="Reason" className="" >
          <textarea className="textarea" rows={3} style={{ marginTop: 10 }} value={refundForm.reason} onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })} placeholder="Guest complaint, duplicate payment…" />
        </Field>
      </Modal>
    </>
  );
}
