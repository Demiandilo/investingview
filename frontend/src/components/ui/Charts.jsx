import { useState, useEffect, useRef, useMemo } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle } from "lightweight-charts";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, LabelList,
} from "recharts";
import { fmt, fmtMoneyShort } from "../../api.js";

const PIE_COLORS = ["#0071e3","#34c759","#ff9f0a","#ff3b30","#8b5cf6","#06b6d4","#f59e0b","#10b981"];

/* ─── Candlestick Chart (lightweight-charts v5) ──────────────────────────── */
export function CandlestickChart({ data, dark, supports = [], resistances = [], trendLine }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !data?.length) return;

    // Filter out invalid rows and deduplicate by date before sorting
    const seen = new Set();
    const sorted = [...data]
      .filter(d => d?.date && d?.close != null && !seen.has(d.date) && seen.add(d.date))
      .sort((a, b) => a.date < b.date ? -1 : 1);

    if (!sorted.length) return;

    const textColor = dark ? "#aeaeb2" : "#6e6e73";
    const gridColor = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
    const borderColor = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";

    let chart;
    try {
      chart = createChart(ref.current, {
        width: ref.current.clientWidth, height: 340,
        layout: { background: { type: "solid", color: "transparent" }, textColor },
        grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor },
        timeScale: { borderColor, timeVisible: false },
      });

      const hasOHLC = sorted[0]?.open != null;
      if (hasOHLC) {
        // lightweight-charts v5: use chart.addSeries(SeriesType, opts)
        const c = chart.addSeries(CandlestickSeries, {
          upColor: "#34c759", downColor: "#ff3b30",
          borderVisible: false, wickUpColor: "#34c759", wickDownColor: "#ff3b30",
        });
        c.setData(sorted.map(d => ({
          time: d.date,
          open:  d.open  ?? d.close,
          high:  d.high  ?? d.close,
          low:   d.low   ?? d.close,
          close: d.close,
        })));
        if (sorted.some(d => d.volume)) {
          const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
          vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
          vol.setData(sorted.map(d => ({
            time: d.date,
            value: d.volume || 0,
            color: d.close >= (d.open ?? d.close) ? "rgba(52,199,89,.35)" : "rgba(255,59,48,.35)",
          })));
        }

        // Support / resistance levels — dashed horizontal lines with price labels
        supports.forEach(s => {
          c.createPriceLine({
            price: s.price, color: "#34c759", lineWidth: 1, lineStyle: LineStyle.Dashed,
            axisLabelVisible: true, title: `S ${s.price}`,
          });
        });
        resistances.forEach(r => {
          c.createPriceLine({
            price: r.price, color: "#ff3b30", lineWidth: 1, lineStyle: LineStyle.Dashed,
            axisLabelVisible: true, title: `R ${r.price}`,
          });
        });

        // Short/medium-term trend line (linear regression over the last ~30 trading days)
        if (trendLine?.from && trendLine?.to) {
          const trend = chart.addSeries(LineSeries, {
            color: "#0071e3", lineWidth: 1, lineStyle: LineStyle.Dashed,
            lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
          });
          trend.setData([
            { time: trendLine.from.date, value: trendLine.from.price },
            { time: trendLine.to.date,   value: trendLine.to.price },
          ]);
        }
      } else {
        const line = chart.addSeries(LineSeries, { color: "#0071e3", lineWidth: 2 });
        line.setData(sorted.map(d => ({ time: d.date, value: d.close ?? d.adjClose ?? 0 })));
      }
      chart.timeScale().fitContent();
    } catch (e) {
      console.error("CandlestickChart error:", e);
      return;
    }

    const ro = new ResizeObserver(() => { if (ref.current) chart.applyOptions({ width: ref.current.clientWidth }); });
    ro.observe(ref.current);
    return () => { try { chart.remove(); } catch {} ro.disconnect(); };
  }, [data, dark, supports, resistances, trendLine]);

  return <div ref={ref} style={{ width: "100%", minHeight: 340 }} />;
}

/* ─── Historical Area Chart (recharts) ───────────────────────────────────── */
function calcMA(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    return data.slice(i - period + 1, i + 1).reduce((s, d) => s + d.close, 0) / period;
  });
}
const PERIODS = [{ label: "1M", days: 22 }, { label: "3M", days: 65 }, { label: "6M", days: 130 }, { label: "1A", days: 252 }];

export function HistoricalChart({ history }) {
  const [period, setPeriod] = useState(2);
  const raw = useMemo(() => [...history].reverse(), [history]);
  const slice = useMemo(() => raw.slice(Math.max(0, raw.length - PERIODS[period].days)), [raw, period]);
  const ma50 = useMemo(() => calcMA(raw, 50).slice(Math.max(0, raw.length - PERIODS[period].days)), [raw, period]);
  const ma200 = useMemo(() => calcMA(raw, 200).slice(Math.max(0, raw.length - PERIODS[period].days)), [raw, period]);
  const chartData = useMemo(() => slice.map((d, i) => ({ date: d.date, close: d.close, ma50: ma50[i] ? +ma50[i].toFixed(2) : undefined, ma200: ma200[i] ? +ma200[i].toFixed(2) : undefined })), [slice, ma50, ma200]);
  if (!chartData.length) return null;
  const up = chartData[chartData.length - 1].close >= chartData[0].close;
  const color = up ? "#34c759" : "#ff3b30";
  const minY = Math.min(...chartData.map(d => d.close)) * .98;
  const maxY = Math.max(...chartData.map(d => d.close)) * 1.02;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "var(--text2)", display: "flex", gap: 14 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 2, background: "#0071e3", display: "inline-block", borderRadius: 1 }} />MA50</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 2, background: "#ff9f0a", display: "inline-block", borderRadius: 1 }} />MA200</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {PERIODS.map((p, i) => (
            <button key={p.label} onClick={() => setPeriod(i)} style={{ padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: period === i ? "var(--blue)" : "var(--surface2)", color: period === i ? "white" : "var(--text2)", border: "none", cursor: "pointer" }}>{p.label}</button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs><linearGradient id="hgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.18} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={fmt.date} interval="preserveStartEnd" axisLine={false} tickLine={false} />
          <YAxis domain={[minY, maxY]} tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={v => `$${v.toFixed(0)}`} axisLine={false} tickLine={false} width={55} />
          <Tooltip formatter={(v, n) => [`$${Number(v).toFixed(2)}`, n === "close" ? "Prezzo" : n === "ma50" ? "MA50" : "MA200"]} labelFormatter={fmt.date} contentStyle={{ borderRadius: 10, border: "1px solid var(--border2)", boxShadow: "var(--shadow)", fontSize: 12 }} />
          <Area type="monotone" dataKey="close" stroke={color} strokeWidth={2} fill="url(#hgrad)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
          {chartData.some(d => d.ma50) && <Area type="monotone" dataKey="ma50" stroke="#0071e3" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />}
          {chartData.some(d => d.ma200) && <Area type="monotone" dataKey="ma200" stroke="#ff9f0a" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Comparison Chart (recharts) ────────────────────────────────────────── */
export function ComparisonChart({ data1, data2, sym1, sym2 }) {
  const chartData = useMemo(() => {
    if (!data1?.length || !data2?.length) return [];
    const sorted1 = [...data1].sort((a, b) => a.date < b.date ? -1 : 1);
    const sorted2 = [...data2].sort((a, b) => a.date < b.date ? -1 : 1);
    const map2 = Object.fromEntries(sorted2.map(d => [d.date, d.close]));
    const base1 = sorted1[0]?.close;
    const base2 = sorted2[0]?.close;
    return sorted1.map(d => ({
      date: d.date,
      [sym1]: base1 ? +((d.close / base1 - 1) * 100).toFixed(2) : undefined,
      [sym2]: map2[d.date] && base2 ? +((map2[d.date] / base2 - 1) * 100).toFixed(2) : undefined,
    }));
  }, [data1, data2, sym1, sym2]);

  if (!chartData.length) return <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)" }}>Caricamento…</div>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={fmt.date} interval="preserveStartEnd" axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v, n) => [`${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`, n]} labelFormatter={fmt.date} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
        <ReferenceLine y={0} stroke="rgba(0,0,0,0.15)" strokeDasharray="4 2" />
        <Legend />
        <Line type="monotone" dataKey={sym1} stroke="#0071e3" dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey={sym2} stroke="#ff9f0a" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ─── Dividends Bar Chart ─────────────────────────────────────────────────── */
export function DividendsChart({ dividends }) {
  const data = useMemo(() => {
    const byYear = {};
    dividends.forEach(d => {
      const yr = d.date?.slice(0, 4) || d.label || "?";
      byYear[yr] = (byYear[yr] || 0) + (d.dividend || d.adjDividend || 0);
    });
    return Object.entries(byYear).sort(([a], [b]) => a < b ? -1 : 1).slice(-8).map(([year, value]) => ({ year, value: +value.toFixed(4) }));
  }, [dividends]);

  if (!data.length) return <div style={{ padding: "32px", textAlign: "center", color: "var(--text3)", fontSize: 14 }}>Nessun dato dividendi</div>;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--text3)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={v => `$${v.toFixed(2)}`} axisLine={false} tickLine={false} />
        <Tooltip formatter={v => [`$${v.toFixed(4)}`, "Dividendo ann."]} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
        <Bar dataKey="value" fill="#0071e3" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Financial History Chart (Revenue & Net Income) ─────────────────────── */
export function FinancialHistoryChart({ periods, currency, labels }) {
  const data = useMemo(() => [...(periods || [])].reverse(), [periods]); // oldest → newest, left to right
  if (!data.length) return null;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--text3)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={v => fmtMoneyShort(v, currency)} axisLine={false} tickLine={false} width={56} />
        <Tooltip formatter={(v, name) => [fmtMoneyShort(v, currency), name]} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="revenue" name={labels?.revenue || "Fatturato"} fill="#0071e3" radius={[4, 4, 0, 0]} />
        <Bar dataKey="netIncome" name={labels?.netIncome || "Utile Netto"} radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.netIncome >= 0 ? "#34c759" : "#ff3b30"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Portfolio History Chart ─────────────────────────────────────────────── */
export function PortfolioHistoryChart({ data }) {
  if (!data?.length) return null;
  const start = data[0]?.value, end = data[data.length - 1]?.value;
  const pct = start ? ((end - start) / start * 100) : 0;
  const up = pct >= 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>Andamento 90 giorni</p>
        <span className={`pill ${up ? "pill-green" : "pill-red"}`}>{pct > 0 ? "+" : ""}{pct.toFixed(2)}%</span>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs><linearGradient id="phgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={up ? "#34c759" : "#ff3b30"} stopOpacity={.18} /><stop offset="100%" stopColor={up ? "#34c759" : "#ff3b30"} stopOpacity={0} /></linearGradient></defs>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={fmt.date} interval="preserveStartEnd" axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} axisLine={false} tickLine={false} width={48} />
          <Tooltip formatter={v => [fmt.price(v), "Valore"]} labelFormatter={fmt.date} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
          <Area type="monotone" dataKey="value" stroke={up ? "#34c759" : "#ff3b30"} strokeWidth={2} fill="url(#phgrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Sentiment Bar Chart ─────────────────────────────────────────────────── */
export function SentimentBarChart({ positive = 0, neutral = 0, negative = 0 }) {
  const data = [{ label: "Positive", value: positive, fill: "#34c759" }, { label: "Neutre", value: neutral, fill: "#aeaeb2" }, { label: "Negative", value: negative, fill: "#ff3b30" }];
  return (
    <ResponsiveContainer width="100%" height={110}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: "var(--text2)" }} axisLine={false} tickLine={false} width={68} />
        <Tooltip formatter={v => [v, "Notizie"]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]}>{data.map((d, i) => <Cell key={i} fill={d.fill} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Portfolio Pie Chart ─────────────────────────────────────────────────── */
export function PortfolioPieChart({ positions }) {
  const data = positions.map(p => ({ name: p.symbol, value: p.qty * (p.cur || p.avg) }));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" outerRadius={80} innerRadius={50} dataKey="value" paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v, n) => [`$${v.toFixed(2)} (${((v / total) * 100).toFixed(1)}%)`, n]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ─── Sector Bar Chart ────────────────────────────────────────────────────── */
const SECTOR_IT = {
  "Technology":             "Tecnologia",
  "Healthcare":             "Sanità",
  "Financial Services":     "Finanza",
  "Financials":             "Finanza",
  "Consumer Cyclical":      "Beni Voluttuari",
  "Consumer Discret.":      "Beni Voluttuari",
  "Consumer Defensive":     "Cons. Difensivi",
  "Consumer Staples":       "Cons. Difensivi",
  "Energy":                 "Energia",
  "Industrials":            "Industria",
  "Communication Services": "Comunicazioni",
  "Communication":          "Comunicazioni",
  "Utilities":              "Utility",
  "Basic Materials":        "Materiali",
  "Materials":              "Materiali",
  "Real Estate":            "Immobiliare",
};

function toItalian(sector) {
  if (!sector) return sector || "—";
  return SECTOR_IT[sector] || sector;
}

// Custom YAxis tick — recharts interval="auto" may skip ticks when bars are close;
// a custom tick forces every label to render.
function SectorTick({ x, y, payload }) {
  if (!payload?.value) return null;
  return (
    <text x={x} y={y} dy="0.35em" textAnchor="end" fill="var(--text2)" fontSize={11}>
      {payload.value}
    </text>
  );
}

function SectorPctLabel({ x, y, width, height, value }) {
  if (value == null || isNaN(value)) return null;
  const positive = value >= 0;
  // recharts may pass negative width for negative bars (bar extends left from x=zero ref)
  // so we derive the true left/right edges from Math.min/max
  const leftEdge  = Math.min(x, x + width);
  const rightEdge = Math.max(x, x + width);
  const lx     = positive ? rightEdge + 5 : leftEdge - 5;
  const anchor = positive ? "start" : "end";
  return (
    <text x={lx} y={y + height / 2} dy="0.35em" fill={positive ? "#34c759" : "#ff3b30"} fontSize={10} fontWeight={700} textAnchor={anchor}>
      {`${value > 0 ? "+" : ""}${value.toFixed(2)}%`}
    </text>
  );
}

/* ─── Fear & Greed Gauge ──────────────────────────────────────────────────── */
export function FearGreedGauge({ score = 50, width = 200 }) {
  const cx = 100, cy = 96, r = 80, rNeedle = 70;

  function pt(s) {
    const a = (1 - s / 100) * Math.PI;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  }
  function arc(s1, s2) {
    const [x1, y1] = pt(s1);
    const [x2, y2] = pt(s2);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  const ZONES = [
    [0, 25, "#ff3b30"], [25, 45, "#ff9f0a"], [45, 55, "#ffd60a"],
    [55, 75, "#34c759"], [75, 100, "#00c853"],
  ];
  const gaugeColor = score < 25 ? "#ff3b30" : score < 45 ? "#ff9f0a" : score < 55 ? "#ffd60a" : score < 75 ? "#34c759" : "#00c853";
  const ratingLabel = score < 25 ? "Paura Estrema" : score < 45 ? "Paura" : score < 55 ? "Neutrale" : score < 75 ? "Avidità" : "Avidità Estrema";

  const na = (1 - score / 100) * Math.PI;
  const nx = cx + rNeedle * Math.cos(na);
  const ny = cy - rNeedle * Math.sin(na);

  return (
    <div style={{ textAlign: "center" }}>
      <svg viewBox="0 0 200 103" width={width} style={{ display: "block", margin: "0 auto", overflow: "visible" }}>
        <path d={arc(0, 100)} stroke="var(--border2)" strokeWidth={14} fill="none" />
        {ZONES.map(([s1, s2, c]) => (
          <path key={s1} d={arc(s1, s2)} stroke={c} strokeWidth={12} fill="none" opacity={0.3} />
        ))}
        {score > 0 && (
          <path d={arc(0, Math.min(score, 99.9))} stroke={gaugeColor} strokeWidth={12} fill="none" strokeLinecap="round" />
        )}
        <line x1={cx} y1={cy} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="var(--text)" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={5} fill="var(--text)" />
      </svg>
      <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.04em", color: gaugeColor, margin: "6px 0 2px" }}>{score}</p>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: gaugeColor }}>{ratingLabel}</p>
    </div>
  );
}

/* ─── Segmented Gauge — 5-level colour bar with position marker ──────────── */
// Used for the overall financial health score and the technical analysis verdict.
export const GAUGE_COLORS = ["#ef5350", "#ff9f0a", "#f5c518", "#9ccc65", "#26a69a"];

export function SegmentedGauge({ score, width = 280, height = 10 }) {
  const clamped = Math.max(1, Math.min(5, score ?? 1));
  const pct = ((clamped - 1) / 4) * 100;

  return (
    <div style={{ width: "100%", maxWidth: width, position: "relative", paddingTop: 12 }}>
      <div style={{
        position: "absolute", top: 0, left: `${pct}%`, transform: "translateX(-50%)",
        width: 0, height: 0,
        borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
        borderTop: "8px solid var(--text)",
      }} />
      <div style={{ display: "flex", height, borderRadius: height / 2, overflow: "hidden" }}>
        {GAUGE_COLORS.map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}
      </div>
    </div>
  );
}

/* ─── Health History Chart — multi-line evolution of dimension scores ────── */
export function HealthHistoryChart({ data, series, dark }) {
  if (!data?.length) return null;
  const gridColor = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--text3)" }} axisLine={false} tickLine={false} />
        <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11, fill: "var(--text3)" }} axisLine={false} tickLine={false} width={28} />
        <Tooltip
          contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid var(--border2)", background: "var(--card)" }}
          labelStyle={{ fontWeight: 600, color: "var(--text)" }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map(s => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SectorBarChart({ sectors, maxItems = 11 }) {
  // Dedup by Italian name using Map (Map preserves insertion order, keeps first occurrence)
  const byName = new Map();
  sectors.forEach(s => {
    const name = toItalian(s.sector);
    const pct  = parseFloat(s.changesPercentage);
    if (!byName.has(name)) byName.set(name, { name, pct: isNaN(pct) ? 0 : pct });
  });

  const data = Array.from(byName.values())
    .sort((a, b) => b.pct - a.pct)
    .slice(0, maxItems);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
        <YAxis type="category" dataKey="name" tick={<SectorTick />} interval={0} axisLine={false} tickLine={false} width={115} />
        <Tooltip
          formatter={v => [`${v > 0 ? "+" : ""}${v.toFixed(2)}%`, "Variazione giornaliera"]}
          contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid var(--border2)", background: "var(--card)" }}
          labelStyle={{ fontWeight: 600, color: "var(--text)" }}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
        />
        <ReferenceLine x={0} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
        <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.pct >= 0 ? "#34c759" : "#ff3b30"} fillOpacity={0.85} />)}
          <LabelList dataKey="pct" content={SectorPctLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
