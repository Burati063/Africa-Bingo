import React from 'react';

const COLORS = ['#f5c542', '#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa'];

function niceMax(value) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / power) * power;
}

export function LineChart({ data, series, height = 190 }) {
  const width = 640;
  const pad = 34;
  const max = niceMax(Math.max(1, ...data.flatMap((row) => series.map((s) => Number(row[s.key]) || 0))));
  const innerW = width - pad * 2;
  const innerH = height - pad * 1.6;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const point = (row, index, key) => {
    const x = pad + index * stepX;
    const y = height - pad + 8 - ((Number(row[key]) || 0) / max) * innerH;
    return [x, y];
  };

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = height - pad + 8 - tick * innerH;
          return (
            <g key={tick}>
              <line x1={pad} x2={width - pad} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />
              <text x={4} y={y + 3} className="chart-axis">
                {Math.round(max * tick)}
              </text>
            </g>
          );
        })}
        {series.map((s, si) => {
          const points = data.map((row, i) => point(row, i, s.key));
          const path = points.map(([x, y]) => `${x},${y}`).join(' ');
          return (
            <g key={s.key}>
              <polyline
                points={path}
                fill="none"
                stroke={s.color || COLORS[si]}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="2.5" fill={s.color || COLORS[si]} />
              ))}
            </g>
          );
        })}
        {data.map((row, i) => {
          if (i % Math.ceil(data.length / 7) !== 0) return null;
          return (
            <text key={row.day} x={pad + i * stepX} y={height - 6} textAnchor="middle" className="chart-axis">
              {row.day?.slice(5)}
            </text>
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map((s, i) => (
          <span key={s.key}>
            <i style={{ background: s.color || COLORS[i] }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BarChart({ data, valueKey, color = '#f5c542', height = 180 }) {
  const width = 640;
  const pad = 32;
  const max = niceMax(Math.max(1, ...data.map((row) => Number(row[valueKey]) || 0)));
  const innerW = width - pad * 2;
  const innerH = height - pad * 1.5;
  const barW = Math.max(4, (innerW / data.length) * 0.55);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img">
        {[0, 0.5, 1].map((tick) => {
          const y = height - pad + 6 - tick * innerH;
          return (
            <g key={tick}>
              <line x1={pad} x2={width - pad} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />
              <text x={4} y={y + 3} className="chart-axis">
                {Math.round(max * tick)}
              </text>
            </g>
          );
        })}
        {data.map((row, i) => {
          const value = Number(row[valueKey]) || 0;
          const h = (value / max) * innerH;
          const x = pad + (i + 0.5) * (innerW / data.length) - barW / 2;
          return (
            <g key={row.day}>
              <rect x={x} y={height - pad + 6 - h} width={barW} height={h} rx="3" fill={color} opacity="0.85" />
              {i % Math.ceil(data.length / 7) === 0 && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="chart-axis">
                  {row.day?.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function PieChart({ data, size = 190 }) {
  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0) || 1;
  const radius = size / 2 - 18;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const center = size / 2;

  return (
    <div className="pie-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="26" />
        {data.map((d, i) => {
          const value = Number(d.value) || 0;
          const length = (value / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const el = (
            <circle
              key={d.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth="26"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${center} ${center})`}
            />
          );
          offset += length;
          return el;
        })}
        <text x={center} y={center - 2} textAnchor="middle" className="pie-total">
          {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : Math.round(total)}
        </text>
        <text x={center} y={center + 16} textAnchor="middle" className="chart-axis">
          ETB
        </text>
      </svg>
      <div className="pie-legend">
        {data.map((d, i) => (
          <div key={d.label}>
            <i style={{ background: COLORS[i % COLORS.length] }} />
            <span>{d.label}</span>
            <strong>{Math.round(d.value).toLocaleString()} ETB</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
