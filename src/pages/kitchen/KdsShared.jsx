import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Live clock so KDS timers tick without re-fetching. */
export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

export function elapsedSeconds(iso, now = Date.now()) {
  if (!iso) return 0;
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((now - start) / 1000));
}

export function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function KdsStat({ label, value, tone = '' }) {
  return (
    <div className={`kds-stat ${tone}`}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

/** Dark modal for the kitchen display (the shared Modal is light-themed). */
export function KdsModal({ open, onClose, title, subtitle, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.62)', zIndex: 300, display: 'grid', placeItems: 'center', padding: 18 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: '100%', maxWidth: wide ? 760 : 440, background: '#211f1b', border: '1px solid #35312a',
          borderRadius: 14, color: '#f2ede4', boxShadow: '0 24px 60px rgba(0,0,0,.5)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: '18px 20px 12px', display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #302c26' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 21 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11.5, color: '#a49b8d', marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button className="kds-btn" style={{ flex: '0 0 auto', minWidth: 0, width: 32, height: 32, padding: 0 }} onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <div style={{ padding: '16px 20px', overflowY: 'auto' }}>{children}</div>
        {footer && <div style={{ padding: 14, borderTop: '1px solid #302c26', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/** Distinct beep for new tickets. Respects the sound preference. */
export function beep(kind = 'new') {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'new' ? 880 : kind === 'ready' ? 660 : 520;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 700);
  } catch { /* audio not available */ }
}

export function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#979083', fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: '#827b6f' }}>{hint}</span>}
    </label>
  );
}

export function KdsInput(props) {
  return (
    <input
      {...props}
      style={{
        height: 38, borderRadius: 8, border: '1px solid #3d3830', background: '#191816', color: '#f2ede4',
        padding: '0 10px', fontSize: 13, outline: 'none', width: '100%', ...props.style,
      }}
    />
  );
}

export function KdsSelect({ children, ...props }) {
  return (
    <select
      {...props}
      style={{
        height: 38, borderRadius: 8, border: '1px solid #3d3830', background: '#191816', color: '#f2ede4',
        padding: '0 10px', fontSize: 13, outline: 'none', width: '100%', ...props.style,
      }}
    >
      {children}
    </select>
  );
}
