import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, CreditCard, Clock, MapPin, ShoppingBag,
  Smartphone, Sparkles, Store, UtensilsCrossed, Wallet,
} from 'lucide-react';
import { post, qs } from '../../lib/api';
import { useAuth, useCart, useFetch, useToast } from '../../lib/store';
import { fmtDate, inr, todayISO } from '../../lib/format';
import { EmptyState } from '../../components/ui';

const PAY_METHODS = [
  { key: 'upi', label: 'UPI', hint: 'Pay by UPI at the table or counter', icon: Smartphone },
  { key: 'card', label: 'Card', hint: 'Card machine brought to your table', icon: CreditCard },
  { key: 'cash', label: 'Cash', hint: 'Pay the waiter or at the counter', icon: Wallet },
  { key: 'other', label: 'Other', hint: 'Wallet, voucher or another method', icon: Store },
];

export default function Checkout() {
  const { items, subtotal, count, clear } = useCart();
  const { isCustomer, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const { data: home } = useFetch('/public/home');
  const settings = home?.settings || {};
  const { data: offersData } = useFetch('/public/offers');
  const offers = offersData?.offers || [];
  const profileFetch = useFetch('/customer/profile', [], { skip: !isCustomer });
  const profile = profileFetch.data;
  const reservationsFetch = useFetch('/customer/reservations', [], { skip: !isCustomer });
  const tablesFetch = useFetch(`/public/availability${qs({ date: todayISO(), time: '12:00', party: 2 })}`);
  const tables = tablesFetch.data?.tables || [];

  const [type, setType] = useState(params.get('reservation') ? 'preorder' : 'dine_in');
  const [tableId, setTableId] = useState('');
  const [reservationId, setReservationId] = useState(params.get('reservation') || '');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [offerCode, setOfferCode] = useState('');
  const [redeemPoints, setRedeemPoints] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [details, setDetails] = useState([]);
  const idempotencyRef = useRef(crypto.randomUUID());

  const upcomingReservations = useMemo(
    () => (reservationsFetch.data?.reservations || []).filter(
      (r) => ['pending', 'confirmed'].includes(r.status) && r.reservation_date >= todayISO()
    ),
    [reservationsFetch.data]
  );

  useEffect(() => {
    if (profile?.customer) {
      setGuestName((n) => n || profile.customer.name || '');
      setGuestPhone((p) => p || profile.customer.phone || '');
    }
  }, [profile?.customer?.id]);

  useEffect(() => {
    if (type === 'preorder' && !reservationId && upcomingReservations.length) {
      setReservationId(String(upcomingReservations[0].id));
    }
  }, [type, upcomingReservations.length]);

  useEffect(() => {
    if (tableId || !tables.length) return;
    const raw = params.get('table') || localStorage.getItem('bh_table');
    if (!raw) return;
    const match = tables.find((t) => String(t.id) === String(raw) || t.label.toLowerCase() === String(raw).toLowerCase());
    if (match) {
      setTableId(String(match.id));
      try { localStorage.setItem('bh_table', String(match.id)); } catch { /* ignore */ }
    } else if (/^\d+$/.test(String(raw))) {
      setTableId(String(raw));
    }
  }, [tables.length, tableId]);

  const chosenReservation = upcomingReservations.find((r) => String(r.id) === String(reservationId)) || null;
  const chosenTable = tables.find((t) => String(t.id) === String(tableId)) || null;

  useEffect(() => {
    if (type === 'preorder') setTableId('');
    if (type === 'takeaway') { setTableId(''); setReservationId(''); }
  }, [type]);

  const loyalty = profile?.loyaltyConfig || {};
  const loyaltyPoints = Number(profile?.customer?.loyalty_points) || 0;
  const pointsRequested = Math.max(0, Math.floor(Number(redeemPoints) || 0));
  const canRedeem = Boolean(isCustomer && loyalty.enabled && loyaltyPoints >= Number(loyalty.minRedeem || 0));
  const redeemable = canRedeem ? Math.min(pointsRequested, loyaltyPoints) : 0;

  const taxRate = Number(settings.tax_rate) || 0;
  const serviceRate = Number(settings.service_charge_rate) || 0;
  const tax = settings.tax_inclusive ? (subtotal * taxRate) / (100 + taxRate) : (subtotal * taxRate) / 100;
  const service = (subtotal * serviceRate) / 100;

  const matchedOffer = useMemo(() => {
    const code = offerCode.trim().toUpperCase();
    if (!code) return null;
    const offer = offers.find((o) => String(o.code).toUpperCase() === code);
    if (!offer) return { invalid: true, code };
    if (subtotal < Number(offer.min_order || 0)) return { invalid: true, code, minOrder: offer.min_order };
    let value = offer.discount_type === 'percent' ? (subtotal * Number(offer.value)) / 100 : Number(offer.value);
    if (offer.max_discount) value = Math.min(value, Number(offer.max_discount));
    return { offer, value: Math.max(0, Math.min(value, subtotal)) };
  }, [offerCode, offers, subtotal]);

  const offerDiscount = matchedOffer && !matchedOffer.invalid ? matchedOffer.value : 0;
  const loyaltyDiscount = canRedeem ? Math.min(redeemable * Number(loyalty.pointValue || 0), Math.max(0, subtotal + tax + service - offerDiscount)) : 0;
  const total = Math.max(0, subtotal + tax + service - offerDiscount - loyaltyDiscount);
  const pointsEarned = loyalty.enabled ? Math.floor((total / 100) * Number(loyalty.pointsPer100 || 0)) : 0;

  const needsTable = type === 'dine_in';
  const canPlace = items.length > 0 && !submitting
    && (type !== 'preorder' || Boolean(chosenReservation))
    && (!needsTable || Boolean(chosenTable || chosenReservation || tableId))
    && (isCustomer || Boolean(guestName.trim()));

  const placeOrder = async (e) => {
    e.preventDefault();
    setDetails([]);
    if (!items.length) { toast.error('Your cart is empty.'); return; }
    if (needsTable && !chosenTable && !tableId) { toast.error('Choose the table you are sitting at.'); return; }
    if (type === 'preorder' && !chosenReservation) { toast.error('Choose a reservation for your pre-order.'); return; }
    if (!isCustomer && !guestName.trim()) { toast.error('Add your name so the kitchen knows who is ordering.'); return; }

    setSubmitting(true);
    try {
      const res = await post('/public/orders', {
        type,
        tableId: needsTable && tableId ? Number(tableId) : undefined,
        reservationId: reservationId ? Number(reservationId) : undefined,
        guestName: guestName.trim() || undefined,
        guestPhone: guestPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        paymentMethod,
        offerCode: matchedOffer && !matchedOffer.invalid ? offerCode.trim().toUpperCase() : undefined,
        redeemPoints: canRedeem && redeemable > 0 ? redeemable : undefined,
        partySize: chosenReservation?.party_size || undefined,
        idempotencyKey: idempotencyRef.current,
        items: items.map((item) => ({
          menuItemId: item.id,
          qty: item.qty,
          optionIds: (item.options || []).map((o) => o.id).filter(Boolean),
          instructions: item.instructions || '',
          allergy: Boolean(item.allergy),
        })),
      });
      clear();
      try {
        localStorage.removeItem('bh_table');
        localStorage.setItem('bh_last_order', JSON.stringify({
          number: res.order?.order_number,
          token: res.trackingToken,
          at: new Date().toISOString(),
        }));
      } catch { /* ignore */ }
      idempotencyRef.current = crypto.randomUUID();
      toast.success(`Order ${res.order?.order_number || ''} sent to the kitchen`);
      navigate(res.order?.trackUrl || res.trackUrl || `/track/${res.order?.order_number}?token=${res.trackingToken}`);
    } catch (err) {
      setDetails(err.data?.details || []);
      toast.error(err.message);
    } finally { setSubmitting(false); }
  };

  if (!items.length) {
    return (
      <div style={{ paddingTop: 30 }}>
        <div className="card" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)', marginTop: 20 }}>
          <EmptyState
            icon={ShoppingBag}
            title="Nothing to check out"
            description="Your cart is empty. Add something from the menu and come back."
            action={<Link className="btn btn-primary btn-sm" to="/menu"><UtensilsCrossed size={14} /> Browse the menu</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 30 }}>
      <div className="cust-page-head" style={{ paddingTop: 0 }}>
        <div className="eyebrow" style={{ color: 'var(--copper)' }}>Checkout</div>
        <h1>Almost at the table</h1>
        <p>Tell us how you’re dining. The kitchen validates every item, price and option before accepting the order.</p>
      </div>

      <form id="checkout-form" onSubmit={placeOrder} className="cart-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
            <div className="between" style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>How are you ordering?</strong>
              <Link to="/cart" className="btn btn-ghost btn-xs"><ArrowLeft size={12} /> Edit cart</Link>
            </div>
            <div className="grid g3" style={{ gap: 8 }}>
              <TypeOption active={type === 'dine_in'} onClick={() => setType('dine_in')} icon={UtensilsCrossed} title="Dine-in" hint={chosenTable ? `Table ${chosenTable.label}` : 'At the cafe'} />
              <TypeOption
                active={type === 'takeaway'}
                onClick={() => setType('takeaway')}
                icon={ShoppingBag}
                title="Takeaway"
                hint={settings.takeaway_enabled ? 'Collect at the counter' : 'Currently unavailable'}
                disabled={!settings.takeaway_enabled}
              />
              <TypeOption
                active={type === 'preorder'}
                onClick={() => setType('preorder')}
                icon={CalendarDays}
                title="Pre-order"
                hint={isCustomer ? 'With a reservation' : 'Sign in to pre-order'}
                disabled={!isCustomer}
              />
            </div>

            {!settings.takeaway_enabled && type === 'takeaway' && (
              <div className="notice warn" style={{ marginTop: 10 }}>
                <AlertTriangle size={15} /> <span>Takeaway ordering is disabled by the cafe right now.</span>
              </div>
            )}

            {type === 'dine_in' && (
              <div style={{ marginTop: 16 }}>
                <div className="between" style={{ marginBottom: 8 }}>
                  <span className="small strong">Which table are you at?</span>
                  {tableId && <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setTableId(''); try { localStorage.removeItem('bh_table'); } catch { /* ignore */ } }}>Clear</button>}
                </div>
                {tablesFetch.loading && !tables.length ? (
                  <div className="tiny muted">Loading tables…</div>
                ) : tables.length ? (
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {tables.map((table) => {
                      const disabled = table.status === 'out_of_service';
                      return (
                        <button
                          type="button"
                          key={table.id}
                          className={`option-pill ${String(tableId) === String(table.id) ? 'active' : ''}`}
                          disabled={disabled}
                          onClick={() => {
                            setTableId(String(table.id));
                            try { localStorage.setItem('bh_table', String(table.id)); } catch { /* ignore */ }
                          }}
                          title={disabled ? 'Out of service' : `${table.zone || 'Dining'} · seats ${table.capacity}${table.visual === 'occupied' ? ' · currently occupied' : ''}`}
                          style={{ opacity: disabled ? 0.4 : 1 }}
                        >
                          {String(tableId) === String(table.id) ? <Check size={12} /> : null} Table {table.label}
                          <span className="d">{table.capacity}p</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="tiny muted">No tables found. Ask a team member for help.</div>
                )}
                <div className="tiny muted" style={{ marginTop: 7 }}>
                  <MapPin size={11} style={{ verticalAlign: -1 }} /> Scanning the QR code on your table fills this in automatically.
                </div>
              </div>
            )}

            {type === 'preorder' && (
              <div style={{ marginTop: 16 }}>
                <span className="small strong" style={{ display: 'block', marginBottom: 8 }}>Link this pre-order to a reservation</span>
                {upcomingReservations.length ? (
                  <select className="select" value={reservationId} onChange={(e) => setReservationId(e.target.value)} style={{ background: '#fff' }}>
                    <option value="">Choose a reservation…</option>
                    {upcomingReservations.map((r) => (
                      <option key={r.id} value={r.id}>
                        {fmtDate(r.reservation_date)} · {r.reservation_time} · {r.party_size} guests{r.table_label ? ` · Table ${r.table_label}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="notice info">
                    <CalendarDays size={15} />
                    <span>You have no upcoming reservations. <Link to="/reserve" style={{ fontWeight: 600, color: 'inherit' }}>Book a table first</Link>, then pre-order.</span>
                  </div>
                )}
                {chosenReservation && (
                  <div className="tiny muted" style={{ marginTop: 7 }}>
                    The kitchen schedules this for your reservation time{chosenReservation.table_label ? ` at Table ${chosenReservation.table_label}` : ''}.
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
            <strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>Who’s ordering?</strong>
            <div className="grid g2" style={{ gap: 12 }}>
              <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}>Name *</span>
                <input className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Your name" maxLength={120} disabled={isCustomer} style={{ background: isCustomer ? '#f7f1e8' : '#fff' }} />
              </label>
              <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}>Phone</span>
                <input className="input" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+91 …" maxLength={30} disabled={isCustomer} style={{ background: isCustomer ? '#f7f1e8' : '#fff' }} />
              </label>
            </div>
            {!isCustomer && (
              <div className="tiny muted" style={{ marginTop: 8 }}>
                Ordering as a guest. <Link to={`/login?redirect=${encodeURIComponent('/checkout')}`} style={{ color: 'var(--copper)', fontWeight: 600 }}>Sign in</Link> to earn loyalty points and keep this order in your history.
              </div>
            )}

            <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 12 }}>
              <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}>Notes for the kitchen</span>
              <textarea className="textarea" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, timing, celebration…" style={{ background: '#fff' }} />
            </label>
          </section>

          <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
            <strong style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>Payment method</strong>
            <p className="tiny muted" style={{ marginBottom: 10, lineHeight: 1.5 }}>
              Nothing is charged online. The payment is recorded as pending and verified by staff when you pay{settings.prepayment_required ? ' — prepayment is required before preparation.' : '.'}
            </p>
            <div className="grid g2" style={{ gap: 7 }}>
              {PAY_METHODS.map(({ key, label, hint, icon: Icon }) => (
                <label key={key} className={`pay-option ${paymentMethod === key ? 'active' : ''}`} style={{ marginBottom: 0 }}>
                  <input type="radio" name="payment" value={key} checked={paymentMethod === key} onChange={() => setPaymentMethod(key)} />
                  <Icon size={15} style={{ color: '#8b7c6c' }} />
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
                    <span className="tiny muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
            <strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>Offers &amp; loyalty</strong>
            <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}>Offer code</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={offerCode} onChange={(e) => setOfferCode(e.target.value.toUpperCase())} placeholder="BREW10" maxLength={40} style={{ background: '#fff' }} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => toast.info(offerCode.trim() ? 'The offer is validated by the server when you place the order.' : 'Enter a code from the offers page.')}>Check</button>
              </div>
            </label>
            {matchedOffer?.invalid && <div className="tiny" style={{ color: 'var(--red)', marginTop: 5 }}>{matchedOffer.minOrder ? `That offer needs a minimum order of ${inr(matchedOffer.minOrder)}.` : 'That code is not active right now.'}</div>}
            {matchedOffer && !matchedOffer.invalid && <div className="tiny" style={{ color: 'var(--green)', marginTop: 5 }}>{matchedOffer.offer.title} applied — you save {inr(matchedOffer.value)}.</div>}

            {isCustomer && loyalty.enabled && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(33,26,21,.08)' }}>
                <div className="between" style={{ marginBottom: 6 }}>
                  <span className="small strong"><Sparkles size={13} style={{ verticalAlign: -2 }} /> Loyalty points</span>
                  <span className="tiny muted">{loyaltyPoints} available · minimum {loyalty.minRedeem}</span>
                </div>
                {canRedeem ? (
                  <>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="input"
                        type="number"
                        min={loyalty.minRedeem}
                        max={loyaltyPoints}
                        step="1"
                        value={redeemPoints}
                        onChange={(e) => setRedeemPoints(e.target.value)}
                        placeholder={`Redeem from ${loyalty.minRedeem}`}
                        style={{ background: '#fff' }}
                      />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRedeemPoints(String(loyaltyPoints))}>Use max</button>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 5 }}>{redeemable} points = {inr(loyaltyDiscount)} off · value {inr(loyalty.pointValue, { decimals: true })} per point.</div>
                  </>
                ) : (
                  <div className="tiny muted">{loyaltyPoints >= Number(loyalty.minRedeem || 0) ? 'Loyalty is paused by the cafe.' : `You need ${loyalty.minRedeem} points to redeem. You earn ${pointsEarned} on this order.`}</div>
                )}
              </div>
            )}
          </section>

          {details.length > 0 && (
            <div className="notice warn" style={{ alignItems: 'flex-start' }}>
              <AlertTriangle size={15} />
              <div>
                <div className="small strong" style={{ marginBottom: 4 }}>The kitchen could not accept this order yet</div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
                  {details.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>

        <aside className="checkout-box">
          <div className="eyebrow" style={{ color: 'var(--copper)' }}>Order summary</div>
          <div style={{ margin: '10px 0 8px', maxHeight: 220, overflowY: 'auto' }}>
            {items.map((item) => (
              <div key={item.key} className="between" style={{ gap: 10, padding: '5px 0', fontSize: 12 }}>
                <span style={{ minWidth: 0 }}>
                  <span className="strong">{item.qty}×</span> {item.name}
                  {item.options?.length > 0 && <span className="tiny muted" style={{ display: 'block' }}>{item.options.map((o) => o.name).join(' · ')}</span>}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{inr(item.price * item.qty)}</span>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid rgba(33,26,21,.1)', paddingTop: 8 }}>
            <div className="checkout-line"><span>Subtotal ({count} item{count === 1 ? '' : 's'})</span><span>{inr(subtotal)}</span></div>
            {taxRate > 0 && <div className="checkout-line"><span>GST ({taxRate}%){settings.tax_inclusive ? ' · included' : ''}</span><span>{inr(tax, { decimals: true })}</span></div>}
            {serviceRate > 0 && <div className="checkout-line"><span>Service charge</span><span>{inr(service, { decimals: true })}</span></div>}
            {offerDiscount > 0 && <div className="checkout-line" style={{ color: 'var(--green)' }}><span>Offer {matchedOffer?.offer?.code}</span><span>−{inr(offerDiscount)}</span></div>}
            {loyaltyDiscount > 0 && <div className="checkout-line" style={{ color: 'var(--green)' }}><span>Loyalty ({redeemable} pts)</span><span>−{inr(loyaltyDiscount)}</span></div>}
            <div className="checkout-line total"><span>Total</span><span>{inr(total)}</span></div>
          </div>

          <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
            {type === 'dine_in' && chosenTable ? `Dine-in · Table ${chosenTable.label}` : type === 'dine_in' ? 'Dine-in · choose a table' : type === 'takeaway' ? 'Takeaway · collect at the counter' : chosenReservation ? `Pre-order · ${fmtDate(chosenReservation.reservation_date)} at ${chosenReservation.reservation_time}` : 'Pre-order · choose a reservation'}
            {' · '}Payment: {PAY_METHODS.find((p) => p.key === paymentMethod)?.label}
          </div>

          <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 14 }} disabled={!canPlace}>
            {submitting ? 'Sending to the kitchen…' : <><Check size={15} /> Place order · {inr(total)}</>}
          </button>
          <div className="tiny muted" style={{ marginTop: 9, lineHeight: 1.55, textAlign: 'center' }}>
            <Clock size={11} style={{ verticalAlign: -1 }} /> Estimated prep {Math.max(10, ...items.map((i) => Number(i.prepTime) || 10)) + 5} min · you can track it live.
          </div>
        </aside>
      </form>
    </div>
  );
}

function TypeOption({ active, onClick, icon: Icon, title, hint, disabled = false }) {
  return (
    <button
      type="button"
      className={`pay-option ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      style={{ marginBottom: 0, opacity: disabled ? 0.5 : 1, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600 }}><Icon size={14} /> {title}</span>
      <span className="tiny muted">{hint}</span>
    </button>
  );
}
