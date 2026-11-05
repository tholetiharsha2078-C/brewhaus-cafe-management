import React, { useState } from 'react';
import { ChefHat, MessageSquare, RefreshCw, Send, ShieldCheck, TriangleAlert, UserCheck, Users } from 'lucide-react';
import { post } from '../../lib/api';
import { useAuth, useFetch, useToast } from '../../lib/store';
import { titleize } from '../../lib/format';
import { Field, KdsInput, KdsModal, KdsStat } from './KdsShared';

export default function Team() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch('/kitchen/staff');
  const [messageOpen, setMessageOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const [sending, setSending] = useState(false);

  const staff = data?.staff || [];
  const canMessage = ['owner', 'manager', 'supervisor'].includes(user?.role);

  const send = async () => {
    if (!form.title.trim()) { toast.error('Add a message title.'); return; }
    setSending(true);
    try {
      await post('/kitchen/messages', { title: form.title.trim(), body: form.body.trim() });
      toast.success('Message sent to the kitchen');
      setMessageOpen(false);
      setForm({ title: '', body: '' });
    } catch (err) { toast.error(err.message); }
    finally { setSending(false); }
  };

  if (loading && !data) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: 340, color: '#8d877c' }}><div className="flex items-center gap-12"><span className="spinner" /> Loading the team…</div></div>;
  }
  if (error) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 300, textAlign: 'center' }}>
        <div><TriangleAlert size={26} style={{ color: '#e07868', marginBottom: 10 }} /><div style={{ marginBottom: 12 }}>{error.message}</div>
          <button className="kds-btn primary" style={{ flex: '0 0 auto' }} onClick={reload}><RefreshCw size={13} /> Retry</button></div>
      </div>
    );
  }

  return (
    <>
      <div className="between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 25 }}>Kitchen team</div>
          <div style={{ fontSize: 11.5, color: '#8d877c' }}>Who is on the line, their station and live workload.</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canMessage && <button className="kds-btn primary" style={{ flex: '0 0 auto' }} onClick={() => setMessageOpen(true)}><MessageSquare size={13} /> Message kitchen</button>}
          <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={reload}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>

      <div className="kds-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KdsStat label="Team members" value={staff.length} />
        <KdsStat label="On the line" value={staff.filter((s) => Number(s.active_items) > 0).length} tone="good" />
        <KdsStat label="Items in progress" value={staff.reduce((sum, s) => sum + Number(s.active_items || 0), 0)} tone="warn" />
        <KdsStat label="Items served" value={staff.reduce((sum, s) => sum + Number(s.completed_items || 0), 0)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 11 }}>
        {staff.map((member) => (
          <div key={member.id} style={{ background: '#1e1d1a', border: '1px solid #2c2a26', borderRadius: 12, padding: 14 }}>
            <div className="between" style={{ alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: member.color ? `${member.color}22` : '#2a2723', border: `1px solid ${member.color || '#3a352d'}`, display: 'grid', placeItems: 'center', color: member.color || '#d9b48a', fontWeight: 700, fontSize: 12 }}>
                  {String(member.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('')}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{member.name}</div>
                  <div style={{ fontSize: 10, color: '#8d877c' }}>{titleize(member.role)}{member.station_name ? ` · ${member.station_name}` : ''}</div>
                </div>
              </div>
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em', color: member.active ? '#8bb98c' : '#e07868' }}>
                {member.active ? 'Active' : 'Disabled'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginTop: 12 }}>
              <Mini label="Live items" value={member.active_items} tone={Number(member.active_items) ? '#e0a04a' : ''} />
              <Mini label="Served" value={member.completed_items} tone={Number(member.completed_items) ? '#8bb98c' : ''} />
              <Mini label="Station" value={member.station_name ? member.station_name.slice(0, 7) : '—'} />
            </div>
            <div style={{ fontSize: 10, color: '#7f786c', marginTop: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.email}</div>
          </div>
        ))}
        {!staff.length && <div className="kds-empty">No kitchen staff accounts found. Management can add them in Settings.</div>}
      </div>

      <div style={{ marginTop: 12, fontSize: 10.5, color: '#8d877c', display: 'flex', alignItems: 'center', gap: 6 }}>
        <ShieldCheck size={12} /> Kitchen and supervisor accounts can work tickets. Only owners, managers and supervisors can broadcast a kitchen message.
      </div>

      <KdsModal
        open={messageOpen}
        onClose={() => setMessageOpen(false)}
        title="Message the kitchen"
        subtitle="Posts to every kitchen display as a notification."
        footer={(
          <>
            <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={() => setMessageOpen(false)} disabled={sending}>Cancel</button>
            <button className="kds-btn primary" style={{ flex: '0 0 auto' }} onClick={send} disabled={sending}><Send size={13} /> {sending ? 'Sending…' : 'Send message'}</button>
          </>
        )}
      >
        <Field label="Title">
          <KdsInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="All-day brunch starts at 11" maxLength={160} autoFocus />
        </Field>
        <Field label="Message" hint="Keep it short — this appears on a busy screen.">
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={4}
            maxLength={500}
            style={{ width: '100%', borderRadius: 8, border: '1px solid #3d3830', background: '#191816', color: '#f2ede4', padding: 10, fontSize: 13, resize: 'vertical' }}
            placeholder="Avocado toast is selling fast; prep extra sourdough."
          />
        </Field>
        <div style={{ fontSize: 10.5, color: '#8d877c', display: 'flex', alignItems: 'center', gap: 6 }}>
          <UserCheck size={12} /> Signed in as {user?.name} · {titleize(user?.role)}
        </div>
      </KdsModal>
    </>
  );
}

function Mini({ label, value, tone = '' }) {
  return (
    <div style={{ background: '#24221e', border: '1px solid #2f2c26', borderRadius: 7, padding: '7px 8px' }}>
      <div style={{ fontSize: 8.5, color: '#8d877c', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: tone || '#f2ede4', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value ?? 0}</div>
    </div>
  );
}
