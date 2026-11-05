import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CalendarDays, Check, ClipboardList, Clock, CreditCard, Heart,
  LayoutDashboard, LogOut, Pencil, RefreshCw, ShoppingBag, Sparkles, Star, Trash2, UserCog,
  UtensilsCrossed, X,
} from 'lucide-react';
import { api, patch, post, qs } from '../../lib/api';
import { useAuth, useFetch, useToast } from '../../lib/store';
import { fmtDate, fmtDateTime, fmtTime, inr, titleize, todayISO } from '../../lib/format';
import { Avatar, ConfirmDialog, EmptyState, Field, Loading, Modal, Pagination, Rating, StatusBadge, Toggle } from '../../components/ui';

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'orders', label: 'Orders', icon: ClipboardList },
  { key: 'reservations', label: 'Reservations', icon: CalendarDays },
  { key: 'favourites', label: 'Favourites', icon: Heart },
  { key: 'reviews', label: 'Reviews', icon: Star },
  { key: 'loyalty', label: 'Loyalty', icon: Sparkles },
  { key: 'profile', label: 'Profile', icon: UserCog },
];

const ORDER_STATUSES = ['all', 'pending', 'confirmed', 'preparing', 'ready', 'collected', 'served', 'completed', 'cancelled'];

export default function Account() {
  const { user, logout, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview';
  const setTab = (key) => setParams(key === 'overview' ? {} : { tab: key }, { replace: true });

  const profileFetch = useFetch('/customer/profile');
  const profile = profileFetch.data;
  const customer = profile?.customer || {};
  const stats = profile?.stats || {};
  const loyaltyConfig = profile?.loyaltyConfig || {};
  const favourites = profile?.favorites || [];
  const loyalty = profile?.loyalty || [];

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const ordersFetch = useFetch(`/customer/orders${qs({ limit: 8, page, status })}`);
  const orders = ordersFetch.data?.orders || [];
  const ordersTotal = ordersFetch.data?.total || 0;

  const reservationsFetch = useFetch('/customer/reservations');
  const reservations = reservationsFetch.data?.reservations || [];
  const reviewsFetch = useFetch('/customer/reviews');
  const reviews = reviewsFetch.data?.reviews || [];

  const [detailId, setDetailId] = useState(null);
  const detailFetch = useFetch(detailId ? `/customer/orders/${detailId}` : '', [], { skip: !detailId });
  const detail = detailFetch.data;

  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const [profileForm, setProfileForm] = useState({ name: '', email: '', phone: '', marketingOptIn: false });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState({});
  useEffect(() => {
    if (profile?.customer) {
      setProfileForm({
        name: profile.customer.name || '',
        email: profile.customer.email || '',
        phone: profile.customer.phone || '',
        marketingOptIn: Boolean(profile.customer.marketing_opt_in),
      });
    }
  }, [profile?.customer?.id]);

  useEffect(() => { setPage(1); }, [status]);

  const nextReservation = useMemo(() => reservations
    .filter((r) => ['pending', 'confirmed'].includes(r.status) && r.reservation_date >= todayISO())
    .sort((a, b) => `${a.reservation_date}${a.reservation_time}`.localeCompare(`${b.reservation_date}${b.reservation_time}`))[0], [reservations]);

  const cancelReservation = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await post(`/customer/reservations/${cancelTarget.id}/cancel`, { reason: 'Cancelled from account' });
      toast.success(`Reservation ${cancelTarget.reference} cancelled`);
      setCancelTarget(null);
      reservationsFetch.reload();
      profileFetch.reload();
    } catch (err) { toast.error(err.message); }
    finally { setCancelling(false); }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileErrors({});
    if (!profileForm.name.trim()) { setProfileErrors({ name: 'Your name is required.' }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.email.trim())) { setProfileErrors({ email: 'Enter a valid email.' }); return; }
    setProfileSaving(true);
    try {
      await patch('/customer/profile', {
        name: profileForm.name.trim(),
        email: profileForm.email.trim().toLowerCase(),
        phone: profileForm.phone.trim() || null,
        marketingOptIn: profileForm.marketingOptIn,
      });
      toast.success('Profile updated');
      await refresh();
      profileFetch.reload();
    } catch (err) {
      setProfileErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setProfileSaving(false); }
  };

  const signOut = async () => {
    await logout();
    toast.info('Signed out');
    navigate('/');
  };

  if (profileFetch.loading && !profile) return <Loading label="Opening your account…" minHeight={420} />;
  if (profileFetch.error) {
    return (
      <div className="track-wrap">
        <div className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)', textAlign: 'center', padding: 38 }}>
          <AlertTriangle size={28} style={{ color: 'var(--amber)', marginBottom: 10 }} />
          <h2 className="display" style={{ fontSize: 28 }}>We couldn’t load your account</h2>
          <p className="small muted" style={{ margin: '8px 0 16px' }}>{profileFetch.error.message}</p>
          <button className="btn btn-primary btn-sm" onClick={profileFetch.reload}><RefreshCw size={14} /> Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="account-layout">
      <aside className="account-side">
        <div className="account-user">
          <Avatar name={customer.name || 'Guest'} size={40} />
          <div style={{ minWidth: 0 }}>
            <div className="small strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.name}</div>
            <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.email}</div>
          </div>
        </div>
        <nav aria-label="Account sections">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              <Icon /> {label}
              {key === 'orders' && ordersTotal ? <span className="badge" style={{ marginLeft: 'auto' }}>{ordersTotal}</span> : null}
              {key === 'favourites' && favourites.length ? <span className="badge" style={{ marginLeft: 'auto' }}>{favourites.length}</span> : null}
            </button>
          ))}
          <button onClick={signOut} style={{ color: 'var(--red)', marginTop: 6, borderTop: '1px solid rgba(33,26,21,.08)', borderRadius: 0, paddingTop: 12 }}>
            <LogOut /> Sign out
          </button>
        </nav>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(33,26,21,.08)' }}>
          <div className="tiny muted">Member since {fmtDate(customer.created_at, { year: true })}</div>
          {customer.last_visit_at && <div className="tiny muted">Last visit {fmtDate(customer.last_visit_at)}</div>}
        </div>
      </aside>

      <div style={{ minWidth: 0 }}>
        {tab === 'overview' && (
          <>
            <div style={{ marginBottom: 18 }}>
              <div className="eyebrow" style={{ color: 'var(--copper)' }}>My account</div>
              <h1 className="display" style={{ fontSize: 34, marginTop: 4 }}>Hello, {String(customer.name || '').split(' ')[0] || 'there'}.</h1>
              <p className="small muted" style={{ marginTop: 4 }}>Your visits, orders and table bookings in one place.</p>
            </div>

            <div className={`loyalty-card ${loyaltyConfig.enabled ? '' : 'muted'}`} style={{ marginBottom: 16 }}>
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="tiny" style={{ letterSpacing: '.12em', textTransform: 'uppercase', opacity: .7 }}>Brewhaus loyalty</div>
                  <h3 style={{ marginTop: 4 }}>{loyaltyConfig.enabled ? 'Your points' : 'Loyalty is paused'}</h3>
                </div>
                <Sparkles size={20} style={{ opacity: .7 }} />
              </div>
              <div className="loyalty-points">{Number(customer.loyalty_points || 0).toLocaleString('en-IN')}</div>
              <div className="tiny" style={{ opacity: .75 }}>
                Worth {inr((Number(customer.loyalty_points) || 0) * Number(loyaltyConfig.pointValue || 0))}
                {loyaltyConfig.enabled ? ` · redeem from ${loyaltyConfig.minRedeem} points` : ' · points are kept on record'}
              </div>
              <span className="paw">B</span>
            </div>

            <div className="grid g4" style={{ marginBottom: 18 }}>
              <MiniStat label="Orders" value={stats.orders_count || 0} icon={ShoppingBag} />
              <MiniStat label="Visits" value={stats.visits || 0} icon={UtensilsCrossed} />
              <MiniStat label="Total spent" value={inr(stats.total_spent || 0)} icon={CreditCard} />
              <MiniStat label="Reservations" value={stats.reservations_count || 0} icon={CalendarDays} />
            </div>

            <div className="grid g2" style={{ gap: 16, alignItems: 'start' }}>
              <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                <div className="between" style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 14 }}>Next reservation</strong>
                  <Link to="/reserve" className="btn btn-ghost btn-xs"><CalendarDays size={12} /> New booking</Link>
                </div>
                {nextReservation ? (
                  <div>
                    <div className="between">
                      <div>
                        <div className="strong">{fmtDate(nextReservation.reservation_date)} · {nextReservation.reservation_time}</div>
                        <div className="tiny muted">{nextReservation.party_size} guest{nextReservation.party_size === 1 ? '' : 's'}{nextReservation.table_label ? ` · Table ${nextReservation.table_label}` : ''}</div>
                      </div>
                      <StatusBadge status={nextReservation.status} />
                    </div>
                    {nextReservation.special_requests && <div className="tiny muted" style={{ marginTop: 6 }}>“{nextReservation.special_requests}”</div>}
                    <div className="flex gap-6" style={{ marginTop: 12 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setTab('reservations')}>Manage</button>
                      {['pending', 'confirmed'].includes(nextReservation.status) && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setCancelTarget(nextReservation)} style={{ color: 'var(--red)' }}>Cancel</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="tiny muted" style={{ lineHeight: 1.6 }}>
                    No upcoming table. <Link to="/reserve" style={{ color: 'var(--copper)', fontWeight: 600 }}>Reserve a table</Link> for your next visit.
                  </div>
                )}
              </section>

              <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                <div className="between" style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 14 }}>Recent orders</strong>
                  <button className="btn btn-ghost btn-xs" onClick={() => setTab('orders')}>All orders <ArrowRight size={12} /></button>
                </div>
                {ordersFetch.loading && !orders.length ? <div className="tiny muted">Loading…</div> : orders.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {orders.slice(0, 3).map((o) => (
                      <button key={o.id} onClick={() => setDetailId(o.id)} className="between" style={{ border: 0, background: 'transparent', textAlign: 'left', gap: 8, padding: '4px 0' }}>
                        <span style={{ minWidth: 0 }}>
                          <span className="small strong" style={{ display: 'block' }}>{o.order_number} · {inr(o.total)}</span>
                          <span className="tiny muted">{fmtDateTime(o.placed_at)} · {o.item_count} item{o.item_count === 1 ? '' : 's'}</span>
                        </span>
                        <StatusBadge status={o.status} />
                      </button>
                    ))}
                  </div>
                ) : <div className="tiny muted">No orders yet. <Link to="/menu" style={{ color: 'var(--copper)', fontWeight: 600 }}>Order something</Link>.</div>}
              </section>
            </div>

            {favourites.length > 0 && (
              <section style={{ marginTop: 18 }}>
                <div className="between" style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 14 }}>Saved favourites</strong>
                  <button className="btn btn-ghost btn-xs" onClick={() => setTab('favourites')}>See all <ArrowRight size={12} /></button>
                </div>
                <div className="food-grid">
                  {favourites.slice(0, 4).map((f) => <FavouriteCard key={f.id} item={f} />)}
                </div>
              </section>
            )}
          </>
        )}

        {tab === 'orders' && (
          <>
            <SectionHeading title="My orders" subtitle="Every order linked to your account, newest first." action={<Link className="btn btn-primary btn-sm" to="/menu"><UtensilsCrossed size={14} /> Order again</Link>} />
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {ORDER_STATUSES.map((s) => (
                <button key={s} className={`chip ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
                  {s === 'all' ? 'All orders' : titleize(s)}
                </button>
              ))}
            </div>

            {ordersFetch.loading && !orders.length ? <Loading label="Loading orders…" minHeight={240} /> : orders.length ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {orders.map((o) => (
                    <div key={o.id} className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                      <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                        <div>
                          <div className="flex items-center gap-8 wrap">
                            <strong>{o.order_number}</strong>
                            <StatusBadge status={o.status} />
                            <StatusBadge status={o.payment_status} />
                          </div>
                          <div className="tiny muted" style={{ marginTop: 3 }}>
                            {fmtDateTime(o.placed_at)} · {o.table_label ? `Table ${o.table_label}` : titleize(o.type)} · {o.item_count} item{o.item_count === 1 ? '' : 's'}
                          </div>
                          <div className="small muted" style={{ marginTop: 5, maxWidth: 460 }}>{o.items_summary || '—'}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="strong" style={{ fontSize: 17 }}>{inr(o.total)}</div>
                          <div className="flex gap-6" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-xs" onClick={() => setDetailId(o.id)}>Details</button>
                            <Link className="btn btn-ghost btn-xs" to={`/track/${o.order_number}`}>Track</Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <Pagination page={page} limit={8} total={ordersTotal} onPage={setPage} />
              </>
            ) : (
              <div className="card" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                <EmptyState icon={ClipboardList} title={status === 'all' ? 'No orders yet' : `No ${status} orders`} description={status === 'all' ? 'Your first coffee is waiting.' : 'Try a different status filter.'} action={<Link className="btn btn-primary btn-sm" to="/menu">Browse the menu</Link>} />
              </div>
            )}
          </>
        )}

        {tab === 'reservations' && (
          <>
            <SectionHeading title="My reservations" subtitle="Upcoming bookings and past visits." action={<Link className="btn btn-primary btn-sm" to="/reserve"><CalendarDays size={14} /> Reserve a table</Link>} />
            {reservationsFetch.loading && !reservations.length ? <Loading label="Loading reservations…" minHeight={240} /> : reservations.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...reservations].sort((a, b) => `${b.reservation_date}${b.reservation_time}`.localeCompare(`${a.reservation_date}${a.reservation_time}`)).map((r) => {
                  const upcoming = ['pending', 'confirmed'].includes(r.status) && r.reservation_date >= todayISO();
                  return (
                    <div key={r.id} className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                      <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                        <div>
                          <div className="flex items-center gap-8 wrap">
                            <strong>{r.reference}</strong>
                            <StatusBadge status={r.status} />
                            {upcoming && <span className="badge accent">Upcoming</span>}
                          </div>
                          <div className="small" style={{ marginTop: 4 }}>{fmtDate(r.reservation_date)} · {r.reservation_time} · {r.party_size} guest{r.party_size === 1 ? '' : 's'}{r.table_label ? ` · Table ${r.table_label}` : ''}</div>
                          {r.special_requests && <div className="tiny muted" style={{ marginTop: 3 }}>“{r.special_requests}”</div>}
                        </div>
                        <div className="flex gap-6">
                          {upcoming && <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={() => setCancelTarget(r)}>Cancel</button>}
                          {['confirmed', 'pending'].includes(r.status) && upcoming && <Link className="btn btn-secondary btn-xs" to="/menu">Pre-order</Link>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                <EmptyState icon={CalendarDays} title="No reservations yet" description="Book a table and we’ll keep it here." action={<Link className="btn btn-primary btn-sm" to="/reserve">Find a table</Link>} />
              </div>
            )}
          </>
        )}

        {tab === 'favourites' && (
          <>
            <SectionHeading title="Favourites" subtitle="Dishes you saved from the menu." />
            {favourites.length ? (
              <div className="food-grid">
                {favourites.map((f) => <FavouriteCard key={f.id} item={f} onRemoved={() => profileFetch.reload()} />)}
              </div>
            ) : (
              <div className="card" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                <EmptyState icon={Heart} title="Nothing saved yet" description="Tap the heart on any dish to keep it here." action={<Link className="btn btn-primary btn-sm" to="/menu">Explore the menu</Link>} />
              </div>
            )}
          </>
        )}

        {tab === 'reviews' && (
          <>
            <SectionHeading title="My reviews" subtitle="Ratings you’ve shared after a visit." />
            {reviewsFetch.loading && !reviews.length ? <Loading label="Loading reviews…" minHeight={220} /> : reviews.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {reviews.map((r) => (
                  <div key={r.id} className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                    <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div className="strong small">{r.order_number} <span className="tiny muted">· {fmtDate(r.created_at)}</span></div>
                        <div className="flex gap-12 wrap" style={{ marginTop: 4 }}>
                          <span className="tiny muted">Food <Rating value={Number(r.food_rating)} size={11} /></span>
                          <span className="tiny muted">Service <Rating value={Number(r.service_rating)} size={11} /></span>
                          <span className="tiny muted">Overall <Rating value={Number(r.overall_rating)} size={11} /></span>
                        </div>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    {r.comment && <p className="small" style={{ color: '#6f6153', lineHeight: 1.65, marginTop: 8 }}>“{r.comment}”</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="card" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                <EmptyState icon={Star} title="No reviews yet" description="After your order is served, you can rate the food and service from your order details." action={<button className="btn btn-primary btn-sm" onClick={() => setTab('orders')}>View orders</button>} />
              </div>
            )}
          </>
        )}

        {tab === 'loyalty' && (
          <>
            <SectionHeading title="Loyalty" subtitle={loyaltyConfig.enabled ? 'Points earned on completed orders.' : 'The programme is paused — your points are safe.'} />
            <div className="loyalty-card" style={{ marginBottom: 16 }}>
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="tiny" style={{ letterSpacing: '.12em', textTransform: 'uppercase', opacity: .7 }}>Available balance</div>
                  <h3 style={{ marginTop: 4 }}>{loyaltyConfig.enabled ? 'Brewhaus points' : 'Loyalty paused'}</h3>
                </div>
                <Sparkles size={20} style={{ opacity: .7 }} />
              </div>
              <div className="loyalty-points">{Number(customer.loyalty_points || 0).toLocaleString('en-IN')}</div>
              <div className="tiny" style={{ opacity: .75 }}>
                {loyaltyConfig.enabled
                  ? `Earn ${loyaltyConfig.pointsPer100} points per ₹100 spent · 1 point = ${inr(loyaltyConfig.pointValue, { decimals: true })} · minimum ${loyaltyConfig.minRedeem} points to redeem`
                  : 'Points stay on record and will be available when the programme resumes.'}
              </div>
              <span className="paw">B</span>
            </div>

            <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
              <strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>Points activity</strong>
              {loyalty.length ? (
                <div>
                  {loyalty.map((t) => (
                    <div key={t.id} className="between" style={{ borderTop: '1px solid rgba(33,26,21,.07)', padding: '9px 0', gap: 10 }}>
                      <div>
                        <div className="small strong">{titleize(t.type)}</div>
                        <div className="tiny muted">{t.note || '—'} · {fmtDateTime(t.created_at)}</div>
                      </div>
                      <span className="strong" style={{ color: Number(t.points) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {Number(t.points) > 0 ? '+' : ''}{Number(t.points).toLocaleString('en-IN')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <div className="tiny muted">No points activity yet. Complete an order to start earning.</div>}
            </section>
          </>
        )}

        {tab === 'profile' && (
          <>
            <SectionHeading title="Profile" subtitle="Keep your contact details up to date for reservations and receipts." />
            <form onSubmit={saveProfile} className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
              <div className="grid g2" style={{ gap: 12 }}>
                <Field label="Full name" error={profileErrors.name}>
                  <input className="input" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} style={{ background: '#fff' }} />
                </Field>
                <Field label="Email" error={profileErrors.email}>
                  <input className="input" type="email" value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} style={{ background: '#fff' }} />
                </Field>
                <Field label="Phone" error={profileErrors.phone} hint="Used for reservation confirmation.">
                  <input className="input" value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} style={{ background: '#fff' }} />
                </Field>
                <Field label="Marketing">
                  <div className="flex items-center gap-10" style={{ minHeight: 38 }}>
                    <Toggle checked={profileForm.marketingOptIn} onChange={(v) => setProfileForm({ ...profileForm, marketingOptIn: v })} label="Receive offers" />
                    <span className="tiny muted">{profileForm.marketingOptIn ? 'Send me occasional offers' : 'No marketing emails'}</span>
                  </div>
                </Field>
              </div>
              <div className="flex gap-8 wrap" style={{ marginTop: 14 }}>
                <button className="btn btn-primary" type="submit" disabled={profileSaving}>{profileSaving ? 'Saving…' : <><Check size={14} /> Save profile</>}</button>
                <Link className="btn btn-secondary" to="/forgot-password">Change password</Link>
                <button className="btn btn-ghost" type="button" onClick={signOut} style={{ color: 'var(--red)' }}><LogOut size={14} /> Sign out</button>
              </div>
            </form>

            <div className="notice info" style={{ marginTop: 14 }}>
              <Sparkles size={15} />
              <span>Your account is protected by a server-side session cookie. We never expose API keys or payment credentials in the browser.</span>
            </div>
          </>
        )}
      </div>

      <OrderDetailModal
        open={!!detailId}
        onClose={() => setDetailId(null)}
        data={detail}
        loading={detailFetch.loading}
        onRefresh={() => { detailFetch.reload(); ordersFetch.reload(); reviewsFetch.reload(); profileFetch.reload(); }}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel this reservation?"
        message={cancelTarget ? `${cancelTarget.reference} on ${fmtDate(cancelTarget.reservation_date)} at ${cancelTarget.reservation_time}. The table will be released.` : ''}
        confirmLabel="Cancel reservation"
        busy={cancelling}
        onConfirm={cancelReservation}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}

function SectionHeading({ title, subtitle, action }) {
  return (
    <div className="between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
      <div>
        <h1 className="display" style={{ fontSize: 30 }}>{title}</h1>
        {subtitle && <p className="small muted" style={{ marginTop: 3 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function MiniStat({ label, value, icon: Icon }) {
  return (
    <div className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)', padding: 14 }}>
      <div className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon size={12} /> {label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function FavouriteCard({ item, onRemoved }) {
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const mapped = {
    id: item.id,
    name: item.name,
    price: item.price,
    image: item.image_url,
    available: Boolean(item.available),
    category: item.category,
    description: item.category ? `${item.category}${item.available ? '' : ' · currently unavailable'}` : '',
    tags: [],
  };
  const remove = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setRemoving(true);
    try {
      await post(`/customer/favorites/${item.id}`);
      toast.success(`${item.name} removed from favourites`);
      onRemoved?.();
    } catch (err) { toast.error(err.message); }
    finally { setRemoving(false); }
  };
  return (
    <div className="food-card" style={{ opacity: removing ? 0.5 : 1 }}>
      <div className="food-img">
        <Link to={`/menu/${item.id}`} aria-label={item.name} style={{ display: 'block', width: '100%', height: '100%' }}>
          {mapped.image ? <img src={mapped.image} alt={mapped.name} loading="lazy" /> : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#b8a894' }}><UtensilsCrossed size={18} /></div>}
        </Link>
        <button type="button" className="food-fav active" onClick={remove} aria-label="Remove favourite"><Heart size={14} fill="currentColor" /></button>
      </div>
      <div className="food-body">
        <Link to={`/menu/${item.id}`} className="food-name">{item.name}</Link>
        <p className="food-desc">{mapped.description}</p>
        <div className="food-foot">
          <div className="food-price">{inr(item.price)}</div>
          <Link className="food-add" to={`/menu/${item.id}`} aria-label={`Open ${item.name}`}><ArrowRight size={14} /></Link>
        </div>
      </div>
    </div>
  );
}

function StarPicker({ label, value, onChange }) {
  return (
    <div>
      <div className="tiny muted" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 3 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star${n === 1 ? '' : 's'}`} style={{ border: 0, background: 'transparent', padding: 2, color: '#d3a24f' }}>
            <Star size={18} fill={n <= value ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
    </div>
  );
}

function OrderDetailModal({ open, onClose, data, loading, onRefresh }) {
  const toast = useToast();
  const [ratings, setRatings] = useState({ foodRating: 5, serviceRating: 5, overallRating: 5 });
  const [comment, setComment] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setRatings({ foodRating: 5, serviceRating: 5, overallRating: 5 }); setComment(''); setPhotoUrl(''); }
  }, [open, data?.order?.id]);

  const order = data?.order;
  const review = data?.review || null;
  const canReview = data?.canReview;

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Images must be under 5 MB.'); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api('/customer/upload', { method: 'POST', body: form });
      setPhotoUrl(res.url);
      toast.success('Photo uploaded');
    } catch (err) { toast.error(err.message); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const submitReview = async () => {
    setSaving(true);
    try {
      await post('/customer/reviews', { orderId: order.id, ...ratings, comment: comment.trim(), photoUrl: photoUrl || null });
      toast.success('Thank you — your review has been saved');
      onRefresh?.();
      onClose?.();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={order ? `Order ${order.order_number}` : 'Order details'}
      subtitle={order ? `${fmtDateTime(order.placed_at)} · ${order.table_label ? `Table ${order.table_label}` : titleize(order.type)}` : ''}
      size="wide"
      footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      {loading && !order ? <Loading label="Loading order…" minHeight={220} /> : !order ? <div className="small muted">Order not found.</div> : (
        <div>
          <div className="flex gap-8 wrap" style={{ marginBottom: 12 }}>
            <StatusBadge status={order.status} />
            <StatusBadge status={order.payment_status} />
            {review && <span className="badge green"><Star size={9} /> Reviewed</span>}
          </div>

          <div style={{ border: '1px solid rgba(33,26,21,.08)', borderRadius: 12, overflow: 'hidden' }}>
            {(order.items || []).map((i) => (
              <div key={i.id} className="between" style={{ padding: '9px 12px', borderBottom: '1px solid rgba(33,26,21,.06)', gap: 10 }}>
                <div>
                  <div className="small strong">{i.qty}× {i.name_snapshot}</div>
                  {i.options?.length > 0 && <div className="tiny muted">{i.options.map((o) => o.name).join(' · ')}</div>}
                  {i.special_instructions && <div className="tiny muted" style={{ fontStyle: 'italic' }}>“{i.special_instructions}”</div>}
                  {i.allergy_flag ? <div className="tiny" style={{ color: 'var(--red)' }}>Allergy noted</div> : null}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="small">{inr(i.line_total)}</div>
                  <div className="tiny muted">{titleize(i.status)}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="checkout-line"><span>Subtotal</span><span>{inr(order.subtotal)}</span></div>
            {Number(order.discount_amount) > 0 && <div className="checkout-line" style={{ color: 'var(--green)' }}><span>Offer {order.offer_code || ''}</span><span>−{inr(order.discount_amount)}</span></div>}
            {Number(order.loyalty_discount) > 0 && <div className="checkout-line" style={{ color: 'var(--green)' }}><span>Loyalty</span><span>−{inr(order.loyalty_discount)}</span></div>}
            {Number(order.tax_amount) > 0 && <div className="checkout-line"><span>GST</span><span>{inr(order.tax_amount, { decimals: true })}</span></div>}
            {Number(order.service_charge) > 0 && <div className="checkout-line"><span>Service charge</span><span>{inr(order.service_charge, { decimals: true })}</span></div>}
            <div className="checkout-line total"><span>Total</span><span>{inr(order.total)}</span></div>
          </div>

          {order.payments?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="tiny muted" style={{ marginBottom: 4 }}>Payments</div>
              {order.payments.map((p) => (
                <div key={p.id} className="between tiny" style={{ padding: '3px 0' }}>
                  <span>{p.transaction_ref} · {titleize(p.method)}</span>
                  <span>{inr(p.amount)} · {titleize(p.status)}</span>
                </div>
              ))}
            </div>
          )}

          {review && (
            <div className="notice info" style={{ marginTop: 12 }}>
              <Star size={15} />
              <span>You rated this order {review.overall_rating}/5. {review.status === 'pending' ? 'It is awaiting moderation.' : 'Thank you for the feedback.'}</span>
            </div>
          )}

          {canReview && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(33,26,21,.1)' }}>
              <strong style={{ fontSize: 13.5 }}>How was it?</strong>
              <div className="grid g3" style={{ gap: 10, marginTop: 8 }}>
                <StarPicker label="Food" value={ratings.foodRating} onChange={(v) => setRatings({ ...ratings, foodRating: v })} />
                <StarPicker label="Service" value={ratings.serviceRating} onChange={(v) => setRatings({ ...ratings, serviceRating: v })} />
                <StarPicker label="Overall" value={ratings.overallRating} onChange={(v) => setRatings({ ...ratings, overallRating: v })} />
              </div>
              <textarea className="textarea" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tell us what stood out…" style={{ marginTop: 10, background: '#fff' }} />
              <div className="flex gap-8 wrap" style={{ marginTop: 8 }}>
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  {uploading ? 'Uploading…' : photoUrl ? <><Check size={13} /> Photo added</> : 'Add a photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={uploadPhoto} style={{ display: 'none' }} disabled={uploading} />
                </label>
                <button className="btn btn-primary btn-sm" onClick={submitReview} disabled={saving}>{saving ? 'Saving…' : 'Submit review'}</button>
              </div>
            </div>
          )}

          {order.history?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="tiny muted" style={{ marginBottom: 5 }}>Timeline</div>
              {order.history.map((h) => (
                <div key={h.id} className="between tiny muted" style={{ padding: '2px 0' }}>
                  <span>{titleize(h.status)}</span>
                  <span>{fmtDateTime(h.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
