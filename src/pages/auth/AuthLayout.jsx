import React from 'react';
import { Link } from 'react-router-dom';
import { Coffee } from 'lucide-react';

export default function AuthLayout({ children, title, subtitle, foot }) {
  return (
    <div className="auth-wrap">
      <div className="auth-visual">
        <img src="/seed/hero-cafe.jpg" alt="" />
        <div>
          <Link to="/" className="flex items-center gap-8" style={{ color: '#f3dfc6', marginBottom: 28 }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(243,223,198,.16)', display: 'grid', placeItems: 'center' }}><Coffee size={17} /></span>
            <span className="display" style={{ fontSize: 21 }}>Brewhaus</span>
          </Link>
          <div className="display">Slow mornings.<br />Honest food.</div>
          <p>
            One cafe, one kitchen, one team. Sign in to manage service, work the pass, or keep your reservations and orders in one place.
          </p>
          <div className="tiny" style={{ marginTop: 22, opacity: .65, letterSpacing: '.1em', textTransform: 'uppercase' }}>
            Lavelle Road · Bengaluru · Single location
          </div>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-card">
          <Link to="/" className="auth-back">← Back to the cafe</Link>
          <div className="eyebrow" style={{ color: 'var(--copper)' }}>Brewhaus Coffee &amp; Kitchen</div>
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-sub">{subtitle}</p>}
          {children}
          {foot && <div className="auth-foot">{foot}</div>}
        </div>
      </div>
    </div>
  );
}
