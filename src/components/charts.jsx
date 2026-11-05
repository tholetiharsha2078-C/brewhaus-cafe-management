import React, { useMemo, useState } from 'react';
import { inr } from '../lib/format';

const PALETTE = ['#9a5b2f', '#3d6a50', '#3d5e76', '#9a6b12', '#6a5478', '#a33f3a'];

function niceMax(max) {
  if (!max || max <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function AreaChart({
  data = [],
  xKey = 'day',
  valueKey = 'value',
  height = 220,
  color = '#9a5b2f',
  format = inr,
  xLabel,
  empty = 'No data for this period',
}) {
  const [hover, setHover] = useState(null);
  const width = 800;
  const padTop = 12;
  const padBottom = 8;
  const chartH = height - padTop - padBottom;
  const n = data.length;
  const max = niceMax(Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0)));

  const points = useMemo(() => data.map((d, i) => {
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const y = padTop + chartH - ((Number(d[valueKey]) || 0) / max) * chartH;
    return { x, y, d, i };
  }), [data, n, chartH, max, valueKey]);

  if (!n) {
    return <div className="chart-empty" style={{ height }}>{empty}</div>;
  }

  const linePath = points.reduce((path, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const mid = (prev.x + p.x) / 2;
    return `${path} C ${mid} ${prev.y}, ${mid} ${p.y}, ${p.x} ${p.y}`;
  }, '');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padTop + chartH} L ${points[0].x} ${padTop + chartH} Z`;
  const gid = `grad-${color.replace('#', '')}`;
  const labelFor = xLabel || ((d) => d[xKey]);

  return (
    <div style={{ position: 'relative' }}>
      <div className="between small muted" style={{ marginBottom: 6 }}>
        <span>{format(max)}</span>
        <span>{format(0)}</span>
      </div>
      <div
        style={{ position: 'relative' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          setHover(Math.round(ratio * (n - 1)));
        }}
      >
        <svg className="chart" viewBox={`0 0 ${width} ${height}`} style={{ height, width: '100%' }} preserveAspectRatio="none" role="img" aria-label="Trend chart">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.24" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t} x1="0" x2={width} y1={padTop + chartH * t} y2={padTop + chartH * t} stroke="#ece5da" strokeWidth="1" />
          ))}
          <path d={areaPath} fill={`url(#${gid})`} />
          <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hover != null && points[hover] && (
            <>
              <line x1={points[hover].x} x2={points[hover].x} y1={padTop} y2={padTop + chartH} stroke={color} strokeOpacity="0.35" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              <circle cx={points[hover].x} cy={points[hover].y} r="4.5" fill="#fff" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {hover != null && points[hover] && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: `${(points[hover].x / width) * 100}%`,
            transform: `translateX(${hover > n / 2 ? '-105%' : '5%'})`,
            background: 'var(--espresso)',
            color: '#f8efe3',
            padding: '6px 9px',
            borderRadius: 8,
            fontSize: 11,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-sm)',
            zIndex: 3,
          }}>
            <strong>{format(points[hover].d[valueKey])}</strong>
            <span style={{ opacity: 0.65, marginLeft: 6 }}>{labelFor(points[hover].d)}</span>
          </div>
        )}
        <div className="between tiny faint" style={{ marginTop: 4 }}>
          <span>{labelFor(points[0].d)}</span>
          {n > 2 && <span>{labelFor(points[Math.floor((n - 1) / 2)].d)}</span>}
          <span>{labelFor(points[n - 1].d)}</span>
        </div>
      </div>
    </div>
  );
}

export function BarChart({ data = [], valueKey = 'value', labelKey = 'label', height = 180, format = inr, color = '#9a5b2f', horizontal = false }) {
  if (!data.length) return <div className="chart-empty" style={{ height }}>No data for this period</div>;
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));

  if (horizontal) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {data.map((d, i) => (
          <div key={`${d[labelKey]}-${i}`}>
            <div className="between tiny" style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{d[labelKey]}</span>
              <span className="muted">{format(d[valueKey])}</span>
            </div>
            <div className="progress" style={{ height: 7 }}>
              <span style={{ width: `${(Number(d[valueKey]) / max) * 100}%`, background: d.color || color }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: Math.max(2, Math.min(10, 40 / data.length)), height, paddingTop: 8 }}>
        {data.map((d, i) => {
          const h = (Number(d[valueKey]) || 0) / max;
          return (
            <div key={`${d[labelKey]}-${i}`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', position: 'relative' }} title={`${d[labelKey]}: ${format(d[valueKey])}`}>
              <div style={{
                width: '100%',
                height: `${Math.max(2, h * 100)}%`,
                background: d.color || color,
                opacity: d.dim ? 0.35 : 1,
                borderRadius: '4px 4px 2px 2px',
                transition: 'height .35s ease',
              }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: Math.max(2, Math.min(10, 40 / data.length)), marginTop: 7 }}>
        {data.map((d, i) => (
          <div key={`l-${i}`} style={{ flex: 1, fontSize: 9.5, color: 'var(--faint)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.length > 14 && i % 2 ? '' : d[labelKey]}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Donut({ segments = [], size = 148, thickness = 16, centerLabel, centerValue, format = (v) => v }) {
  const total = segments.reduce((s, x) => s + (Number(x.value) || 0), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex items-center gap-16" style={{ flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
          {total > 0 && segments.map((s, i) => {
            const frac = (Number(s.value) || 0) / total;
            const dash = frac * circumference;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color || PALETTE[i % PALETTE.length]}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em' }}>{centerValue ?? format(total)}</div>
            {centerLabel && <div className="tiny muted">{centerLabel}</div>}
          </div>
        </div>
      </div>
      <div className="legend" style={{ flexDirection: 'column', gap: 7 }}>
        {segments.map((s, i) => (
          <span key={i} style={{ justifyContent: 'space-between', width: '100%', gap: 10 }}>
            <span className="flex items-center gap-8" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
              <i style={{ background: s.color || PALETTE[i % PALETTE.length] }} /> {s.label}
            </span>
            <strong style={{ fontSize: 11.5 }}>{s.value}</strong>
          </span>
        ))}
        {!segments.length && <span className="muted small">No data yet</span>}
      </div>
    </div>
  );
}

export function Sparkline({ data = [], color = '#9a5b2f', height = 36, width = 110 }) {
  if (data.length < 2) return <div style={{ height }} />;
  const values = data.map((d) => Number(typeof d === 'number' ? d : d.value) || 0);
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [((i / (values.length - 1)) * width), height - ((v - min) / span) * (height - 4) - 2]);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export { PALETTE };
