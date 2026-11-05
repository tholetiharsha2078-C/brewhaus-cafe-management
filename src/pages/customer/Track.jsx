import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Bell, Check, ChefHat, ClipboardList, Clock, Flame, HandPlatter,
  MapPin, Radio, RefreshCw, Search, ShoppingBag, UtensilsCrossed,
} from 'lucide-react';
import { useAuth, useFetch, useRealtime, useToast } from '../../lib/store';
import { fmtDateTime, fmtTime, inr, titleize } from '../../lib/format';
import { ErrorState, Loading, StatusBadge } from '../../components/ui';

const STEPS = [
  { key: 'received', label: 'Order received', icon: ClipboardList, hint: 'Sent to the kitchen' },
  { key: 'preparing', label: 'Preparing', icon: Flame, hint: 'On the line' },
  { key: 'ready', label: 'Ready', icon: Bell, hint: 'Waiting for pickup' },
  { key: 'served', label: 'On its way', icon: HandPlatter, hint: 'Handed to your table' },
  { key: 'completed', label: 'Completed', icon: Check, hint: 'Enjoy' },
];

const STEP_INDEX = {
  pending: 0, confirmed: 0, preparing: 1, ready: 2, collected: 3, served: 3, completed: 4,
};

function activeStatus(status) {
  return !['completed', 'cancelled'].includes(status);
}

export default function Track() {
  const { number } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { isCustomer } = useAuth();
  const token = params.get('token') || '';
  const [lookup, setLookup] = useState({ number: number || '', token: token || '' });
  const [now, setNow] = useState(Date.now());

  const trackPath = number ? `/public/track/${encodeURIComponent(number)}${token ? `?token=${encodeURIComponent(token)}` : ''}` : '';
  const { data, loading, error, reload } = useFetch(trackPath, [number, token], { skip: !number });
  const order = data?.order || null;

  const recentFetch = useFetch('/customer/orders?limit=5', [], { skip: !isCustomer });
  const recent = recentFetch.data?.orders || [];
  const lastOrder = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('bh_last_order') || 'null'); } catch { return null; }
  }, []);

  useRealtime((event) => {
    if (!event) return;
    if (event.type === 'order' && number && (!event.orderNumber || event.orderNumber === number)) reload();
  });

  useEffect(() => {
    if (!order || !activeStatus(order.status)) return undefined;
    const timer = setInterval(reload, 12000);
    return () => clearInterval(timer);
  }, [order?.status, order?.id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (number && token) setLookup({ number, token });
  }, [number, token]);

  const submitLookup = (e) => {
    e.preventDefault();
    const num = lookup.number.trim().toUpperCase();
    if (!num) { toast.error('Enter the order number from your receipt.'); return; }
    if (!lookup.token.trim() && !isCustomer) { toast.error('Add the tracking token from your order link.'); return; }
    navigate(`/track/${encodeURIComponent(num)}${lookup.token.trim() ? `?token=${encodeURIComponent(lookup.token.trim())}` : ''}`);
  };

  if (!number) {
    return (
      <div className="track-wrap">
        <div className="track-head">
          <div className="eyebrow" style={{ color: 'var(--copper)' }}>Live order tracking</div>
          <h1>Where’s my order?</h1>
          <p className="small muted" style={{ maxWidth: 430, margin: '8px auto 0', lineHeight: 1.65 }}>
            Enter the order number and tracking token from your confirmation link. Signed-in customers can open their order history instead.
          </p>
        </div>

        <div className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
          <form onSubmit={submitLookup} className="grid g2" style={{ gap: 12 }}>
            <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}>Order number</span>
              <input className="input" value={lookup.number} onChange={(e) => setLookup({ ...lookup, number: e.target.value })} placeholder="BH-000123" style={{ background: '#fff' }} />
            </label>
            <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}>Tracking token</span>
              <input className="input" value={lookup.token} onChange={(e) => setLookup({ ...lookup, token: e.target.value })} placeholder="From your order link" style={{ background: '#fff' }} />
            </label>
            <div className="full" style={{ gridColumn: '1 / -1' }}>
              <button className="btn btn-primary" type="submit" style={{ width: '100%' }}><Search size={14} /> Find my order</button>
            </div>
          </form>
          {lastOrder?.number && (
            <div className="notice info" style={{ marginTop: 12 }}>
              <Clock size={15} />
              <span>Your last order was <strong>{lastOrder.number}</strong>. <Link to={`/track/${lastOrder.number}?token=${lastOrder.token || ''}`} style={{ color: 'inherit', fontWeight: 600 }}>Track it</Link>.</span>
            </div>
          )}
        </div>

        {!isCustomer && (
          <p className="small muted" style={{ textAlign: 'center', marginTop: 18 }}>
            <Link to="/login?redirect=%2Faccount%3Ftab%3Dorders" style={{ color: 'var(--copper)', fontWeight: 600 }}>Sign in</Link> to see every order in one place.
          </p>
        )}

        {isCustomer && recent.length > 0 && (
          <section className="section" style={{ marginTop: 28 }}>
            <div className="section-head">
              <div>
                <div className="eyebrow" style={{ color: 'var(--copper)' }}>Your recent orders</div>
                <h2 className="section-title" style={{ fontSize: 24 }}>Across the last few visits</h2>
              </div>
              <Link to="/account?tab=orders" className="section-link">All orders <ArrowRight size={13} /></Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recent.map((o) => (
                <Link key={o.id} to={`/track/${o.order_number}`} className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 38, height: 38, borderRadius: 10, background: '#efe4d3', display: 'grid', placeItems: 'center', color: 'var(--copper)' }}><ShoppingBag size={16} /></span>
                  <div style={{ flex: 1 }}>
                    <div className="strong small">{o.order_number} · {inr(o.total)}</div>
                    <div className="tiny muted">{fmtDateTime(o.placed_at)} · {o.item_count} item{o.item_count === 1 ? '' : 's'}</div>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (loading && !data) {
    return <div className="track-wrap"><Loading label="Finding your order…" minHeight={360} /></div>;
  }

  if (error) {
    return (
      <div className="track-wrap">
        <div className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)', textAlign: 'center', padding: 38 }}>
          <AlertTriangle size={30} style={{ color: 'var(--amber)', marginBottom: 10 }} />
          <h2 className="display" style={{ fontSize: 28 }}>We couldn’t open that order</h2>
          <p className="small muted" style={{ maxWidth: 400, margin: '8px auto 16px', lineHeight: 1.6 }}>
            {error.status === 401 ? 'This order needs its tracking token. Open the link from your confirmation, or sign in if you ordered with an account.' : error.message}
          </p>
          <div className="flex gap-8 wrap" style={{ justifyContent: 'center' }}>
            {isCustomer && <Link className="btn btn-primary btn-sm" to="/account?tab=orders"><ClipboardList size={14} /> My orders</Link>}
            <Link className="btn btn-secondary btn-sm" to="/track"><Search size={14} /> Try another order</Link>
            <button className="btn btn-ghost btn-sm" onClick={reload}><RefreshCw size={14} /> Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const statusIndex = STEP_INDEX[order.status] ?? 0;
  const cancelled = order.status === 'cancelled';
  const etaMs = order.estimated_ready_at ? new Date(order.estimated_ready_at).getTime() - now : null;
  const etaMinutes = etaMs != null ? Math.max(0, Math.round(etaMs / 60000)) : null;

  return (
    <div className="track-wrap">
      <div className="track-head">
        <div className="flex items-center gap-8" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <span className="eyebrow" style={{ color: 'var(--copper)' }}>Order {order.number}</span>
          <span className="tiny" style={{ color: '#8b7c6c', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Radio size={10} style={{ color: activeStatus(order.status) ? 'var(--green)' : '#9a8b7c' }} />
            {activeStatus(order.status) ? 'Live updates' : 'Closed'}
          </span>
        </div>
        <h1>{cancelled ? 'Order cancelled' : order.status === 'completed' ? 'Thanks for visiting' : order.status === 'ready' ? 'Your order is ready' : order.status === 'collected' || order.status === 'served' ? 'Coming to your table' : 'We’re on it'}</h1>
        <p className="small muted" style={{ marginTop: 8 }}>
          {order.table_label ? `Table ${order.table_label} · ` : ''}{titleize(order.type)} · placed {fmtDateTime(order.placed_at)}
        </p>
        {cancelled && (
          <div className="notice warn" style={{ marginTop: 14, textAlign: 'left' }}>
            <AlertTriangle size={15} />
            <span>This order was cancelled. If this is unexpected, please speak to a team member{order.table_label ? ' at your table' : ''}.</span>
          </div>
        )}
      </div>

      {!cancelled && (
        <div className="track-status">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const done = i < statusIndex || order.status === 'completed';
            const current = i === statusIndex && order.status !== 'completed';
            return (
              <div key={step.key} className={`track-step ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                <span className="track-dot">{done ? <Check /> : <Icon />}</span>
                <span>{step.label}</span>
                <span className="tiny" style={{ color: '#a3937f' }}>{step.hint}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid g2" style={{ gap: 14, alignItems: 'start' }}>
        <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
          <div className="between" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>Your items</strong>
            <button className="btn btn-ghost btn-xs" onClick={reload}><RefreshCw size={12} /> Refresh</button>
          </div>
          {order.items.map((item) => (
            <div key={item.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid rgba(33,26,21,.07)' }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: '#efe4d3', color: '#6b5d4f', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flex: '0 0 auto' }}>{item.qty}×</span>
              <div style={{ flex: 1 }}>
                <div className="between">
                  <span className="small strong">{item.name}</span>
                  <span className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{inr(item.line_total)}</span>
                </div>
                {item.options?.length > 0 && <div className="tiny muted">{item.options.map((o) => o.name).join(' · ')}</div>}
                {item.special_instructions && <div className="tiny muted" style={{ fontStyle: 'italic' }}>“{item.special_instructions}”</div>}
                {item.allergy_flag ? <div className="tiny" style={{ color: 'var(--red)', display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}><AlertTriangle size={10} /> Allergy noted</div> : null}
              </div>
              <StatusBadge status={item.status} />
            </div>
          ))}

          <div style={{ borderTop: '1px solid rgba(33,26,21,.1)', marginTop: 8, paddingTop: 10 }}>
            <div className="checkout-line"><span>Subtotal</span><span>{inr(order.subtotal)}</span></div>
            {Number(order.discount_amount) > 0 && <div className="checkout-line" style={{ color: 'var(--green)' }}><span>Offer</span><span>−{inr(order.discount_amount)}</span></div>}
            {Number(order.loyalty_discount) > 0 && <div className="checkout-line" style={{ color: 'var(--green)' }}><span>Loyalty</span><span>−{inr(order.loyalty_discount)}</span></div>}
            {Number(order.tax_amount) > 0 && <div className="checkout-line"><span>GST</span><span>{inr(order.tax_amount, { decimals: true })}</span></div>}
            {Number(order.service_charge) > 0 && <div className="checkout-line"><span>Service charge</span><span>{inr(order.service_charge, { decimals: true })}</span></div>}
            <div className="checkout-line total"><span>Total</span><span>{inr(order.total)}</span></div>
          </div>
          <div className="between" style={{ marginTop: 10 }}>
            <span className="tiny muted">Payment</span>
            <StatusBadge status={order.payment_status} />
          </div>
          {order.payments?.length > 0 && (
            <div className="tiny muted" style={{ marginTop: 6 }}>
              {order.payments.map((p) => `${titleize(p.method)} · ${inr(p.amount)} · ${titleize(p.status)}${Number(p.refunded) ? ` · refunded ${inr(p.refunded)}` : ''}`).join(' · ')}
            </div>
          )}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
            <strong style={{ fontSize: 14 }}>{activeStatus(order.status) ? 'Kitchen estimate' : 'Timing'}</strong>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
              <span className="display" style={{ fontSize: 34 }}>
                {order.status === 'ready' ? 'Ready' : order.status === 'completed' ? 'Done' : etaMinutes != null && etaMinutes > 0 ? `${etaMinutes} min` : order.eta_minutes ? `${order.eta_minutes} min` : '—'}
              </span>
              {order.estimated_ready_at && activeStatus(order.status) && <span className="tiny muted">by {fmtTime(order.estimated_ready_at)}</span>}
            </div>
            <p className="tiny muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
              {order.status === 'ready' ? 'Collect it from the counter, or a waiter will bring it over.' : order.status === 'collected' ? 'A team member has collected it from the kitchen.' : activeStatus(order.status) ? 'The kitchen updates this page as soon as each item is ready.' : 'This order is closed.'}
            </p>
            {order.ready_at && <div className="tiny" style={{ color: 'var(--green)', marginTop: 6 }}><Check size={11} style={{ verticalAlign: -1 }} /> Ready at {fmtTime(order.ready_at)}</div>}
            {order.served_at && <div className="tiny" style={{ color: 'var(--green)' }}><Check size={11} style={{ verticalAlign: -1 }} /> Served at {fmtTime(order.served_at)}</div>}
          </section>

          <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
            <strong style={{ fontSize: 14 }}>Timeline</strong>
            <div style={{ marginTop: 10 }}>
              {(order.history || []).map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? 'var(--copper)' : '#d8c9b5', marginTop: 4 }} />
                    {i < order.history.length - 1 && <span style={{ width: 1, flex: 1, background: '#e5dacb', margin: '3px 0' }} />}
                  </div>
                  <div style={{ paddingBottom: 10 }}>
                    <div className="small strong">{titleize(h.status)}</div>
                    <div className="tiny muted">{fmtDateTime(h.at)}</div>
                  </div>
                </div>
              ))}
              {!order.history?.length && <div className="tiny muted">No timeline entries yet.</div>}
            </div>
          </section>

          <div className="flex gap-8 wrap">
            <Link className="btn btn-secondary btn-sm" to="/menu"><UtensilsCrossed size={13} /> Add something else</Link>
            <Link className="btn btn-ghost btn-sm" to="/track"><Search size={13} /> Track another</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
