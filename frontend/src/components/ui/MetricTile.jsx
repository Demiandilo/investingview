import { memo } from "react";
import { InfoIcon } from "./Spinner.jsx";
import { useLang } from "../../i18n.js";

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

export const VerdictBadge = memo(function VerdictBadge({ verdict }) {
  const { t } = useLang();
  const map = {
    "Forte Acquisto": { bg: "#e8f8ed",          color: "var(--green)", icon: "↑↑" },
    "Acquisto":       { bg: "#f0faf3",           color: "var(--green)", icon: "↑"  },
    "Neutro":         { bg: "var(--gold-light)",  color: "var(--gold)",  icon: "→"  },
    "Vendita":        { bg: "var(--red-light)",   color: "var(--red)",   icon: "↓"  },
    "Forte Vendita":  { bg: "#ffe5e3",            color: "var(--red)",   icon: "↓↓" },
  };
  const s = map[verdict] || map["Neutro"];
  const verdicts = t("analysis.ai.verdicts");
  const label = verdicts?.[verdict] || verdict;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: s.bg, color: s.color, borderRadius: 12, padding: "8px 16px", fontWeight: 700, fontSize: 16 }}>
      <span style={{ fontSize: 18 }}>{s.icon}</span>{label}
    </div>
  );
});
