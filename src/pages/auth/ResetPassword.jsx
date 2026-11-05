import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Eye, EyeOff, Lock, ShieldAlert } from 'lucide-react';
import { post } from '../../lib/api';
import { useToast } from '../../lib/store';
import AuthLayout from './AuthLayout';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = params.get('token') || '';
  const type = params.get('type') === 'staff' ? 'staff' : 'customer';
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const strength = useMemo(() => {
    const p = form.password;
    let score = 0;
    if (p.length >= 8) score += 1;
    if (p.length >= 12) score += 1;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score += 1;
    if (/[0-9]/.test(p)) score += 1;
    if (/[^A-Za-z0-9]/.test(p)) score += 1;
    return Math.min(5, score);
  }, [form.password]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!token) { setError('This reset link is missing its token. Request a new link.'); return; }
    if (form.password.length < 8) { setError('Use a password of at least 8 characters.'); return; }
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      await post('/auth/password/reset', { token, password: form.password });
      setDone(true);
      toast.success('Password updated — sign in with your new password');
    } catch (err) {
      setError(err.message);
    } finally { setSubmitting(false); }
  };

  if (!token) {
    return (
      <AuthLayout
        title="Link not valid"
        subtitle="This page needs the single-use token from your reset email."
        foot={<Link to="/login">Back to sign in</Link>}
      >
        <div className="notice warn" style={{ alignItems: 'flex-start' }}>
          <ShieldAlert size={17} />
          <span>No reset token was provided. Request a new link and open it from the same browser.</span>
        </div>
        <Link className="btn btn-primary" to={`/forgot-password${type === 'staff' ? '?type=staff' : ''}`} style={{ width: '100%', marginTop: 14 }}>
          Request a new link <ArrowRight size={14} />
        </Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout
        title="Password updated"
        subtitle="Your old sessions were signed out on the server. Use your new password to continue."
        foot={<Link to="/login">Back to sign in</Link>}
      >
        <div className="notice success" style={{ alignItems: 'flex-start' }}>
          <Check size={17} />
          <span>The password was changed and every previous session for this account was revoked.</span>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => navigate(type === 'staff' ? '/login?staff=1' : '/login')}
          style={{ width: '100%', marginTop: 14 }}
        >
          Sign in <ArrowRight size={14} />
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={type === 'staff' ? 'This will sign out every management or kitchen session for this staff account.' : 'This will sign out every session for your customer account.'}
      foot={<Link to="/login">Back to sign in</Link>}
    >
      <form onSubmit={submit} className="auth-form" noValidate>
        <label className="field">
          <span className="small strong">New password</span>
          <div style={{ position: 'relative' }}>
            <Lock size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input
              className="input"
              type={show ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              autoFocus
              style={{ paddingLeft: 36, paddingRight: 38 }}
            />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 8, top: 7, border: 0, background: 'transparent', color: 'var(--faint)', padding: 4 }}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="flex gap-4" style={{ marginTop: 2 }} aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} style={{ height: 4, flex: 1, borderRadius: 3, background: n <= strength ? (strength >= 4 ? 'var(--green)' : strength >= 3 ? 'var(--amber)' : 'var(--red)') : 'rgba(33,26,21,.1)' }} />
            ))}
          </div>
          <span className="tiny muted">{strength >= 4 ? 'Strong password' : strength >= 3 ? 'Good — add a symbol for more strength' : 'Use 8+ characters with letters, numbers and a symbol.'}</span>
        </label>

        <label className="field">
          <span className="small strong">Confirm password</span>
          <div style={{ position: 'relative' }}>
            <Lock size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input
              className="input"
              type={show ? 'text' : 'password'}
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              placeholder="Repeat your new password"
              autoComplete="new-password"
              style={{ paddingLeft: 36 }}
            />
          </div>
          {form.confirm && form.confirm !== form.password && <span className="err">Passwords do not match.</span>}
        </label>

        {error && <div className="notice warn" role="alert">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Updating…' : <>Update password <ArrowRight size={14} /></>}
        </button>
      </form>

      <div className="notice info" style={{ marginTop: 16 }}>
        <ShieldAlert size={15} />
        <span>The token works once and expires after 30 minutes. If it has expired, request a fresh link.</span>
      </div>
    </AuthLayout>
  );
}
