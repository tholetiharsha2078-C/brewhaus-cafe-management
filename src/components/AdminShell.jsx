import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Armchair, BarChart3, Bell, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, CreditCard,
  HeartHandshake, LayoutDashboard, LogOut, Menu, Package, PanelLeftClose, PanelLeftOpen, Settings,
  Sparkles, Users, UtensilsCrossed, Wallet, X, Check,
} from 'lucide-react';
import { useAuth, useRealtime, useToast } from '../lib/store';
import { get, post } from '../lib/api';
import { fmtDate, timeAgo } from '../lib/format';
import { Avatar, Badge } from './ui';

const GROUPS = [
  {
    label: 'Main',
    items: [{ to: '/admin', end: true, label: 'Dashboard', icon: LayoutDashboard, key: 'dashboard' }],
  },
  {
    label: 'Operations',
    items: [
      { to: '/admin/reservations', label: 'Reservations', icon: CalendarDays, key: 'reservations' },
      { to: '/admin/orders', label: 'Orders', icon: ClipboardList, key: 'orders' },
      { to: '/admin/menu', label: 'Menu Management', icon: UtensilsCrossed, key: 'menu' },
      { to: '/admin/payments', label: 'Payments', icon: CreditCard, key: 'payments' },
      { to: '/admin/tables', label: 'Tables & Seating', icon: Armchair, key: 'tables' },
    ],
  },
  {
    label: 'Customer Management',
    items: [
      { to: '/admin/customers', label: 'Customers', icon: Users, key: 'customers' },
      { to: '/admin/retention', label: 'Customer Retention', icon: HeartHandshake, key: 'retention' },
    ],
  },
  {
    label: 'Business Management',
    items: [
      { to: '/admin/finance', label: 'Revenue & Finance', icon: Wallet, key: 'finance' },
      { to: '/admin/analytics', label: 'Analytics & Reports', icon: BarChart3, key: 'analytics' },
      { to: '/admin/inventory', label: 'Inventory & Procurement', icon: Package, key: 'inventory' },
    ],
  },
  {
    label: 'Intelligence',
    items: [{ to: '/admin/assistant', label: 'AI Assistant', icon: Sparkles, key: 'assistant' }],
  },
  {
    label: 'Settings',
    items: [
      { to: '/admin/settings', label: 'Settings', icon: Settings, key: 'settings' },
      { label: 'Logout', icon: LogOut, key: 'logout', action: 'logout' },
    ],
  },
];

const TITLES = {
  '/admin': ['Dashboard', 'Live view of today’s service'],
  '/admin/reservations': ['Reservations', 'Bookings, seating and guest history'],
  '/admin/orders': ['Orders', 'Every order from kitchen to table'],
  '/admin/menu': ['Menu Management', 'Items, categories, pricing and availability'],
  '/admin/payments': ['Payments', 'Verified transactions and refunds'],
  '/admin/tables': ['Tables & Seating', 'Interactive floor plan and table states'],
  '/admin/customers': ['Customers', 'Profiles, history and spend'],
  '/admin/retention': ['Customer Retention', 'Loyalty, repeat visits and segments'],
  '/admin/finance': ['Revenue & Finance', 'Recorded revenue, expenses and taxes'],
  '/admin/analytics': ['Analytics & Reports', 'Performance, peaks and exports'],
  '/admin/inventory': ['Inventory & Procurement', 'Stock, recipes, suppliers and purchases'],
  '/admin/assistant': ['AI Assistant', 'Answers grounded in your live database'],
  '/admin/settings': ['Settings', 'Cafe, staff, stations and loyalty'],
};

function allowedKeys(role) {
  if (role === 'owner' || role === 'manager') return null;
  if (role === 'waiter') {
    return new Set(['dashboard', 'reservations', 'orders', 'tables', 'customers', 'payments']);
  }
  if (role === 'supervisor') {
    return new Set(['dashboard', 'reservations', 'orders', 'menu', 'payments', 'tables', 'customers', 'inventory']);
  }
  return new Set(['dashboard']);
}

export default function AdminShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('bh_sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const notifRef = useRef(null);

  const allowed = allowedKeys(user?.role);
  const [title, subtitle] = TITLES[location.pathname] || ['Management', ''];

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

  useRealtime((event) => {
    if (!event) return;
    if (['order', 'reservation', 'payment', 'inventory', 'kitchen_issue', 'review'].includes(event.type)) {
      setUnread((n) => n + 1);
      if (event.type === 'order' && event.action === 'created') {
        toast.info(`New order ${event.orderNumber || ''} received`);
      }
      loadNotifications();
    }
  });

  useEffect(() => {
    setMobileOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!notifOpen) return undefined;
    const onClick = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [notifOpen]);

  useEffect(() => {
    localStorage.setItem('bh_sidebar', collapsed ? 'collapsed' : 'open');
  }, [collapsed]);

  const toggle = () => setCollapsed((c) => !c);

  const markAllRead = async () => {
    try {
      await post('/notifications/read', { all: true });
      setUnread(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    } catch { /* silent */ }
  };

  const handleLogout = async () => {
    await logout();
    toast.info('Signed out');
    navigate('/login');
  };

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      {mobileOpen && <div className="drawer-backdrop" style={{ zIndex: 55 }} onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
              <path d="M16 10h2a3 3 0 0 1 0 6h-2" />
              <path d="M7 3v2M10 2v3M13 3v2" />
              <path d="M3 21h14" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-name display">Brewhaus</div>
            <div className="brand-sub">Coffee &amp; Kitchen</div>
          </div>
        </div>

        <div className="sidebar-scroll">
          {GROUPS.map((group) => {
            const items = group.items.filter((i) => !allowed || allowed.has(i.key));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-label">{group.label}</div>
                {items.map(({ to, label, icon: Icon, end, action }) => (
                  action === 'logout' ? (
                    <button
                      key={label}
                      type="button"
                      className="nav-item"
                      title={label}
                      onClick={handleLogout}
                      style={{ width: '100%', textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer' }}
                    >
                      <Icon />
                      <span>{label}</span>
                    </button>
                  ) : (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                      title={label}
                    >
                      <Icon />
                      <span>{label}</span>
                    </NavLink>
                  )
                ))}
              </div>
            );
          })}
        </div>

        <div className="sidebar-foot">
          <div className="side-card">
            <Avatar name={user?.name} />
            <div className="side-user" style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
              <div className="tiny muted" style={{ textTransform: 'capitalize' }}>{user?.role}</div>
            </div>
            <div className="side-user flex gap-4">
              <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={handleLogout} title="Log out" aria-label="Log out">
                <LogOut size={14} />
              </button>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-block sidebar-collapse" style={{ marginTop: 8, justifyContent: 'flex-start' }} onClick={handleLogout}>
            <LogOut size={14} /> <span>Log out</span>
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <button className="icon-btn sidebar-toggle" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={17} />
          </button>
          <button className="icon-btn" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div>
            <div className="topbar-title">{title}</div>
            <div className="topbar-sub">{subtitle}</div>
          </div>
          <div style={{ marginLeft: 'auto' }} className="flex items-center gap-12">
            <span className="small muted hide-sm">{fmtDate(new Date())}</span>
            <div style={{ position: 'relative' }} ref={notifRef}>
              <button className="icon-btn" onClick={() => setNotifOpen((o) => !o)} aria-label="Notifications">
                <Bell size={16} />
                {unread > 0 && <span className="dot" />}
              </button>
              {notifOpen && (
                <div className="card" style={{ position: 'absolute', right: 0, top: 44, width: 340, zIndex: 90, boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
                  <div className="between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                    <strong style={{ fontSize: 13 }}>Notifications {unread > 0 && <span className="badge red" style={{ marginLeft: 4 }}>{unread}</span>}</strong>
                    <button className="btn btn-ghost btn-xs" onClick={markAllRead}><Check size={13} /> Mark read</button>
                  </div>
                  <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {notifications.length ? notifications.slice(0, 15).map((n) => (
                      <Link
                        key={n.id}
                        to={n.link || '#'}
                        onClick={() => setNotifOpen(false)}
                        style={{ display: 'block', padding: '11px 14px', borderBottom: '1px solid var(--line)', background: n.read_at ? 'transparent' : 'var(--surface-2)' }}
                      >
                        <div className="between" style={{ gap: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{n.title}</span>
                          <span className="tiny faint nowrap">{timeAgo(n.created_at)}</span>
                        </div>
                        {n.body && <div className="small muted" style={{ marginTop: 2, lineHeight: 1.45 }}>{n.body}</div>}
                      </Link>
                    )) : <div className="empty" style={{ padding: '28px 16px' }}><Bell size={18} style={{ marginBottom: 8 }} /><div className="small muted">No notifications yet</div></div>}
                  </div>
                </div>
              )}
            </div>
            <button className="btn btn-secondary btn-sm hide-sm" onClick={handleLogout}><LogOut size={14} /> Log out</button>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
