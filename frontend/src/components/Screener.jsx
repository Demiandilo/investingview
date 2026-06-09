import { useState, useMemo, useRef, useEffect } from "react";
import { API, fmtPrice, fmt, useLocalStorage } from "../api.js";
import { Spinner } from "./ui/Spinner.jsx";
import { useLang } from "../i18n.js";

/* ─── Sector translation ─────────────────────────────────────────────────── */
const SECTOR_IT = {
  "Technology":             "Tecnologia",
  "Consumer Defensive":     "Cons. Difensivi",
  "Consumer Cyclical":      "Beni Voluttuari",
  "Financial Services":     "Finanza",
  "Healthcare":             "Sanità",
  "Industrials":            "Industria",
  "Communication Services": "Comunicazioni",
  "Energy":                 "Energia",
  "Utilities":              "Utility",
  "Basic Materials":        "Materiali",
  "Real Estate":            "Immobiliare",
};

/* ─── Constants ──────────────────────────────────────────────────────────── */
const SECTORS_LIST = [
  "Technology","Healthcare","Financial Services","Energy",
  "Consumer Cyclical","Industrials","Communication Services",
  "Consumer Defensive","Basic Materials","Real Estate","Utilities",
];

const QUICK_PRESETS = [
  { label: "Value",         f: { roeMin:"10", pbMax:"2", marketCapMin:"5" } },
  { label: "Growth",        f: { sector:"Technology", epsGrowthMin:"20", roeMin:"15" } },
  { label: "Dividendi",     f: { divYieldMin:"3", deMax:"1" } },
  { label: "Oversold",      f: { rsiMax:"30" } },
  { label: "Momentum",      f: { changeMin:"2", exchange:"USA" } },
  { label: "Near 52W Low",  f: { dist52WLowMax:"5" } },
  { label: "Italia",        f: { exchange:"ITALIA" } },
  { label: "Europa",        f: { exchange:"EUROPA" } },
];

const DEFAULT_F = {
  sector:"", exchange:"USA", marketCapMin:"", marketCapMax:"", limit:20,
  priceMin:"", priceMax:"",
  roeMin:"", marginMin:"", pbMax:"", deMax:"", epsGrowthMin:"", divYieldMin:"",
  rsiMin:"", rsiMax:"",
  changeMin:"", changeMax:"",
  dist52WHighMax:"", dist52WLowMax:"",
  betaFilter:"",
  volMin:"",
};

/* ─── Column definitions ─────────────────────────────────────────────────── */
const ALL_COLS = [
  { key:"symbol",           label:"Ticker",      sort:null,              req:true },
  { key:"companyName",      label:"Azienda",     sort:null,              req:true },
  { key:"sector",           label:"Settore",     sort:null,              def:true },
  { key:"exchange",         label:"Borsa",       sort:null,              def:true },
  { key:"marketCap",        label:"Market Cap",  sort:"marketCap",       def:true },
  { key:"price",            label:"Prezzo",      sort:"price",           def:true },
  { key:"changePercentage", label:"Var%",        sort:"changePercentage",def:true },
  { key:"pe",               label:"P/E",         sort:"pe",              def:true },
  { key:"roe",              label:"ROE",         sort:"roe",             def:true },
  { key:"rsi",              label:"RSI",         sort:"rsi",             def:true },
  { key:"margin",           label:"Margine",     sort:"margin",          def:false },
  { key:"pb",               label:"P/B",         sort:"pb",              def:false },
  { key:"de",               label:"D/E",         sort:"de",              def:false },
  { key:"divYield",         label:"Div. Yield",  sort:"divYield",        def:false },
  { key:"beta",             label:"Beta",        sort:"beta",            def:false },
  { key:"high52w",          label:"52W H%",      sort:"high52w",         def:false },
  { key:"low52w",           label:"52W L%",      sort:"low52w",          def:false },
  { key:"epsGrowth",        label:"EPS Cresc.",  sort:"epsGrowth",       def:false },
  { key:"volume",           label:"Volume",      sort:"volume",          def:false },
  { key:"actions",          label:"",            sort:null,              req:true },
];

const DEFAULT_VIS = Object.fromEntries(ALL_COLS.map(c => [c.key, !!(c.req || c.def)]));

/* ─── Sort value getter ──────────────────────────────────────────────────── */
function getVal(s, col) {
  const r = s._ratios;
  switch (col) {
    case "marketCap":        return s.marketCap;
    case "price":            return s.price;
    case "changePercentage": return s.changePercentage;
    case "pe":               return r?.peRatioTTM;
    case "roe":              return r?.returnOnEquityTTM;
    case "margin":           return r?.netProfitMarginTTM;
    case "pb":               return r?.priceToBookRatioTTM;
    case "de":               return r?.debtEquityRatioTTM;
    case "divYield":         return r?.dividendYielTTM;
    case "beta":             return s.beta;
    case "high52w":          return s.yearHigh && s.price ? (s.price - s.yearHigh) / s.yearHigh * 100 : null;
    case "low52w":           return s.yearLow  && s.price ? (s.price - s.yearLow)  / s.yearLow  * 100 : null;
    case "epsGrowth":        return r?.epsGrowth;
    case "volume":           return s.volume;
    case "rsi":              return s.rsi;
    default:                 return null;
  }
}

/* ─── SVG sort icon ──────────────────────────────────────────────────────── */
function SortIcon({ active, asc }) {
  if (!active) return (
    <svg width="9" height="12" viewBox="0 0 9 12" style={{ opacity:.2, marginLeft:3, verticalAlign:"middle" }}>
      <path d="M4.5 0L9 5H0L4.5 0Z" fill="currentColor" />
      <path d="M4.5 12L0 7H9L4.5 12Z" fill="currentColor" />
    </svg>
  );
  return asc ? (
    <svg width="9" height="7" viewBox="0 0 9 7" style={{ color:"var(--blue)", marginLeft:3, verticalAlign:"middle" }}>
      <path d="M4.5 0L9 7H0L4.5 0Z" fill="currentColor" />
    </svg>
  ) : (
    <svg width="9" height="7" viewBox="0 0 9 7" style={{ color:"var(--blue)", marginLeft:3, verticalAlign:"middle" }}>
      <path d="M4.5 7L0 0H9L4.5 7Z" fill="currentColor" />
    </svg>
  );
}

/* ─── Cell renderer ──────────────────────────────────────────────────────── */
function Cell({ colKey, s, onAnalyze }) {
  const { t, lang } = useLang();
  const r = s._ratios;
  const ratPct = v => v != null ? (v * 100).toFixed(1) + "%" : "—";
  const locSector = sec => lang === "en" ? sec : (SECTOR_IT[sec] || sec);

  switch (colKey) {
    case "symbol":
      return <span style={{ fontWeight:700, color:"var(--blue)", fontFamily:"monospace" }}>{s.symbol}</span>;
    case "companyName":
      return <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight:500, maxWidth:150 }}>{s.companyName}</div>;
    case "sector":
      return <span className="pill pill-blue" style={{ fontSize:11, whiteSpace:"nowrap" }}>{locSector(s.sector)}</span>;
    case "exchange":
      return <span style={{ fontSize:12, color:"var(--text2)" }}>{s.exchange}</span>;
    case "marketCap":
      return <span style={{ fontFamily:"monospace" }}>{fmt.bn(s.marketCap)}</span>;
    case "price":
      return <span style={{ fontFamily:"monospace", fontWeight:600 }}>{s.price ? fmtPrice(s.price, s.currency) : "—"}</span>;
    case "changePercentage":
      return s.changePercentage != null
        ? <span className={`pill ${s.changePercentage >= 0 ? "pill-green" : "pill-red"}`}>{fmt.pct(s.changePercentage)}</span>
        : <span style={{ color:"var(--text3)" }}>—</span>;
    case "pe":
      return <span style={{ fontFamily:"monospace", fontSize:13 }}>{r?.peRatioTTM ? r.peRatioTTM.toFixed(1) : "—"}</span>;
    case "roe":
      return <span style={{ fontSize:13, fontWeight:600 }}>{ratPct(r?.returnOnEquityTTM)}</span>;
    case "margin":
      return <span style={{ fontSize:13 }}>{ratPct(r?.netProfitMarginTTM)}</span>;
    case "pb":
      return <span style={{ fontFamily:"monospace", fontSize:13 }}>{r?.priceToBookRatioTTM ? r.priceToBookRatioTTM.toFixed(2) : "—"}</span>;
    case "de":
      return <span style={{ fontFamily:"monospace", fontSize:13 }}>{r?.debtEquityRatioTTM ? r.debtEquityRatioTTM.toFixed(2) : "—"}</span>;
    case "divYield": {
      const dy = r?.dividendYielTTM;
      return <span style={{ fontSize:13, fontWeight:600, color: dy > 0 ? "var(--green)" : "var(--text3)" }}>
        {dy ? (dy * 100).toFixed(1) + "%" : "—"}
      </span>;
    }
    case "beta": {
      const b = s.beta;
      const bc = b == null ? "var(--text3)" : b < 0.8 ? "var(--green)" : b > 1.2 ? "var(--red)" : "var(--text)";
      return <span style={{ fontFamily:"monospace", fontSize:13, fontWeight:700, color:bc }}>{b != null ? b.toFixed(2) : "—"}</span>;
    }
    case "high52w": {
      if (!s.yearHigh || !s.price) return <span style={{ color:"var(--text3)" }}>—</span>;
      const d = +((s.price - s.yearHigh) / s.yearHigh * 100).toFixed(1);
      const col = d > -3 ? "var(--green)" : d > -10 ? "var(--gold)" : "var(--red)";
      return <span style={{ fontSize:13, fontWeight:700, color:col }}>{d > 0 ? "+" : ""}{d}%</span>;
    }
    case "low52w": {
      if (!s.yearLow || !s.price) return <span style={{ color:"var(--text3)" }}>—</span>;
      const d = +((s.price - s.yearLow) / s.yearLow * 100).toFixed(1);
      const col = d < 5 ? "var(--green)" : d < 20 ? "var(--gold)" : "var(--text2)";
      return <span style={{ fontSize:13, fontWeight:700, color:col }}>+{d}%</span>;
    }
    case "epsGrowth": {
      const eg = r?.epsGrowth;
      if (eg == null) return <span style={{ color:"var(--text3)" }}>—</span>;
      const col = eg < 0 ? "var(--red)" : eg > 15 ? "var(--green)" : "var(--gold)";
      return <span style={{ fontSize:13, fontWeight:600, color:col }}>{eg > 0 ? "+" : ""}{eg.toFixed(1)}%</span>;
    }
    case "volume":
      return <span style={{ fontFamily:"monospace", fontSize:13 }}>{s.volume ? fmt.bn(s.volume) : "—"}</span>;
    case "rsi": {
      const rc = s.rsi == null ? "var(--text3)" : s.rsi < 30 ? "var(--green)" : s.rsi > 70 ? "var(--red)" : "var(--text2)";
      return <span style={{ fontFamily:"monospace", fontSize:13, fontWeight:700, color:rc }}>{s.rsi != null ? s.rsi.toFixed(0) : "—"}</span>;
    }
    case "actions":
      return <button className="btn btn-blue btn-sm" onClick={() => onAnalyze(s.symbol)}>{t("screener.analyzeBtn")}</button>;
    default:
      return <span style={{ color:"var(--text3)" }}>—</span>;
  }
}

/* ─── Column toggle dropdown ─────────────────────────────────────────────── */
function ColsDropdown({ visible, onChange }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const colLabels = t("screener.cols");
  const toggleable = ALL_COLS.filter(c => !c.req);
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)} style={{ display:"flex", alignItems:"center", gap:6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="18" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>
        {t("screener.columns")}
      </button>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:200, background:"var(--surface)", border:"1px solid var(--border2)", borderRadius:14, padding:"14px 16px", minWidth:200, boxShadow:"0 12px 32px rgba(0,0,0,.18)" }}>
          <p style={{ fontSize:11, fontWeight:700, color:"var(--text3)", marginBottom:10, letterSpacing:".06em" }}>{t("screener.colsTitle")}</p>
          {toggleable.map(c => (
            <label key={c.key} style={{ display:"flex", alignItems:"center", gap:10, padding:"5px 0", cursor:"pointer", fontSize:13, userSelect:"none" }}>
              <input type="checkbox" checked={!!visible[c.key]} onChange={e => onChange({ ...visible, [c.key]: e.target.checked })}
                style={{ width:15, height:15, accentColor:"var(--blue)", cursor:"pointer" }} />
              {colLabels[c.key] || c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Filter field wrapper ───────────────────────────────────────────────── */
function FF({ label, children }) {
  return (
    <div>
      <p style={{ fontSize:10, fontWeight:700, color:"var(--text3)", marginBottom:5, letterSpacing:".05em" }}>{label}</p>
      {children}
    </div>
  );
}

/* ─── Section label ──────────────────────────────────────────────────────── */
function SL({ children }) {
  return <div style={{ fontSize:10, fontWeight:700, color:"var(--text3)", letterSpacing:".08em", marginBottom:10, marginTop:4, paddingBottom:6, borderBottom:"1px solid var(--border2)" }}>{children}</div>;
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function Screener({ onAnalyze }) {
  const { t, lang } = useLang();
  const [f, setF] = useState(DEFAULT_F);
  const [res, setRes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [savedFilters, setSavedFilters] = useLocalStorage("saved_screener_filters", null);
  const [sort, setSort] = useState({ col: "marketCap", asc: false });
  const [visibleCols, setVisibleCols] = useLocalStorage("screener_cols_v2", DEFAULT_VIS);

  const sf = (k, v) => setF(p => ({ ...p, [k]: v }));
  const markets = t("screener.markets");
  const filters = t("screener.filters");
  const sections = t("screener.sections");
  const betaOpts = t("screener.betaOptions");
  const colLabels = t("screener.cols");
  const locSector = sec => lang === "en" ? sec : (SECTOR_IT[sec] || sec);

  /* ─── Client-side filter ─ */
  const applyFilters = (results) =>
    results.filter(s => {
      const r = s._ratios;
      // price range
      if (f.priceMin && s.price != null && s.price < +f.priceMin) return false;
      if (f.priceMax && s.price != null && s.price > +f.priceMax) return false;
      // fundamentals
      if (f.roeMin       && r?.returnOnEquityTTM   != null && r.returnOnEquityTTM   * 100 < +f.roeMin)      return false;
      if (f.marginMin    && r?.netProfitMarginTTM  != null && r.netProfitMarginTTM  * 100 < +f.marginMin)   return false;
      if (f.pbMax        && r?.priceToBookRatioTTM != null && r.priceToBookRatioTTM >     +f.pbMax)          return false;
      if (f.deMax        && r?.debtEquityRatioTTM  != null && r.debtEquityRatioTTM  >     +f.deMax)          return false;
      if (f.epsGrowthMin && r?.epsGrowth           != null && r.epsGrowth            <     +f.epsGrowthMin)  return false;
      if (f.divYieldMin  && +f.divYieldMin > 0) {
        if (!r?.dividendYielTTM || r.dividendYielTTM * 100 < +f.divYieldMin) return false;
      }
      // RSI range
      if (f.rsiMin && s.rsi != null && s.rsi < +f.rsiMin) return false;
      if (f.rsiMax && s.rsi != null && s.rsi > +f.rsiMax) return false;
      // change %
      if (f.changeMin && s.changePercentage != null && s.changePercentage < +f.changeMin) return false;
      if (f.changeMax && s.changePercentage != null && s.changePercentage > +f.changeMax) return false;
      // volume
      if (f.volMin && s.volume != null && s.volume < +f.volMin * 1_000_000) return false;
      // beta
      if (f.betaFilter && s.beta != null) {
        if (f.betaFilter === "low"    && s.beta >= 0.8)               return false;
        if (f.betaFilter === "medium" && (s.beta < 0.8 || s.beta > 1.2)) return false;
        if (f.betaFilter === "high"   && s.beta <= 1.2)               return false;
      }
      // 52W distances
      if (f.dist52WHighMax && s.yearHigh && s.price) {
        if ((s.yearHigh - s.price) / s.yearHigh * 100 > +f.dist52WHighMax) return false;
      }
      if (f.dist52WLowMax && s.yearLow && s.price) {
        if ((s.price - s.yearLow) / s.yearLow * 100 > +f.dist52WLowMax) return false;
      }
      return true;
    });

  /* ─── Sort (3-state) ─ */
  const onSort = col => setSort(s => {
    if (s.col !== col) return { col, asc: true };
    if (s.asc)         return { col, asc: false };
    return { col: null, asc: true };
  });

  const sorted = useMemo(() => {
    const filtered = applyFilters(res);
    if (!sort.col) return filtered;
    return [...filtered].sort((a, b) => {
      const va = getVal(a, sort.col), vb = getVal(b, sort.col);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sort.asc ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
    });
  }, [res, f, sort]);

  /* ─── Fetch ─ */
  const run = async () => {
    setLoading(true); setRes([]); setSearched(true);
    const p = {};
    if (f.sector)       p.sector       = f.sector;
    if (f.exchange)     p.exchange     = f.exchange;
    if (f.marketCapMin) p.marketCapMin = f.marketCapMin;
    if (f.marketCapMax) p.marketCapMax = f.marketCapMax;
    p.limit = f.limit;
    const data = await API.screen(p);
    setRes(data || []);
    setFetchedAt(data?.[0]?.fetchedAt || Date.now());
    setLoading(false);
  };

  const applyPreset = p => setF({ ...DEFAULT_F, ...p.f });
  const visibleColDefs = ALL_COLS.filter(c => c.req || visibleCols[c.key]);
  const mLabel = m => markets.find(x => x.value === m)?.label?.replace(/^[^ ]+ /, '') || '';

  return (
    <div className="fade page-pad" style={{ padding:"28px 0" }}>
      <h1 className="page-title" style={{ fontSize:28, fontWeight:800, letterSpacing:"-.04em", marginBottom:20 }}>{t("screener.title")}</h1>

      {/* Quick presets */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
        {QUICK_PRESETS.map(p => (
          <button key={p.label} onClick={() => applyPreset(p)} className="btn btn-ghost btn-sm" style={{ fontSize:12, fontWeight:600 }}>{p.label}</button>
        ))}
      </div>

      {/* Filter panel */}
      <div className="card" style={{ padding:"22px 24px", marginBottom:24 }}>

        {/* Market */}
        <SL>{sections.market}</SL>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(148px,1fr))", gap:12, marginBottom:18 }}>
          <FF label={filters.sector}>
            <select className="input" value={f.sector} onChange={e => sf("sector", e.target.value)}>
              <option value="">{t("screener.allSectors")}</option>
              {SECTORS_LIST.map(s => <option key={s} value={s}>{locSector(s)}</option>)}
            </select>
          </FF>
          <FF label={filters.market}>
            <select className="input" value={f.exchange} onChange={e => sf("exchange", e.target.value)}>
              {markets.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </FF>
          <FF label={filters.capMin}><input className="input" type="number" placeholder="10"  value={f.marketCapMin} onChange={e => sf("marketCapMin", e.target.value)} /></FF>
          <FF label={filters.capMax}><input className="input" type="number" placeholder="500" value={f.marketCapMax} onChange={e => sf("marketCapMax", e.target.value)} /></FF>
          <FF label={filters.priceMin}><input className="input" type="number" placeholder="5"   value={f.priceMin}    onChange={e => sf("priceMin",    e.target.value)} /></FF>
          <FF label={filters.priceMax}><input className="input" type="number" placeholder="200" value={f.priceMax}    onChange={e => sf("priceMax",    e.target.value)} /></FF>
          <FF label={filters.results}>
            <select className="input" value={f.limit} onChange={e => sf("limit", e.target.value)}>
              {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </FF>
        </div>

        {/* Fundamentals */}
        <SL>{sections.fundamentals}</SL>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(148px,1fr))", gap:12, marginBottom:18 }}>
          <FF label={filters.roeMin}><input className="input" type="number" placeholder="15" value={f.roeMin}       onChange={e => sf("roeMin",       e.target.value)} /></FF>
          <FF label={filters.marginMin}><input className="input" type="number" placeholder="10" value={f.marginMin}   onChange={e => sf("marginMin",    e.target.value)} /></FF>
          <FF label={filters.pbMax}><input className="input" type="number" placeholder="3"   value={f.pbMax}        onChange={e => sf("pbMax",        e.target.value)} /></FF>
          <FF label={filters.deMax}><input className="input" type="number" placeholder="1.5" value={f.deMax}        onChange={e => sf("deMax",        e.target.value)} /></FF>
          <FF label={filters.epsGrowthMin}><input className="input" type="number" placeholder="10" value={f.epsGrowthMin} onChange={e => sf("epsGrowthMin", e.target.value)} /></FF>
          <FF label={filters.divYieldMin}><input className="input" type="number" placeholder="3"  value={f.divYieldMin}  onChange={e => sf("divYieldMin",  e.target.value)} /></FF>
        </div>

        {/* Technical */}
        <SL>{sections.technical}</SL>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(148px,1fr))", gap:12 }}>
          <FF label={filters.rsiMin}><input className="input" type="number" placeholder="30" value={f.rsiMin}  onChange={e => sf("rsiMin",  e.target.value)} /></FF>
          <FF label={filters.rsiMax}><input className="input" type="number" placeholder="70" value={f.rsiMax}  onChange={e => sf("rsiMax",  e.target.value)} /></FF>
          <FF label={filters.changeMin}><input className="input" type="number" placeholder="-2" value={f.changeMin} onChange={e => sf("changeMin", e.target.value)} /></FF>
          <FF label={filters.changeMax}><input className="input" type="number" placeholder="+5" value={f.changeMax} onChange={e => sf("changeMax", e.target.value)} /></FF>
          <FF label={filters.volMin}><input className="input" type="number" placeholder="1" value={f.volMin} onChange={e => sf("volMin", e.target.value)} /></FF>
          <FF label={filters.beta}>
            <select className="input" value={f.betaFilter} onChange={e => sf("betaFilter", e.target.value)}>
              <option value="">{betaOpts.all}</option>
              <option value="low">{betaOpts.low}</option>
              <option value="medium">{betaOpts.medium}</option>
              <option value="high">{betaOpts.high}</option>
            </select>
          </FF>
          <FF label={filters.dist52HighMax}><input className="input" type="number" placeholder="10" value={f.dist52WHighMax} onChange={e => sf("dist52WHighMax", e.target.value)} /></FF>
          <FF label={filters.dist52LowMax}><input className="input" type="number" placeholder="5" value={f.dist52WLowMax}  onChange={e => sf("dist52WLowMax",  e.target.value)} /></FF>
        </div>

        {/* Actions */}
        <div style={{ display:"flex", gap:8, marginTop:20, flexWrap:"wrap", alignItems:"center" }}>
          <button className="btn btn-blue" onClick={run} style={{ minWidth:160 }}>
            {loading ? <Spinner size={16} /> : <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> {t("screener.run")}</>}
          </button>
          <ColsDropdown visible={visibleCols} onChange={setVisibleCols} />
          <button className="btn btn-ghost btn-sm" onClick={() => setSavedFilters({ ...f })} style={{display:"inline-flex",alignItems:"center",gap:5}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {t("screener.save")}
          </button>
          {savedFilters && <button className="btn btn-ghost btn-sm" onClick={() => setF({ ...DEFAULT_F, ...savedFilters })} style={{display:"inline-flex",alignItems:"center",gap:5}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            {t("screener.load")}
          </button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setF(DEFAULT_F)}>✕ {t("common.reset")}</button>
        </div>
      </div>

      {/* Loading */}
      {loading && <div style={{ textAlign:"center", padding:"48px" }}><Spinner size={32} /></div>}

      {/* Timestamp banner */}
      {!loading && searched && sorted.length > 0 && fetchedAt && (() => {
        const ageMin = Math.floor((Date.now() - fetchedAt) / 60000);
        const locale = lang === "en" ? "en-US" : "it-IT";
        const timeStr = new Date(fetchedAt).toLocaleTimeString(locale, { hour:"2-digit", minute:"2-digit" });
        const stale = ageMin > 30;
        const ts = t("screener.timestamp");
        return (
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", marginBottom:12, borderRadius:8, background: stale ? "var(--red-light)" : "var(--surface2)", border: `1px solid ${stale ? "rgba(239,83,80,0.2)" : "var(--border2)"}`, fontSize:12 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={stale?"var(--red)":"var(--text3)"} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style={{ color: stale ? "var(--red)" : "var(--text3)" }}>
              {stale ? t("screener.timestamp.stale", { min: ageMin }) : t("screener.timestamp.updated", { time: timeStr })}
            </span>
            {stale && <button className="btn btn-sm" style={{marginLeft:"auto",padding:"3px 10px",fontSize:11,background:"var(--red)",color:"#fff"}} onClick={run}>{ts.reload}</button>}
          </div>
        );
      })()}

      {/* Results */}
      {!loading && sorted.length > 0 && (
        <div className="card" style={{ padding:0, overflow:"hidden" }}>
          <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--border2)", fontSize:13, color:"var(--text2)", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span style={{ fontWeight:600 }}>{t("screener.results", { n: sorted.length })}</span>
            {res.length !== sorted.length && <span style={{ fontSize:12, color:"var(--text3)" }}>{t("screener.resultsFiltered", { total: res.length, filtered: res.length - sorted.length })}</span>}
            {f.exchange && <span style={{ fontSize:12, color:"var(--blue)", fontWeight:600 }}>{mLabel(f.exchange)}</span>}
          </div>
          <div style={{ overflowX:"auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  {visibleColDefs.map(c => (
                    <th key={c.key}
                      onClick={c.sort ? () => onSort(c.sort) : undefined}
                      style={{
                        cursor: c.sort ? "pointer" : undefined,
                        userSelect: "none",
                        whiteSpace: "nowrap",
                        color: sort.col === c.sort ? "var(--blue)" : undefined,
                        fontWeight: sort.col === c.sort ? 700 : 600,
                      }}>
                      {colLabels[c.key] || c.label}
                      {c.sort && <SortIcon active={sort.col === c.sort} asc={sort.asc} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => (
                  <tr key={i}>
                    {visibleColDefs.map(c => (
                      <td key={c.key}>
                        <Cell colKey={c.key} s={s} onAnalyze={onAnalyze} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && searched && sorted.length === 0 && (
        <div style={{ textAlign:"center", padding:"72px 0", color:"var(--text3)" }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </div>
          <div style={{fontWeight:500}}>{t("screener.empty.noResults")}</div>
          <div style={{fontSize:13,marginTop:6}}>{t("screener.empty.tip")}</div>
        </div>
      )}
      {!loading && !searched && (
        <div style={{ textAlign:"center", padding:"72px 0", color:"var(--text3)" }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          </div>
          <div style={{fontWeight:500, color:"var(--text)"}}>{t("screener.initial.hint")}</div>
        </div>
      )}
    </div>
  );
}
