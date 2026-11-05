import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, Check, Clock, Coffee, CreditCard, Edit3, History, KeyRound,
  Leaf, MapPin, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Store, Tag, Trash2,
  UserPlus, Users, UtensilsCrossed, Wallet,
} from 'lucide-react';
import { del, patch, post, put } from '../../lib/api';
import { useFetch, useToast } from '../../lib/store';
import {
  Avatar, Badge, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader,
  SectionCard, StatusBadge, Tabs, Toggle,
} from '../../components/ui';
import { fmtDate, fmtDateTime, inr, num, titleize } from '../../lib/format';

const ROLE_TONE = { owner: 'purple', manager: 'accent', supervisor: 'blue', kitchen: 'amber', waiter: 'green' };
const KINDS = [
  ['temporarily_unavailable', 'Temporarily unavailable'],
  ['ingredient_shortage', 'Ingredient shortage'],
  ['equipment_issue', 'Equipment issue'],
  ['restock_needed', 'Restock needed'],
];
const emptyStation = () => ({ name: '', description: '', color: '#b07d4f', targetMinutes: 12, sortOrder: 0, active: true });
const emptyStaff = () => ({ name: '', email: '', phone: '', role: 'waiter', stationId: '', password: '', active: true });
const emptyOffer = () => ({
  title: '', description: '', code: '', discountType: 'percent', value: 10, minOrder: 0,
  maxDiscount: '', active: true, startsAt: '', endsAt: '',
});

function settingsToForm(s) {
  return {
    name: s?.name || '', tagline: s?.tagline || '', description: s?.description || '',
    address: s?.address || '', phone: s?.phone || '', email: s?.email || '',
    latitude: s?.latitude ?? '', longitude: s?.longitude ?? '',
    taxRate: s?.tax_rate ?? 0, serviceChargeRate: s?.service_charge_rate ?? 0,
    taxInclusive: Boolean(s?.tax_inclusive), prepaymentRequired: Boolean(s?.prepayment_required),
    takeawayEnabled: Boolean(s?.takeaway_enabled),
    reservationHoldMinutes: s?.reservation_hold_minutes ?? 10,
    reservationSlotMinutes: s?.reservation_slot_minutes ?? 90,
    openingTime: s?.opening_time || '08:00', closingTime: s?.closing_time || '23:00',
    loyaltyEnabled: Boolean(s?.loyalty_enabled),
    loyaltyPointsPer100: s?.loyalty_points_per_100 ?? 5,
    loyaltyPointValue: s?.loyalty_point_value ?? 0.25,
    loyaltyMinRedeem: s?.loyalty_min_redeem ?? 100,
    reviewModeration: Boolean(s?.review_moderation),
    aiEnabled: Boolean(s?.ai_enabled),
  };
}

export default function Settings() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch('/admin/settings');
  const [tab, setTab] = useState('cafe');
  const [form, setForm] = useState(settingsToForm(null));
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (data?.settings) setForm(settingsToForm(data.settings));
  }, [data?.settings]);

  const settings = data?.settings || {};
  const staff = data?.staff || [];
  const stations = data?.stations || [];
  const offers = data?.offers || [];
  const audit = data?.audit || [];
  const reports = data?.availabilityReports || [];

  const stationName = (id) => stations.find((s) => s.id === Number(id))?.name;

  const [savingModal, setSavingModal] = useState(false);
  const [errors, setErrors] = useState({});

  const saveSettings = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim()) { toast.error('Cafe name is required.'); return; }
    if (!form.address.trim()) { toast.error('Address is required.'); return; }
    setSavingSettings(true);
    try {
      await put('/admin/settings', {
        ...form,
        taxRate: Number(form.taxRate),
        serviceChargeRate: Number(form.serviceChargeRate),
        reservationHoldMinutes: Number(form.reservationHoldMinutes),
        reservationSlotMinutes: Number(form.reservationSlotMinutes),
        loyaltyPointsPer100: Number(form.loyaltyPointsPer100),
        loyaltyPointValue: Number(form.loyaltyPointValue),
        loyaltyMinRedeem: Number(form.loyaltyMinRedeem),
        latitude: form.latitude === '' ? null : Number(form.latitude),
        longitude: form.longitude === '' ? null : Number(form.longitude),
      });
      toast.success('Settings saved');
      reload();
    } catch (err) {
      setErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSavingSettings(false); }
  };

  // ------------------------------------------------------------------- Staff
  const [staffModal, setStaffModal] = useState(null);
  const [passwordModal, setPasswordModal] = useState(null);
  const [passwordValue, setPasswordValue] = useState('');

  const openStaff = (member = null) => {
    setErrors({});
    setStaffModal({
      editing: member,
      form: member ? {
        name: member.name, email: member.email, phone: member.phone || '', role: member.role,
        stationId: member.station_id || '', password: '', active: Boolean(member.active),
      } : emptyStaff(),
    });
  };

  const saveStaff = async (e) => {
    e.preventDefault();
    const f = staffModal.form;
    const local = {};
    if (!f.name.trim()) local.name = 'Name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) local.email = 'Enter a valid email.';
    if (!staffModal.editing && f.password.length < 8) local.password = 'Use at least 8 characters.';
    if (Object.keys(local).length) { setErrors(local); return; }
    setSavingModal(true);
    try {
      const body = {
        name: f.name.trim(), email: f.email.trim().toLowerCase(), phone: f.phone.trim() || null,
        role: f.role, stationId: f.stationId ? Number(f.stationId) : null, active: f.active,
      };
      if (staffModal.editing) await put(`/admin/staff/${staffModal.editing.id}`, body);
      else await post('/admin/staff', { ...body, password: f.password });
      toast.success(staffModal.editing ? 'Staff member updated' : 'Staff member added');
      setStaffModal(null);
      reload();
    } catch (err) {
      setErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSavingModal(false); }
  };

  const toggleStaffActive = async (member) => {
    try {
      await put(`/admin/staff/${member.id}`, { active: !member.active });
      toast.success(`${member.name} ${member.active ? 'deactivated' : 'reactivated'}`);
      reload();
    } catch (err) { toast.error(err.message); }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (passwordValue.length < 8) { setErrors({ password: 'Use at least 8 characters.' }); return; }
    setSavingModal(true);
    try {
      await post(`/admin/staff/${passwordModal.id}/password`, { password: passwordValue });
      toast.success('Password reset · existing sessions revoked');
      setPasswordModal(null);
      setPasswordValue('');
      setErrors({});
    } catch (err) { toast.error(err.message); }
    finally { setSavingModal(false); }
  };

  // ---------------------------------------------------------------- Stations
  const [stationModal, setStationModal] = useState(null);
  const [stationConfirm, setStationConfirm] = useState(null);

  const openStation = (station = null) => {
    setErrors({});
    setStationModal({
      editing: station,
      form: station ? {
        name: station.name, description: station.description || '', color: station.color,
        targetMinutes: station.target_minutes, sortOrder: station.sort_order, active: Boolean(station.active),
      } : emptyStation(),
    });
  };

  const saveStation = async (e) => {
    e.preventDefault();
    if (!stationModal.form.name.trim()) { setErrors({ name: 'Station name is required.' }); return; }
    setSavingModal(true);
    try {
      const body = {
        name: stationModal.form.name.trim(), description: stationModal.form.description.trim() || null,
        color: stationModal.form.color, targetMinutes: Number(stationModal.form.targetMinutes),
        sortOrder: Number(stationModal.form.sortOrder), active: stationModal.form.active,
      };
      if (stationModal.editing) await put(`/admin/stations/${stationModal.editing.id}`, body);
      else await post('/admin/stations', body);
      toast.success(stationModal.editing ? 'Station updated' : 'Station created');
      setStationModal(null);
      reload();
    } catch (err) {
      setErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSavingModal(false); }
  };

  const removeStation = async (station) => {
    try {
      await del(`/admin/stations/${station.id}`);
      toast.success('Station deleted');
      setStationConfirm(null);
      reload();
    } catch (err) { toast.error(err.message); setStationConfirm(null); }
  };

  // ------------------------------------------------------------------ Offers
  const [offerModal, setOfferModal] = useState(null);

  const openOffer = (offer = null) => {
    setErrors({});
    setOfferModal({
      editing: offer,
      form: offer ? {
        title: offer.title, description: offer.description || '', code: offer.code,
        discountType: offer.discount_type, value: offer.value, minOrder: offer.min_order,
        maxDiscount: offer.max_discount ?? '', active: Boolean(offer.active),
        startsAt: offer.starts_at ? String(offer.starts_at).slice(0, 10) : '',
        endsAt: offer.ends_at ? String(offer.ends_at).slice(0, 10) : '',
      } : emptyOffer(),
    });
  };

  const saveOffer = async (e) => {
    e.preventDefault();
    const f = offerModal.form;
    const local = {};
    if (!f.title.trim()) local.title = 'Add a title.';
    if (!f.code.trim()) local.code = 'Add a code.';
    if (!(Number(f.value) > 0)) local.value = 'Enter a value above zero.';
    if (Object.keys(local).length) { setErrors(local); return; }
    setSavingModal(true);
    try {
      const body = {
        title: f.title.trim(), description: f.description.trim() || null, code: f.code.trim().toUpperCase(),
        discountType: f.discountType, value: Number(f.value), minOrder: Number(f.minOrder) || 0,
        maxDiscount: f.maxDiscount === '' ? null : Number(f.maxDiscount), active: f.active,
        startsAt: f.startsAt || null, endsAt: f.endsAt || null,
      };
      if (offerModal.editing) await put(`/admin/offers/${offerModal.editing.id}`, body);
      else await post('/admin/offers', body);
      toast.success(offerModal.editing ? 'Offer updated' : 'Offer created');
      setOfferModal(null);
      reload();
    } catch (err) {
      setErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSavingModal(false); }
  };

  const resolveReport = async (report, status) => {
    try {
      await patch(`/admin/availability-reports/${report.id}`, { status });
      toast.success(`Issue marked ${status}`);
      reload();
    } catch (err) { toast.error(err.message); }
  };

  const mapLink = form.latitude !== '' && form.longitude !== ''
    ? `https://www.google.com/maps/search/?api=1&query=${form.latitude},${form.longitude}`
    : null;

  const managerCount = staff.filter((u) => ['owner', 'manager'].includes(u.role) && u.active).length;

  const tabs = useMemo(() => ([
    { key: 'cafe', label: 'Cafe profile' },
    { key: 'service', label: 'Service & tax' },
    { key: 'loyalty', label: 'Loyalty & AI' },
    { key: 'staff', label: 'Staff', count: staff.length },
    { key: 'stations', label: 'Kitchen stations', count: stations.length },
    { key: 'offers', label: 'Offers', count: offers.length },
    { key: 'issues', label: 'Kitchen issues', count: reports.length },
    { key: 'audit', label: 'Audit log', count: audit.length },
  ]), [staff.length, stations.length, offers.length, reports.length, audit.length]);

  if (loading && !data) return <Loading label="Loading settings…" minHeight={420} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const set = (key) => (e) => {
    const value = e?.target?.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };
  const toggle = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  return (
    <>
      <PageHeader title="Settings" description="Cafe details, tax and service rules, loyalty, staff access, kitchen stations and offers. Changes are audited.">
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
        {['cafe', 'service', 'loyalty'].includes(tab) && (
          <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={savingSettings}>
            <Check size={14} /> {savingSettings ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </PageHeader>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Cafe</div>
          <div style={{ fontWeight: 600 }}>{settings.name}</div>
          <div className="tiny muted">{settings.opening_time}–{settings.closing_time} · {settings.phone}</div>
        </div>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Tax &amp; service</div>
          <div style={{ fontSize: 21, fontWeight: 600 }}>{Number(settings.tax_rate) || 0}%</div>
          <div className="tiny muted">{Number(settings.service_charge_rate) ? `${settings.service_charge_rate}% service charge` : 'No service charge'} · {settings.tax_inclusive ? 'inclusive' : 'exclusive'}</div>
        </div>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Active staff</div>
          <div style={{ fontSize: 21, fontWeight: 600 }}>{num(staff.filter((u) => u.active).length)}</div>
          <div className="tiny muted">{managerCount} manager{managerCount === 1 ? '' : 's'} · {staff.filter((u) => u.role === 'kitchen').length} kitchen</div>
        </div>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Kitchen issues</div>
          <div style={{ fontSize: 21, fontWeight: 600, color: reports.length ? 'var(--amber)' : 'var(--green)' }}>{num(reports.length)}</div>
          <div className="tiny muted">{offers.filter((o) => o.active).length} active offer{offers.filter((o) => o.active).length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div style={{ marginTop: 16 }}>
        {tab === 'cafe' && (
          <form onSubmit={saveSettings} className="split-2">
            <SectionCard title="Cafe profile" subtitle="Shown on the customer site, receipts and reservation confirmations.">
              <div className="form-grid">
                <Field label="Cafe name" className="full">
                  <input className="input" value={form.name} onChange={set('name')} placeholder="Brewhaus Coffee & Kitchen" />
                </Field>
                <Field label="Tagline" className="full">
                  <input className="input" value={form.tagline} onChange={set('tagline')} placeholder="Slow mornings, honest food." />
                </Field>
                <Field label="Description" className="full">
                  <textarea className="textarea" rows={4} value={form.description} onChange={set('description')} />
                </Field>
                <Field label="Phone">
                  <input className="input" value={form.phone} onChange={set('phone')} placeholder="+91 80 4123 8890" />
                </Field>
                <Field label="Email">
                  <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="hello@brewhaus.cafe" />
                </Field>
                <Field label="Full address" className="full">
                  <textarea className="textarea" rows={2} value={form.address} onChange={set('address')} />
                </Field>
                <Field label="Latitude" hint="Used for the venue map link.">
                  <input className="input" type="number" step="0.0001" value={form.latitude} onChange={set('latitude')} />
                </Field>
                <Field label="Longitude">
                  <input className="input" type="number" step="0.0001" value={form.longitude} onChange={set('longitude')} />
                </Field>
              </div>
              <div className="notice info" style={{ marginTop: 14 }}>
                <MapPin size={15} />
                <span>
                  {mapLink
                    ? <>Venue pin: <a href={mapLink} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'inherit' }}>open in Google Maps</a>. The indoor seating plan is managed separately in Tables &amp; Seating.</>
                    : 'Add latitude and longitude to generate the venue map link.'}
                </span>
              </div>
            </SectionCard>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionCard title="Customer-facing preview" subtitle="How guests see your cafe">
                <div className="promo light" style={{ padding: 22, position: 'relative', overflow: 'hidden', borderRadius: 14 }}>
                  <span className="code" style={{ border: '1px solid rgba(45,35,27,.3)', padding: '3px 8px', borderRadius: 20, fontSize: 10 }}>
                    {form.openingTime} – {form.closingTime}
                  </span>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 26, marginTop: 10 }}>{form.name || 'Your cafe'}</h3>
                  <p style={{ fontSize: 12.5, opacity: .75, marginTop: 6 }}>{form.tagline || 'Add a tagline to set the tone.'}</p>
                  <div className="tiny" style={{ marginTop: 12, opacity: .8 }}>{form.address || 'Add the cafe address.'}</div>
                </div>
              </SectionCard>
              <div className="notice warn">
                <AlertTriangle size={15} />
                <span>Saving these details updates the customer site immediately. Tax rates apply to new orders only — historical orders keep the tax they were charged.</span>
              </div>
            </div>
          </form>
        )}

        {tab === 'service' && (
          <form onSubmit={saveSettings} className="split-2">
            <SectionCard title="Tax &amp; charges" subtitle="Applied when an order is placed and frozen on the order.">
              <div className="form-grid">
                <Field label="Tax rate (%)">
                  <input className="input" type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={set('taxRate')} />
                </Field>
                <Field label="Service charge (%)">
                  <input className="input" type="number" min="0" max="100" step="0.01" value={form.serviceChargeRate} onChange={set('serviceChargeRate')} />
                </Field>
                <div className="full flex items-center gap-12">
                  <Toggle checked={form.taxInclusive} onChange={toggle('taxInclusive')} />
                  <span className="small muted">{form.taxInclusive ? 'Menu prices include tax (tax is separated on the receipt).' : 'Tax is added on top of menu prices.'}</span>
                </div>
                <div className="full flex items-center gap-12">
                  <Toggle checked={form.prepaymentRequired} onChange={toggle('prepaymentRequired')} />
                  <span className="small muted">{form.prepaymentRequired ? 'Prepayment is required before an order is prepared.' : 'Orders can be paid after service.'}</span>
                </div>
                <div className="full flex items-center gap-12">
                  <Toggle checked={form.takeawayEnabled} onChange={toggle('takeawayEnabled')} />
                  <span className="small muted">{form.takeawayEnabled ? 'Takeaway ordering is available.' : 'Takeaway ordering is hidden.'}</span>
                </div>
              </div>
            </SectionCard>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionCard title="Opening hours &amp; reservations" subtitle="Reservation slots and temporary table holds">
                <div className="form-grid">
                  <Field label="Opening time">
                    <input className="input" type="time" value={form.openingTime} onChange={set('openingTime')} />
                  </Field>
                  <Field label="Closing time">
                    <input className="input" type="time" value={form.closingTime} onChange={set('closingTime')} />
                  </Field>
                  <Field label="Reservation slot (minutes)" hint="Tables conflict within this window.">
                    <input className="input" type="number" min="30" max="240" value={form.reservationSlotMinutes} onChange={set('reservationSlotMinutes')} />
                  </Field>
                  <Field label="Hold duration (minutes)" hint="Temporary hold before a customer confirms.">
                    <input className="input" type="number" min="2" max="60" value={form.reservationHoldMinutes} onChange={set('reservationHoldMinutes')} />
                  </Field>
                </div>
                <div className="notice info" style={{ marginTop: 12 }}>
                  <Clock size={15} />
                  <span>Reservations are accepted between {form.openingTime} and {form.closingTime}. Conflicts are rejected atomically on the server.</span>
                </div>
              </SectionCard>
              <button className="btn btn-primary" type="submit" disabled={savingSettings}>
                <Check size={14} /> {savingSettings ? 'Saving…' : 'Save service settings'}
              </button>
            </div>
          </form>
        )}

        {tab === 'loyalty' && (
          <form onSubmit={saveSettings} className="split-2">
            <SectionCard title="Loyalty programme" subtitle="Points are earned on completed orders and can be redeemed at checkout.">
              <div className="flex items-center gap-12" style={{ marginBottom: 14 }}>
                <Toggle checked={form.loyaltyEnabled} onChange={toggle('loyaltyEnabled')} />
                <div>
                  <div className="small strong">{form.loyaltyEnabled ? 'Loyalty is enabled' : 'Loyalty is paused'}</div>
                  <div className="tiny muted">{form.loyaltyEnabled ? 'Customers earn and redeem points.' : 'Points stay on record but are not earned or redeemed.'}</div>
                </div>
              </div>
              <div className="form-grid">
                <Field label="Points per ₹100 spent">
                  <input className="input" type="number" min="0" step="0.1" value={form.loyaltyPointsPer100} onChange={set('loyaltyPointsPer100')} />
                </Field>
                <Field label="Value per point (₹)">
                  <input className="input" type="number" min="0" step="0.01" value={form.loyaltyPointValue} onChange={set('loyaltyPointValue')} />
                </Field>
                <Field label="Minimum points to redeem">
                  <input className="input" type="number" min="0" step="1" value={form.loyaltyMinRedeem} onChange={set('loyaltyMinRedeem')} />
                </Field>
                <Field label="Example earn" hint="On a ₹1,000 completed order">
                  <div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-3)' }}>
                    {num(Math.floor((1000 / 100) * Number(form.loyaltyPointsPer100 || 0)))} points · worth {inr((1000 / 100) * Number(form.loyaltyPointsPer100 || 0) * Number(form.loyaltyPointValue || 0))}
                  </div>
                </Field>
              </div>
            </SectionCard>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionCard title="Reviews &amp; AI" subtitle="Moderation and the customer/management assistants">
                <div className="flex items-center gap-12" style={{ marginBottom: 12 }}>
                  <Toggle checked={form.reviewModeration} onChange={toggle('reviewModeration')} />
                  <div>
                    <div className="small strong">Hold reviews for approval</div>
                    <div className="tiny muted">{form.reviewModeration ? 'New reviews are pending until approved.' : 'Reviews publish immediately.'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-12">
                  <Toggle checked={form.aiEnabled} onChange={toggle('aiEnabled')} />
                  <div>
                    <div className="small strong">AI assistant</div>
                    <div className="tiny muted">{form.aiEnabled ? 'Workers AI narrates database facts. Falls back to rules.' : 'Rule-based database answers only.'}</div>
                  </div>
                </div>
              </SectionCard>
              <button className="btn btn-primary" type="submit" disabled={savingSettings}>
                <Check size={14} /> {savingSettings ? 'Saving…' : 'Save loyalty settings'}
              </button>
            </div>
          </form>
        )}

        {tab === 'staff' && (
          <SectionCard
            title="Staff &amp; access"
            subtitle="Roles control which areas staff can open. Kitchen accounts use the kitchen display only."
            action={<button className="btn btn-primary btn-sm" onClick={() => openStaff()}><UserPlus size={14} /> Add staff</button>}
            noPad
          >
            {staff.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>Staff</th><th>Role</th><th>Station</th><th>Last sign-in</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {staff.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <div className="flex items-center gap-12">
                            <Avatar name={member.name} size={32} />
                            <div>
                              <div className="primary-cell">{member.name}</div>
                              <div className="sub-cell">{member.email}{member.phone ? ` · ${member.phone}` : ''}</div>
                            </div>
                          </div>
                        </td>
                        <td><Badge tone={ROLE_TONE[member.role] || ''}>{titleize(member.role)}</Badge></td>
                        <td className="small">{stationName(member.station_id) || <span className="muted">—</span>}</td>
                        <td className="small">{member.last_login_at ? fmtDateTime(member.last_login_at) : <span className="muted">Never</span>}</td>
                        <td><Badge tone={member.active ? 'green' : 'red'} dot>{member.active ? 'Active' : 'Disabled'}</Badge></td>
                        <td className="right">
                          <div className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-xs" onClick={() => openStaff(member)}><Edit3 size={11} /> Edit</button>
                            <button className="btn btn-secondary btn-xs" onClick={() => { setPasswordModal(member); setPasswordValue(''); setErrors({}); }}><KeyRound size={11} /> Reset</button>
                            <button className={`btn btn-xs ${member.active ? 'btn-ghost' : 'btn-soft'}`} onClick={() => toggleStaffActive(member)}>
                              {member.active ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={Users} title="No staff accounts" description="Add your first staff member to give them access." />}
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }} className="tiny muted">
              <ShieldCheck size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              Passwords are hashed with PBKDF2. Resetting a password revokes that staff member’s sessions. Waiter and supervisor access is limited server-side, not just hidden in the sidebar.
            </div>
          </SectionCard>
        )}

        {tab === 'stations' && (
          <>
            <div className="between" style={{ marginBottom: 12 }}>
              <span className="small muted">{stations.length} station{stations.length === 1 ? '' : 's'} · menu items are auto-routed by their assigned station</span>
              <button className="btn btn-primary btn-sm" onClick={() => openStation()}><Plus size={14} /> Add station</button>
            </div>
            <div className="grid g3">
              {stations.map((station) => (
                <div key={station.id} className="card card-pad">
                  <div className="between" style={{ alignItems: 'flex-start' }}>
                    <div className="flex items-center gap-12">
                      <span style={{ width: 34, height: 34, borderRadius: 9, background: `${station.color}22`, border: `1px solid ${station.color}`, display: 'grid', placeItems: 'center', color: station.color }}>
                        <UtensilsCrossed size={16} />
                      </span>
                      <div>
                        <div className="strong">{station.name}</div>
                        <div className="tiny muted">{station.description || 'No description'}</div>
                      </div>
                    </div>
                    <Badge tone={station.active ? 'green' : 'red'}>{station.active ? 'Active' : 'Off'}</Badge>
                  </div>
                  <div className="kv" style={{ marginTop: 10 }}><dt>Target prep</dt><dd>{station.target_minutes} min</dd></div>
                  <div className="kv"><dt>Sort order</dt><dd>{station.sort_order}</dd></div>
                  <div className="flex gap-4" style={{ marginTop: 10 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openStation(station)}><Edit3 size={13} /> Edit</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setStationConfirm(station)}><Trash2 size={13} /> Delete</button>
                  </div>
                </div>
              ))}
              {!stations.length && <div className="card" style={{ gridColumn: '1 / -1' }}><EmptyState icon={UtensilsCrossed} title="No stations" description="Create stations such as Beverage, Bakery, Main Course and Snacks." action={<button className="btn btn-primary btn-sm" onClick={() => openStation()}><Plus size={14} /> Add station</button>} /></div>}
            </div>
            <div className="notice info" style={{ marginTop: 14 }}>
              <ShieldCheck size={15} />
              <span>A station cannot be disabled while live items are routed to it. Reassign those menu items first, or let the kitchen finish them.</span>
            </div>
          </>
        )}

        {tab === 'offers' && (
          <>
            <div className="between" style={{ marginBottom: 12 }}>
              <span className="small muted">{offers.filter((o) => o.active).length} active of {offers.length} offer{offers.length === 1 ? '' : 's'}</span>
              <button className="btn btn-primary btn-sm" onClick={() => openOffer()}><Plus size={14} /> New offer</button>
            </div>
            <SectionCard noPad>
              {offers.length ? (
                <div className="table-wrap">
                  <table className="tbl">
                    <thead><tr><th>Offer</th><th>Code</th><th>Discount</th><th>Minimum order</th><th>Window</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {offers.map((offer) => (
                        <tr key={offer.id}>
                          <td className="primary-cell">{offer.title}{offer.description ? <div className="sub-cell">{offer.description}</div> : null}</td>
                          <td><span className="code badge accent" style={{ padding: '3px 8px' }}>{offer.code}</span></td>
                          <td className="small">{offer.discount_type === 'percent' ? `${offer.value}%` : inr(offer.value)}{offer.max_discount ? ` · max ${inr(offer.max_discount)}` : ''}</td>
                          <td className="num">{offer.min_order ? inr(offer.min_order) : '—'}</td>
                          <td className="small">{offer.starts_at ? fmtDate(offer.starts_at) : 'Anytime'}{offer.ends_at ? ` → ${fmtDate(offer.ends_at)}` : ''}</td>
                          <td><Badge tone={offer.active ? 'green' : 'red'}>{offer.active ? 'Active' : 'Paused'}</Badge></td>
                          <td className="right"><button className="btn btn-secondary btn-xs" onClick={() => openOffer(offer)}><Edit3 size={11} /> Edit</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon={Tag} title="No offers yet" description="Create a promo code for the customer site." action={<button className="btn btn-primary btn-sm" onClick={() => openOffer()}><Plus size={14} /> New offer</button>} />}
            </SectionCard>
          </>
        )}

        {tab === 'issues' && (
          <SectionCard title="Kitchen availability reports" subtitle="Issues raised from the kitchen display. Resolving here tells staff the item is handled." noPad>
            {reports.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Item</th><th>Kind</th><th>Reported by</th><th>Reason</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r.id}>
                        <td className="primary-cell">{r.item_name}<div className="sub-cell">{fmtDateTime(r.created_at)}</div></td>
                        <td><Badge tone={r.kind === 'restock_needed' ? 'amber' : 'red'}>{titleize(r.kind)}</Badge></td>
                        <td className="small">{r.reported_by_name || 'Kitchen'}</td>
                        <td className="small" style={{ maxWidth: 320 }}>{r.reason}</td>
                        <td><StatusBadge status={r.status} /></td>
                        <td className="right">
                          <div className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
                            {r.status === 'open' && <button className="btn btn-secondary btn-xs" onClick={() => resolveReport(r, 'acknowledged')}>Acknowledge</button>}
                            <button className="btn btn-primary btn-xs" onClick={() => resolveReport(r, 'resolved')}>Resolve</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={Check} title="No open kitchen issues" description="Issues reported by the kitchen appear here for follow-up." />}
          </SectionCard>
        )}

        {tab === 'audit' && (
          <SectionCard title="Audit log" subtitle="The most recent 60 privileged actions, newest first." noPad>
            {audit.length ? (
              <div className="table-wrap">
                <table className="tbl compact">
                  <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
                  <tbody>
                    {audit.map((row) => (
                      <tr key={row.id}>
                        <td className="small nowrap">{fmtDateTime(row.created_at)}</td>
                        <td className="small"><span className="strong">{row.actor_name || 'System'}</span><div className="sub-cell">{row.actor_type}</div></td>
                        <td><span className="code">{row.action}</span></td>
                        <td className="small">{row.entity || '—'}{row.entity_id ? ` #${row.entity_id}` : ''}</td>
                        <td className="small muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.meta || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={History} title="No audit entries" description="Privileged actions are recorded here." />}
          </SectionCard>
        )}
      </div>

      {/* Staff modal */}
      <Modal
        open={!!staffModal}
        onClose={() => setStaffModal(null)}
        title={staffModal?.editing ? `Edit ${staffModal.editing.name}` : 'Add staff member'}
        subtitle="Kitchen accounts can only use the kitchen display. Waiter and supervisor access is restricted server-side."
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setStaffModal(null)} disabled={savingModal}>Cancel</button>
            <button className="btn btn-primary" type="submit" form="staff-form" disabled={savingModal}>{savingModal ? 'Saving…' : 'Save staff member'}</button>
          </>
        )}
      >
        {staffModal && (
          <form id="staff-form" onSubmit={saveStaff} className="form-grid" style={{ paddingTop: 6 }}>
            <Field label="Full name" error={errors.name} className="full">
              <input className="input" value={staffModal.form.name} onChange={(e) => setStaffModal({ ...staffModal, form: { ...staffModal.form, name: e.target.value } })} />
            </Field>
            <Field label="Email" error={errors.email} className="full">
              <input className="input" type="email" value={staffModal.form.email} onChange={(e) => setStaffModal({ ...staffModal, form: { ...staffModal.form, email: e.target.value } })} />
            </Field>
            <Field label="Phone">
              <input className="input" value={staffModal.form.phone} onChange={(e) => setStaffModal({ ...staffModal, form: { ...staffModal.form, phone: e.target.value } })} />
            </Field>
            <Field label="Role">
              <select className="select" value={staffModal.form.role} onChange={(e) => setStaffModal({ ...staffModal, form: { ...staffModal.form, role: e.target.value } })}>
                {['owner', 'manager', 'supervisor', 'kitchen', 'waiter'].map((r) => <option key={r} value={r}>{titleize(r)}</option>)}
              </select>
            </Field>
            <Field label="Station" hint="Kitchen staff are routed work by station." className="full">
              <select className="select" value={staffModal.form.stationId} onChange={(e) => setStaffModal({ ...staffModal, form: { ...staffModal.form, stationId: e.target.value } })}>
                <option value="">No station</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            {!staffModal.editing && (
              <Field label="Temporary password" error={errors.password} hint="At least 8 characters. Share it securely." className="full">
                <input className="input" type="password" value={staffModal.form.password} onChange={(e) => setStaffModal({ ...staffModal, form: { ...staffModal.form, password: e.target.value } })} />
              </Field>
            )}
            {staffModal.editing && (
              <div className="full flex items-center gap-12">
                <Toggle checked={staffModal.form.active} onChange={(v) => setStaffModal({ ...staffModal, form: { ...staffModal.form, active: v } })} />
                <span className="small muted">{staffModal.form.active ? 'Account enabled' : 'Account disabled — cannot sign in'}</span>
              </div>
            )}
          </form>
        )}
      </Modal>

      {/* Password modal */}
      <Modal
        open={!!passwordModal}
        onClose={() => setPasswordModal(null)}
        title={passwordModal ? `Reset password · ${passwordModal.name}` : 'Reset password'}
        subtitle="Existing sessions for this staff member will be signed out."
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setPasswordModal(null)} disabled={savingModal}>Cancel</button>
            <button className="btn btn-primary" type="submit" form="password-form" disabled={savingModal}><KeyRound size={14} /> {savingModal ? 'Resetting…' : 'Reset password'}</button>
          </>
        )}
      >
        <form id="password-form" onSubmit={savePassword} style={{ paddingTop: 6 }}>
          <Field label="New password" error={errors.password} hint="At least 8 characters.">
            <input className="input" type="password" value={passwordValue} onChange={(e) => setPasswordValue(e.target.value)} autoFocus />
          </Field>
        </form>
      </Modal>

      {/* Station modal */}
      <Modal
        open={!!stationModal}
        onClose={() => setStationModal(null)}
        title={stationModal?.editing ? `Edit ${stationModal.editing.name}` : 'Add kitchen station'}
        subtitle="Menu items assigned to this station route here automatically."
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setStationModal(null)} disabled={savingModal}>Cancel</button>
            <button className="btn btn-primary" type="submit" form="station-form" disabled={savingModal}>{savingModal ? 'Saving…' : 'Save station'}</button>
          </>
        )}
      >
        {stationModal && (
          <form id="station-form" onSubmit={saveStation} className="form-grid" style={{ paddingTop: 6 }}>
            <Field label="Station name" error={errors.name} className="full">
              <input className="input" value={stationModal.form.name} onChange={(e) => setStationModal({ ...stationModal, form: { ...stationModal.form, name: e.target.value } })} placeholder="Beverage, Bakery, Main Course…" />
            </Field>
            <Field label="Description" className="full">
              <input className="input" value={stationModal.form.description} onChange={(e) => setStationModal({ ...stationModal, form: { ...stationModal.form, description: e.target.value } })} />
            </Field>
            <Field label="Colour">
              <input className="input" type="color" value={stationModal.form.color} onChange={(e) => setStationModal({ ...stationModal, form: { ...stationModal.form, color: e.target.value } })} style={{ padding: 4, height: 38 }} />
            </Field>
            <Field label="Target prep (minutes)">
              <input className="input" type="number" min="1" max="180" value={stationModal.form.targetMinutes} onChange={(e) => setStationModal({ ...stationModal, form: { ...stationModal.form, targetMinutes: e.target.value } })} />
            </Field>
            <Field label="Sort order">
              <input className="input" type="number" value={stationModal.form.sortOrder} onChange={(e) => setStationModal({ ...stationModal, form: { ...stationModal.form, sortOrder: e.target.value } })} />
            </Field>
            <div className="full flex items-center gap-12">
              <Toggle checked={stationModal.form.active} onChange={(v) => setStationModal({ ...stationModal, form: { ...stationModal.form, active: v } })} />
              <span className="small muted">{stationModal.form.active ? 'Active station' : 'Disabled — no new items will route here'}</span>
            </div>
          </form>
        )}
      </Modal>

      {/* Offer modal */}
      <Modal
        open={!!offerModal}
        onClose={() => setOfferModal(null)}
        title={offerModal?.editing ? `Edit ${offerModal.editing.title}` : 'Create offer'}
        subtitle="Offers appear on the customer site and are validated server-side at checkout."
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setOfferModal(null)} disabled={savingModal}>Cancel</button>
            <button className="btn btn-primary" type="submit" form="offer-form" disabled={savingModal}>{savingModal ? 'Saving…' : 'Save offer'}</button>
          </>
        )}
      >
        {offerModal && (
          <form id="offer-form" onSubmit={saveOffer} className="form-grid" style={{ paddingTop: 6 }}>
            <Field label="Title" error={errors.title} className="full">
              <input className="input" value={offerModal.form.title} onChange={(e) => setOfferModal({ ...offerModal, form: { ...offerModal.form, title: e.target.value } })} placeholder="Monsoon coffee break" />
            </Field>
            <Field label="Description" className="full">
              <input className="input" value={offerModal.form.description} onChange={(e) => setOfferModal({ ...offerModal, form: { ...offerModal.form, description: e.target.value } })} />
            </Field>
            <Field label="Code" error={errors.code}>
              <input className="input code" value={offerModal.form.code} onChange={(e) => setOfferModal({ ...offerModal, form: { ...offerModal.form, code: e.target.value.toUpperCase() } })} placeholder="BREW10" />
            </Field>
            <Field label="Type">
              <select className="select" value={offerModal.form.discountType} onChange={(e) => setOfferModal({ ...offerModal, form: { ...offerModal.form, discountType: e.target.value } })}>
                <option value="percent">Percentage</option>
                <option value="flat">Flat ₹ off</option>
              </select>
            </Field>
            <Field label={offerModal.form.discountType === 'percent' ? 'Discount (%)' : 'Discount (₹)'} error={errors.value}>
              <input className="input" type="number" min="0" step="0.01" value={offerModal.form.value} onChange={(e) => setOfferModal({ ...offerModal, form: { ...offerModal.form, value: e.target.value } })} />
            </Field>
            <Field label="Minimum order (₹)">
              <input className="input" type="number" min="0" value={offerModal.form.minOrder} onChange={(e) => setOfferModal({ ...offerModal, form: { ...offerModal.form, minOrder: e.target.value } })} />
            </Field>
            <Field label="Max discount (₹)" hint="Optional cap for percentage offers.">
              <input className="input" type="number" min="0" value={offerModal.form.maxDiscount} onChange={(e) => setOfferModal({ ...offerModal, form: { ...offerModal.form, maxDiscount: e.target.value } })} />
            </Field>
            <Field label="Starts">
              <input className="input" type="date" value={offerModal.form.startsAt} onChange={(e) => setOfferModal({ ...offerModal, form: { ...offerModal.form, startsAt: e.target.value } })} />
            </Field>
            <Field label="Ends">
              <input className="input" type="date" value={offerModal.form.endsAt} onChange={(e) => setOfferModal({ ...offerModal, form: { ...offerModal.form, endsAt: e.target.value } })} />
            </Field>
            <div className="full flex items-center gap-12">
              <Toggle checked={offerModal.form.active} onChange={(v) => setOfferModal({ ...offerModal, form: { ...offerModal.form, active: v } })} />
              <span className="small muted">{offerModal.form.active ? 'Offer is live' : 'Offer is paused'}</span>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!stationConfirm}
        title="Delete station?"
        message={stationConfirm ? `Delete ${stationConfirm.name}? This only works if no menu items are assigned to it.` : ''}
        confirmLabel="Delete station"
        onConfirm={() => removeStation(stationConfirm)}
        onCancel={() => setStationConfirm(null)}
      />
    </>
  );
}
