import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChefHat, Eye, EyeOff, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { useAuth, useToast } from '../../lib/store';
import { Loading } from '../../components/ui';
import AuthLayout from './AuthLayout';

function safeRedirect(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

export default function Login() {
  const { user, loading, loginCustomer, loginStaff } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));
  const [mode, setMode] = useState(params.get('staff') === '1' ? 'staff' : 'customer');
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loading || !user) return;
    if (user.type === 'customer') navigate(redirect || '/', { replace: true });
    else navigate(['kitchen', 'supervisor'].includes(user.role) ? '/kitchen' : '/admin', { replace: true });
  }, [user, loading]);

  if (loading) return <Loading label="Checking your session…" minHeight="100vh" />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const email = form.email.trim().toLowerCase();
    if (!email) { setError('Enter your email address.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address.'); return; }
    if (!form.password) { setError('Enter your password.'); return; }
    setSubmitting(true);
    try {
      const res = mode === 'staff'
        ? await loginStaff(email, form.password)
        : await loginCustomer(email, form.password);
      toast.success(mode === 'staff' ? 'Signed in to management' : `Welcome back, ${res.user?.name?.split(' ')[0] || 'guest'}`);
      if (mode === 'customer') navigate(redirect || res.redirect || '/', { replace: true });
      else navigate(res.redirect || '/admin', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally { setSubmitting(false); }
  };

  const fill = (email, password, type) => {
    setMode(type);
    setForm({ email, password });
    setError('');
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your customer account, or to the management and kitchen workspace."
      foot={mode === 'customer'
        ? <>New to Brewhaus? <Link to={`/register${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}>Create an account</Link></>
        : <>Staff accounts are managed by the cafe owner. <Link to="/forgot-password?type=staff">Need help?</Link></>}
    >
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button type="button" className={`tab ${mode === 'customer' ? 'active' : ''}`} onClick={() => { setMode('customer'); setError(''); }}>
          <User size={13} style={{ verticalAlign: -2, marginRight: 5 }} /> Customer
        </button>
        <button type="button" className={`tab ${mode === 'staff' ? 'active' : ''}`} onClick={() => { setMode('staff'); setError(''); }}>
          <ChefHat size={13} style={{ verticalAlign: -2, marginRight: 5 }} /> Staff &amp; kitchen
        </button>
      </div>

      <form onSubmit={submit} className="auth-form" noValidate>
        <label className="field">
          <span className="small strong">Email</span>
          <div style={{ position: 'relative' }}>
            <Mail size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder={mode === 'staff' ? 'you@brewhaus.cafe' : 'you@example.com'}
              autoComplete="email"
              autoFocus
              style={{ paddingLeft: 36 }}
            />
          </div>
        </label>
        <label className="field">
          <span className="small strong">Password</span>
          <div style={{ position: 'relative' }}>
            <Lock size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Your password"
              autoComplete="current-password"
              style={{ paddingLeft: 36, paddingRight: 38 }}
            />
            <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 8, top: 7, border: 0, background: 'transparent', color: 'var(--faint)', padding: 4 }}>
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </label>

        {error && <div className="notice warn" role="alert">{error}</div>}

        <div className="between" style={{ marginTop: -2 }}>
          <span className="tiny muted"><ShieldCheck size={11} style={{ verticalAlign: -1 }} /> Server-side session cookie</span>
          <Link to={`/forgot-password${mode === 'staff' ? '?type=staff' : ''}`} className="tiny" style={{ color: 'var(--accent-strong)', fontWeight: 600 }}>Forgot password?</Link>
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', marginTop: 4 }}>
          {submitting ? 'Signing in…' : <>{mode === 'staff' ? 'Sign in to workspace' : 'Sign in'} <ArrowRight size={14} /></>}
        </button>
      </form>

      {mode === 'staff' && (
        <div className="notice info" style={{ marginTop: 16 }}>
          <ShieldCheck size={15} />
          <span>Kitchen accounts open the kitchen display only. Managers and owners can open the management workspace. Access is enforced on the server, not just hidden in the menu.</span>
        </div>
      )}

      <div className="demo-creds">
        <div className="title">Demo accounts · local seed data</div>
        <div className="demo-row">
          <span><strong>Owner</strong> <code>admin@brewhaus.cafe</code></span>
          <button type="button" onClick={() => fill('admin@brewhaus.cafe', 'Admin@123', 'staff')}>Use</button>
        </div>
        <div className="demo-row">
          <span><strong>Kitchen</strong> <code>kitchen@brewhaus.cafe</code></span>
          <button type="button" onClick={() => fill('kitchen@brewhaus.cafe', 'Kitchen@123', 'staff')}>Use</button>
        </div>
        <div className="demo-row">
          <span><strong>Customer</strong> <code>priya@example.com</code></span>
          <button type="button" onClick={() => fill('priya@example.com', 'Customer@123', 'customer')}>Use</button>
        </div>
      </div>
    </AuthLayout>
  );
}
