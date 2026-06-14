import { useState, useEffect } from "react";
import { API } from "../api.js";
import { Spinner } from "./ui/Spinner.jsx";
import { SegmentedGauge, HealthHistoryChart, GAUGE_COLORS } from "./ui/Charts.jsx";
import { useLang } from "../i18n.js";

/* ─── Metric formatters ──────────────────────────────────────────────────── */
const pct = v => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const dec = d => v => v == null ? "—" : v.toFixed(d);
const num = d => v => v == null ? "—" : v.toFixed(d);

const METRIC_FORMAT = {
  pe: dec(2), pb: dec(2), peg: dec(2),
  perf3m: pct, perf6m: pct, perf12m: pct,
  distMA50: pct, distMA200: pct, rsi14: num(1),
  fcfMargin: pct, ocfMargin: pct,
  roe: pct, roa: pct, netMargin: pct, opMargin: pct,
  revenueGrowth: pct, epsGrowth: pct,
};

const RATING_PILL = { weak: "pill-red", fair: "pill-orange", good: "pill-gold", great: "pill-green", excellent: "pill-green" };

const HISTORY_COLORS = {
  valuation: "#2962ff",
  profitability: "#26a69a",
  cashflow: "#f59e0b",
  growth: "#8b5cf6",
  overall: "var(--text)",
};

/* ─── Metric Slider — horizontal range bar with sector min/max + stock value ─ */
function MetricSlider({ label, data, format }) {
  if (!data || data.value == null) return null;
  const { value, min, max } = data;
  const fmt = format || dec(2);
  let pct2 = 50;
  if (min != null && max != null && max !== min) {
    pct2 = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text2)" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{fmt(value)}</span>
      </div>
      <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--surface2)" }}>
        <div style={{
          position: "absolute", top: -3, left: `${pct2}%`, transform: "translateX(-50%)",
          width: 12, height: 12, borderRadius: "50%", background: "var(--blue)",
          border: "2px solid var(--card, var(--surface))", boxShadow: "var(--shadow-sm)",
        }} />
      </div>
      {min != null && max != null && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 10, color: "var(--text3)" }}>{fmt(min)}</span>
          <span style={{ fontSize: 10, color: "var(--text3)" }}>{fmt(max)}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Dimension Card — rating pill + score + metric sliders ──────────────── */
function DimensionCard({ dimKey, dim, t }) {
  const { score, rating, metrics } = dim;
  const hasScore = score != null;
  const pillClass = hasScore ? (RATING_PILL[rating] || "pill-gray") : "pill-gray";
  const ratingLabel = hasScore ? t(`analysis.health.ratings.${rating}`) : "—";
  const dimLabel = t(`analysis.health.dimensions.${dimKey}`);

  const sliders = Object.entries(metrics)
    .map(([key, data]) => ({ key, data, label: t(`analysis.health.metrics.${key}`), format: METRIC_FORMAT[key] }))
    .filter(m => m.data?.value != null);

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
        <span className={`pill ${pillClass}`} style={{ fontSize: 12 }}>{ratingLabel} - {dimLabel}</span>
        {hasScore && <span style={{ fontSize: 18, fontWeight: 800 }}>{score.toFixed(1)}</span>}
      </div>
      {sliders.length > 0
        ? sliders.map(m => <MetricSlider key={m.key} label={m.label} data={m.data} format={m.format} />)
        : <p style={{ fontSize: 12, color: "var(--text3)" }}>{t("analysis.health.noData")}</p>
      }
    </div>
  );
}

/* ─── Salute Tab — overall gauge + 5 dimension cards + history chart ─────── */
export default function SaluteTab({ symbol, dark }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    setData(null);
    setLoading(true);
    API.getHealthScore(symbol).then(d => { setData(d); setLoading(false); }).catch(() => { setData(null); setLoading(false); });
  }, [symbol]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "48px" }}>
        <Spinner size={28} />
        <p style={{ marginTop: 12, color: "var(--text2)" }}>{t("analysis.health.loading")}</p>
      </div>
    );
  }

  if (!data || data.overall?.score == null) {
    return (
      <div className="card" style={{ padding: "32px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
        {t("analysis.health.noData")}
      </div>
    );
  }

  const { overall, dimensions, history, sector } = data;
  const gaugeIdx = Math.max(0, Math.min(4, Math.round(overall.score) - 1));

  const historySeries = [
    { key: "valuation",     label: t("analysis.health.dimensions.valuation"),     color: HISTORY_COLORS.valuation },
    { key: "profitability", label: t("analysis.health.dimensions.profitability"), color: HISTORY_COLORS.profitability },
    { key: "cashflow",       label: t("analysis.health.dimensions.cashflow"),     color: HISTORY_COLORS.cashflow },
    { key: "growth",         label: t("analysis.health.dimensions.growth"),       color: HISTORY_COLORS.growth },
    { key: "overall",        label: t("analysis.health.history.overall"),         color: HISTORY_COLORS.overall },
  ];

  return (
    <div className="fade">
      <div className="card" style={{ padding: "24px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
          <div>
            <p className="section-label" style={{ marginBottom: 4 }}>{t("analysis.health.overallLabel")}</p>
            <div style={{ fontSize: 26, fontWeight: 800, color: GAUGE_COLORS[gaugeIdx] }}>{t(`analysis.health.ratings.${overall.rating}`)}</div>
          </div>
          {sector && (
            <div style={{ textAlign: "right" }}>
              <p className="section-label" style={{ marginBottom: 4 }}>{t("analysis.health.sectorLabel")}</p>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{sector}</div>
            </div>
          )}
        </div>
        <SegmentedGauge score={overall.score} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, maxWidth: 280 }}>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("analysis.health.ratings.weak")}</span>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("analysis.health.ratings.excellent")}</span>
        </div>
      </div>

      <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16, marginBottom: 20 }}>
        {Object.entries(dimensions).map(([key, dim]) => (
          <DimensionCard key={key} dimKey={key} dim={dim} t={t} />
        ))}
      </div>

      {history?.length > 1 && (
        <div className="card" style={{ padding: "22px 24px" }}>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t("analysis.health.history.title")}</p>
          <HealthHistoryChart data={history} series={historySeries} dark={dark} />
        </div>
      )}
    </div>
  );
}
