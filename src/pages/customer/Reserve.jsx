import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, Check, Clock, MapPin, Phone, RefreshCw, Users, UtensilsCrossed, X,
} from 'lucide-react';
import { del, get, post, qs } from '../../lib/api';
import { useAuth, useFetch, useToast } from '../../lib/store';
import { fmtDate, todayISO } from '../../lib/format';
import { ErrorState, Loading } from '../../components/ui';

const STEPS = [
  { key: 'when', label: 'Date & party' },
  { key: 'table', label: 'Choose a table' },
  { key: 'confirm', label: 'Confirm' },
];

function toMinutes(time) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function buildSlots(open = '08:00', close = '23:00') {
  const start = Math.max(8 * 60, toMinutes(open));
  const end = Math.min(22 * 60 + 30, toMinutes(close) - 30);
  const slots = [];
  for (let m = start; m <= end; m += 30) {
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return slots.length ? slots : ['19:00'];
}

function fmtCountdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function Reserve() {
  const { isCustomer, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const { data: home } = useFetch('/public/home');
  const settings = home?.settings || {};
  const slots = useMemo(() => buildSlots(settings.opening_time, settings.closing_time), [settings.opening_time, settings.closing_time]);

  const [date, setDate] = useState(params.get('date') || todayISO());
  const [time, setTime] = useState(params.get('time') || (slots.includes('19:00') ? '19:00' : slots[0]));
  const [party, setParty] = useState(Number(params.get('party')) || 2);
  const [selectedId, setSelectedId] = useState(null);
  const [holdingId, setHoldingId] = useState(null);
  const [hold, setHold] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [specialRequests, setSpecialRequests] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const holdRef = useRef(null);

  const profileFetch = useFetch('/customer/profile', [], { skip: !isCustomer });
  useEffect(() => {
    if (profileFetch.data?.customer?.phone && !phone) setPhone(profileFetch.data.customer.phone);
  }, [profileFetch.data?.customer?.phone]);

  const availabilityPath = `/public/availability${qs({ date, time, party })}`;
  const { data: availability, loading, error, reload } = useFetch(availabilityPath);

  const plan = availability?.plan;
  const tables = availability?.tables || [];
  const selected = tables.find((t) => t.id === selectedId) || null;

  const releaseHold = async (token = holdRef.current?.token) => {
    if (!token) return;
    try { await del(`/public/holds/${token}`); } catch { /* hold may already be gone */ }
    if (holdRef.current?.token === token) holdRef.current = null;
  };

  useEffect(() => {
    setSelectedId(null);
    setHold(null);
    releaseHold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, time, party]);

  useEffect(() => () => { releaseHold(); }, []);

  useEffect(() => {
    if (!hold?.expiresAt) { setSecondsLeft(0); return undefined; }
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        setHold(null);
        setSelectedId(null);
        holdRef.current = null;
        toast.info('Your table hold expired. Choose a table again to continue.');
        reload();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [hold?.expiresAt]);

  const pickTable = async (table) => {
    if (!table.available || table.tooSmall) return;
    if (selectedId === table.id) return;
    await releaseHold();
    setHoldingId(table.id);
    try {
      const res = await post('/public/holds', { tableId: table.id, date, time, party });
      holdRef.current = { token: res.token, expiresAt: res.expiresAt, tableId: table.id };
      setHold(holdRef.current);
      setSelectedId(table.id);
      toast.success(`Table ${table.label} held for ${Math.round((new Date(res.expiresAt) - Date.now()) / 60000)} minutes`);
    } catch (err) {
      toast.error(err.message);
      setSelectedId(null);
      reload();
    } finally { setHoldingId(null); }
  };

  const clearSelection = async () => {
    await releaseHold();
    setHold(null);
    setSelectedId(null);
  };

  const confirm = async (e) => {
    e.preventDefault();
    if (!selected || !hold) { toast.error('Choose an available table first.'); return; }
    if (!isCustomer) {
      toast.info('Sign in to confirm your table — we keep your booking under your account.');
      navigate(`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await post('/customer/reservations', {
        date, time, party, tableId: selected.id, holdToken: hold.token,
        specialRequests: specialRequests.trim(), phone: phone.trim(),
      });
      holdRef.current = null;
      setHold(null);
      setSuccess({ ...res.reservation, table_label: selected.label });
      toast.success('Table confirmed');
    } catch (err) {
      toast.error(err.message);
      if (err.status === 409) { setHold(null); setSelectedId(null); reload(); }
    } finally { setSubmitting(false); }
  };

  const activeStep = success ? 3 : selected ? 2 : 1;
  const mapLink = settings.latitude && settings.longitude
    ? `https://www.google.com/maps/search/?api=1&query=${settings.latitude},${settings.longitude}`
    : null;

  if (success) {
    return (
      <div className="track-wrap">
        <div className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)', textAlign: 'center', padding: 44 }}>
          <div style={{ width: 58, height: 58, borderRadius: '50%', background: '#eaf3e9', color: 'var(--green)', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
            <Check size={28} />
          </div>
          <div className="eyebrow" style={{ color: 'var(--copper)' }}>Reservation {success.reference}</div>
          <h1 className="display" style={{ fontSize: 36, margin: '8px 0 6px' }}>Your table is booked</h1>
          <p className="small muted" style={{ maxWidth: 420, margin: '0 auto 18px', lineHeight: 1.65 }}>
            {fmtDate(success.reservation_date)} at {success.reservation_time} for {success.party_size} guests.
            {success.table_label ? ` Table ${success.table_label} is reserved for you.` : ''} We’ve also sent this to the cafe team.
          </p>
          <div className="flex gap-8 wrap" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/account?tab=reservations"><CalendarDays size={14} /> My reservations</Link>
            <Link className="btn btn-secondary" to="/menu"><UtensilsCrossed size={14} /> Browse the menu</Link>
          </div>
          <p className="tiny muted" style={{ marginTop: 18 }}>Need to change it? Cancel from your account or call the cafe{settings.phone ? ` on ${settings.phone}` : ''}.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 30 }}>
      <div className="cust-page-head" style={{ paddingTop: 0 }}>
        <div className="eyebrow" style={{ color: 'var(--copper)' }}>Reserve a table</div>
        <h1>Save your corner</h1>
        <p>Pick a date, party size and a table on the floor plan. We hold your table for a few minutes while you confirm — no double bookings.</p>
      </div>

      <div className="steps" aria-label="Reservation steps">
        {STEPS.map((step, i) => (
          <div key={step.key} className={`step ${activeStep === i + 1 ? 'active' : activeStep > i + 1 ? 'done' : ''}`}>
            <span className="n">{activeStep > i + 1 ? <Check size={10} /> : i + 1}</span> {step.label}
          </div>
        ))}
      </div>

      <div className="reserve-wrap">
        <div>
          <div className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)', marginBottom: 16 }}>
            <div className="grid g3" style={{ gap: 12 }}>
              <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}><CalendarDays size={11} style={{ verticalAlign: -1 }} /> Date</span>
                <input
                  className="input"
                  type="date"
                  value={date}
                  min={todayISO()}
                  max={new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)}
                  onChange={(e) => setDate(e.target.value)}
                  style={{ background: '#fff' }}
                />
              </label>
              <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}><Users size={11} style={{ verticalAlign: -1 }} /> Guests</span>
                <select className="select" value={party} onChange={(e) => setParty(Number(e.target.value))} style={{ background: '#fff' }}>
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n} guest{n === 1 ? '' : 's'}</option>
                  ))}
                </select>
              </label>
              <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}><Clock size={11} style={{ verticalAlign: -1 }} /> Time</span>
                <select className="select" value={time} onChange={(e) => setTime(e.target.value)} style={{ background: '#fff' }}>
                  {slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                </select>
              </label>
            </div>

            <div className="slot-grid" style={{ marginTop: 14 }}>
              {slots.map((slot) => (
                <button key={slot} type="button" className={`slot ${time === slot ? 'active' : ''}`} onClick={() => setTime(slot)}>
                  {slot}
                </button>
              ))}
            </div>
            <div className="tiny muted" style={{ marginTop: 8 }}>
              Service hours {settings.opening_time || '08:00'}–{settings.closing_time || '23:00'} · reservations are held for {settings.reservation_hold_minutes || 10} minutes.
            </div>
          </div>

          <div className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
            <div className="between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong style={{ fontSize: 14 }}>Indoor seating plan</strong>
                <div className="tiny muted">Tables that are grey or too small for your party cannot be booked.</div>
              </div>
              <button className="btn btn-ghost btn-xs" onClick={reload} disabled={loading}><RefreshCw size={12} /> Refresh</button>
            </div>

            {loading && !availability ? (
              <Loading label="Checking table availability…" minHeight={260} />
            ) : error ? (
              <ErrorState error={error} onRetry={reload} />
            ) : !plan ? (
              <div className="empty" style={{ padding: 34 }}>
                <MapPin size={20} style={{ marginBottom: 7 }} />
                <div className="small muted">The indoor floor plan is not available yet. Please call the cafe to book.</div>
              </div>
            ) : (
              <>
                <div className="floor-map" style={{ aspectRatio: `${plan.width} / ${plan.height}` }}>
                  {tables.map((table) => {
                    const isSelected = selectedId === table.id;
                    return (
                      <button
                        key={table.id}
                        type="button"
                        className={`floor-table ${table.shape === 'round' ? 'round' : ''} ${table.visual} ${isSelected ? 'selected' : ''}`}
                        style={{
                          left: `${(table.x / plan.width) * 100}%`,
                          top: `${(table.y / plan.height) * 100}%`,
                          width: `${(table.width / plan.width) * 100}%`,
                          height: `${(table.height / plan.height) * 100}%`,
                          cursor: table.available && !table.tooSmall ? 'pointer' : 'not-allowed',
                          opacity: table.visual === 'available' || isSelected ? 1 : 0.6,
                        }}
                        disabled={!table.available || table.tooSmall || (holdingId !== null && holdingId !== table.id)}
                        onClick={() => pickTable(table)}
                        title={table.tooSmall
                          ? `${table.label} seats ${table.capacity} — too small for ${party}`
                          : table.available
                            ? `${table.label} · seats ${table.capacity} · ${table.zone || 'Dining'}`
                            : `${table.label} · ${table.reservation ? `booked at ${table.reservation.time}` : table.visual.replace('_', ' ')}`}
                        aria-label={`Table ${table.label}, seats ${table.capacity}${table.available ? ', available' : ', unavailable'}`}
                      >
                        <span className="t-label">{holdingId === table.id ? '…' : table.label}</span>
                        <span className="t-cap">{table.capacity} seats</span>
                      </button>
                    );
                  })}
                </div>
                <div className="floor-legend">
                  <span><i className="legend-dot" style={{ background: '#fff' }} /> Available</span>
                  <span><i className="legend-dot" style={{ background: '#f2e5d2' }} /> Reserved</span>
                  <span><i className="legend-dot" style={{ background: '#ede4d8' }} /> Occupied</span>
                  <span><i className="legend-dot" style={{ background: '#fbf0d9' }} /> On hold</span>
                  <span><i className="legend-dot" style={{ background: '#eee9e3' }} /> Out of service</span>
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="reserve-summary">
          <div className="eyebrow" style={{ color: 'var(--copper)' }}>Your reservation</div>
          <h3 className="display" style={{ fontSize: 25, margin: '6px 0 12px' }}>{selected ? `Table ${selected.label}` : 'Choose a table'}</h3>

          <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid rgba(33,26,21,.08)' }}>
            <dt style={{ color: '#8b7c6c' }}>Date</dt><dd style={{ fontWeight: 600 }}>{fmtDate(date)}</dd>
          </div>
          <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid rgba(33,26,21,.08)' }}>
            <dt style={{ color: '#8b7c6c' }}>Time</dt><dd style={{ fontWeight: 600 }}>{time}</dd>
          </div>
          <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid rgba(33,26,21,.08)' }}>
            <dt style={{ color: '#8b7c6c' }}>Party</dt><dd style={{ fontWeight: 600 }}>{party} guest{party === 1 ? '' : 's'}</dd>
          </div>
          {selected && (
            <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0' }}>
              <dt style={{ color: '#8b7c6c' }}>Table</dt><dd style={{ fontWeight: 600 }}>{selected.label} · {selected.capacity} seats{selected.zone ? ` · ${selected.zone}` : ''}</dd>
            </div>
          )}

          {hold && (
            <div className="notice warn" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Clock size={15} />
              <span>Held for <strong>{fmtCountdown(secondsLeft)}</strong>. {isCustomer ? 'Confirm below to lock it in.' : 'Sign in to confirm before it expires.'}</span>
            </div>
          )}

          <form onSubmit={confirm} style={{ marginTop: 14 }}>
            {selected && (
              <>
                <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
                  <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}>Phone</span>
                  <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" maxLength={30} style={{ background: '#fff' }} />
                </label>
                <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
                  <span className="tiny" style={{ color: '#8b7c6c', textTransform: 'uppercase', letterSpacing: '.08em' }}>Special requests</span>
                  <textarea className="textarea" rows={3} maxLength={500} value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} placeholder="Window seat, high chair, birthday…" style={{ background: '#fff' }} />
                </label>
              </>
            )}

            {selected ? (
              <>
                <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={submitting || !hold}>
                  {submitting ? 'Confirming…' : isCustomer ? <><Check size={14} /> Confirm reservation</> : <><ArrowRight size={14} /> Sign in to confirm</>}
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={clearSelection} style={{ width: '100%', marginTop: 6 }}>
                  <X size={13} /> Choose another table
                </button>
              </>
            ) : (
              <div className="small" style={{ color: '#8b7c6c', lineHeight: 1.6 }}>
                <MapPin size={14} style={{ verticalAlign: -2, marginRight: 5 }} />
                Select an available table on the plan. Larger parties may need two tables — call us and we’ll arrange it.
              </div>
            )}
          </form>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(33,26,21,.08)' }}>
            <div className="small strong" style={{ marginBottom: 8 }}>Find the cafe</div>
            <div className="map-preview" style={{ padding: 10 }}>
              <div className="map-thumb" style={{ width: 46, height: 46, borderRadius: 9 }}><MapPin size={18} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="tiny strong">{settings.name || 'Brewhaus Coffee & Kitchen'}</div>
                <div className="tiny muted" style={{ lineHeight: 1.45 }}>{settings.address || '18 Lavelle Road, Bengaluru'}</div>
                {mapLink && <a className="tiny" href={mapLink} target="_blank" rel="noreferrer" style={{ color: 'var(--copper)', fontWeight: 600 }}>Open in Maps</a>}
              </div>
            </div>
            {settings.phone && <a className="btn btn-ghost btn-sm" href={`tel:${String(settings.phone).replace(/\s/g, '')}`} style={{ marginTop: 8, width: '100%' }}><Phone size={13} /> {settings.phone}</a>}
          </div>

          {!isCustomer && (
            <div className="tiny muted" style={{ marginTop: 12, lineHeight: 1.55 }}>
              New here? <Link to={`/register?redirect=${encodeURIComponent('/reserve')}`} style={{ color: 'var(--copper)', fontWeight: 600 }}>Create an account</Link> to keep this booking in one place.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
