import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Bell, Check, CheckCircle2, ChefHat, Clock, Flame, HandPlatter, Pause,
  Play, RefreshCw, Timer, TriangleAlert, UtensilsCrossed, Volume2, XCircle,
} from 'lucide-react';
import { get, patch, post, qs } from '../../lib/api';
import { useFetch, useRealtime, useToast } from '../../lib/store';
import { fmtTime, titleize } from '../../lib/format';
import { beep, clock, elapsedSeconds, Field, KdsInput, KdsModal, KdsSelect, KdsStat, useNow } from './KdsShared';

const COLUMNS = [
  { key: 'pending', label: 'New', icon: Bell, hint: 'Awaiting acceptance' },
  { key: 'confirmed', label: 'Accepted', icon: Check, hint: 'Queued for prep' },
  { key: 'preparing', label: 'Preparing', icon: Flame, hint: 'On the line' },
  { key: 'ready', label: 'Ready', icon: CheckCircle2, hint: 'Awaiting pickup' },
  { key: 'collected', label: 'Collected', icon: HandPlatter, hint: 'With the waiter' },
  { key: 'on_hold', label: 'On hold', icon: Pause, hint: 'Blocked' },
];

function statusForColumn(order) {
  return COLUMNS.some((c) => c.key === order.status) ? order.status : null;
}

export default function Board() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const station = params.get('station') || '';
  const now = useNow(1000);
  const { data, loading, error, reload } = useFetch(`/kitchen/bootstrap${qs({ station })}`);
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState(null);
  const [reasonModal, setReasonModal] = useState(null);
  const [reason, setReason] = useState('');
  const [etaModal, setEtaModal] = useState(null);
  const [eta, setEta] = useState('15');
  const [collectModal, setCollectModal] = useState(null);
  const [collectStaff, setCollectStaff] = useState('');
  const [issueModal, setIssueModal] = useState(null);
  const [issue, setIssue] = useState({ orderItemId: '', kind: 'temporarily_unavailable', reason: '' });
  const [hiddenDelayed, setHiddenDelayed] = useState([]);
  const reloadTimer = useRef(null);
  const lastNewCount = useRef(null);

  const summary = data?.summary || {};
  const orders = data?.orders || [];
  const stations = data?.stations || [];
  const stationLoad = data?.stationLoad || [];
  const waiters = data?.waiters || [];

  const scheduleReload = () => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(reload, 350);
  };

  useRealtime((event) => {
    if (!event) return;
    if (event.type === 'order' || event.type === 'kitchen_issue' || event.type === 'station') {
      scheduleReload();
    }
    if (event.type === 'order' && event.action === 'created') {
      if (localStorage.getItem('bh_kds_sound') !== 'off') beep('new');
      setFlash({ number: event.orderNumber, at: Date.now() });
    }
    if (event.type === 'order' && event.action === 'eta_updated') {
      if (localStorage.getItem('bh_kds_sound') !== 'off') beep('ready');
    }
  });

  useEffect(() => {
    if (summary.new_orders != null && lastNewCount.current != null && summary.new_orders > lastNewCount.current) {
      setFlash({ number: null, at: Date.now() });
    }
    lastNewCount.current = summary.new_orders ?? null;
  }, [summary.new_orders]);

  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => () => clearTimeout(reloadTimer.current), []);

  const transition = async (order, status, extra = {}) => {
    setBusyId(order.id);
    try {
      await patch(`/kitchen/orders/${order.id}/status`, { status, ...extra });
      toast.success(`${order.order_number} → ${titleize(status)}`);
      if (localStorage.getItem('bh_kds_sound') !== 'off') beep(status === 'ready' ? 'ready' : 'new');
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusyId(null); }
  };

  const itemStatus = async (order, item, status) => {
    setBusyId(order.id);
    try {
      await patch(`/kitchen/items/${item.id}/status`, { status });
      scheduleReload();
    } catch (err) { toast.error(err.message); }
    finally { setBusyId(null); }
  };

  const bulkItems = async (order, status) => {
    const targets = order.items.filter((i) => (status === 'preparing' ? i.status === 'pending' : !['ready', 'served', 'cancelled'].includes(i.status)));
    if (!targets.length) { toast.info('Nothing to update on this ticket.'); return; }
    setBusyId(order.id);
    try {
      for (const item of targets) {
        await patch(`/kitchen/items/${item.id}/status`, { status });
      }
      toast.success(`${targets.length} item${targets.length === 1 ? '' : 's'} marked ${status}`);
      reload();
    } catch (err) { toast.error(err.message); reload(); }
    finally { setBusyId(null); }
  };

  const saveReason = async () => {
    if (!String(reason).trim()) { toast.error('Add a short reason.'); return; }
    const { order, action } = reasonModal;
    setBusyId(order.id);
    try {
      await patch(`/kitchen/orders/${order.id}/status`, { status: action, reason: reason.trim() });
      toast.success(`${order.order_number} ${action === 'on_hold' ? 'put on hold' : 'cancelled'}`);
      setReasonModal(null);
      setReason('');
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusyId(null); }
  };

  const saveEta = async () => {
    const minutes = Number(eta);
    if (!(minutes >= 1 && minutes <= 180)) { toast.error('Enter an ETA between 1 and 180 minutes.'); return; }
    setBusyId(etaModal.id);
    try {
      await patch(`/kitchen/orders/${etaModal.id}/eta`, { minutes });
      toast.success(`ETA set to ${minutes} minutes · customer notified`);
      setEtaModal(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusyId(null); }
  };

  const confirmCollect = async () => {
    setBusyId(collectModal.id);
    try {
      const res = await post(`/kitchen/orders/${collectModal.id}/collect`, collectStaff ? { staffId: Number(collectStaff) } : {});
      toast.success(`${collectModal.order_number} collected by ${res.collectedBy}`);
      setCollectModal(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusyId(null); }
  };

  const openIssue = (order) => {
    setIssue({ orderItemId: order.items[0]?.id || '', kind: 'temporarily_unavailable', reason: '' });
    setIssueModal(order);
  };

  const saveIssue = async () => {
    if (!issue.orderItemId) { toast.error('Choose the affected item.'); return; }
    if (!issue.reason.trim()) { toast.error('Describe what happened.'); return; }
    setBusyId(issueModal.id);
    try {
      await post(`/kitchen/orders/${issueModal.id}/issue`, {
        orderItemId: Number(issue.orderItemId), kind: issue.kind, reason: issue.reason.trim(),
      });
      toast.success('Issue reported to management');
      setIssueModal(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusyId(null); }
  };

  const grouped = useMemo(() => {
    const map = {};
    for (const col of COLUMNS) map[col.key] = [];
    for (const order of orders) {
      const key = statusForColumn(order);
      if (key) map[key].push(order);
    }
    return map;
  }, [orders]);

  const sorted = (list) => [...list].sort((a, b) => {
    const pa = a.priority === 'high' ? 0 : a.priority === 'normal' ? 1 : 2;
    const pb = b.priority === 'high' ? 0 : b.priority === 'normal' ? 1 : 2;
    if (pa !== pb) return pa - pb;
    return new Date(a.placed_at) - new Date(b.placed_at);
  });

  const stationCount = (id) => stationLoad.find((s) => s.station_id === id)?.total || 0;
  const activeTicketCount = orders.length;

  if (loading && !data) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 380, color: '#8d877c' }}>
        <div className="flex items-center gap-12"><span className="spinner" /> Loading the kitchen board…</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 360, textAlign: 'center' }}>
        <div>
          <TriangleAlert size={28} style={{ color: '#e07868', marginBottom: 10 }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>Could not load the kitchen board</div>
          <p style={{ fontSize: 12, color: '#a49b8d', margin: '6px 0 14px' }}>{error.message}</p>
          <button className="kds-btn primary" onClick={reload} style={{ flex: '0 0 auto' }}><RefreshCw size={13} /> Try again</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {flash && (
        <div className="kds-toast" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={14} />
          {flash.number ? `New ticket ${flash.number} arrived just now` : 'A new kitchen ticket just arrived'}
        </div>
      )}

      <div className="kds-stats">
        <KdsStat label="New" value={numberOr(summary.new_orders)} />
        <KdsStat label="Accepted" value={numberOr(summary.accepted)} />
        <KdsStat label="Preparing" value={numberOr(summary.preparing)} />
        <KdsStat label="Ready" value={numberOr(summary.ready)} tone="good" />
        <KdsStat label="Delayed" value={numberOr(summary.delayed)} tone={Number(summary.delayed) ? 'bad' : ''} />
        <KdsStat label="Open issues" value={numberOr(summary.open_issues)} tone={Number(summary.open_issues) ? 'warn' : ''} />
      </div>

      <div className="kds-station">
        <button className={`kds-tab ${!station ? 'active' : ''}`} onClick={() => setParams({})}>
          <UtensilsCrossed size={13} /> All stations <span className="n">{activeTicketCount}</span>
        </button>
        {stations.map((s) => (
          <button
            key={s.id}
            className={`kds-tab ${String(station) === String(s.id) ? 'active' : ''}`}
            onClick={() => setParams({ station: String(s.id) })}
            title={s.description || s.name}
          >
            <span style={{ width: 8, height: 8, borderRadius: 3, background: s.color, display: 'inline-block' }} />
            {s.name} <span className="n">{stationCount(s.id)}</span>
          </button>
        ))}
        <button className="kds-tab" onClick={reload} style={{ marginLeft: 'auto' }}><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className="kds-cols" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        {COLUMNS.map((col) => {
          const list = sorted(grouped[col.key] || []);
          const Icon = col.icon;
          return (
            <section className="kds-col" key={col.key} aria-label={`${col.label} tickets`}>
              <div className="kds-col-head">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon size={13} /> {col.label}</span>
                <span className="n">{list.length}</span>
              </div>
              <div className="kds-col-body">
                {list.map((order) => {
                  const timer = elapsedSeconds(order.placed_at, now);
                  const mins = Math.floor(timer / 60);
                  const over = order.eta_minutes ? mins > Number(order.eta_minutes) : order.delayed;
                  const visibleItems = order.items || [];
                  const allReady = visibleItems.length > 0 && visibleItems.every((i) => ['ready', 'served'].includes(i.status));
                  return (
                    <article key={order.id} className={`kds-card ${order.priority === 'high' ? 'high' : ''} ${order.delayed || over ? 'delayed' : ''} ${order.status === 'ready' ? 'ready' : ''}`}>
                      <div className="kds-card-head">
                        <div>
                          <div className="kds-order-num">{order.order_number}</div>
                          <div className="kds-meta">
                            {order.table_label ? `Table ${order.table_label}` : titleize(order.type)} · {order.customer_name}
                            {order.waiter_name ? ` · ${order.waiter_name}` : ''}
                          </div>
                        </div>
                        <div className="kds-timer">
                          <div className={over ? 'over' : ''} style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                            <Timer size={12} /> {clock(timer)}
                          </div>
                          <div style={{ fontSize: 9.5, color: '#8d877c', marginTop: 2 }}>placed {fmtTime(order.placed_at)}</div>
                        </div>
                      </div>

                      <div className="kds-items">
                        {visibleItems.map((item) => (
                          <div key={item.id}>
                            <div className={`kds-item ${item.status === 'ready' ? 'ready' : ''}`}>
                              <span className="q">{item.qty}×</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600 }}>{item.name_snapshot}</div>
                                {Array.isArray(item.options) && item.options.length > 0 ? (
                                  <div style={{ fontSize: 10, color: '#968e80', marginTop: 1 }}>
                                    {item.options.map((o) => o.name).join(' · ')}
                                  </div>
                                ) : null}
                                {item.special_instructions ? <div className="kds-note">{item.special_instructions}</div> : null}
                                {item.allergy_flag ? <div className="kds-allergy">ALLERGY — check with guest before plating</div> : null}
                                {order.status === 'preparing' || order.status === 'confirmed' || order.status === 'pending' ? (
                                  <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                                    {item.status === 'pending' && (
                                      <button className="kds-btn" style={{ flex: '0 0 auto', minWidth: 0, padding: '3px 7px', fontSize: 9.5 }} onClick={() => itemStatus(order, item, 'preparing')}>
                                        <Play size={9} /> Start
                                      </button>
                                    )}
                                    {item.status !== 'ready' && (
                                      <button className="kds-btn good" style={{ flex: '0 0 auto', minWidth: 0, padding: '3px 7px', fontSize: 9.5 }} onClick={() => itemStatus(order, item, 'ready')}>
                                        <Check size={9} /> Ready
                                      </button>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                              <span className="st" style={{ color: item.status === 'ready' ? '#8bb98c' : undefined }}>{titleize(item.status)}</span>
                            </div>
                            {item.station_name && !station ? <div style={{ fontSize: 9, color: item.station_color || '#8d877c', paddingLeft: 26, marginTop: -1 }}>{item.station_name}</div> : null}
                          </div>
                        ))}
                        {!visibleItems.length && <div className="kds-empty">No items for this station.</div>}
                      </div>

                      {order.allItemsSummary && order.allItemsSummary.total > visibleItems.length ? (
                        <div style={{ fontSize: 10, color: '#9c9486', marginBottom: 6 }}>
                          Showing {visibleItems.length} of {order.allItemsSummary.total} items for this station · {order.allItemsSummary.ready} ready overall
                        </div>
                      ) : null}

                      <div className="kds-actions">
                        {order.status === 'pending' && (
                          <>
                            <button className="kds-btn primary" disabled={busyId === order.id} onClick={() => transition(order, 'confirmed')}><Check size={12} /> Accept</button>
                            <button className="kds-btn warn" disabled={busyId === order.id} onClick={() => { setReasonModal({ order, action: 'on_hold' }); setReason(''); }}><Pause size={12} /> Hold</button>
                            <button className="kds-btn danger" disabled={busyId === order.id} onClick={() => { setReasonModal({ order, action: 'cancelled' }); setReason(''); }}><XCircle size={12} /> Cancel</button>
                          </>
                        )}
                        {order.status === 'confirmed' && (
                          <>
                            <button className="kds-btn primary" disabled={busyId === order.id} onClick={() => transition(order, 'preparing')}><Flame size={12} /> Start prep</button>
                            <button className="kds-btn" disabled={busyId === order.id} onClick={() => bulkItems(order, 'preparing')}><Play size={12} /> Start items</button>
                            <button className="kds-btn warn" disabled={busyId === order.id} onClick={() => { setReasonModal({ order, action: 'on_hold' }); setReason(''); }}><Pause size={12} /> Hold</button>
                          </>
                        )}
                        {order.status === 'preparing' && (
                          <>
                            <button className="kds-btn good" disabled={busyId === order.id} onClick={() => bulkItems(order, 'ready')}><Check size={12} /> {station ? 'Station items ready' : 'All items ready'}</button>
                            <button className="kds-btn warn" disabled={busyId === order.id} onClick={() => { setReasonModal({ order, action: 'on_hold' }); setReason(''); }}><Pause size={12} /> Hold</button>
                          </>
                        )}
                        {order.status === 'ready' && (
                          <button className="kds-btn primary" disabled={busyId === order.id} onClick={() => { setCollectModal(order); setCollectStaff(''); }}><HandPlatter size={12} /> Collected</button>
                        )}
                        {order.status === 'on_hold' && (
                          <>
                            <button className="kds-btn primary" disabled={busyId === order.id} onClick={() => transition(order, 'confirmed')}><Play size={12} /> Resume</button>
                            <button className="kds-btn danger" disabled={busyId === order.id} onClick={() => { setReasonModal({ order, action: 'cancelled' }); setReason(''); }}><XCircle size={12} /> Cancel</button>
                          </>
                        )}
                        {order.status === 'collected' && (
                          <div style={{ fontSize: 10.5, color: '#8bb98c', display: 'flex', alignItems: 'center', gap: 5 }}><HandPlatter size={12} /> Collected — awaiting service completion</div>
                        )}
                      </div>

                      {order.status !== 'collected' && (
                        <div className="kds-actions" style={{ marginTop: 5 }}>
                          <button className="kds-btn" disabled={busyId === order.id} onClick={() => { setEtaModal(order); setEta(String(order.eta_minutes || 15)); }}><Clock size={11} /> ETA</button>
                          <button className="kds-btn" disabled={busyId === order.id} onClick={() => openIssue(order)}><AlertTriangle size={11} /> Issue</button>
                        </div>
                      )}
                      {order.eta_minutes ? (
                        <div style={{ fontSize: 9.5, color: '#968e80', marginTop: 6 }}>ETA {order.eta_minutes} min{order.estimated_ready_at ? ` · by ${fmtTime(order.estimated_ready_at)}` : ''}</div>
                      ) : null}
                    </article>
                  );
                })}
                {!list.length && <div className="kds-empty">No {col.label.toLowerCase()} tickets</div>}
              </div>
            </section>
          );
        })}
      </div>

      <KdsModal
        open={!!reasonModal}
        onClose={() => setReasonModal(null)}
        title={reasonModal?.action === 'on_hold' ? 'Put order on hold' : 'Cancel order'}
        subtitle={reasonModal?.order ? `${reasonModal.order.order_number} · the reason is recorded in order history and shown to staff.` : ''}
        footer={(
          <>
            <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={() => setReasonModal(null)}>Back</button>
            <button className={`kds-btn ${reasonModal?.action === 'cancelled' ? 'danger' : 'warn'}`} style={{ flex: '0 0 auto' }} disabled={busyId} onClick={saveReason}>
              {reasonModal?.action === 'on_hold' ? <Pause size={13} /> : <XCircle size={13} />} {reasonModal?.action === 'on_hold' ? 'Hold order' : 'Cancel order'}
            </button>
          </>
        )}
      >
        <Field label="Reason" hint="Required. Be specific so the floor team knows what to do.">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={300}
            autoFocus
            style={{ width: '100%', borderRadius: 8, border: '1px solid #3d3830', background: '#191816', color: '#f2ede4', padding: 10, fontSize: 13, resize: 'vertical' }}
            placeholder={reasonModal?.action === 'on_hold' ? 'Waiting on a guest, ingredient running late…' : 'Guest cancelled, item unavailable…'}
          />
        </Field>
      </KdsModal>

      <KdsModal
        open={!!etaModal}
        onClose={() => setEtaModal(null)}
        title="Set preparation ETA"
        subtitle={etaModal ? `${etaModal.order_number} · the customer is notified of the new estimate.` : ''}
        footer={(
          <>
            <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={() => setEtaModal(null)}>Cancel</button>
            <button className="kds-btn primary" style={{ flex: '0 0 auto' }} disabled={busyId} onClick={saveEta}><Clock size={13} /> Save ETA</button>
          </>
        )}
      >
        <Field label="Minutes from now" hint="Between 1 and 180 minutes.">
          <KdsInput type="number" min="1" max="180" value={eta} onChange={(e) => setEta(e.target.value)} autoFocus />
        </Field>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[5, 10, 15, 20, 30, 45].map((m) => (
            <button key={m} className={`kds-btn ${Number(eta) === m ? 'primary' : ''}`} style={{ flex: '0 0 auto' }} onClick={() => setEta(String(m))}>{m} min</button>
          ))}
        </div>
      </KdsModal>

      <KdsModal
        open={!!collectModal}
        onClose={() => setCollectModal(null)}
        title="Record collection"
        subtitle={collectModal ? `${collectModal.order_number} · only collected orders can be served by the floor team.` : ''}
        footer={(
          <>
            <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={() => setCollectModal(null)}>Cancel</button>
            <button className="kds-btn good" style={{ flex: '0 0 auto' }} disabled={busyId} onClick={confirmCollect}><HandPlatter size={13} /> Confirm collection</button>
          </>
        )}
      >
        <Field label="Collected by" hint="Defaults to you if no waiter is chosen.">
          <KdsSelect value={collectStaff} onChange={(e) => setCollectStaff(e.target.value)}>
            <option value="">Me ({titleize('kitchen')})</option>
            {waiters.map((w) => <option key={w.id} value={w.id}>{w.name} · {titleize(w.role)}</option>)}
          </KdsSelect>
        </Field>
      </KdsModal>

      <KdsModal
        open={!!issueModal}
        onClose={() => setIssueModal(null)}
        title="Report a kitchen issue"
        subtitle={issueModal ? `${issueModal.order_number} · management sees this in Inventory and Settings.` : ''}
        footer={(
          <>
            <button className="kds-btn" style={{ flex: '0 0 auto' }} onClick={() => setIssueModal(null)}>Cancel</button>
            <button className="kds-btn warn" style={{ flex: '0 0 auto' }} disabled={busyId} onClick={saveIssue}><AlertTriangle size={13} /> Report issue</button>
          </>
        )}
      >
        <Field label="Affected item">
          <KdsSelect value={issue.orderItemId} onChange={(e) => setIssue({ ...issue, orderItemId: e.target.value })}>
            {(issueModal?.items || []).map((item) => <option key={item.id} value={item.id}>{item.qty}× {item.name_snapshot}</option>)}
          </KdsSelect>
        </Field>
        <Field label="Issue type">
          <KdsSelect value={issue.kind} onChange={(e) => setIssue({ ...issue, kind: e.target.value })}>
            <option value="temporarily_unavailable">Temporarily unavailable</option>
            <option value="ingredient_shortage">Ingredient shortage</option>
            <option value="equipment_issue">Equipment issue</option>
            <option value="restock_needed">Restock needed</option>
          </KdsSelect>
        </Field>
        <Field label="What happened?" hint="This is shown to management, not the guest.">
          <textarea
            value={issue.reason}
            onChange={(e) => setIssue({ ...issue, reason: e.target.value })}
            rows={3}
            maxLength={400}
            style={{ width: '100%', borderRadius: 8, border: '1px solid #3d3830', background: '#191816', color: '#f2ede4', padding: 10, fontSize: 13, resize: 'vertical' }}
            placeholder="Avocado delivery did not arrive; no substitutions available."
          />
        </Field>
      </KdsModal>
    </>
  );
}

function numberOr(value) {
  return value == null ? '—' : Number(value).toLocaleString('en-IN');
}
