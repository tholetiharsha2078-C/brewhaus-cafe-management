import React, { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Coffee, Compass, LogIn } from 'lucide-react';
import { useAuth } from './lib/store';
import { Loading } from './components/ui';

import CustomerShell from './pages/customer/CustomerShell';
import Home from './pages/customer/Home';
import Menu from './pages/customer/Menu';
import Product from './pages/customer/Product';
import Reserve from './pages/customer/Reserve';
import Cart from './pages/customer/Cart';
import Checkout from './pages/customer/Checkout';
import Track from './pages/customer/Track';
import Account from './pages/customer/Account';

import KitchenShell from './pages/kitchen/KitchenShell';
import KitchenBoard from './pages/kitchen/Board';
import KitchenStations from './pages/kitchen/Stations';
import KitchenAvailability from './pages/kitchen/Availability';
import KitchenHistory from './pages/kitchen/History';
import KitchenAnalytics from './pages/kitchen/Analytics';
import KitchenTeam from './pages/kitchen/Team';

import AdminShell from './components/AdminShell';
import Dashboard from './pages/admin/Dashboard';
import Reservations from './pages/admin/Reservations';
import Orders from './pages/admin/Orders';
import AdminMenu from './pages/admin/Menu';
import Payments from './pages/admin/Payments';
import Tables from './pages/admin/Tables';
import Customers from './pages/admin/Customers';
import Retention from './pages/admin/Retention';
import Finance from './pages/admin/Finance';
import Analytics from './pages/admin/Analytics';
import Inventory from './pages/admin/Inventory';
import Assistant from './pages/admin/Assistant';
import AdminSettings from './pages/admin/Settings';

import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';

const FULL_PAGE_LOADING = { label: 'Warming up…', minHeight: '100vh' };

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [pathname]);
  return null;
}

function withRedirect(pathname, search) {
  const target = `${pathname}${search || ''}`;
  return `/login?redirect=${encodeURIComponent(target)}`;
}

function RequireCustomer({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading {...FULL_PAGE_LOADING} />;
  if (!user || user.type !== 'customer') {
    return <Navigate to={withRedirect(location.pathname, location.search)} replace />;
  }
  return children;
}

function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading {...FULL_PAGE_LOADING} />;
  if (!user) return <Navigate to={`/login?staff=1&redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.type !== 'staff') return <Navigate to="/" replace />;
  if (['kitchen', 'supervisor'].includes(user.role)) return <Navigate to="/kitchen" replace />;
  return children;
}

function RequireKitchen({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading {...FULL_PAGE_LOADING} />;
  if (!user) return <Navigate to={`/login?staff=1&redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.type !== 'staff') return <Navigate to="/" replace />;
  return children;
}

function NotFound() {
  return (
    <div className="auth-wrap" style={{ gridTemplateColumns: '1fr', placeItems: 'center', minHeight: '100vh' }}>
      <div className="card card-pad" style={{ maxWidth: 440, textAlign: 'center', padding: 40 }}>
        <span style={{ display: 'inline-grid', placeItems: 'center', width: 54, height: 54, borderRadius: 14, background: 'var(--accent-soft)', color: 'var(--accent-strong)', marginBottom: 14 }}>
          <Compass size={24} />
        </span>
        <div className="eyebrow" style={{ color: 'var(--copper)' }}>404</div>
        <h1 className="display" style={{ fontSize: 32, margin: '6px 0 8px' }}>That page isn’t on the menu</h1>
        <p className="small muted" style={{ lineHeight: 1.6, marginBottom: 18 }}>
          The link may be old, or the page may have moved. The cafe is still open — start from the home page.
        </p>
        <div className="flex gap-8 wrap" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-primary" to="/"><Coffee size={14} /> Back to Brewhaus</Link>
          <Link className="btn btn-secondary" to="/login"><LogIn size={14} /> Sign in</Link>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Customer storefront */}
        <Route element={<CustomerShell />}>
          <Route index element={<Home />} />
          <Route path="menu" element={<Menu />} />
          <Route path="menu/:id" element={<Product />} />
          <Route path="reserve" element={<Reserve />} />
          <Route path="cart" element={<Cart />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="track" element={<Track />} />
          <Route path="track/:number" element={<Track />} />
          <Route path="account" element={<RequireCustomer><Account /></RequireCustomer>} />
          <Route path="*" element={<NotFound />} />
        </Route>

        {/* Auth */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Kitchen display */}
        <Route path="/kitchen" element={<RequireKitchen><KitchenShell /></RequireKitchen>}>
          <Route index element={<KitchenBoard />} />
          <Route path="stations" element={<KitchenStations />} />
          <Route path="availability" element={<KitchenAvailability />} />
          <Route path="history" element={<KitchenHistory />} />
          <Route path="analytics" element={<KitchenAnalytics />} />
          <Route path="team" element={<KitchenTeam />} />
        </Route>

        {/* Management workspace */}
        <Route path="/admin" element={<RequireAdmin><AdminShell /></RequireAdmin>}>
          <Route index element={<Dashboard />} />
          <Route path="reservations" element={<Reservations />} />
          <Route path="orders" element={<Orders />} />
          <Route path="menu" element={<AdminMenu />} />
          <Route path="payments" element={<Payments />} />
          <Route path="tables" element={<Tables />} />
          <Route path="customers" element={<Customers />} />
          <Route path="retention" element={<Retention />} />
          <Route path="finance" element={<Finance />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
