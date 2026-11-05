import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Bot, Camera, Check, ClipboardList, Coffee, Home, MapPin, MessageCircle,
  Phone, Send, ShoppingBag, Sparkles, User, UtensilsCrossed, X, CalendarDays,
} from 'lucide-react';
import { get, post } from '../../lib/api';
import { useAuth, useCart, useFetch, useRealtime, useToast } from '../../lib/store';
import { timeAgo } from '../../lib/format';

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/menu', label: 'Menu' },
  { to: '/reserve', label: 'Reserve a table' },
  { to: '/track', label: 'Track order' },
];

function Markdown({ text }) {
  return (
    <div>
      {String(text || '').split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 5 }} />;
        const bullet = line.startsWith('•') || line.startsWith('- ');
        const content = bullet ? line.replace(/^[•-]\s*/, '') : line;
        const parts = content.split(/(\*\*[^*]+\*\*)/g);
        const body = parts.map((part, j) => (
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={j}>{part.slice(2, -2)}</strong>
            : <React.Fragment key={j}>{part}</React.Fragment>
        ));
        if (bullet) return <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 3 }}><span style={{ color: 'var(--copper)' }}>•</span><span>{body}</span></div>;
        return <p key={i} style={{ marginBottom: 4 }}>{body}</p>;
      })}
    </div>
  );
}

function AssistantWidget() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, sending]);

  const ask = async (text) => {
    const q = String(text || '').trim();
    if (!q || sending) return;
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setQuestion('');
    setSending(true);
    try {
      const res = await post('/public/ai', { question: q });
      setMessages((prev) => [...prev, {
        role: 'assistant', text: res.answer, mode: res.mode, items: res.items || [], note: res.note,
      }]);
    } catch (err) {
      toast.error(err.message);
      setMessages((prev) => [...prev, { role: 'assistant', text: `I could not answer that: ${err.message}`, mode: 'error' }]);
    } finally { setSending(false); }
  };

  return (
    <>
      {open && (
        <div style={panelStyle} role="dialog" aria-label="Brewhaus menu assistant">
          <div style={{ padding: '13px 15px', borderBottom: '1px solid rgba(33,26,21,.1)', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--espresso)', color: '#f3dfc6', display: 'grid', placeItems: 'center' }}><Bot size={16} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Menu guide</div>
              <div className="tiny muted">Answers use the live menu — nothing invented</div>
            </div>
            <button style={iconBtn} onClick={() => setOpen(false)} aria-label="Close assistant"><X size={15} /></button>
          </div>
          <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 11, background: '#fdfbf7' }}>
            {!messages.length && (
              <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 300 }}>
                <div className="empty-icon" style={{ color: 'var(--copper)', background: '#f3e9db', margin: '0 auto 10px' }}><Sparkles size={20} /></div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>What are you craving?</div>
                <p className="small muted" style={{ marginTop: 6, lineHeight: 1.55 }}>Ask about dishes, dietary options or pairings. Suggestions come from the live menu and stock availability.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
                <div style={{
                  background: m.role === 'user' ? 'var(--espresso)' : '#fff',
                  color: m.role === 'user' ? '#f8efe3' : 'var(--espresso)',
                  border: m.role === 'user' ? '1px solid var(--espresso)' : '1px solid rgba(33,26,21,.1)',
                  borderRadius: 13, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.6,
                }}>
                  <Markdown text={m.text} />
                </div>
                {m.mode && m.mode !== 'error' && (
                  <div className="tiny muted" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {m.mode === 'ai' ? <Sparkles size={9} /> : <Check size={9} />}
                    {m.mode === 'ai' ? 'AI narration over live menu data' : 'Answered from the menu database'}
                  </div>
                )}
                {m.items?.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                    {m.items.slice(0, 4).map((item) => (
                      <Link key={item.id} to={`/menu/${item.id}`} onClick={() => setOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(33,26,21,.12)', background: '#fff', borderRadius: 20, padding: '4px 9px 4px 4px', fontSize: 10.5 }}>
                        {item.image ? <img src={item.image} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} /> : null}
                        {item.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && <div className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span className="spinner" style={{ width: 13, height: 13 }} /> Checking the menu…</div>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(question); }} style={{ display: 'flex', gap: 7, padding: 10, borderTop: '1px solid rgba(33,26,21,.1)' }}>
            <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Something warm and not too sweet…" maxLength={500} style={{ height: 38 }} />
            <button className="btn btn-primary btn-sm" type="submit" disabled={sending || !question.trim()} style={{ height: 38 }}><Send size={13} /></button>
          </form>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open menu assistant"
        style={{
          position: 'fixed', right: 20, bottom: 22, zIndex: 130, width: 52, height: 52, borderRadius: '50%',
          background: 'var(--espresso)', color: '#f3dfc6', border: '1px solid #4a3a2c', display: 'grid', placeItems: 'center',
          boxShadow: '0 12px 28px rgba(33,26,21,.3)', cursor: 'pointer',
        }}
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>
    </>
  );
}

const panelStyle = {
  position: 'fixed', right: 20, bottom: 84, zIndex: 130, width: 370, maxWidth: 'calc(100vw - 32px)',
  height: 520, maxHeight: 'calc(100vh - 110px)', background: '#fff', border: '1px solid rgba(33,26,21,.12)',
  borderRadius: 18, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(33,26,21,.25)',
};
const iconBtn = { width: 30, height: 30, borderRadius: 8, border: 0, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer' };

export default function CustomerShell() {
  const { user, isCustomer, logout } = useAuth();
  const { count, subtotal } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: home } = useFetch('/public/home');
  const settings = home?.settings || {};
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const notifRef = useRef(null);
  const accountRef = useRef(null);

  // Remember the table from a QR link (?table=12) so checkout can preselect it.
  useEffect(() => {
    const table = new URLSearchParams(location.search).get('table');
    if (!table) return;
    try { localStorage.setItem('bh_table', table); } catch { /* storage may be blocked */ }
  }, [location.search]);

  const loadNotifications = async () => {
    if (!isCustomer) return;
    try {
      const data = await get('/notifications');
      setNotifications(data.notifications || []);
      setUnread(data.unread || 0);
    } catch { /* silent */ }
  };

  useEffect(() => { loadNotifications(); }, [isCustomer]);

  useRealtime((event) => {
    if (!event) return;
    if (['order', 'notification', 'reservation'].includes(event.type)) {
      loadNotifications();
      if (event.type === 'order' && event.action === 'ready') toast.info(`Order ${event.orderNumber || ''} is ready`);
      if (event.type === 'notification' && event.title) toast.info(event.title);
    }
  });

  useEffect(() => {
    setNotifOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!notifOpen && !accountOpen) return undefined;
    const onClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [notifOpen, accountOpen]);

  const markRead = async () => {
    try {
      await post('/notifications/read', { all: true });
      setUnread(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    } catch { /* silent */ }
  };

  const signOut = async () => {
    await logout();
    toast.info('Signed out');
    navigate('/');
  };

  return (
    <div className="cust">
      <header className="cust-header">
        <nav className="cust-nav">
          <Link to="/" className="cust-brand">
            <span className="brand-mark" style={{ background: 'var(--espresso)', color: '#e6c49e', width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center' }}>
              <Coffee size={17} />
            </span>
            <div>
              <div className="brand-name display" style={{ fontSize: 19 }}>Brewhaus</div>
              <div style={{ fontSize: 9, letterSpacing: '.15em', textTransform: 'uppercase', color: '#91837a' }}>Coffee &amp; Kitchen</div>
            </div>
          </Link>
          <div className="cust-links">
            {LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>{l.label}</NavLink>)}
          </div>
          <div className="cust-actions">
            {isCustomer ? (
              <div style={{ position: 'relative' }} ref={notifRef}>
                <button className="icon-btn" onClick={() => setNotifOpen((o) => !o)} aria-label="Notifications" style={{ background: 'transparent', border: '1px solid rgba(33,26,21,.14)' }}>
                  <Bell size={16} />
                  {unread > 0 && <span style={{ position: 'absolute', top: 6, right: 7, width: 6, height: 6, borderRadius: '50%', background: 'var(--red)' }} />}
                </button>
                {notifOpen && (
                  <div className="card" style={{ position: 'absolute', right: 0, top: 43, width: 320, zIndex: 95, overflow: 'hidden', boxShadow: 'var(--shadow-md)' }}>
                    <div className="between" style={{ padding: '11px 13px', borderBottom: '1px solid var(--line)' }}>
                      <strong style={{ fontSize: 12.5 }}>Notifications {unread > 0 && <span className="badge red">{unread}</span>}</strong>
                      <button className="btn btn-ghost btn-xs" onClick={markRead}><Check size={12} /> Read</button>
                    </div>
                    <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                      {notifications.length ? notifications.slice(0, 12).map((n) => (
                        <Link key={n.id} to={n.link || '/account'} style={{ display: 'block', padding: '10px 13px', borderBottom: '1px solid var(--line)', background: n.read_at ? 'transparent' : 'var(--surface-2)' }}>
                          <div className="between" style={{ gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{n.title}</span>
                            <span className="tiny faint nowrap">{timeAgo(n.created_at)}</span>
                          </div>
                          {n.body && <div className="tiny muted" style={{ marginTop: 2, lineHeight: 1.45 }}>{n.body}</div>}
                        </Link>
                      )) : <div className="empty" style={{ padding: 26 }}><Bell size={17} style={{ marginBottom: 6 }} /><div className="small muted">No notifications yet</div></div>}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div style={{ position: 'relative' }} ref={accountRef}>
              <button className="btn btn-secondary btn-sm hide-mobile" onClick={() => (isCustomer ? setAccountOpen((o) => !o) : navigate('/login'))} style={{ background: 'transparent' }}>
                <User size={14} /> {isCustomer ? user.name.split(' ')[0] : 'Sign in'}
              </button>
              {isCustomer && accountOpen && (
                <div className="card" style={{ position: 'absolute', right: 0, top: 43, width: 220, zIndex: 95, overflow: 'hidden', boxShadow: 'var(--shadow-md)' }}>
                  <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--line)' }}>
                    <div className="small strong">{user.name}</div>
                    <div className="tiny muted">{user.email}</div>
                  </div>
                  <Link to="/account" style={{ display: 'flex', gap: 8, padding: '9px 13px', fontSize: 12.5 }}><User size={13} /> My account</Link>
                  <Link to="/account?tab=orders" style={{ display: 'flex', gap: 8, padding: '9px 13px', fontSize: 12.5, borderTop: '1px solid var(--line)' }}><ClipboardList size={13} /> My orders</Link>
                  <Link to="/account?tab=reservations" style={{ display: 'flex', gap: 8, padding: '9px 13px', fontSize: 12.5, borderTop: '1px solid var(--line)' }}><CalendarDays size={13} /> Reservations</Link>
                  <button onClick={signOut} style={{ display: 'flex', gap: 8, padding: '9px 13px', fontSize: 12.5, width: '100%', borderTop: '1px solid var(--line)', border: 0, background: 'transparent', textAlign: 'left', color: 'var(--red)' }}>Sign out</button>
                </div>
              )}
            </div>

            <Link to="/cart" className="cust-cart">
              <ShoppingBag size={15} />
              <span className="label">Cart</span>
              {count > 0 && <span className="n">{count}</span>}
            </Link>
          </div>
        </nav>
      </header>

      <main className="cust-main">
        <Outlet />
      </main>

      <footer className="cust-footer">
        <div className="cust-main" style={{ paddingBottom: 0 }}>
          <div className="footer-grid">
            <div>
              <div className="flex items-center gap-8" style={{ marginBottom: 10 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--espresso)', color: '#e6c49e', display: 'grid', placeItems: 'center' }}><Coffee size={15} /></span>
                <span className="display" style={{ fontSize: 21 }}>{settings.name || 'Brewhaus Coffee & Kitchen'}</span>
              </div>
              <p style={{ maxWidth: 320, lineHeight: 1.65 }}>{settings.tagline || 'Slow mornings, honest food.'}</p>
              <p style={{ lineHeight: 1.65 }}>{settings.description || 'A neighbourhood coffee house and kitchen.'}</p>
            </div>
            <div>
              <h4>Visit</h4>
              <p><MapPin size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{settings.address || '18 Lavelle Road, Bengaluru'}</p>
              <p><Phone size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{settings.phone || '+91 80 4123 8890'}</p>
              <p>{settings.opening_time || '08:00'} – {settings.closing_time || '23:00'} daily</p>
            </div>
            <div>
              <h4>Explore</h4>
              <Link to="/menu">Full menu</Link>
              <Link to="/reserve">Reserve a table</Link>
              <Link to="/track">Track an order</Link>
              <Link to="/account">Loyalty &amp; account</Link>
            </div>
            <div>
              <h4>Reach us</h4>
              <p>{settings.email || 'hello@brewhaus.cafe'}</p>
              <p style={{ display: 'flex', gap: 10, marginTop: 6 }}><Camera size={15} /><MessageCircle size={15} /></p>
              <p className="tiny" style={{ opacity: .8, marginTop: 8 }}>Single location · Lavelle Road, Bengaluru</p>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Brewhaus Coffee &amp; Kitchen · All prices in Indian Rupees (₹)</span>
            <span>Built for a slower cup.</span>
          </div>
        </div>
      </footer>

      <nav className="cust-mobile-nav" aria-label="Customer navigation">
        {[
          { to: '/', label: 'Home', icon: Home, end: true },
          { to: '/menu', label: 'Menu', icon: UtensilsCrossed },
          { to: '/reserve', label: 'Reserve', icon: CalendarDays },
          { to: '/cart', label: 'Cart', icon: ShoppingBag },
          { to: isCustomer ? '/account' : '/login', label: isCustomer ? 'Account' : 'Sign in', icon: User },
        ].map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon /> {label}{label === 'Cart' && count > 0 ? ` (${count})` : ''}
          </NavLink>
        ))}
      </nav>

      <AssistantWidget />
    </div>
  );
}
