import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Inbox, RefreshCw, Search, Star, X,
} from 'lucide-react';
import { initials, toneFor, titleize } from '../lib/format';

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Loading({ label = 'Loading…', minHeight = 220 }) {
  return (
    <div className="center-pad" style={{ minHeight }}>
      <div className="flex items-center gap-8 muted small"><Spinner /> {label}</div>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty" role="alert">
      <div className="empty-icon" style={{ color: 'var(--red)', background: 'var(--red-soft)' }}>
        <AlertTriangle size={20} />
      </div>
      <div className="empty-title">Something went wrong</div>
      <p>{error?.message || 'We could not load this data.'}</p>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 14 }} onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', description, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={20} /></div>
      <div className="empty-title">{title}</div>
      {description && <p>{description}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, children }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function SectionCard({ title, subtitle, action, children, className = '', noPad = false }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={noPad ? '' : 'card-body'}>{children}</div>
    </section>
  );
}

export function Badge({ tone = '', dot = false, children, className = '' }) {
  return (
    <span className={`badge ${tone} ${className}`}>
      {dot && <i className="dot" style={{ borderRadius: '50%' }} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className = '' }) {
  return <Badge tone={toneFor(status)} dot className={className}>{titleize(status)}</Badge>;
}

export function Avatar({ name, size = 34 }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.37 }}>{initials(name)}</span>;
}

export function Stat({ label, value, icon: Icon, meta, tone = '', className = '' }) {
  return (
    <div className={`card stat ${tone} ${className}`}>
      {Icon && <div className="stat-icon"><Icon /></div>}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {meta != null && <div className="stat-meta">{meta}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      className={`switch ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label || 'Toggle'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          className={`tab ${value === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count != null && t.count !== '' ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (limit || 10)));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(total || 0, page * limit);
  return (
    <div className="pagination">
      <span>{total ? `Showing ${from}–${to} of ${total}` : 'No records'}</span>
      <div className="pager">
        <button className="btn btn-secondary btn-sm btn-icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={15} />
        </button>
        <span style={{ padding: '0 6px' }}>Page {page} of {pages}</span>
        <button className="btn btn-secondary btn-sm btn-icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…', onSubmit }) {
  return (
    <form className="search" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
      <Search size={15} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && (
        <button type="button" onClick={() => onChange('')} style={{ border: 0, background: 'transparent', color: 'var(--faint)', display: 'grid' }} aria-label="Clear search">
          <X size={13} />
        </button>
      )}
    </form>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

function Overlay({ open, onClose, children, labelledBy }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(children, document.body);
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = '' }) {
  return (
    <Overlay open={open} onClose={onClose}>
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
        <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title}>
          <div className="modal-head">
            <div>
              <h2 className="modal-title">{title}</h2>
              {subtitle && <p className="modal-sub">{subtitle}</p>}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </Overlay>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer }) {
  return (
    <Overlay open={open} onClose={onClose}>
      <div className="drawer-backdrop" onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div>
            <h2 className="modal-title">{title}</h2>
            {subtitle && <p className="modal-sub">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </Overlay>
  );
}

export function ConfirmDialog({ open, title = 'Are you sure?', message, confirmLabel = 'Confirm', tone = 'danger', busy = false, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="slim"
      footer={(
        <>
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner size={14} /> : <Check size={15} />} {confirmLabel}
          </button>
        </>
      )}
    >
      <p className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.65 }}>{message}</p>
    </Modal>
  );
}

export function Rating({ value = 0, count, size = 14 }) {
  return (
    <span className="flex items-center gap-4" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} style={{ color: n <= Math.round(value) ? '#c68a2f' : 'var(--line-strong)' }} fill={n <= Math.round(value) ? '#e3b567' : 'none'} />
      ))}
      {count != null && <span className="tiny muted" style={{ marginLeft: 3 }}>({count})</span>}
    </span>
  );
}

export function Progress({ value, tone = '' }) {
  return <div className={`progress ${tone}`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
