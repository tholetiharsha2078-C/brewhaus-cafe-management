import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, Check, ChefHat, ClipboardList, History, LayoutGrid, LogOut, Radio,
  Settings2, UtensilsCrossed, Users, Volume2, VolumeX,
} from 'lucide-react';
import { get, post } from '../../lib/api';
import { useAuth, useRealtime, useToast } from '../../lib/store';
import { timeAgo } from '../../lib/format';

const NAV = [
  { to: '/kitchen', end: true, label: 'Live board', icon: LayoutGrid },
  { to: '/kitchen/stations', label: 'Stations', icon: UtensilsCrossed },
  { to: '/kitchen/availability', label: 'Availability', icon: Settings2 },
  { to: '/kitchen/history', label: 'History', icon: History },
  { to: '/kitchen/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/kitchen/team', label: 'Team', icon: Users },
];

export default function KitchenShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [sound, setSound] = useState(() => localStorage.getItem('bh_kds_sound') !== 'off');
  const [online, setOnline] = useState(true);
  const notifRef = useRef(null);

  const { connected } = useRealtime((event) => {
    if (!event) return;
    if (['order', 'kitchen_issue', 'notification', 'reservation'].includes(event.type)) {
      setUnread((n) => n + 1);
      loadNotifications();
      if (event.type === 'notification') toast.info(event.title || 'New kitchen message');
      if (event.type === 'kitchen_issue') toast.info('A kitchen issue was reported');
    }
  });

  const loadNotifications = async () => {
    try {
      const data = await get('/notifications');
      setNotifications(data.notifications || []);
      setUnread(data.unread || 0);
    } catch { /* silent */ }
  };

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('bh_kds_sound', sound ? 'on' : 'off');
  }, [sound]);

  useEffect(() => {
    setNotifOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const timer = setInterval(() => setOnline(navigator.onLine), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notifOpen) return undefined;
    const onClick = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [notifOpen]);

  const markRead = async () => {
    try {
      await post('/notifications/read', { all: true });
      setUnread(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    } catch { /* silent */ }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="kds">
      <header className="kds-top">
        <div className="kds-brand">
          <div className="brand-mark" aria-hidden="true"><ChefHat size={17} /></div>
          <div>
            <div style={{ fontSize: 14 }}>Kitchen display</div>
            <div style={{ fontSize: 10, color: '#8d877c', letterSpacing: '.08em', textTransform: 'uppercase' }}>Brewhaus Coffee &amp; Kitchen</div>
          </div>
        </div>

        <nav className="kds-tabs" aria-label="Kitchen sections">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `kds-tab ${isActive ? 'active' : ''}`}>
              <Icon size={14} /> {label}
            </NavLink>
          ))}
        </nav>

        <div className="right-actions">
          <span className="kds-link" title={connected ? 'Realtime connected' : 'Reconnecting'} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Radio size={13} style={{ color: connected ? '#8bb98c' : '#e0a04a' }} /> {connected ? 'Live' : 'Polling'}
          </span>
          <button className="kds-link" onClick={() => setSound((s) => !s)} title={sound ? 'Mute new-order sound' : 'Enable new-order sound'} aria-label="Toggle sound">
            {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          <div style={{ position: 'relative' }} ref={notifRef}>
            <button className="kds-link" onClick={() => setNotifOpen((o) => !o)} aria-label="Kitchen notifications" style={{ position: 'relative' }}>
              <Bell size={15} />
              {unread > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: '#e07868' }} />}
            </button>
            {notifOpen && (
              <div style={{ position: 'absolute', right: 0, top: 42, width: 330, background: '#211f1b', border: '1px solid #38332b', borderRadius: 12, zIndex: 100, overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
                <div className="between" style={{ padding: '10px 12px', borderBottom: '1px solid #302c26' }}>
                  <strong style={{ fontSize: 12 }}>Kitchen notifications {unread > 0 && <span style={{ color: '#e0a04a' }}>· {unread}</span>}</strong>
                  <button className="kds-btn" style={{ flex: '0 0 auto', minWidth: 0, padding: '4px 8px', fontSize: 10 }} onClick={markRead}><Check size={11} /> Read</button>
                </div>
                <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                  {notifications.length ? notifications.slice(0, 14).map((n) => (
                    <div key={n.id} style={{ padding: '9px 12px', borderBottom: '1px solid #2a2723', background: n.read_at ? 'transparent' : '#26231e' }}>
                      <div className="between" style={{ gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{n.title}</span>
                        <span style={{ fontSize: 9.5, color: '#8d877c' }}>{timeAgo(n.created_at)}</span>
                      </div>
                      {n.body && <div style={{ fontSize: 11, color: '#a49b8d', marginTop: 2, lineHeight: 1.45 }}>{n.body}</div>}
                    </div>
                  )) : <div className="kds-empty">No kitchen notifications yet</div>}
                </div>
              </div>
            )}
          </div>
          <span className="kds-link hide-sm" style={{ color: online ? '#b4ac9e' : '#e07868' }} title={online ? 'Online' : 'Offline'}>
            <ClipboardList size={13} />
          </span>
          <div style={{ textAlign: 'right', paddingLeft: 8, borderLeft: '1px solid #302c26' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600 }}>{user?.name}</div>
            <div style={{ fontSize: 9.5, color: '#8d877c', textTransform: 'capitalize' }}>{user?.role} · kitchen</div>
          </div>
          <button className="kds-link" onClick={handleLogout} title="Sign out" aria-label="Sign out"><LogOut size={15} /></button>
        </div>
      </header>

      <main className="kds-body">
        <Outlet />
      </main>
    </div>
  );
}
