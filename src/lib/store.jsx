import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from './api';

/* ------------------------------------------------------------------ Toasts */
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback((message, type = 'success') => {
    const id = ++idRef.current;
    setItems((prev) => [...prev.slice(-3), { id, message: String(message), type }]);
    if (type !== 'error') {
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
    }
    return id;
  }, []);

  const apiObj = useMemo(() => ({
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastCtx.Provider value={apiObj}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.type === 'error' ? '⚠' : t.type === 'info' ? 'ℹ' : '✓'}</span>
            <div style={{ flex: 1 }}>{t.message}</div>
            <button className="close" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* -------------------------------------------------------------------- Auth */
const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [cafe, setCafe] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await get('/auth/me');
      setUser(data.user || null);
      setPermissions(data.permissions || []);
      setCafe(data.cafe || null);
      return data.user || null;
    } catch {
      setUser(null);
      setPermissions([]);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loginStaff = useCallback(async (email, password) => {
    const data = await post('/auth/staff/login', { email, password });
    await refresh();
    return data;
  }, [refresh]);

  const loginCustomer = useCallback(async (email, password) => {
    const data = await post('/auth/customer/login', { email, password });
    await refresh();
    return data;
  }, [refresh]);

  const registerCustomer = useCallback(async (payload) => {
    const data = await post('/auth/customer/register', payload);
    await refresh();
    return data;
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await post('/auth/logout'); } catch { /* ignore */ }
    setUser(null);
    setPermissions([]);
  }, []);

  const value = useMemo(() => ({
    user,
    permissions,
    cafe,
    loading,
    refresh,
    loginStaff,
    loginCustomer,
    registerCustomer,
    logout,
    isStaff: user?.type === 'staff',
    isCustomer: user?.type === 'customer',
    isManager: user?.type === 'staff' && ['owner', 'manager'].includes(user.role),
    isKitchen: user?.type === 'staff' && ['kitchen', 'supervisor'].includes(user.role),
  }), [user, permissions, cafe, loading, refresh, loginStaff, loginCustomer, registerCustomer, logout]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/* -------------------------------------------------------------------- Cart */
const CartCtx = createContext(null);
const CART_KEY = 'brewhaus_cart_v1';

function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(readCart);

  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }, [items]);

  const add = useCallback((item) => {
    setItems((prev) => {
      const key = item.key;
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) => (i.key === key ? { ...i, qty: Math.min(20, i.qty + item.qty) } : i));
      }
      return [...prev, item];
    });
  }, []);

  const setQty = useCallback((key, qty) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, qty: Math.max(1, Math.min(20, qty)) } : i)));
  }, []);

  const remove = useCallback((key) => setItems((prev) => prev.filter((i) => i.key !== key)), []);
  const clear = useCallback(() => setItems([]), []);

  const count = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);

  const value = useMemo(() => ({ items, add, setQty, remove, clear, count, subtotal }), [items, add, setQty, remove, clear, count, subtotal]);
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}

/* ---------------------------------------------------------------- Realtime */
export function useRealtime(onEvent, { enabled = true } = {}) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let ws;
    let retry = 0;
    let timer;
    let closed = false;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      try {
        ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      } catch { schedule(); return; }
      ws.onopen = () => { retry = 0; setConnected(true); };
      ws.onmessage = (event) => {
        if (event.data === 'pong' || event.data === 'ping') return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'hello') return;
          handlerRef.current?.(payload);
        } catch { /* ignore malformed frame */ }
      };
      ws.onclose = () => { setConnected(false); schedule(); };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    };
    const schedule = () => {
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      timer = setTimeout(connect, Math.min(8000, 600 * 2 ** retry));
    };

    connect();
    const ping = setInterval(() => { try { if (ws?.readyState === 1) ws.send('ping'); } catch { /* ignore */ } }, 25000);
    return () => {
      closed = true;
      clearInterval(ping);
      clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [enabled]);

  return { connected };
}

/* ------------------------------------------------------------- Data helper */
export function useFetch(path, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !skip });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (skip) { setState({ data: null, error: null, loading: false }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    get(path)
      .then((data) => { if (!cancelled) setState({ data, error: null, loading: false }); })
      .catch((err) => { if (!cancelled) setState({ data: null, error: err, loading: false }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, skip, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}
