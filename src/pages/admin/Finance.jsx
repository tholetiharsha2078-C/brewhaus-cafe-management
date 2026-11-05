import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Download, IndianRupee, Minus, PiggyBank, Plus, Receipt, RefreshCw,
  RotateCcw, Trash2, TrendingUp, Wallet,
} from 'lucide-react';
import { del, post, put, qs } from '../../lib/api';
import { useAuth, useFetch, useToast } from '../../lib/store';
import { AreaChart, Donut } from '../../components/charts';
import {
  Badge, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader,
  SectionCard, Stat, StatusBadge, Tabs, Toggle,
} from '../../components/ui';
import { addDaysISO, fmtDate, fmtDateShort, fmtDateTime, inr, num, titleize, todayISO } from '../../lib/format';

const PRESETS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7 days', days: 6 },
  { key: '30d', label: '30 days', days: 29 },
  { key: '90d', label: '90 days', days: 89 },
];
const EXPENSE_CATEGORIES = ['Ingredients', 'Rent', 'Salaries', 'Utilities', 'Marketing', 'Maintenance', 'Equipment', 'Licenses', 'Other'];
const emptyExpense = () => ({ category: 'Ingredients', description: '', amount: '', expenseDate: todayISO(), isEstimated: false, vendor: '', notes: '' });

export default function Finance() {
  const toast = useToast();
  const { isManager } = useAuth();
  const [from, setFrom] = useState(addDaysISO(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [preset, setPreset] = useState('30d');
  const [tab, setTab] = useState('expenses');

  const path = useMemo(() => `/admin/finance${qs({ from, to })}`, [from, to]);
  const { data, loading, error, reload } = useFetch(path);

  const applyPreset = (p) => {
    setPreset(p.key);
    setTo(todayISO());
    setFrom(addDaysISO(todayISO(), -p.days));
  };

  const [modal, setModal] = useState(null); // { editing, form }
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => { setErrors({}); setModal({ editing: null, form: emptyExpense() }); };
  const openEdit = (exp) => {
    setErrors({});
    setModal({
      editing: exp,
      form: {
        category: exp.category, description: exp.description, amount: exp.amount, expenseDate: exp.expense_date,
        isEstimated: Boolean(exp.is_estimated), vendor: exp.vendor || '', notes: exp.notes || '',
      },
    });
  };

  const saveExpense = async (e) => {
    e.preventDefault();
    const f = modal.form;
    const local = {};
    if (!f.category.trim()) local.category = 'Choose a category.';
    if (!f.description.trim()) local.description = 'Add a description.';
    if (!(Number(f.amount) >= 0) || f.amount === '') local.amount = 'Enter a valid amount.';
    if (!f.expenseDate) local.expenseDate = 'Choose a date.';
    if (Object.keys(local).length) { setErrors(local); return; }
    setSaving(true);
    setErrors({});
    try {
      const body = {
        category: f.category.trim(), description: f.description.trim(), amount: Number(f.amount),
        expenseDate: f.expenseDate, isEstimated: f.isEstimated, vendor: f.vendor.trim() || null, notes: f.notes.trim() || null,
      };
      if (modal.editing) await put(`/admin/expenses/${modal.editing.id}`, body);
      else await post('/admin/expenses', body);
      toast.success(modal.editing ? 'Expense updated' : 'Expense recorded');
      setModal(null);
      reload();
    } catch (err) {
      setErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const removeExpense = async (exp) => {
    setBusy(true);
    try {
      await del(`/admin/expenses/${exp.id}`);
      toast.success('Expense deleted');
      setConfirm(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  if (loading && !data) return <Loading label="Loading finance…" minHeight={420} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const s = data.summary || {};
  const daily = (data.daily || []).map((d) => ({ ...d, label: fmtDateShort(d.day) }));
  const methods = data.paymentMethods || [];
  const methodSegments = methods.map((m) => ({ label: titleize(m.method), value: Number(m.total) }));
  const expenses = data.expenses || [];
  const refunds = data.refunds || [];
  const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const margin = Number(s.netRevenue) ? ((Number(s.netRevenue) - Number(s.totalExpenses)) / Number(s.netRevenue)) * 100 : 0;

  return (
    <>
      <PageHeader title="Revenue & Finance" description="Gross and net revenue from verified payments, refunds, taxes and expenses. Actual and estimated costs are always kept separate.">
        <a className="btn btn-secondary btn-sm" href={`/api/admin/export${qs({ type: 'payments', from, to })}`} target="_blank" rel="noreferrer"><Download size={14} /> Payments CSV</a>
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
        <button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={14} /> Add expense</button>
      </PageHeader>

      <div className="card card-pad" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="flex items-center gap-12 wrap">
          <Wallet size={15} className="muted" />
          {PRESETS.map((p) => (
            <button key={p.key} className={`btn btn-sm ${preset === p.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
          <label className="small muted" style={{ marginLeft: 6 }}>From</label>
          <input type="date" className="input" style={{ width: 150, height: 34 }} value={from} max={to} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} />
          <label className="small muted">To</label>
          <input type="date" className="input" style={{ width: 150, height: 34 }} value={to} min={from} max={todayISO()} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} />
          <span className="small muted" style={{ marginLeft: 'auto' }}>{num(s.transactions)} verified transactions · {num(s.completedOrders)} completed orders</span>
        </div>
      </div>

      <div className="grid g6" style={{ marginBottom: 16 }}>
        <Stat label="Gross revenue" icon={IndianRupee} tone="accent" value={inr(s.grossRevenue)} meta="Before refunds" />
        <Stat label="Refunds" icon={RotateCcw} tone="red" value={inr(s.refunds)} meta="Recorded refunds" />
        <Stat label="Net revenue" icon={TrendingUp} tone="green" value={inr(s.netRevenue)} meta="Gross − refunds" />
        <Stat label="Expenses" icon={PiggyBank} tone="amber" value={inr(s.totalExpenses)} meta={`${inr(s.actualExpenses)} actual · ${inr(s.estimatedExpenses)} est.`} />
        <Stat label="Tax collected" icon={Receipt} value={inr(s.taxCollected)} meta={`on ${inr(s.orderRevenue)} of served orders`} />
        <Stat label="Net after costs" icon={Wallet} tone={Number(s.netAfterExpenses) >= 0 ? 'green' : 'red'} value={inr(s.netAfterExpenses)} meta={`${margin.toFixed(1)}% margin`} />
      </div>

      <div className="split-2" style={{ marginBottom: 16 }}>
        <SectionCard
          title="Revenue in this period"
          subtitle="Net of refunds, from verified payment records"
          action={<Badge tone="accent">Avg {inr(s.averageTransaction)}</Badge>}
        >
          <AreaChart data={daily} valueKey="value" height={230} xLabel={(d) => fmtDateShort(d.day)} empty="No verified payments in this range" />
        </SectionCard>

        <SectionCard title="Payment methods" subtitle="Net amount by method">
          <Donut segments={methodSegments} centerLabel="net revenue" centerValue={inr(s.netRevenue)} format={(v) => inr(v)} />
          <div className="divider" />
          <div className="grid g2" style={{ gap: 8 }}>
            {methods.map((m) => (
              <div key={m.method} className="between small">
                <span>{titleize(m.method)} <span className="muted tiny">({num(m.count)})</span></span>
                <strong>{inr(m.total)}</strong>
              </div>
            ))}
            {!methods.length && <span className="small muted">No payments in range.</span>}
          </div>
        </SectionCard>
      </div>

      <Tabs
        tabs={[
          { key: 'expenses', label: 'Expenses', count: expenses.length },
          { key: 'refunds', label: 'Refunds', count: refunds.length },
          { key: 'taxes', label: 'Taxes & reconciliation' },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div style={{ marginTop: 14 }}>
        {tab === 'expenses' && (
          <SectionCard
            title="Expense ledger"
            subtitle="Estimated rows are clearly marked and never treated as actual cash out."
            action={<button className="btn btn-secondary btn-sm" onClick={openNew}><Plus size={13} /> Add</button>}
            noPad
          >
            {expenses.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Type</th><th className="right">Amount</th><th /></tr></thead>
                  <tbody>
                    {expenses.map((exp) => (
                      <tr key={exp.id}>
                        <td className="small nowrap">{fmtDate(exp.expense_date)}</td>
                        <td><Badge tone="blue">{exp.category}</Badge></td>
                        <td className="primary-cell">{exp.description}{exp.notes ? <div className="sub-cell">{exp.notes}</div> : null}</td>
                        <td className="small">{exp.vendor || '—'}</td>
                        <td><Badge tone={exp.is_estimated ? 'amber' : 'green'}>{exp.is_estimated ? 'Estimated' : 'Actual'}</Badge></td>
                        <td className="right num strong">{inr(exp.amount)}</td>
                        <td className="right">
                          <div className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-xs" onClick={() => openEdit(exp)}>Edit</button>
                            {isManager && <button className="btn btn-ghost btn-xs" onClick={() => setConfirm(exp)} title="Delete expense"><Trash2 size={12} /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'right', fontWeight: 600 }}>Total expenses</td>
                      <td className="right num strong">{inr(expenseTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <EmptyState icon={PiggyBank} title="No expenses in this range" description="Record rent, ingredients, salaries and other costs to see a true net figure." action={<button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={14} /> Add expense</button>} />
            )}
          </SectionCard>
        )}

        {tab === 'refunds' && (
          <SectionCard title="Refunds in this period" subtitle="Every refund reduces net revenue and is logged against the payment." noPad>
            {refunds.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Transaction</th><th>Order</th><th>Customer</th><th>Method</th><th>Status</th><th className="right">Refunded</th><th>Paid at</th></tr></thead>
                  <tbody>
                    {refunds.map((r) => (
                      <tr key={r.id}>
                        <td className="primary-cell code">{r.transaction_ref}</td>
                        <td className="small">{r.order_number || '—'}</td>
                        <td className="small">{r.customer_name || 'Guest'}</td>
                        <td><Badge tone="blue">{titleize(r.method)}</Badge></td>
                        <td><StatusBadge status={r.status} /></td>
                        <td className="right num" style={{ color: 'var(--purple)', fontWeight: 600 }}>−{inr(r.refunded_amount)}</td>
                        <td className="small">{r.paid_at ? fmtDateTime(r.paid_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={RotateCcw} title="No refunds" description="Refunds recorded against payments will be listed here." />}
          </SectionCard>
        )}

        {tab === 'taxes' && (
          <div className="split-2">
            <SectionCard title="Tax reconciliation" subtitle="Tax stored on served and completed orders">
              <div className="kv"><dt>Order revenue (served)</dt><dd>{inr(s.orderRevenue)}</dd></div>
              <div className="kv"><dt>Tax collected</dt><dd>{inr(s.taxCollected)}</dd></div>
              <div className="kv"><dt>Completed orders</dt><dd>{num(s.completedOrders)}</dd></div>
              <div className="kv"><dt>Average transaction</dt><dd>{inr(s.averageTransaction)}</dd></div>
              <div className="notice info" style={{ marginTop: 14 }}>
                <Receipt size={15} />
                <span>Tax comes from the <strong>tax_amount</strong> stored on each order at the time it was placed. It is not recomputed from current settings, so historical figures stay accurate.</span>
              </div>
            </SectionCard>
            <SectionCard title="Actual vs estimated costs" subtitle="Only actual expenses reduce cash profit">
              <div className="kv"><dt>Actual expenses</dt><dd>{inr(s.actualExpenses)}</dd></div>
              <div className="kv"><dt>Estimated expenses</dt><dd>{inr(s.estimatedExpenses)}</dd></div>
              <div className="kv"><dt>Total recorded</dt><dd>{inr(s.totalExpenses)}</dd></div>
              <div className="kv"><dt>Net after all costs</dt><dd className="strong">{inr(s.netAfterExpenses)}</dd></div>
              <div className="notice warn" style={{ marginTop: 14 }}>
                <AlertTriangle size={15} />
                <span>Estimated rows are planning figures. Toggle “Estimated” when recording an expense you have not paid yet.</span>
              </div>
            </SectionCard>
          </div>
        )}
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.editing ? 'Edit expense' : 'Record an expense'}
        subtitle="Expenses feed net profit calculations. Use Estimated for planned costs."
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setModal(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="expense-form" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save expense'}</button>
          </>
        )}
      >
        {modal && (
          <form id="expense-form" onSubmit={saveExpense} className="form-grid" style={{ paddingTop: 6 }}>
            <Field label="Category" error={errors.category}>
              <select className="select" value={modal.form.category} onChange={(e) => setModal({ ...modal, form: { ...modal.form, category: e.target.value } })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Date" error={errors.expenseDate}>
              <input className="input" type="date" value={modal.form.expenseDate} onChange={(e) => setModal({ ...modal, form: { ...modal.form, expenseDate: e.target.value } })} />
            </Field>
            <Field label="Description" error={errors.description} className="full">
              <input className="input" value={modal.form.description} onChange={(e) => setModal({ ...modal, form: { ...modal.form, description: e.target.value } })} placeholder="Coffee bean restock, electricity bill…" />
            </Field>
            <Field label="Amount (₹)" error={errors.amount}>
              <input className="input" type="number" min="0" step="0.01" value={modal.form.amount} onChange={(e) => setModal({ ...modal, form: { ...modal.form, amount: e.target.value } })} placeholder="0.00" />
            </Field>
            <Field label="Vendor">
              <input className="input" value={modal.form.vendor} onChange={(e) => setModal({ ...modal, form: { ...modal.form, vendor: e.target.value } })} placeholder="Supplier or payee" />
            </Field>
            <Field label="Notes" className="full">
              <input className="input" value={modal.form.notes} onChange={(e) => setModal({ ...modal, form: { ...modal.form, notes: e.target.value } })} placeholder="Invoice number, payment mode…" />
            </Field>
            <div className="full flex items-center gap-12">
              <Toggle checked={modal.form.isEstimated} onChange={(v) => setModal({ ...modal, form: { ...modal.form, isEstimated: v } })} label="Estimated expense" />
              <span className="small muted">{modal.form.isEstimated ? 'Planning figure — not counted as actual cash out.' : 'Actual expense — reduces net profit.'}</span>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="Delete expense?"
        message={confirm ? `Delete “${confirm.description}” for ${inr(confirm.amount)}? This changes your reported profit.` : ''}
        confirmLabel="Delete expense"
        busy={busy}
        onConfirm={() => removeExpense(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
