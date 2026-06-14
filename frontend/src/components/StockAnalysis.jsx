import { useState, useEffect, useCallback, useMemo, memo, Component } from "react";
import { API, fmt, fmtPrice, fmtMoneyShort, M, calcRSI, useLocalStorage, getZonedMinutes } from "../api.js";
import { MetricTile } from "./ui/MetricTile.jsx";
import { Spinner, Skeleton } from "./ui/Spinner.jsx";
import { CandlestickChart, HistoricalChart, ComparisonChart, DividendsChart, SentimentBarChart, FinancialHistoryChart, SegmentedGauge, GAUGE_COLORS } from "./ui/Charts.jsx";
import SaluteTab from "./SaluteTab.jsx";
import { useToast } from "./ui/Toast.jsx";
import { useLang } from "../i18n.js";

/* ─── Error Boundary ──────────────────────────────────────────────────────── */
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <div style={{ marginBottom: 12 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{localStorage.getItem("app_lang") === "en" ? "Chart component error" : "Errore nel componente grafico"}</p>
          <p style={{ fontSize: 13, color: "var(--text3)" }}>{this.state.error.message}</p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => this.setState({ error: null })}>{localStorage.getItem("app_lang") === "en" ? "Retry" : "Riprova"}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const CANDLE_PERIODS = [
  { label: "1W", days: 7 }, { label: "1M", days: 30 }, { label: "3M", days: 90 },
  { label: "6M", days: 180 }, { label: "1Y", days: 365 },
];

function timeAgo(dateStr, lang) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 2) return lang === 'en' ? 'just now' : 'adesso';
  if (minutes < 60) return lang === 'en' ? `${minutes}min ago` : `${minutes} min fa`;
  if (hours < 24) return lang === 'en' ? `${hours}h ago` : `${hours}h fa`;
  if (days < 7) return lang === 'en' ? `${days}d ago` : `${days} ${days === 1 ? 'giorno' : 'giorni'} fa`;
  return new Date(dateStr).toLocaleDateString(lang === 'en' ? 'en-US' : 'it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isCommodity(sym) {
  if (!sym) return false;
  if (sym.startsWith('^')) return true;          // market indices: ^IXIC, ^GSPC, ^GDAXI, etc.
  if (/^[A-Z]{1,4}=F$/.test(sym)) return true;   // futures: GC=F, CL=F, etc.
  if (/^[A-Z]+-USD$/.test(sym)) return true;      // crypto: BTC-USD, ETH-USD
  return ['GLD','SLV','USO','UNG','WEAT','CPER','IAU','PDBC'].includes(sym);
}

function commodityLabelKey(sym) {
  if (sym.startsWith('^')) return 'index';
  if (/^[A-Z]+-USD$/.test(sym)) return 'crypto';
  if (/^[A-Z]{1,4}=F$/.test(sym)) return 'futures';
  return 'etf';
}

/* ─── Moving Averages Analysis ───────────────────────────────────────────── */
function MovingAveragesSection({ q, hist }) {
  const { t } = useLang();
  const ma = t("analysis.ma");
  const analysis = useMemo(() => {
    const price = q?.price;
    if (!price || !hist?.length) return null;

    // hist is newest-first; first N elements = most recent N closes
    const closes = hist.map(d => d.close).filter(c => c != null);

    const sma = (n) => {
      const slice = closes.slice(0, n);
      if (slice.length < n) return null;
      return +(slice.reduce((s, v) => s + v, 0) / n).toFixed(4);
    };

    const ma20  = sma(20);
    const ma50  = q?.priceAvg50  ?? sma(50);
    const ma100 = sma(100);
    const ma200 = q?.priceAvg200 ?? sma(200);

    const info = (value, label) => {
      if (value == null) return null;
      const dist = +((price - value) / value * 100).toFixed(2);
      return { value, label, dist, bullish: price >= value };
    };

    const items = [
      info(ma20,  "MA 20"),
      info(ma50,  "MA 50"),
      info(ma100, "MA 100"),
      info(ma200, "MA 200"),
    ].filter(Boolean);

    if (!items.length) return null;

    const goldenCross = ma50 != null && ma200 != null && ma50 > ma200;
    const deathCross  = ma50 != null && ma200 != null && ma50 < ma200;
    const bullishCount = items.filter(m => m.bullish).length;
    const allAbove = bullishCount === items.length;
    const allBelow = bullishCount === 0;

    let crossType = goldenCross ? "bullish" : deathCross ? "bearish" : null;

    const explanations = t("analysis.ma.explanations");
    let explanation;
    if (goldenCross && allAbove)          explanation = explanations.goldenAllAbove;
    else if (goldenCross)                 explanation = explanations.golden;
    else if (deathCross && allBelow)      explanation = explanations.deathAllBelow;
    else if (deathCross)                  explanation = explanations.death;
    else if (allAbove)                    explanation = explanations.allAbove;
    else if (allBelow)                    explanation = explanations.allBelow;
    else if (bullishCount > items.length / 2) explanation = explanations.mostAbove;
    else                                  explanation = explanations.mixed;

    return { items, crossType, goldenCross, deathCross, allAbove, allBelow, explanation };
  }, [q, hist]);

  if (!analysis) return null;
  const { items, crossType, goldenCross, deathCross, explanation } = analysis;

  return (
    <div style={{ marginTop: 24 }}>
      <p className="section-label">{ma.section}</p>
      <div className="card" style={{ padding: "20px 24px" }}>
        {/* MA Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border2)" }}>
                {ma.tableHeaders.map(h => (
                  <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(({ label, value, dist, bullish }) => (
                <tr key={label} style={{ borderBottom: "1px solid var(--border2)" }}>
                  <td style={{ padding: "11px 14px", fontWeight: 700, fontFamily: "monospace", fontSize: 13 }}>{label}</td>
                  <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 600 }}>{fmtPrice(value, q?.currency)}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 700, color: dist >= 0 ? "var(--green)" : "var(--red)" }}>
                    {dist >= 0 ? "+" : ""}{dist}%
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: bullish ? "var(--green)" : "var(--red)", flexShrink: 0, boxShadow: bullish ? "0 0 6px rgba(52,199,89,.5)" : "0 0 6px rgba(255,59,48,.5)" }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: bullish ? "var(--green)" : "var(--red)" }}>
                        {bullish ? ma.bullish : ma.bearish}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Cross badge */}
        {crossType && (
          <div style={{ marginTop: 16, padding: "13px 18px", borderRadius: 12, background: crossType === "bullish" ? "rgba(52,199,89,.08)" : "rgba(255,59,48,.08)", border: `1px solid ${crossType === "bullish" ? "rgba(52,199,89,.3)" : "rgba(255,59,48,.3)"}`, display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ lineHeight: 1, flexShrink: 0 }}>
              {crossType === "bullish"
                ? <svg width="22" height="22" viewBox="0 0 24 24" fill="#f59e0b" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
              }
            </span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 800, color: crossType === "bullish" ? "var(--green)" : "var(--red)", marginBottom: 3 }}>
                {goldenCross ? ma.goldenCross : ma.deathCross}
              </p>
              <p style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>
                {goldenCross ? ma.goldenCrossDesc : ma.deathCrossDesc}
              </p>
            </div>
          </div>
        )}

        {/* Spiegazione educativa */}
        <div style={{ marginTop: 16, padding: "14px 18px", background: "var(--surface2)", borderRadius: 12, borderLeft: "3px solid var(--blue)", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={{ flexShrink: 0, lineHeight: 1 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21h6m-3-3v-6"/><path d="M17 7A7 7 0 1 0 7 7c0 3.5 2 5.5 3.5 7h3C15 12.5 17 10.5 17 7z"/></svg>
          </span>
          <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>{explanation}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Tecnica Tab ─────────────────────────────────────────────────────────── */
function TecnicaTab({ symbol, q, hist, dark }) {
  const { t } = useLang();
  const [cPeriod, setCPeriod] = useState(2);
  const [candles, setCandles] = useState([]);
  const [candleLoading, setCandleLoading] = useState(false);
  const [ta, setTa] = useState(null);
  const [ts, setTs] = useState(null);

  useEffect(() => {
    if (!symbol) return;
    setCandleLoading(true);
    const from = new Date(Date.now() - CANDLE_PERIODS[cPeriod].days * 86400000).toISOString().split("T")[0];
    const to = new Date().toISOString().split("T")[0];
    API.getCandles(symbol, from, to).then(d => { setCandles(d); setCandleLoading(false); }).catch(() => setCandleLoading(false));
  }, [symbol, cPeriod]);

  useEffect(() => {
    if (!symbol) return;
    setTa(null);
    API.getTechnicalAnalysis(symbol).then(setTa).catch(() => setTa(null));
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    setTs(null);
    API.getTechnicalSummary(symbol).then(setTs).catch(() => setTs(null));
  }, [symbol]);

  // RSI from last 30 close prices (calculated from history)
  const rsi = useMemo(() => {
    if (!hist || hist.length < 16) return null;
    const sorted = [...hist].reverse(); // oldest→newest
    const prices = sorted.slice(-30).map(d => d.close).filter(Boolean);
    return calcRSI(prices);
  }, [hist]);

  // Volume ratio: today vs average
  const volRatio = q?.volume && q?.avgVolume
    ? +((q.volume / q.avgVolume) * 100).toFixed(1) : null;

  // Distance from 52W high/low
  const distHigh = q?.price && q?.yearHigh ? +((q.price - q.yearHigh) / q.yearHigh * 100).toFixed(1) : null;

  return (
    <div className="fade">
      <TechnicalSummaryCard ts={ts} q={q} />
      <div className="stagger metric-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(175px,1fr))", gap: 12, marginBottom: 20 }}>
        <MetricTile label={t("analysis.metrics.price")}    value={fmtPrice(q?.price, q?.currency)} />
        <MetricTile label={t("analysis.metrics.open")}     value={fmtPrice(q?.open, q?.currency)} tip={t("analysis.tips.open")} />
        <MetricTile label={t("analysis.metrics.ma50")}     value={fmtPrice(q?.priceAvg50, q?.currency)} tip={t("analysis.tips.ma50")} />
        <MetricTile label={t("analysis.metrics.ma200")}    value={fmtPrice(q?.priceAvg200, q?.currency)} tip={t("analysis.tips.ma200")} />
        <MetricTile label={t("analysis.metrics.rsi")}      value={rsi != null ? rsi.toString() : "—"} eval={M.rsi.eval(rsi)} tip={M.rsi.tip} />
        <MetricTile label={t("analysis.metrics.volRatio")} value={volRatio != null ? `${volRatio}%` : "—"} eval={M.volRatio.eval(volRatio)} tip={M.volRatio.tip} />
        <MetricTile label={t("analysis.metrics.high52")}   value={fmtPrice(q?.yearHigh, q?.currency)} tip={t("analysis.tips.high52")} />
        <MetricTile label={t("analysis.metrics.low52")}    value={fmtPrice(q?.yearLow, q?.currency)} tip={t("analysis.tips.low52")} />
        <MetricTile label={t("analysis.metrics.distMax")}  value={distHigh != null ? `${distHigh}%` : "—"}
          eval={distHigh != null ? (distHigh < -30 ? { c:"green" } : distHigh < -10 ? { c:"gold" } : { c:"orange" }) : null}
          tip={t("analysis.tips.distMax")} />
        <MetricTile label={t("analysis.metrics.avgVol")}   value={fmt.bn(q?.avgVolume)} tip={t("analysis.tips.avgVol")} />
      </div>
      <MovingAveragesSection q={q} hist={hist} />
      <div className="card" style={{ padding: "22px 24px", marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <p style={{ fontSize: 14, fontWeight: 700 }}>{t("analysis.candle.title")}</p>
          <div style={{ display: "flex", gap: 4 }}>
            {CANDLE_PERIODS.map((p, i) => (
              <button key={p.label} onClick={() => setCPeriod(i)} style={{ padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: cPeriod === i ? "var(--blue)" : "var(--surface2)", color: cPeriod === i ? "white" : "var(--text2)", border: "none", cursor: "pointer" }}>{p.label}</button>
            ))}
          </div>
        </div>
        {candleLoading ? <div className="skeleton" style={{ height: 340 }} />
          : candles.length > 0 ? <CandlestickChart data={candles} dark={dark} supports={ta?.supports} resistances={ta?.resistances} trendLine={ta?.trendLine} />
          : (hist?.length ?? 0) > 1 ? <HistoricalChart history={hist} />
          : <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 14 }}>{t("analysis.candle.noData")}</div>
        }
      </div>
      <AnalisiGraficaCard ta={ta} q={q} />
    </div>
  );
}

/* ─── Technical Summary Card — aggregate verdict + oscillators/MAs table ───── */
const VERDICT_TO_GAUGE = { strong_sell: 1, sell: 2, neutral: 3, buy: 4, strong_buy: 5 };
const SIGNAL_PILL = { buy: "pill-green", sell: "pill-red", neutral: "pill-gold" };

function oscillatorValueLabel(key, value, ccy) {
  switch (key) {
    case "rsi14":  return value.toFixed(2);
    case "stoch":  return `${value.k.toFixed(2)} / ${value.d.toFixed(2)}`;
    case "macd":   return `${value.macd.toFixed(2)} / ${value.signal.toFixed(2)}`;
    case "adx":    return `${value.adx.toFixed(2)} (+DI ${value.plusDI.toFixed(2)} / -DI ${value.minusDI.toFixed(2)})`;
    case "bbands": return `${fmtPrice(value.lower, ccy)} – ${fmtPrice(value.upper, ccy)}`;
    default: return "—";
  }
}

function TechnicalSummaryCard({ ts, q }) {
  const { t } = useLang();
  if (!ts || !ts.verdict) {
    return (
      <div className="card" style={{ padding: "22px 24px", marginBottom: 20, textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
        {t("analysis.technical.summary.noData")}
      </div>
    );
  }
  const ccy = q?.currency;
  const gaugeIdx = VERDICT_TO_GAUGE[ts.verdict] - 1;

  const oscillatorRows = ts.oscillators.map(o => ({ ...o, label: t(`analysis.technical.summary.indicators.${o.key}`), display: oscillatorValueLabel(o.key, o.value, ccy) }));
  const maRows = ts.movingAverages.map(m => ({ ...m, label: t(`analysis.technical.summary.indicators.${m.key}`), display: fmtPrice(m.value, ccy) }));

  const sectionRowStyle = { fontWeight: 700, color: "var(--text2)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", background: "var(--surface2)" };

  return (
    <div className="card" style={{ padding: "22px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>{t("analysis.technical.summary.title")}</p>
          <div style={{ fontSize: 26, fontWeight: 800, color: GAUGE_COLORS[gaugeIdx] }}>{t(`analysis.technical.summary.verdicts.${ts.verdict}`)}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>
          {t("analysis.technical.summary.counts", { buy: ts.summary.buy, neutral: ts.summary.neutral, sell: ts.summary.sell })}
        </div>
      </div>
      <SegmentedGauge score={gaugeIdx + 1} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, marginBottom: 20, maxWidth: 280 }}>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("analysis.technical.summary.verdicts.strong_sell")}</span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("analysis.technical.summary.verdicts.strong_buy")}</span>
      </div>
      <table className="data-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>{t("analysis.technical.summary.table.indicator")}</th>
            <th>{t("analysis.technical.summary.table.value")}</th>
            <th>{t("analysis.technical.summary.table.action")}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan={3} style={sectionRowStyle}>{t("analysis.technical.summary.oscillators")}</td></tr>
          {oscillatorRows.map(r => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>{r.display}</td>
              <td><span className={`pill ${SIGNAL_PILL[r.signal]}`} style={{ fontSize: 11 }}>{t(`analysis.technical.summary.${r.signal}`)}</span></td>
            </tr>
          ))}
          <tr><td colSpan={3} style={sectionRowStyle}>{t("analysis.technical.summary.movingAverages")}</td></tr>
          {maRows.map(r => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>{r.display}</td>
              <td><span className={`pill ${SIGNAL_PILL[r.signal]}`} style={{ fontSize: 11 }}>{t(`analysis.technical.summary.${r.signal}`)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Analisi Grafica Card (support/resistance, trend, pattern) ─────────────── */
const TREND_ICONS = {
  bullish: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  bearish: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
  sideways: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="12" x2="22" y2="12"/><polyline points="16 6 22 12 16 18"/></svg>,
};
const TREND_COLORS = { bullish: "var(--green)", bearish: "var(--red)", sideways: "#ff9f0a" };
const APPROACH_THRESHOLD = 3; // % distance below which a level is considered "approaching"

function AnalisiGraficaCard({ ta, q }) {
  const { t } = useLang();
  if (!ta || !ta.trend) return null;

  const { trend, supports = [], resistances = [], pattern } = ta;
  const price = ta.currentPrice ?? q?.price;
  const ccy = q?.currency;

  const nearestSupport = supports[0];
  const nearestResistance = resistances[0];
  const distSupport = nearestSupport && price ? ((price - nearestSupport.price) / price) * 100 : null;
  const distResistance = nearestResistance && price ? ((nearestResistance.price - price) / price) * 100 : null;

  let explanation = null;
  if (distResistance != null && (distSupport == null || distResistance <= distSupport) && distResistance <= APPROACH_THRESHOLD) {
    explanation = t("analysis.technical.explainResistance", { price: fmtPrice(nearestResistance.price, ccy) });
  } else if (distSupport != null && distSupport <= APPROACH_THRESHOLD) {
    explanation = t("analysis.technical.explainSupport", { price: fmtPrice(nearestSupport.price, ccy) });
  } else if (nearestSupport && nearestResistance) {
    explanation = t("analysis.technical.explainNeutral", { support: fmtPrice(nearestSupport.price, ccy), resistance: fmtPrice(nearestResistance.price, ccy) });
  }

  const patternInfo = pattern ? {
    label: t(`analysis.technical.patterns.${pattern.type}`),
    desc: t(`analysis.technical.patternDesc.${pattern.type}`, {
      level: fmtPrice(pattern.level, ccy), neckline: fmtPrice(pattern.neckline, ccy),
      head: fmtPrice(pattern.head, ccy), leftShoulder: fmtPrice(pattern.leftShoulder, ccy), rightShoulder: fmtPrice(pattern.rightShoulder, ccy),
    }),
  } : null;

  const tileLabel = { fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 };

  return (
    <div className="card" style={{ padding: "22px 24px", marginTop: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t("analysis.technical.title")}</p>
      <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 12, marginBottom: 16 }}>
        <div>
          <p style={tileLabel}>{t("analysis.technical.trend")}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 800, color: TREND_COLORS[trend.direction] }}>
            {TREND_ICONS[trend.direction]} {t(`analysis.technical.${trend.direction}`)}
          </div>
        </div>
        <div>
          <p style={tileLabel}>{t("analysis.technical.nearestSupport")}</p>
          {nearestSupport ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{fmtPrice(nearestSupport.price, ccy)}</div>
              <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>-{distSupport.toFixed(2)}%</div>
            </>
          ) : <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("analysis.technical.noLevels")}</div>}
        </div>
        <div>
          <p style={tileLabel}>{t("analysis.technical.nearestResistance")}</p>
          {nearestResistance ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{fmtPrice(nearestResistance.price, ccy)}</div>
              <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>+{distResistance.toFixed(2)}%</div>
            </>
          ) : <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("analysis.technical.noLevels")}</div>}
        </div>
        {patternInfo && (
          <div>
            <p style={tileLabel}>{t("analysis.technical.pattern")}</p>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--blue)" }}>{patternInfo.label}</div>
          </div>
        )}
      </div>

      {patternInfo && (
        <div style={{ padding: "12px 16px", background: "var(--surface2)", borderRadius: 10, fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: explanation ? 10 : 0 }}>
          {patternInfo.desc}
        </div>
      )}

      {explanation && (
        <div style={{ padding: "14px 18px", background: "var(--surface2)", borderRadius: 12, borderLeft: "3px solid var(--blue)", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={{ flexShrink: 0, lineHeight: 1 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21h6m-3-3v-6"/><path d="M17 7A7 7 0 1 0 7 7c0 3.5 2 5.5 3.5 7h3C15 12.5 17 10.5 17 7z"/></svg>
          </span>
          <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>{explanation}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Confronto Tab ───────────────────────────────────────────────────────── */
function ConfrontoTab({ sym1 }) {
  const { t } = useLang();
  const [sym2, setSym2] = useState("");
  const [input2, setInput2] = useState("");
  const [hist1, setHist1] = useState([]);
  const [hist2, setHist2] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sym1) return;
    const from = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
    API.getHistory(sym1, from).then(setHist1).catch(() => {});
  }, [sym1]);

  const compare = async () => {
    const s = input2.trim().toUpperCase();
    if (!s || loading) return;
    setLoading(true);
    setSym2(s);
    const from = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
    const h = await API.getHistory(s, from).catch(() => []);
    setHist2(h);
    setLoading(false);
  };

  return (
    <div className="fade">
      <div className="card" style={{ padding: "20px 24px", marginBottom: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t("analysis.compare.title", { sym1 })}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <input className="input" value={input2} onChange={e => setInput2(e.target.value)} onKeyDown={e => e.key === "Enter" && compare()} placeholder={t("analysis.compare.placeholder")} style={{ flex: 1 }} />
          <button className="btn btn-blue" onClick={compare} disabled={loading} style={{ minWidth: 100 }}>
            {loading ? <Spinner size={15} /> : t("analysis.compare.btn")}
          </button>
        </div>
      </div>
      {sym2 && hist1.length > 0 && hist2.length > 0 && (
        <div className="card" style={{ padding: "22px 24px" }}>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t("analysis.compare.chartTitle", { sym1, sym2 })}</p>
          <ComparisonChart data1={hist1} data2={hist2} sym1={sym1} sym2={sym2} />
        </div>
      )}
      {!sym2 && (
        <div className="card" style={{ padding: "48px", textAlign: "center" }}>
          <div style={{ marginBottom: 12 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <p style={{ fontSize: 14, color: "var(--text3)" }}>{t("analysis.compare.emptyPrompt")}</p>
        </div>
      )}
      {sym2 && (hist1.length === 0 || hist2.length === 0) && !loading && (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--text3)" }}>{t("analysis.compare.noData")}</div>
      )}
    </div>
  );
}

/* ─── Dividendi Tab ───────────────────────────────────────────────────────── */
function DividendiTab({ symbol, prof }) {
  const { t } = useLang();
  const [divs, setDivs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    API.getDividends(symbol).then(d => { setDivs(d); setLoading(false); }).catch(() => setLoading(false));
  }, [symbol]);

  const lastDiv = prof?.lastDividend;
  const yield_ = prof?.price && lastDiv ? ((lastDiv / prof.price) * 100).toFixed(2) : null;

  return (
    <div className="fade">
      {loading ? <div className="skeleton" style={{ height: 200 }} /> : (
        <>
          <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(175px,1fr))", gap: 12, marginBottom: 20 }}>
            <MetricTile label={t("analysis.metrics.lastDiv")} value={lastDiv ? `$${lastDiv.toFixed(4)}` : "—"} tip={t("analysis.tips.lastDiv")} />
            <MetricTile label={t("analysis.metrics.divYield")} value={yield_ ? `${yield_}%` : "—"} eval={yield_ ? M.divYield.eval(+yield_) : null} tip={t("analysis.tips.divYield")} />
          </div>
          {divs.length > 0 ? (
            <div className="card" style={{ padding: "22px 24px" }}>
              <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t("analysis.dividends.history")}</p>
              <DividendsChart dividends={divs} />
            </div>
          ) : (
            <div className="card" style={{ padding: "48px", textAlign: "center" }}>
              <div style={{ marginBottom: 12 }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <p style={{ color: "var(--text3)", fontSize: 14 }}>{lastDiv > 0 ? t("analysis.dividends.noHistory") : t("analysis.dividends.noDividends")}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Earnings Section ────────────────────────────────────────────────────── */
function EarningsSection({ earnings }) {
  const { t, lang } = useLang();
  if (!earnings) return null;
  const { nextDate, epsEstimate, epsLow, epsHigh, history } = earnings;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isUpcoming = nextDate && new Date(nextDate + 'T12:00:00') >= today;
  const sortedHistory = history ? [...history].sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1) : [];

  if (!isUpcoming && !sortedHistory.length) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <p className="section-label">{t("analysis.earnings.section")}</p>
      <div className="card" style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: sortedHistory.length ? 20 : 0, flexWrap: "wrap", gap: 12 }}>
          <div>
            <p style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>{t("analysis.earnings.dateLabel")}</p>
            {isUpcoming ? (
              <p style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em" }}>
                {new Date(nextDate + 'T12:00:00').toLocaleDateString(lang === "en" ? "en-US" : "it-IT", { day: "2-digit", month: "long", year: "numeric" })}
              </p>
            ) : (
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text2)" }}>{t("analysis.earnings.noDate")}</p>
            )}
          </div>
          {isUpcoming && (epsEstimate != null || epsLow != null || epsHigh != null) && (
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {epsLow != null && <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>{t("analysis.earnings.epsMin")}</p>
                <p style={{ fontSize: 16, fontWeight: 700 }}>${epsLow.toFixed(2)}</p>
              </div>}
              {epsEstimate != null && <div style={{ textAlign: "center", background: "var(--blue-light)", padding: "8px 16px", borderRadius: 10 }}>
                <p style={{ fontSize: 11, color: "var(--blue)", fontWeight: 600 }}>{t("analysis.earnings.epsExpected")}</p>
                <p style={{ fontSize: 18, fontWeight: 800, color: "var(--blue)" }}>${epsEstimate.toFixed(2)}</p>
              </div>}
              {epsHigh != null && <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>{t("analysis.earnings.epsMax")}</p>
                <p style={{ fontSize: 16, fontWeight: 700 }}>${epsHigh.toFixed(2)}</p>
              </div>}
            </div>
          )}
        </div>
        {sortedHistory.length > 0 && (
          <>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)", marginBottom: 10 }}>{t("analysis.earnings.history")}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
              {sortedHistory.map((h, i) => {
                const beat = h.epsActual != null && h.epsEstimate != null && h.epsActual >= h.epsEstimate;
                const miss = h.epsActual != null && h.epsEstimate != null && h.epsActual < h.epsEstimate;
                return (
                  <div key={i} style={{ background: "var(--surface2)", borderRadius: 12, padding: "12px 14px", border: `1px solid ${beat ? "rgba(52,199,89,.2)" : miss ? "rgba(255,59,48,.2)" : "var(--border2)"}` }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", marginBottom: 2 }}>{h.quarter}</p>
                    {h.date && <p style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>{new Date(h.date + 'T12:00:00').toLocaleDateString(lang === "en" ? "en-US" : "it-IT", { month: "short", year: "numeric" })}</p>}
                    {h.epsActual != null && <p style={{ fontSize: 17, fontWeight: 800, color: beat ? "var(--green)" : miss ? "var(--red)" : "var(--text)" }}>${h.epsActual.toFixed(2)}</p>}
                    {h.epsEstimate != null && <p style={{ fontSize: 11, color: "var(--text3)" }}>{t("analysis.earnings.estimate")} ${h.epsEstimate.toFixed(2)}</p>}
                    {h.surprise != null && <span style={{ fontSize: 11, fontWeight: 700, color: h.surprise > 0 ? "var(--green)" : "var(--red)" }}>{h.surprise > 0 ? "+" : ""}{h.surprise}%</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Financial History Section (Revenue & Net Income) ───────────────────── */
function FinancialHistorySection({ financials }) {
  const { t } = useLang();
  const [view, setView] = useState("annual");
  const fin = t("analysis.financials");
  const currency = financials?.currency;
  const annual = financials?.periods || [];
  const quarterly = financials?.quarterly || [];

  if (annual.length === 0 && quarterly.length === 0) {
    return (
      <div style={{ marginBottom: 20 }}>
        <p className="section-label">{fin.section}</p>
        <div className="card" style={{ padding: "20px 24px", textAlign: "center", color: "var(--text3)", fontSize: 14 }}>
          {fin.noData}
        </div>
      </div>
    );
  }

  const periods = view === "quarterly" ? quarterly : annual;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <p className="section-label" style={{ marginBottom: 0 }}>{fin.section}</p>
        <div style={{ display: "flex", gap: 8 }}>
          {[["annual", fin.annual], ["quarterly", fin.quarterly]].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              style={{
                padding: "5px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${view === id ? "#2962ff" : "var(--border2)"}`,
                background: view === id ? "#2962ff" : "transparent",
                color: view === id ? "#fff" : "var(--text3)",
                transition: "background .15s, color .15s, border-color .15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="card" style={{ padding: "20px 24px" }}>
        {periods.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 14, padding: "20px 0" }}>{fin.noData}</div>
        ) : (
          <>
            <FinancialHistoryChart periods={periods} currency={currency} labels={{ revenue: fin.revenue, netIncome: fin.netIncome }} />
            <div style={{ overflowX: "auto", marginTop: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border2)" }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", color: "var(--text3)", fontWeight: 600, fontSize: 11 }}>{fin.period}</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", color: "var(--text3)", fontWeight: 600, fontSize: 11 }}>{fin.revenue}</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", color: "var(--text3)", fontWeight: 600, fontSize: 11 }}>{fin.netIncome}</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", color: "var(--text3)", fontWeight: 600, fontSize: 11 }}>{fin.netMargin}</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", color: "var(--text3)", fontWeight: 600, fontSize: 11 }}>{fin.yoyChange}</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p, i) => (
                    <tr key={i} style={{ borderBottom: i < periods.length - 1 ? "1px solid var(--border2)" : "none" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 700 }}>{p.period}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoneyShort(p.revenue, currency)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: p.netIncome >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>{fmtMoneyShort(p.netIncome, currency)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{p.netMargin != null ? `${p.netMargin.toFixed(2)}%` : "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        {p.yoyRevenue != null
                          ? <span style={{ color: p.yoyRevenue >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>{p.yoyRevenue > 0 ? "+" : ""}{p.yoyRevenue.toFixed(2)}%</span>
                          : "—"}
                        {p.yoyNetIncome != null && (
                          <span style={{ display: "block", fontSize: 11, color: "var(--text3)", marginTop: 1 }}>
                            ({p.yoyNetIncome > 0 ? "+" : ""}{p.yoyNetIncome.toFixed(2)}%)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Analysts Card ───────────────────────────────────────────────────────── */
function AnalystsCard({ analysts, price }) {
  const { t } = useLang();
  if (!analysts) return null;
  const { strongBuy, buy, hold, sell, strongSell, targetMean, targetHigh, targetLow, recommendation, numberOfAnalysts } = analysts;
  const total = (strongBuy || 0) + (buy || 0) + (hold || 0) + (sell || 0) + (strongSell || 0);
  if (!total && !targetMean) return null;

  const REC_COLORS = {
    strongbuy: "#00c853", buy: "#34c759", hold: "#ffd60a", sell: "#ff9f0a", strongsell: "#ff3b30",
  };
  const recs = t("analysis.analysts.recs");
  const labels = t("analysis.analysts.labels");
  const recKey = recommendation?.toLowerCase();
  const rec = { label: recs[recKey] || recommendation || "—", color: REC_COLORS[recKey] || "var(--text2)" };
  const upside = price && targetMean ? ((targetMean - price) / price * 100).toFixed(1) : null;

  return (
    <div className="card" style={{ padding: "20px 24px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginBottom: 6 }}>{t("analysis.analysts.consensus")}{numberOfAnalysts ? ` (${numberOfAnalysts})` : ""}</p>
          <p style={{ fontSize: 20, fontWeight: 800, color: rec.color }}>{rec.label}</p>
        </div>
        {targetMean && (
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>{t("analysis.analysts.targetPrice")}</p>
            <p style={{ fontSize: 22, fontWeight: 800 }}>${targetMean.toFixed(2)}</p>
            {upside && <span style={{ fontSize: 12, fontWeight: 700, color: +upside >= 0 ? "var(--green)" : "var(--red)" }}>{+upside >= 0 ? "+" : ""}{upside}{t("analysis.analysts.upside")}</span>}
            {targetLow && targetHigh && <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>${targetLow.toFixed(2)} – ${targetHigh.toFixed(2)}</p>}
          </div>
        )}
      </div>
      {total > 0 && (
        <div>
          {[
            { label: labels.strongBuy, val: strongBuy || 0, color: "#00c853" },
            { label: labels.buy,       val: buy       || 0, color: "#34c759" },
            { label: labels.hold,      val: hold      || 0, color: "#ffd60a" },
            { label: labels.sell,      val: sell      || 0, color: "#ff9f0a" },
            { label: labels.strongSell,val: strongSell|| 0, color: "#ff3b30" },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, width: 95, color: "var(--text2)", fontWeight: 500 }}>{label}</span>
              <div style={{ flex: 1, height: 7, background: "var(--surface2)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${total ? (val / total * 100) : 0}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.8s cubic-bezier(.22,1,.36,1)" }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, width: 20, textAlign: "right", color: "var(--text2)" }}>{val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Insider Tab ─────────────────────────────────────────────────────────── */
function InsiderTab({ insider }) {
  const { t, lang } = useLang();

  if (!insider || insider.length === 0) {
    return (
      <div className="card fade" style={{ padding: "48px", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
        <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{t("analysis.insider.empty")}</p>
        <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("analysis.insider.emptyDesc")}</p>
      </div>
    );
  }

  const typeLabels = t("analysis.insider.types") || {};

  return (
    <div className="fade">
      <div style={{ background: "var(--blue-light)", borderRadius: 14, padding: "16px 20px", marginBottom: 20, border: "1px solid rgba(0,113,227,.12)" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--blue)", marginBottom: 4, display:"flex", alignItems:"center", gap:6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          {t("analysis.insider.title")}
        </p>
        <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>{t("analysis.insider.desc")}</p>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {insider.map((tx, i) => {
          const buy = !!tx.isBuy;
          const typeLabel = typeLabels[tx.type] || tx.type || "—";
          const dateLabel = tx.date
            ? new Date(tx.date).toLocaleDateString(lang === "en" ? "en-US" : "it-IT", { day: "numeric", month: "long", year: "numeric" })
            : "—";
          return (
            <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "14px 18px", borderBottom: i < insider.length - 1 ? "1px solid var(--border2)" : "none" }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: buy ? "rgba(52,199,89,.12)" : "rgba(255,59,48,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: buy ? "var(--green)" : "var(--red)" }}>
                {buy ? "↑" : "↓"}
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <p style={{ fontWeight: 700, fontSize: 13 }}>{tx.name || "—"}</p>
                <p style={{ fontSize: 11, color: "var(--text3)" }}>{tx.role || "—"}</p>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: buy ? "var(--green)" : "var(--red)" }}>{typeLabel}</p>
                <p style={{ fontSize: 11, color: "var(--text3)" }}>{dateLabel}</p>
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <p style={{ fontSize: 12, color: "var(--text2)" }}>{tx.shares != null ? `${fmt.num(tx.shares)} ${t("analysis.insider.shares")}` : "—"}</p>
                <p style={{ fontSize: 11, color: "var(--text3)" }}>{t("analysis.insider.pricePerShare")}: {fmtPrice(tx.price, tx.currency)}</p>
              </div>
              <div style={{ textAlign: "right", minWidth: 90 }}>
                <p style={{ fontSize: 14, fontWeight: 700 }}>{tx.value != null ? fmtMoneyShort(tx.value, tx.currency) : "—"}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main StockAnalysis ──────────────────────────────────────────────────── */
export default function StockAnalysis({ initSym, onAddWatchlist, onRemoveWatchlist, watchlist, onGoHome, dark }) {
  const { t, lang } = useLang();
  const [inp, setInp] = useState(initSym || "");
  const [phase, setPhase] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [hist, setHist] = useState([]);
  const [shortD, setShortD] = useState(null);
  const [sentD, setSentD] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [financials, setFinancials] = useState(null);
  const [analysts, setAnalysts] = useState(null);
  const [insider, setInsider] = useState(null);
  const [tab, setTab] = useState("fondamentali");
  const [translatedDesc, setTranslatedDesc] = useState(null);
  const [descLoading, setDescLoading] = useState(false);
  const [translatedTitles, setTranslatedTitles] = useState(null);
  const [titlesLoading, setTitlesLoading] = useState(false);
  const addToast = useToast();

  const run = useCallback(async input => {
    if (!input) return;
    setLoading(true); setData(null); setHist([]); setShortD(null); setSentD(null); setEarnings(null); setFinancials(null); setAnalysts(null); setInsider(null); setTab("fondamentali");
    setTranslatedDesc(null); setDescLoading(false); setTranslatedTitles(null); setTitlesLoading(false);
    setPhase(t("analysis.loading.searching"));
    const s = await API.resolveSymbol(input);
    setInp(s);
    setPhase(t("analysis.loading.loading"));
    const from = new Date(Date.now() - 400 * 86400000).toISOString().split("T")[0];
    const [q, prof, rat, growth, h] = await Promise.all([
      API.getQuote(s), API.getProfile(s), API.getRatios(s), API.getGrowth(s), API.getHistory(s, from),
    ]);
    setData({ q, prof, rat, growth });
    setHist(Array.isArray(h) ? h : []);
    if (!isCommodity(s) && prof?.companyName) {
      setPhase(t("analysis.loading.extra"));
      const [sent, sh, earningsRes, financialsRes, analystsRes, insiderRes] = await Promise.all([
        API.sentiment(s, prof?.companyName).catch(() => null),
        API.shortInterest(s).catch(() => null),
        API.getEarnings(s).catch(() => null),
        API.getIncomeStatement(s).catch(() => null),
        API.getAnalysts(s).catch(() => null),
        API.getInsider(s).catch(() => null),
      ]);
      setSentD(sent || { _noData: true, label: "N/D", score: 0, positive: 0, neutral: 0, negative: 0, articles: [], summary: "" });
      setShortD(sh || { _noData: true, shortInterest: null, daysToCover: null, sharesShorted: null, trend: null });
      setEarnings(earningsRes);
      setFinancials(financialsRes);
      setAnalysts(analystsRes);
      setInsider(insiderRes);
    }
    setLoading(false); setPhase("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (initSym) run(initSym);
    return () => { cancelled = true; };
  }, [initSym]);

  // Translate company description when lang=it
  useEffect(() => {
    const description = data?.prof?.description;
    if (!description || lang !== 'it') { setTranslatedDesc(null); setDescLoading(false); return; }
    setDescLoading(true);
    API.translate(description.slice(0, 400)).then(res => {
      setTranslatedDesc(res?.translated || null);
      setDescLoading(false);
    }).catch(() => setDescLoading(false));
  }, [data?.prof?.description, lang]);

  // Translate news titles when lang=it
  useEffect(() => {
    if (!sentD?.articles?.length || lang !== 'it') { setTranslatedTitles(null); setTitlesLoading(false); return; }
    setTitlesLoading(true);
    const titles = sentD.articles.map(a => a.title).filter(Boolean);
    API.translateTitles(titles).then(res => {
      setTranslatedTitles(res?.titles || null);
      setTitlesLoading(false);
    }).catch(() => setTitlesLoading(false));
  }, [sentD?.articles, lang]);

  const { q, prof, rat, growth } = data || {};

  // Memoize all derived metric values to avoid recalculation on every render
  const derived = useMemo(() => {
    const eg  = growth?.epsgrowth ? +(growth.epsgrowth * 100).toFixed(1) : null;
    const pe  = rat?.peRatioTTM ?? null;
    const peg = rat?.pegRatioTTM ?? ((pe && eg && eg > 0) ? +(pe / eg).toFixed(2) : null);
    const roe = rat?.returnOnEquityTTM != null ? +(rat.returnOnEquityTTM * 100).toFixed(1) : null;
    const dy  = rat?.dividendYielTTM    != null ? +(rat.dividendYielTTM * 100).toFixed(2) : 0;
    const pb  = rat?.priceToBookRatioTTM ?? null;
    const nm  = rat?.netProfitMarginTTM  != null ? +(rat.netProfitMarginTTM * 100).toFixed(1) : null;
    const de  = rat?.debtEquityRatioTTM  ?? null;
    const volRatio = q?.volume && q?.avgVolume ? +((q.volume / q.avgVolume) * 100).toFixed(1) : null;
    return { eg, pe, peg, roe, dy, pb, nm, de, volRatio };
  }, [data]);

  const { eg, pe, peg, roe, dy, pb, nm, de, volRatio } = derived;

  const isCommodityMode = isCommodity(inp);
  const metrics = t("analysis.metrics");
  const tips = t("analysis.tips");
  const commodity = t("analysis.commodity");
  const tabDefs = t("analysis.tabs");
  const tabs = isCommodityMode
    ? [{ id: "fondamentali", l: tabDefs.info || "Info" }, { id: "tecnica", l: tabDefs.tecnica }]
    : [
        { id: "fondamentali", l: tabDefs.fondamentali }, { id: "salute", l: tabDefs.salute }, { id: "tecnica", l: tabDefs.tecnica },
        { id: "confronto", l: tabDefs.confronto }, { id: "dividendi", l: tabDefs.dividendi },
        { id: "insider", l: tabDefs.insider },
        { id: "sentiment", l: tabDefs.sentiment }, { id: "short", l: tabDefs.short },
      ];

  const isInWatchlist = !!watchlist?.find(w => w.symbol === inp);

  const handleToggleWatchlist = () => {
    if (isInWatchlist) {
      onRemoveWatchlist?.(inp);
      addToast?.(t("watchlist.addedToast", { sym: inp }));
    } else {
      onAddWatchlist?.({ symbol: inp, name: prof?.companyName, price: q?.price, change: q?.changePercentage });
      addToast?.(t("watchlist.savedToast", { sym: inp }));
    }
  };

  return (
    <div className="fade page-pad" style={{ padding: "28px 0" }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
        <button onClick={onGoHome} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", fontSize: 12, fontWeight: 500, padding: 0 }}>{t("nav.home")}</button>
        <span>›</span><span>{t("analysis.breadcrumb")}</span>
        {inp && <><span>›</span><span style={{ color: "var(--text)", fontWeight: 600, fontFamily: "monospace" }}>{inp}</span></>}
      </div>

      <h1 className="page-title" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.04em", marginBottom: 20 }}>{t("analysis.title")}</h1>

      {/* Search bar */}
      <div className="card" style={{ padding: "20px 22px", marginBottom: 24 }}>
        <div className="search-row" style={{ display: "flex", gap: 10 }}>
          <input className="input search-input" value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === "Enter" && run(inp)} placeholder={t("analysis.searchPlaceholder")} style={{ flex: 1 }} />
          <button className="btn btn-blue search-btn" onClick={() => run(inp)} style={{ minWidth: 100 }}>
            {loading ? <Spinner size={16} /> : t("analysis.searchBtn")}
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "64px 0" }}>
          <Spinner size={36} />
          <p style={{ marginTop: 14, fontSize: 14, color: "var(--text2)" }}>{phase}</p>
        </div>
      )}

      {!loading && !data && (
        <div style={{ textAlign: "center", padding: "72px 0", color: "var(--text3)" }}>
          <div style={{ marginBottom: 20, display:"flex", justifyContent:"center" }}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <rect x="8" y="36" width="12" height="20" rx="3" fill="#2962ff" fillOpacity="0.65"/>
              <line x1="14" y1="24" x2="14" y2="36" stroke="#2962ff" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.65"/>
              <line x1="14" y1="56" x2="14" y2="60" stroke="#2962ff" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.65"/>
              <rect x="26" y="22" width="12" height="22" rx="3" fill="#2962ff"/>
              <line x1="32" y1="10" x2="32" y2="22" stroke="#2962ff" strokeWidth="2" strokeLinecap="round"/>
              <line x1="32" y1="44" x2="32" y2="52" stroke="#2962ff" strokeWidth="2" strokeLinecap="round"/>
              <rect x="44" y="28" width="12" height="16" rx="3" fill="#26a69a" fillOpacity="0.85"/>
              <line x1="50" y1="16" x2="50" y2="28" stroke="#26a69a" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.85"/>
              <line x1="50" y1="44" x2="50" y2="54" stroke="#26a69a" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.85"/>
            </svg>
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{t("analysis.emptyTitle")}</div>
          <div style={{ fontSize: 14, color: "var(--text3)" }}>{t("analysis.emptySub")}</div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Company header */}
          <div className="card" style={{ padding: "24px", marginBottom: 20 }}>
            <div className="company-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                {prof?.image && <img src={prof.image} alt="" style={{ width: 52, height: 52, borderRadius: 12, objectFit: "contain", background: "var(--surface2)", padding: 5 }} />}
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.03em" }}>{prof?.companyName || inp}</h2>
                  <p style={{ fontSize: 13, color: "var(--text2)", marginTop: 3 }}>{[prof?.exchange, prof?.sector, prof?.country].filter(Boolean).join(" · ")}</p>
                  {prof?.description && (
                    <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 8, lineHeight: 1.6, maxWidth: 520 }}>
                      {descLoading
                        ? t("analysis.descLoading")
                        : ((lang === 'it' && translatedDesc ? translatedDesc : prof.description).slice(0, 160) + "…")
                      }
                    </p>
                  )}
                </div>
              </div>
              <div className="company-price-block" style={{ textAlign: "right" }}>
                <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-.05em" }}>{fmtPrice(q?.price, q?.currency)}</div>
                <span className={`pill ${(q?.changePercentage || 0) >= 0 ? "pill-green" : "pill-red"}`} style={{ fontSize: 14, padding: "5px 13px", marginTop: 4, display: "inline-block" }}>{fmt.pct(q?.changePercentage)}</span>
                {/* Pre-Market / After Hours extended session */}
                {(() => {
                  // Mutually exclusive ET windows: 4:00-9:30 → pre-market session, 16:00-4:00 → after-hours + overnight
                  const etMin = getZonedMinutes(new Date(), 'America/New_York');
                  const beforeOpen = etMin >= 4 * 60 && etMin < 9 * 60 + 30;
                  const afterClose = etMin >= 16 * 60 || etMin < 4 * 60;
                  const showPre = q?.preMarketPrice != null && beforeOpen;
                  const showPost = q?.postMarketPrice != null && afterClose;
                  if (!showPre && !showPost) return null;
                  const label = showPre ? t("analysis.preMarket") : t("analysis.afterHours");
                  const price = showPre ? q.preMarketPrice : q.postMarketPrice;
                  const pct = showPre ? q.preMarketChangePercent : q.postMarketChangePercent;
                  const up = (pct || 0) >= 0;
                  return (
                    <div style={{ marginTop: 8, padding: "5px 10px", borderRadius: 8, background: "var(--surface2)", display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--border2)" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: up ? "var(--green)" : "var(--red)" }}>{fmtPrice(price, q?.currency)}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: up ? "var(--green)" : "var(--red)" }}>{fmt.pct(pct)}</span>
                    </div>
                  );
                })()}
                <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>{t("analysis.cap")} {fmt.bn(prof?.marketCap)}</p>
                <button
                  className={`btn btn-sm ${isInWatchlist ? "btn-blue" : "btn-ghost"}`}
                  style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, transition: "all .2s" }}
                  onClick={handleToggleWatchlist}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={isInWatchlist ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  {isInWatchlist ? t("analysis.inWatchlist") : t("analysis.addWatchlist")}
                </button>
              </div>
            </div>
          </div>

          {/* Earnings calendar */}
          {!isCommodityMode && <EarningsSection earnings={earnings} />}

          {/* Historical financials: revenue & net income */}
          {!isCommodityMode && <FinancialHistorySection financials={financials} />}

          {/* Tabs */}
          <div className="tab-wrap" style={{ overflowX: "auto", marginBottom: 20 }}>
            <div className="tabs-line" style={{ width: "max-content", minWidth: "100%" }}>
              {tabs.map(t => <button key={t.id} className={`tab-line${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>{t.l}</button>)}
            </div>
          </div>

          {/* Tab: Fondamentali / Info */}
          {tab === "fondamentali" && isCommodityMode && (
            <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Market data tiles */}
              <div className="stagger metric-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(175px,1fr))", gap: 12 }}>
                <MetricTile label={metrics.price} value={fmtPrice(q?.price, q?.currency)}        tip={tips.price} />
                <MetricTile label={metrics.change}   value={q?.changePercentage != null ? `${q.changePercentage >= 0 ? "+" : ""}${q.changePercentage.toFixed(2)}%` : "—"} eval={q?.changePercentage != null ? { c: q.changePercentage >= 0 ? "green" : "red" } : null} tip={tips.varDay} />
                <MetricTile label={metrics.high52}   value={fmtPrice(q?.yearHigh, q?.currency)}     tip={tips.yearHigh} />
                <MetricTile label={metrics.low52}    value={fmtPrice(q?.yearLow, q?.currency)}      tip={tips.yearLow} />
                <MetricTile label={metrics.volume}   value={q?.volume ? fmt.bn(q.volume) : "—"} tip={tips.volToday} />
                <MetricTile label={metrics.avgVol}   value={q?.avgVolume ? fmt.bn(q.avgVolume) : "—"} tip={tips.volAvg} />
              </div>
              {/* Commodity notice */}
              <div className="card" style={{ padding: "20px 24px", background: "var(--surface2)", border: "1px solid var(--border2)", display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ lineHeight: 1, flexShrink: 0 }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                </div>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                    {t("analysis.commodity.notice", { label: commodity.labels[commodityLabelKey(inp)] })}
                  </p>
                  <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
                    {commodityLabelKey(inp) === 'index' ? commodity.indexNoticeDesc : commodity.noticeDesc}
                  </p>
                </div>
              </div>
            </div>
          )}
          {tab === "fondamentali" && !isCommodityMode && (
            <div className="fade">
              <AnalystsCard analysts={analysts} price={q?.price} />
              <div className="stagger metric-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(175px,1fr))", gap: 12 }}>
              <MetricTile label={metrics.pe}        value={pe  != null ? fmt.dec(pe, 1)  : "—"} eval={M.pe.eval(pe)}          tip={M.pe.tip} />
              <MetricTile label={metrics.peg}       value={peg != null ? fmt.dec(peg, 2) : "—"} eval={M.peg.eval(peg)}        tip={M.peg.tip} />
              <MetricTile label={metrics.roe}       value={roe != null ? `${roe}%`        : "—"} eval={M.roe.eval(roe)}        tip={M.roe.tip} />
              <MetricTile label={metrics.divYield}  value={dy  > 0     ? `${dy}%`         : "0%"} eval={M.divYield.eval(dy)}  tip={M.divYield.tip} />
              <MetricTile label={metrics.de}        value={de  != null ? fmt.dec(de, 2)   : "—"} eval={M.debtEq.eval(de)}     tip={M.debtEq.tip} />
              <MetricTile label={metrics.pb}        value={pb  != null ? fmt.dec(pb, 2)   : "—"} eval={M.pb.eval(pb)}         tip={M.pb.tip} />
              <MetricTile label={metrics.netMargin} value={nm  != null ? `${nm}%`          : "—"} eval={M.netMargin.eval(nm)} tip={M.netMargin.tip} />
              <MetricTile label={metrics.eps}       value={rat?.netIncomePerShareTTM != null ? fmt.dec(rat.netIncomePerShareTTM, 2) : "—"} tip={tips.eps} />
              <MetricTile label={metrics.epsGrowth} value={eg != null ? `${eg}%` : "—"}   eval={M.epsGrowth.eval(eg)}        tip={M.epsGrowth.tip} />
              <MetricTile label={metrics.volRatio}  value={volRatio != null ? `${volRatio}%` : "—"} eval={M.volRatio.eval(volRatio)} tip={M.volRatio.tip} />
              <MetricTile label={metrics.high52}    value={fmtPrice(q?.yearHigh, q?.currency)} tip={tips.yearHigh} />
              <MetricTile label={metrics.low52}     value={fmtPrice(q?.yearLow, q?.currency)}  tip={tips.yearLow} />
              </div>
            </div>
          )}

          {/* Tab: Salute (financial health) */}
          {tab === "salute" && !isCommodityMode && (
            <ErrorBoundary>
              <SaluteTab symbol={inp} dark={dark} />
            </ErrorBoundary>
          )}

          {/* Tab: Tecnica */}
          {tab === "tecnica" && (
            <ErrorBoundary>
              <TecnicaTab symbol={inp} q={q} hist={hist || []} dark={dark} />
            </ErrorBoundary>
          )}

          {/* Tab: Confronto */}
          {tab === "confronto" && <ConfrontoTab sym1={inp} />}

          {/* Tab: Dividendi */}
          {tab === "dividendi" && <DividendiTab symbol={inp} prof={prof} />}

          {/* Tab: Insider */}
          {tab === "insider" && (
            insider === null
              ? <div style={{ textAlign: "center", padding: "48px" }}><Spinner size={28} /><p style={{ marginTop: 12, color: "var(--text2)" }}>{t("analysis.loading.loading")}</p></div>
              : <InsiderTab insider={insider} />
          )}

          {/* Tab: Sentiment */}
          {tab === "sentiment" && (
            <div className="fade">
              {!sentD ? (
                <div style={{ textAlign: "center", padding: "48px" }}><Spinner size={28} /><p style={{ marginTop: 12, color: "var(--text2)" }}>{t("analysis.loading.loading")}</p></div>
              ) : sentD._noData ? (
                <div className="card" style={{ padding: "48px", textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📰</div>
                  <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{t("analysis.sentiment.noData")}</p>
                  <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("analysis.sentiment.noDataDesc")}</p>
                </div>
              ) : (
                <>
                  <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
                      <div>
                        <p style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600, marginBottom: 8 }}>{t("analysis.sentiment.label")}</p>
                        <p style={{ fontSize: 26, fontWeight: 700, color: sentD.score > 20 ? "var(--green)" : sentD.score < -20 ? "var(--red)" : "var(--gold)" }}>{sentD.label}</p>
                      </div>
                      <p style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-.05em", color: sentD.score > 20 ? "var(--green)" : sentD.score < -20 ? "var(--red)" : "var(--gold)" }}>{sentD.score > 0 ? "+" : ""}{sentD.score}</p>
                    </div>
                    <SentimentBarChart positive={sentD.positive} neutral={sentD.neutral} negative={sentD.negative} />
                    {sentD.summary && <p style={{ marginTop: 16, fontSize: 13, color: "var(--text2)", lineHeight: 1.7, padding: "12px 16px", background: "var(--surface2)", borderRadius: 10 }}>💬 {sentD.summary}</p>}
                  </div>
                  {sentD.articles?.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: ".06em", textTransform: "uppercase" }}>
                        {sentD.articles.length} {t("analysis.sentiment.recentNews")}
                      </p>
                      {titlesLoading && (
                        <span style={{ fontSize: 11, color: "var(--text3)", fontStyle: "italic" }}>
                          {t("analysis.sentiment.translatingTitles")}
                        </span>
                      )}
                    </div>
                  )}
                  {sentD.articles?.length === 0 && (
                    <div className="card" style={{ padding: "32px", textAlign: "center" }}>
                      <div style={{ marginBottom: 10 }}>
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v4"/><path d="M2 13h10"/><path d="M9 18H2"/><path d="M2 9h3"/></svg>
                      </div>
                      <p style={{ fontSize: 14, color: "var(--text3)" }}>{t("analysis.sentiment.noArticles")}</p>
                    </div>
                  )}
                  {sentD.articles?.map((a, i) => {
                    const title = (lang === 'it' && translatedTitles?.[i]) ? translatedTitles[i] : a.title;
                    return (
                      <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block", marginBottom: 8 }}>
                        <div className="card" style={{ padding: "14px 18px", transition: "background .15s" }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--surface2)"}
                          onMouseLeave={e => e.currentTarget.style.background = ""}>
                          <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", marginBottom: 6, lineHeight: 1.5 }}>{title}</p>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text3)" }}>
                            <span style={{ fontWeight: 600, color: "var(--blue)" }}>{a.source?.name}</span>
                            <span>·</span>
                            <span title={new Date(a.publishedAt).toLocaleString(lang === "en" ? "en-US" : "it-IT")}>{timeAgo(a.publishedAt, lang)}</span>
                            <span style={{ marginLeft: "auto", fontSize: 11 }}>↗</span>
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* Tab: Short */}
          {tab === "short" && (
            <div className="fade">
              <div style={{ background: "var(--blue-light)", borderRadius: 16, padding: "18px 20px", marginBottom: 20, border: "1px solid rgba(0,113,227,.12)" }}>
                <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "var(--blue)" }}>📚 {t("analysis.short.info")}</p>
                <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>{t("analysis.short.infoDesc")}</p>
              </div>
              {!shortD ? (
                <div style={{ textAlign: "center", padding: "48px" }}><Spinner size={28} /></div>
              ) : (shortD._noData || (shortD.shortInterest == null && shortD.daysToCover == null && shortD.sharesShorted == null)) ? (
                <div className="card" style={{ padding: "48px", textAlign: "center" }}>
                  <div style={{ marginBottom: 12, display:"flex", justifyContent:"center" }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{t("analysis.short.noData")}</p>
                  <p style={{ fontSize: 13, color: "var(--text3)" }}>{(shortD._isNonUS || inp.includes('.')) ? t("analysis.short.noDataDesc") : t("analysis.short.noDataUS")}</p>
                </div>
              ) : (
                <div className="stagger metric-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(185px,1fr))", gap: 12 }}>
                  <MetricTile label={t("analysis.metrics.shortInterest")} value={shortD.shortInterest != null ? `${shortD.shortInterest}%` : "—"} eval={M.short.eval(shortD.shortInterest)} tip={M.short.tip} />
                  <MetricTile label={t("analysis.metrics.daysToCover")}   value={shortD.daysToCover  != null ? `${shortD.daysToCover}g` : "—"}   eval={M.daysToCover.eval(shortD.daysToCover)} tip={M.daysToCover.tip} />
                  <MetricTile label={t("analysis.metrics.sharesShorted")} value={shortD.sharesShorted != null ? `${shortD.sharesShorted}M` : "—"} tip={t("analysis.tips.shortShares")} />
                  <MetricTile label={t("analysis.metrics.shortTrend")}    value={shortD.trend ? t("analysis.short.trendLabels")[shortD.trend] || shortD.trend : "—"} eval={shortD.trend ? { c: shortD.trend === "diminuendo" ? "green" : shortD.trend === "aumentando" ? "red" : "gold", t: t("analysis.short.trendEvals")[shortD.trend] || shortD.trend } : null} tip={t("analysis.tips.shortTrend")} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
