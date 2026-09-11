"use client";

/**
 * A dependency-free log-log line chart.
 *
 * Log-log axes are not decoration here. CFR's convergence is a power law
 * (exploitability ~ C * T^-k), and a power law is a straight line on log-log
 * axes and an uninformative hockey stick on linear ones. Reading the *slope*
 * off this chart is how you tell a correct CFR+ implementation from a broken
 * one, so the chart is drawn in the coordinates where the slope is visible.
 */

export interface Series {
  label: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

const W = 720;
const H = 340;
const PAD = { top: 18, right: 18, bottom: 46, left: 66 };

function decades(min: number, max: number): number[] {
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const out: number[] = [];
  for (let e = lo; e <= hi; e++) out.push(10 ** e);
  return out;
}

function fmtTick(v: number): string {
  const e = Math.round(Math.log10(v));
  if (e >= 0 && e <= 5) return v >= 1000 ? `${v / 1000}k` : String(v);
  return `1e${e}`;
}

export default function LogChart({
  series,
  xLabel,
  yLabel,
  yFloor = 1e-9,
  height = H,
}: {
  series: Series[];
  xLabel: string;
  yLabel: string;
  yFloor?: number;
  height?: number;
}) {
  const pts = series.flatMap((s) => s.points).filter((p) => p.x > 0 && p.y > yFloor);
  if (pts.length === 0) {
    return (
      <div className="center muted" style={{ padding: "60px 0", fontSize: "0.88rem" }}>
        No data yet.
      </div>
    );
  }

  const xMin = Math.min(...pts.map((p) => p.x));
  const xMax = Math.max(...pts.map((p) => p.x));
  const yMin = Math.min(...pts.map((p) => p.y));
  const yMax = Math.max(...pts.map((p) => p.y));

  const xTicks = decades(xMin, xMax);
  const yTicks = decades(yMin, yMax);
  const xLo = Math.log10(xTicks[0]);
  const xHi = Math.log10(xTicks[xTicks.length - 1]);
  const yLo = Math.log10(yTicks[0]);
  const yHi = Math.log10(yTicks[yTicks.length - 1]);

  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const sx = (x: number) => PAD.left + ((Math.log10(x) - xLo) / (xHi - xLo || 1)) * innerW;
  const sy = (y: number) => PAD.top + innerH - ((Math.log10(y) - yLo) / (yHi - yLo || 1)) * innerH;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: "block", minWidth: 460 }}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)}
                  stroke="#1f2c3d" strokeWidth="1" />
            <text x={PAD.left - 9} y={sy(t) + 4} textAnchor="end"
                  fill="#61738c" fontSize="10" fontFamily="var(--mono)">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.top} y2={height - PAD.bottom}
                  stroke="#172231" strokeWidth="1" />
            <text x={sx(t)} y={height - PAD.bottom + 17} textAnchor="middle"
                  fill="#61738c" fontSize="10" fontFamily="var(--mono)">
              {fmtTick(t)}
            </text>
          </g>
        ))}

        {series.map((s) => {
          const valid = s.points.filter((p) => p.x > 0 && p.y > yFloor);
          if (valid.length < 2) return null;
          const d = valid.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(" ");
          return (
            <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth="2"
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  strokeLinejoin="round" strokeLinecap="round" />
          );
        })}

        <text x={PAD.left + innerW / 2} y={height - 6} textAnchor="middle"
              fill="#93a4bb" fontSize="11">{xLabel}</text>
        <text x={14} y={PAD.top + innerH / 2} textAnchor="middle" fill="#93a4bb" fontSize="11"
              transform={`rotate(-90 14 ${PAD.top + innerH / 2})`}>{yLabel}</text>
      </svg>

      <div className="badge-row" style={{ marginTop: 10, justifyContent: "center" }}>
        {series.map((s) => (
          <span key={s.label} className="chip-tag" style={{ borderColor: s.color, color: s.color }}>
            <span style={{
              display: "inline-block", width: 10, height: 2, background: s.color,
              verticalAlign: "middle", marginRight: 6,
            }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
