import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Copy, Mail, ShieldCheck, User, ChefHat } from 'lucide-react';
import { post } from '../../lib/api';
import { useToast } from '../../lib/store';
import AuthLayout from './AuthLayout';

export default function ForgotPassword() {
  const [params] = useSearchParams();
  const toast = useToast();
  const [type, setType] = useState(params.get('type') === 'staff' ? 'staff' : 'customer');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await post('/auth/password/request', { email: address, userType: type });
      setResult(res);
      toast.success('Reset request received');
    } catch (err) {
      setError(err.message);
    } finally { setSubmitting(false); }
  };

  const copyLink = async () => {
    if (!result?.devLink) return;
    try {
      await navigator.clipboard.writeText(result.devLink);
      toast.success('Reset link copied');
    } catch {
      toast.info('Select the link and copy it manually.');
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We’ll create a single-use link that expires in 30 minutes. Choose the account type so we look in the right place."
      foot={<Link to={`/login${type === 'staff' ? '?staff=1' : ''}`}>Back to sign in</Link>}
    >
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button type="button" className={`tab ${type === 'customer' ? 'active' : ''}`} onClick={() => { setType('customer'); setResult(null); setError(''); }}>
          <User size={13} style={{ verticalAlign: -2, marginRight: 5 }} /> Customer
        </button>
        <button type="button" className={`tab ${type === 'staff' ? 'active' : ''}`} onClick={() => { setType('staff'); setResult(null); setError(''); }}>
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={type === 'staff' ? 'you@brewhaus.cafe' : 'you@example.com'}
              autoComplete="email"
              autoFocus
              style={{ paddingLeft: 36 }}
            />
          </div>
        </label>

        {error && <div className="notice warn" role="alert">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Sending…' : <>Send reset link <ArrowRight size={14} /></>}
        </button>
      </form>

      {result && (
        <div className="notice info" style={{ marginTop: 16, flexDirection: 'column', alignItems: 'stretch', gap: 8 }} role="status">
          <div className="flex items-center gap-8"><Check size={15} /> <strong style={{ fontSize: 12.5 }}>{result.message}</strong></div>
          {result.note && <span className="tiny">{result.note}</span>}
          {result.devLink && (
            <div style={{ marginTop: 4 }}>
              <div className="tiny" style={{ marginBottom: 5, fontWeight: 600 }}>Development reset link</div>
              <div className="code" style={{ wordBreak: 'break-all', background: '#fff', border: '1px solid rgba(33,26,21,.12)', borderRadius: 8, padding: 8, lineHeight: 1.5 }}>
                {result.devLink}
              </div>
              <div className="flex gap-6" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={copyLink}><Copy size={12} /> Copy link</button>
                <Link className="btn btn-ghost btn-sm" to={result.devLink.replace(/^https?:\/\/[^/]+/, '')}>Open reset page</Link>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="notice info" style={{ marginTop: 16 }}>
        <ShieldCheck size={15} />
        <span>For your security we never reveal whether an email is registered. Email delivery uses the cafe’s own provider; locally the link is shown only in development.</span>
      </div>
    </AuthLayout>
  );
}
