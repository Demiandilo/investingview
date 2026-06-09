import { memo } from "react";

export const MiniSparkline = memo(function MiniSparkline({ data, h = 56 }) {
  if (!data || data.length < 2) return <div style={{ height: h, background: "var(--surface2)", borderRadius: 8 }} />;
  const prices = data.map(d => d.close || d.price || d).filter(v => v != null && !isNaN(v));
  if (prices.length < 2) return null;
  const mn = Math.min(...prices), mx = Math.max(...prices), range = mx - mn || 1;
  const W = 300, H = h;
  const pts = prices.map((p, i) => `${(i / (prices.length - 1)) * W},${H - ((p - mn) / range) * H * .88 - H * .06}`).join(" ");
  const up = prices[prices.length - 1] >= prices[0];
  const lc = up ? "var(--green)" : "var(--red)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: h }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lc} stopOpacity=".18" />
          <stop offset="100%" stopColor={lc} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#sg)" />
      <polyline points={pts} fill="none" stroke={lc} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
});

export const TinySparkline = memo(function TinySparkline({ data, up, w = 80, h = 36 }) {
  if (!data || data.length < 2) return null;
  const prices = data.map(d => d.close).filter(Boolean);
  if (prices.length < 2) return null;
  const mn = Math.min(...prices), mx = Math.max(...prices), range = mx - mn || 1;
  const pts = prices.map((p, i) => `${(i / (prices.length - 1)) * w},${h - ((p - mn) / range) * h * .85 - h * .08}`).join(" ");
  const c = up ? "#34c759" : "#ff3b30";
  const gid = `tsg${up ? 1 : 0}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: w, height: h }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity=".22" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
});
