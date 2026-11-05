import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, ChevronDown, ChevronUp, Crown, Download, Edit3, Mail, Phone, Plus,
  RefreshCw, Search, ShoppingBag, Sparkles, Star, UserPlus, Users, Wallet,
} from 'lucide-react';
import { get, post, put, qs } from '../../lib/api';
import { useFetch, useToast } from '../../lib/store';
import {
  Avatar, Badge, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Loading, Modal,
  PageHeader, Pagination, SearchBox, SectionCard, StatusBadge, Tabs,
} from '../../components/ui';
import { fmtDate, fmtDateTime, inr, num, timeAgo, titleize, todayISO } from '../../lib/format';

const SEGMENTS = [
  { key: 'all', label: 'All customers' },
  { key: 'loyal', label: 'Loyal · 5+ orders' },
  { key: 'returning', label: 'Returning · 2–4 orders' },
  { key: 'new', label: 'New · last 30 days' },
  { key: 'inactive', label: 'Inactive · 60+ days' },
];

const emptyForm = () => ({ name: '', email: '', phone: '', notes: '', marketingOptIn: false });

export default function Customers() {
  const toast = useToast();
  const [segment, setSegment] = useState('all');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: 'last_order_at', dir: 'desc' });

  const path = useMemo(
    () => `/admin/customers${qs({ segment, q: query, page, limit: 15 })}`,
    [segment, query, page]
  );
  const { data, loading, error, reload } = useFetch(path);

  useEffect(() => { setPage(1); }, [segment, query]);

  const rows = useMemo(() => {
    const list = [...(data?.customers || [])];
    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const va = a[sort.key] ?? '';
      const vb = b[sort.key] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      if (sort.key === 'name') return String(va).localeCompare(String(vb)) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return list;
  }, [data, sort]);

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const SortIcon = ({ col }) => (sort.key !== col ? null : sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />);

  // ------------------------------------------------------------- Detail drawer
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');

  const loadDetail = async (id) => {
    setDetailLoading(true);
    try { setDetail(await get(`/admin/customers/${id}`)); }
    catch (err) { toast.error(err.message); setDetailId(null); }
    finally { setDetailLoading(false); }
  };
  useEffect(() => { if (detailId) { setDetailTab('overview'); loadDetail(detailId); } }, [detailId]);

  // ------------------------------------------------------------- Create / edit
  const [modal, setModal] = useState(null); // { editing, form }
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setErrors({});
    setModal({ editing: null, form: emptyForm() });
  };

  const openEdit = (customer) => {
    setErrors({});
    setModal({
      editing: customer,
      form: {
        name: customer.name || '', email: customer.email || '', phone: customer.phone || '',
        notes: customer.notes || '', marketingOptIn: Boolean(customer.marketing_opt_in),
      },
    });
  };

  const save = async (e) => {
    e.preventDefault();
    const f = modal.form;
    const local = {};
    if (!f.name.trim()) local.name = 'Name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) local.email = 'Enter a valid email address.';
    if (Object.keys(local).length) { setErrors(local); return; }
    setSaving(true);
    setErrors({});
    try {
      const body = {
        name: f.name.trim(), email: f.email.trim().toLowerCase(), phone: f.phone.trim() || null,
        notes: f.notes.trim() || null, marketingOptIn: f.marketingOptIn,
      };
      if (modal.editing) await put(`/admin/customers/${modal.editing.id}`, body);
      else await post('/admin/customers', body);
      toast.success(modal.editing ? 'Customer updated' : 'Customer added');
      setModal(null);
      reload();
      if (modal.editing && detailId === modal.editing.id) loadDetail(detailId);
    } catch (err) {
      setErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const totalSpend = rows.reduce((s, c) => s + Number(c.total_spent || 0), 0);
  const totalOrders = rows.reduce((s, c) => s + Number(c.orders_count || 0), 0);
  const members = rows.filter((c) => Number(c.orders_count) > 0).length;

  const exportHref = `/api/admin/export${qs({ type: 'customers', from: todayISO(), to: todayISO() })}`;

  return (
    <>
      <PageHeader title="Customers" description="Every profile is deduplicated by email and phone. Visits, spend and history come straight from orders and payments.">
        <a className="btn btn-secondary btn-sm" href={exportHref} target="_blank" rel="noreferrer"><Download size={14} /> Export CSV</a>
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
        <button className="btn btn-primary btn-sm" onClick={openNew}><UserPlus size={14} /> Add customer</button>
      </PageHeader>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Customers{segment === 'all' ? '' : ' in segment'}</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{num(data?.total)}</div>
          <div className="tiny muted">Deduplicated profiles</div>
        </div>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">On this page</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{num(rows.length)}</div>
          <div className="tiny muted">{num(members)} with recorded orders</div>
        </div>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Page spend</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{inr(totalSpend)}</div>
          <div className="tiny muted">Verified payments only</div>
        </div>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Page orders</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{num(totalOrders)}</div>
          <div className="tiny muted">Completed and served</div>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <SearchBox value={q} onChange={setQ} onSubmit={() => setQuery(q.trim())} placeholder="Search name, email or phone…" />
        <select className="select" style={{ height: 34, width: 210 }} value={segment} onChange={(e) => setSegment(e.target.value)}>
          {SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {(query || segment !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setQuery(''); setSegment('all'); }}>Clear</button>
        )}
        <span className="small muted" style={{ marginLeft: 'auto' }}>{num(data?.total)} profile{data?.total === 1 ? '' : 's'}</span>
      </div>

      <SectionCard noPad>
        {loading && !data ? <Loading label="Loading customers…" /> : error ? <ErrorState error={error} onRetry={reload} /> : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Customer <SortIcon col="name" /></th>
                    <th>Contact</th>
                    <th>Joined</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('orders_count')}>Orders <SortIcon col="orders_count" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('total_spent')}>Spend <SortIcon col="total_spent" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('last_order_at')}>Last visit <SortIcon col="last_order_at" /></th>
                    <th>Loyalty</th>
                    <th>Segment</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const orders = Number(c.orders_count) || 0;
                    const seg = orders >= 5 ? 'loyal' : orders >= 2 ? 'returning' : orders <= 1 && c.created_at >= `${todayISO().slice(0, 8)}01` ? 'new' : 'casual';
                    return (
                      <tr key={c.id} className="row-click" onClick={() => setDetailId(c.id)}>
                        <td>
                          <div className="flex items-center gap-12">
                            <Avatar name={c.name} size={32} />
                            <div>
                              <div className="primary-cell">{c.name}{c.marketing_opt_in ? <Badge tone="green" className="tiny" style={{ marginLeft: 6 }}>Opted in</Badge> : null}</div>
                              <div className="sub-cell">#{c.id} · joined {fmtDate(c.created_at)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="small">
                          {c.email}
                          <div className="sub-cell">{c.phone || 'No phone'}</div>
                        </td>
                        <td className="small">{fmtDate(c.created_at)}</td>
                        <td className="num">{num(orders)}</td>
                        <td className="num strong">{inr(c.total_spent)}</td>
                        <td className="small">{c.last_order_at || c.last_visit_at ? <>{timeAgo(c.last_order_at || c.last_visit_at)}<div className="sub-cell">{fmtDate(c.last_order_at || c.last_visit_at)}</div></> : <span className="muted">Never</span>}</td>
                        <td><Badge tone={Number(c.loyalty_points) > 0 ? 'accent' : ''}>{num(c.loyalty_points)} pts</Badge></td>
                        <td><Badge tone={seg === 'loyal' ? 'green' : seg === 'returning' ? 'blue' : seg === 'new' ? 'amber' : ''}>{titleize(seg)}</Badge></td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr><td colSpan={8}>
                      <EmptyState
                        icon={Users}
                        title="No customers match"
                        description={query || segment !== 'all' ? 'Try a different segment or clear the search.' : 'Customer profiles appear here when guests register, order or are added by staff.'}
                        action={<button className="btn btn-primary btn-sm" onClick={openNew}><UserPlus size={14} /> Add customer</button>}
                      />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={data?.page || page} limit={data?.limit || 15} total={data?.total || 0} onPage={setPage} />
          </>
        )}
      </SectionCard>

      <Drawer
        open={!!detailId}
        onClose={() => { setDetailId(null); setDetail(null); }}
        title={detail ? detail.customer.name : 'Customer profile'}
        subtitle={detail ? `Customer #${detail.customer.id} · joined ${fmtDate(detail.customer.created_at)}` : 'Loading…'}
        footer={detail ? (
          <>
            <button className="btn btn-secondary" onClick={() => loadDetail(detailId)}><RefreshCw size={14} /> Refresh</button>
            <button className="btn btn-primary" onClick={() => openEdit({ ...detail.customer, orders_count: detail.stats?.orders_count, total_spent: detail.stats?.lifetime_value })}><Edit3 size={14} /> Edit profile</button>
          </>
        ) : null}
      >
        {detailLoading && !detail ? <Loading label="Loading profile…" /> : detail ? (
          <>
            <div className="flex items-center gap-12" style={{ marginBottom: 16 }}>
              <Avatar name={detail.customer.name} size={48} />
              <div style={{ flex: 1 }}>
                <div className="strong">{detail.customer.name}</div>
                <div className="tiny muted"><Mail size={11} style={{ verticalAlign: -1 }} /> {detail.customer.email}{detail.customer.phone ? <> · <Phone size={11} style={{ verticalAlign: -1 }} /> {detail.customer.phone}</> : null}</div>
              </div>
              <Badge tone={detail.customer.marketing_opt_in ? 'green' : ''}>{detail.customer.marketing_opt_in ? 'Marketing opted in' : 'No marketing'}</Badge>
            </div>

            <div className="grid g3" style={{ gap: 9, marginBottom: 16 }}>
              <div className="card card-pad" style={{ padding: 12 }}>
                <div className="tiny muted">Orders</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{num(detail.stats?.orders_count)}</div>
              </div>
              <div className="card card-pad" style={{ padding: 12 }}>
                <div className="tiny muted">Lifetime value</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{inr(detail.stats?.lifetime_value)}</div>
              </div>
              <div className="card card-pad" style={{ padding: 12 }}>
                <div className="tiny muted">Loyalty points</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{num(detail.customer.loyalty_points)}</div>
              </div>
            </div>

            {detail.customer.notes && <div className="notice" style={{ marginBottom: 14 }}><Sparkles size={15} /><span>{detail.customer.notes}</span></div>}

            <Tabs
              tabs={[
                { key: 'overview', label: 'Orders', count: detail.orders.length },
                { key: 'reservations', label: 'Reservations', count: detail.reservations.length },
                { key: 'loyalty', label: 'Loyalty', count: detail.loyalty.length },
                { key: 'reviews', label: 'Reviews', count: detail.reviews.length },
              ]}
              value={detailTab}
              onChange={setDetailTab}
            />

            <div style={{ marginTop: 14 }}>
              {detailTab === 'overview' && (
                detail.orders.length ? (
                  <div className="table-wrap card">
                    <table className="tbl compact">
                      <thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="right">Total</th></tr></thead>
                      <tbody>
                        {detail.orders.map((o) => (
                          <tr key={o.id}>
                            <td className="primary-cell"><Link to={`/admin/orders?open=${o.id}`}>{o.order_number}</Link><div className="sub-cell">{o.table_label || titleize(o.type)}</div></td>
                            <td className="small">{fmtDateTime(o.placed_at)}</td>
                            <td><StatusBadge status={o.status} /></td>
                            <td className="right num">{inr(o.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState icon={ShoppingBag} title="No orders yet" description="This customer has not ordered with an account." />
              )}

              {detailTab === 'reservations' && (
                detail.reservations.length ? (
                  <div className="table-wrap card">
                    <table className="tbl compact">
                      <thead><tr><th>Reference</th><th>When</th><th>Party</th><th>Status</th></tr></thead>
                      <tbody>
                        {detail.reservations.map((r) => (
                          <tr key={r.id}>
                            <td className="primary-cell code">{r.reference}</td>
                            <td className="small">{fmtDate(r.reservation_date)} · {String(r.reservation_time).slice(0, 5)}</td>
                            <td>{r.party_size}</td>
                            <td><StatusBadge status={r.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState icon={CalendarDays} title="No reservations" description="Online bookings made with this account appear here." />
              )}

              {detailTab === 'loyalty' && (
                detail.loyalty.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {detail.loyalty.map((t) => (
                      <div key={t.id} className="between" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                        <div>
                          <div className="small strong">{titleize(t.type)} · {t.note || 'Loyalty activity'}</div>
                          <div className="tiny muted">{fmtDateTime(t.created_at)}</div>
                        </div>
                        <Badge tone={t.points >= 0 ? 'green' : 'amber'}>{t.points >= 0 ? '+' : ''}{num(t.points)} pts</Badge>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState icon={Crown} title="No loyalty activity" description="Points are earned on completed orders when loyalty is enabled." />
              )}

              {detailTab === 'reviews' && (
                detail.reviews.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {detail.reviews.map((r) => (
                      <div key={r.id} className="card card-pad" style={{ padding: 13 }}>
                        <div className="between">
                          <span className="flex items-center gap-4" style={{ color: '#c68a2f' }}>
                            {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={12} fill={n <= r.overall_rating ? '#e3b567' : 'none'} color={n <= r.overall_rating ? '#c68a2f' : 'var(--line-strong)'} />)}
                          </span>
                          <StatusBadge status={r.status} />
                        </div>
                        {r.comment && <p className="small" style={{ marginTop: 7, lineHeight: 1.55 }}>{r.comment}</p>}
                        <div className="tiny muted" style={{ marginTop: 6 }}>{fmtDateTime(r.created_at)}</div>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState icon={Star} title="No reviews" description="Reviews left after a served order appear here." />
              )}
            </div>
          </>
        ) : null}
      </Drawer>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.editing ? `Edit ${modal.editing.name}` : 'Add customer'}
        subtitle="Emails and phone numbers must be unique. Duplicate profiles are rejected by the database."
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setModal(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="customer-form" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save customer'}</button>
          </>
        )}
      >
        {modal && (
          <form id="customer-form" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
            <Field label="Full name" error={errors.name}>
              <input className="input" value={modal.form.name} onChange={(e) => setModal({ ...modal, form: { ...modal.form, name: e.target.value } })} placeholder="e.g. Ananya Rao" />
            </Field>
            <Field label="Email" error={errors.email}>
              <input className="input" type="email" value={modal.form.email} onChange={(e) => setModal({ ...modal, form: { ...modal.form, email: e.target.value } })} placeholder="guest@example.com" />
            </Field>
            <Field label="Phone" error={errors.phone}>
              <input className="input" value={modal.form.phone} onChange={(e) => setModal({ ...modal, form: { ...modal.form, phone: e.target.value } })} placeholder="+91 98765 43210" />
            </Field>
            <Field label="Staff notes" hint="Only visible to staff.">
              <textarea className="textarea" rows={3} value={modal.form.notes} onChange={(e) => setModal({ ...modal, form: { ...modal.form, notes: e.target.value } })} placeholder="Allergies, favourite table, corporate account…" />
            </Field>
            <label className="check"><input type="checkbox" checked={modal.form.marketingOptIn} onChange={(e) => setModal({ ...modal, form: { ...modal.form, marketingOptIn: e.target.checked } })} /> Guest agreed to marketing updates</label>
          </form>
        )}
      </Modal>
    </>
  );
}
