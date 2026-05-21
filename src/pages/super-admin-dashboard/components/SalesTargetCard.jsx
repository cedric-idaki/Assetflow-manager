import React from 'react';

const SalesTargetCard = ({ salesTarget }) => {
  const { target, achieved, percentage } = salesTarget;
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const radius = 54;
  const cx = 80;
  const cy = 80;
  const startAngle = -210;
  const endAngle = 30;
  const totalDeg = endAngle - startAngle;
  const filledDeg = (percentage / 100) * totalDeg;

  const toRad = (d) => (d * Math.PI) / 180;
  const arcPath = (start, end) => {
    const s = { x: cx + radius * Math.cos(toRad(start)), y: cy + radius * Math.sin(toRad(start)) };
    const e = { x: cx + radius * Math.cos(toRad(end)), y: cy + radius * Math.sin(toRad(end)) };
    const large = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  const color = percentage >= 80 ? '#10b981' : percentage >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">Sales Target</h2>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
          percentage >= 80 ? 'bg-emerald-100 text-emerald-700' :
          percentage >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
        }`}>
          {percentage}%
        </span>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex-shrink-0">
          <svg width="160" height="100" viewBox="0 0 160 110">
            <path
              d={arcPath(startAngle, endAngle)}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth="10"
              strokeLinecap="round"
            />
            {percentage > 0 && (
              <path
                d={arcPath(startAngle, startAngle + filledDeg)}
                fill="none"
                stroke={color}
                strokeWidth="10"
                strokeLinecap="round"
              />
            )}
            <text x="80" y="78" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--color-foreground)">
              {percentage}%
            </text>
            <text x="80" y="96" textAnchor="middle" fontSize="10" fill="var(--color-muted-foreground)">
              of target
            </text>
          </svg>
        </div>

        <div className="space-y-3 flex-1">
          <div>
            <p className="text-xs text-muted-foreground">Achieved</p>
            <p className="text-2xl font-bold text-foreground">{fmt(achieved)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="text-2xl font-bold text-foreground">{fmt(target)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Remaining</p>
            <p className="text-2xl font-bold" style={{ color: color }}>
              {fmt(Math.max(0, target - achieved))}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalesTargetCard;