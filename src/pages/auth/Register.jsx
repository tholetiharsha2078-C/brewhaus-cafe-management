import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Lock, Mail, Phone, User } from 'lucide-react';
import { useAuth, useToast } from '../../lib/store';
import { Loading } from '../../components/ui';
import AuthLayout from './AuthLayout';

function safeRedirect(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

export default function Register() {
  const { user, loading, registerCustomer } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!loading && user) {
      navigate(user.type === 'customer' ? (redirect || '/') : '/admin', { replace: true });
    }
  }, [user, loading]);

  if (loading) return <Loading label="Checking your session…" minHeight="100vh" />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setErrors({});
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const phone = form.phone.trim();
    const local = {};
    if (!name) local.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) local.email = 'Enter a valid email address.';
    if (form.password.length < 8) local.password = 'Use at least 8 characters.';
    if (form.password !== form.confirm) local.confirm = 'Passwords do not match.';
    if (Object.keys(local).length) { setErrors(local); return; }
    setSubmitting(true);
    try {
      const res = await registerCustomer({ name, email, phone: phone || undefined, password: form.password });
      toast.success(`Welcome to Brewhaus, ${res.user?.name?.split(' ')[0] || name}`);
      navigate(redirect || '/', { replace: true });
    } catch (err) {
      setErrors(err.data?.errors || {});
      setError(err.message);
    } finally { setSubmitting(false); }
  };

  return (
    <AuthLayout
      title="Join the table"
      subtitle="Create an account for faster reservations, live order tracking, saved favourites and loyalty points."
      foot={<>Already have an account? <Link to={`/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}>Sign in</Link></>}
    >
      <form onSubmit={submit} className="auth-form" noValidate>
        <label className="field">
          <span className="small strong">Full name</span>
          <div style={{ position: 'relative' }}>
            <User size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Priya Sharma" autoComplete="name" autoFocus style={{ paddingLeft: 36 }} />
          </div>
          {errors.name && <span className="err">{errors.name}</span>}
        </label>

        <label className="field">
          <span className="small strong">Email</span>
          <div style={{ position: 'relative' }}>
            <Mail size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" autoComplete="email" style={{ paddingLeft: 36 }} />
          </div>
          {errors.email && <span className="err">{errors.email}</span>}
        </label>

        <label className="field">
          <span className="small strong">Phone <span className="tiny muted" style={{ fontWeight: 400 }}>· optional</span></span>
          <div style={{ position: 'relative' }}>
            <Phone size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98450 00000" autoComplete="tel" maxLength={30} style={{ paddingLeft: 36 }} />
          </div>
          {errors.phone && <span className="err">{errors.phone}</span>}
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
              placeholder="At least 8 characters"
              autoComplete="new-password"
              style={{ paddingLeft: 36, paddingRight: 38 }}
            />
            <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 8, top: 7, border: 0, background: 'transparent', color: 'var(--faint)', padding: 4 }}>
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {errors.password && <span className="err">{errors.password}</span>}
          {form.password.length > 0 && (
            <div className="tiny" style={{ color: form.password.length >= 8 ? 'var(--green)' : 'var(--faint)' }}>
              {form.password.length >= 8 ? '✓ Good length' : `${8 - form.password.length} more character${8 - form.password.length === 1 ? '' : 's'} needed`}
            </div>
          )}
        </label>

        <label className="field">
          <span className="small strong">Confirm password</span>
          <div style={{ position: 'relative' }}>
            <Lock size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              placeholder="Repeat your password"
              autoComplete="new-password"
              style={{ paddingLeft: 36 }}
            />
          </div>
          {errors.confirm && <span className="err">{errors.confirm}</span>}
        </label>

        {error && <div className="notice warn" role="alert">{error}</div>}

        <div className="tiny muted" style={{ lineHeight: 1.5 }}>
          By creating an account you agree to the cafe’s booking and ordering terms. We store only what is needed to serve you — never payment credentials.
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Creating account…' : <>Create account <ArrowRight size={14} /></>}
        </button>
      </form>
    </AuthLayout>
  );
}
