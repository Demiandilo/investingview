import { memo } from "react";
import { InfoIcon } from "./Spinner.jsx";

// Color → border + pill class mapping (supports green/gold/orange/red/gray)
function evStyles(ev) {
  if (!ev) return { border: "1px solid var(--border2)", pillClass: "pill-gray" };
  const borders = {
    green:  "2px solid rgba(52,199,89,.3)",
    red:    "2px solid rgba(255,59,48,.2)",
    orange: "2px solid rgba(255,112,38,.22)",
    gold:   "1.5px solid rgba(255,159,10,.3)",
  };
  const pills = { green:"pill-green", red:"pill-red", orange:"pill-orange", gold:"pill-gold", gray:"pill-gray" };
  return {
    border:    borders[ev.c] || "1px solid var(--border2)",
    pillClass: pills[ev.c]   || "pill-gold",
  };
}

export const MetricTile = memo(function MetricTile({ label, value, eval: ev, tip }) {
  const { border, pillClass } = evStyles(ev);
  return (
    <div style={{ background: "var(--surface)", borderRadius: 14, padding: "16px 18px", border, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>{label}</span>
        {tip && (
          <div className="tip-wrap">
            <InfoIcon />
            <div className="tip">{tip}</div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.03em", color: "var(--text)", marginBottom: 5 }}>{value}</div>
      {ev && <span className={`pill ${pillClass}`} style={{ fontSize: 11 }}>{ev.t}</span>}
    </div>
  );
});
