import { useState, useEffect } from "react";
import { useLang } from "../i18n.js";

const BASE = (import.meta.env.VITE_API_URL || "http://localhost:3001") + "/api";
async function apiPost(path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { error: text || "Risposta non valida dal server." }; }
  } catch {
    return { error: "Impossibile connettersi al server. Assicurati che il backend sia avviato su porta 3001." };
  }
}

async function apiGet(path) {
  try {
    const r = await fetch(`${BASE}${path}`);
    return await r.json();
  } catch { return null; }
}

/* ─── Logo ─────────────────────────────────────────────────────────────────── */
export function Logo({ size = 32 }) {
  const id = `lg${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B7EFF" />
          <stop offset="100%" stopColor="#1A4FCC" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <line x1="9"  y1="15" x2="9"  y2="19" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="7"  y="19" width="4" height="7"  rx="0.5" fill="white" />
      <line x1="9"  y1="26" x2="9"  y2="28" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="11" x2="16" y2="14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="14" y="14" width="4" height="8"  rx="0.5" fill="white" />
      <line x1="16" y1="22" x2="16" y2="24" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="23" y1="5"  x2="23" y2="8"  stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="21" y="8"  width="4" height="10" rx="0.5" fill="white" />
      <line x1="23" y1="18" x2="23" y2="21" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ─── Live mini charts (NVDA / GOOGL / RACE.MI) ──────────────────────────── */
const CHART_REFRESH_MS = 5 * 60 * 1000;
const CCY_SYMBOL = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" };
const MINI_VB_W = 300, MINI_VB_H = 100;
const MINI_X0 = 0, MINI_X1 = 300, MINI_Y0 = 4, MINI_Y1 = 96;

/** Smooth cubic-bezier path through points (horizontal control points = no jagged spikes) */
function smoothPath(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const mx = (x0 + x1) / 2;
    d += ` C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/** Formats an ISO "YYYY-MM-DD" date string as "gg/mm" without timezone shifting */
function formatDDMM(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : "";
}

/** Builds a smooth line + area path from the last 30 days of history (API returns newest → oldest) */
function buildMiniChart(history, symbol) {
  const ordered = (history || [])
    .filter(d => d && Number.isFinite(d.close) && d.close > 0)
    .slice(0, 30)
    .reverse(); // oldest -> newest

  const n = ordered.length;
  if (n < 2) return null;

  const closes = ordered.map(d => d.close);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const range = hi - lo;
  const pad = range > 0 ? range * 0.1 : (hi * 0.01 || 1);
  const yMin = lo - pad, yMax = hi + pad;
  const xStep = (MINI_X1 - MINI_X0) / (n - 1);

  const pts = closes.map((c, i) => [
    MINI_X0 + i * xStep,
    MINI_Y1 - ((c - yMin) / (yMax - yMin)) * (MINI_Y1 - MINI_Y0),
  ]);

  const pathD = smoothPath(pts);
  const areaD = `${pathD} L${pts[n - 1][0].toFixed(1)},${MINI_Y1} L${pts[0][0].toFixed(1)},${MINI_Y1} Z`;

  // eslint-disable-next-line no-console
  console.log(`[MiniChart ${symbol}] dati reali 1mese (${n} gg, ${ordered[0].date} -> ${ordered[n - 1].date}):`, ordered);

  return {
    pathD, areaD, last: pts[n - 1],
    yLabels: [hi, (hi + lo) / 2, lo],
    xLabels: [ordered[0].date, ordered[Math.floor((n - 1) / 2)].date, ordered[n - 1].date],
  };
}

/** Compact live ticker card: symbol, exchange, price, change% and a mini line chart */
function MiniChart({ symbol, exchange }) {
  const [live, setLive] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const from = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      const [q, h] = await Promise.all([apiGet(`/quote/${symbol}`), apiGet(`/history/${symbol}?from=${from}`)]);
      if (cancelled) return;
      const quote   = Array.isArray(q) ? q[0] : q;
      const history = Array.isArray(h) ? h : [];
      const geo = quote?.price ? buildMiniChart(history, symbol) : null;
      if (geo) setLive({ quote, geo });
    }
    load();
    const t = setInterval(load, CHART_REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [symbol]);

  const quote  = live?.quote;
  const up     = (quote?.change ?? 0) >= 0;
  const color  = up ? "#00c853" : "#ff3b30";
  const ccy    = CCY_SYMBOL[quote?.currency] || "$";
  const gradId = `mg-${symbol.replace(/[^A-Za-z0-9]/g, "")}`;

  const AXIS_COL = 34; // width reserved (within left padding) for the Y-axis price labels

  return (
    <div style={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden", height: 160, boxSizing: "border-box", boxShadow: "0 8px 20px rgba(0,0,0,0.24)", display: "flex", flexDirection: "column", padding: "16px 18px 20px 35px" }}>
      {/* Ticker header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: "white", letterSpacing: "0.02em" }}>{symbol}</span>
        {live ? (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "white", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
              {ccy}{quote.price.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color, marginTop: 2 }}>
              {up ? "+" : ""}{(quote.changePercentage ?? 0).toFixed(2)}%
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div className="iv-skel" style={{ width: 54, height: 14, borderRadius: 4 }} />
            <div className="iv-skel" style={{ width: 36, height: 10, borderRadius: 4 }} />
          </div>
        )}
      </div>

      {/* Exchange name */}
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", fontWeight: 500, letterSpacing: "0.03em", marginTop: 2, marginBottom: 6 }}>
        {exchange}
      </div>

      {/* Chart row: Y-axis price labels (borrowed from left padding) + line chart */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", marginLeft: -AXIS_COL }}>
        {live ? (
          <>
            <div style={{ width: AXIS_COL, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-end", paddingRight: 4, boxSizing: "border-box" }}>
              {live.geo.yLabels.map((v, i) => (
                <span key={i} style={{ fontSize: 10, color: "#787b86", lineHeight: 1, whiteSpace: "nowrap" }}>
                  {ccy}{v.toFixed(0)}
                </span>
              ))}
            </div>
            <svg viewBox={`0 0 ${MINI_VB_W} ${MINI_VB_H}`} preserveAspectRatio="none" style={{ flex: 1, minWidth: 0, height: "100%", display: "block" }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={color} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={live.geo.areaD} fill={`url(#${gradId})`} />
              <path d={live.geo.pathD} stroke={color} strokeWidth="2" fill="none"
                strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
                strokeDasharray="1000"
                style={{ animation: "ivDrawLineMini 1.8s cubic-bezier(.22,1,.36,1) forwards" }}
              />
              <circle cx={live.geo.last[0]} cy={live.geo.last[1]} r="2.5" fill={color} />
            </svg>
          </>
        ) : (
          <div className="iv-skel" style={{ width: "100%", height: "100%", marginLeft: AXIS_COL }} />
        )}
      </div>

      {/* X-axis date labels, aligned under the chart */}
      {live && (
        <div style={{ display: "flex", marginLeft: -AXIS_COL, marginTop: 4 }}>
          <div style={{ width: AXIS_COL, flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", justifyContent: "space-between" }}>
            {live.geo.xLabels.map((d, i) => (
              <span key={i} style={{ fontSize: 10, color: "#787b86" }}>{formatDDMM(d)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Feature icons ───────────────────────────────────────────────────────── */
const SI = { width:20, height:20, viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:"1.9", strokeLinecap:"round", strokeLinejoin:"round" };

const FEATURES = [
  {
    icon: <svg {...SI}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    title: "Real-Time Data",
    desc: "Prezzi live al secondo da NYSE, NASDAQ, Borsa di Milano, Tokyo e 50+ mercati.",
  },
  {
    icon: <svg {...SI}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"/></svg>,
    title: "AI Analysis",
    desc: "Analisi fondamentale e tecnica automatica con Gemini AI, in italiano.",
  },
  {
    icon: <svg {...SI}><path d="M4 22V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16"/><path d="M9 8h6M9 12h6M9 16h4"/><line x1="4" y1="22" x2="20" y2="22"/></svg>,
    title: "Live News",
    desc: "Notizie filtrate con sentiment AI specifiche per ogni titolo che segui.",
  },
  {
    icon: <svg {...SI}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    title: "Advanced Charts",
    desc: "Grafici a candele giapponesi con volumi, MA50, MA200 e RSI integrati.",
  },
  {
    icon: <svg {...SI}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
    title: "Global Markets",
    desc: "Azioni, ETF, futures, crypto e valute da ogni borsa del pianeta.",
  },
  {
    icon: <svg {...SI}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
    title: "Smart Screener",
    desc: "Filtra migliaia di titoli per P/E, crescita EPS, dividend yield e oltre.",
  },
];

/* ─── Global CSS ──────────────────────────────────────────────────────────── */
const CSS = `
  html, body { margin: 0; padding: 0; background: #080d18; }
  @keyframes ivDrawLine { from { stroke-dashoffset: 1200; } to { stroke-dashoffset: 0; } }
  @keyframes ivDrawLineMini { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
  @keyframes ivPulseOut { 0%   { opacity: 0.7; transform: scale(0.5); } 100% { opacity: 0; transform: scale(2.2); } }
  @keyframes ivLiveRing { 0%   { opacity: 0.8; transform: scale(0.6); } 100% { opacity: 0; transform: scale(1.4); } }
  @keyframes ivFadeUp   { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes ivSkeleton { 0% { opacity: 0.35; } 50% { opacity: 0.75; } 100% { opacity: 0.35; } }
  .iv-skel  { background: rgba(255,255,255,0.08); animation: ivSkeleton 1.4s ease-in-out infinite; }
  .iv-page  { animation: ivFadeUp 0.5s cubic-bezier(.22,1,.36,1); }
  .iv-live-ring { animation: ivLiveRing 2s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  .iv-feat  { transition: border-color 0.2s, box-shadow 0.2s, transform 0.22s; }
  .iv-feat:hover { border-color: rgba(41,98,255,0.5) !important; box-shadow: 0 0 28px rgba(41,98,255,0.12), 0 12px 40px rgba(0,0,0,0.4) !important; transform: translateY(-3px) !important; }
  .iv-btn-p { transition: all 0.18s; }
  .iv-btn-p:hover { background: #3b7eff !important; transform: translateY(-1px); box-shadow: 0 10px 32px rgba(41,98,255,0.45) !important; }
  .iv-btn-g { transition: all 0.18s; }
  .iv-btn-g:hover { background: rgba(255,255,255,0.13) !important; }
  .iv-nav-login { transition: all 0.18s; }
  .iv-nav-login:hover { background: rgba(41,98,255,0.25) !important; color: white !important; }
  .iv-inp:focus { border-color: rgba(59,126,255,0.6) !important; box-shadow: 0 0 0 3px rgba(41,98,255,0.14) !important; outline: none; }
  .iv-inp::placeholder { color: rgba(255,255,255,0.25); }
  .iv-sub:hover:not(:disabled) { background: #3b7eff !important; }
  @media (max-width: 940px)  { .iv-hero { flex-direction: column !important; gap: 28px !important; padding-top: 110px !important; } .iv-text-col { flex: 0 0 auto !important; max-width: 100% !important; } .iv-chart-col { flex: 0 0 auto !important; width: 100% !important; max-width: 480px !important; margin: 0 auto !important; } .iv-h1 { font-size: 52px !important; } }
  @media (max-width: 680px)  { .iv-feat-grid { grid-template-columns: 1fr !important; } .iv-reviews { flex-direction: column !important; align-items: stretch !important; } .iv-stats-row { gap: 32px !important; } .iv-h1 { font-size: 40px !important; } .iv-h2 { font-size: 32px !important; } }
  @media (max-width: 480px)  { .iv-cta-h { font-size: 30px !important; } }
`;

const PAGE_BG = {
  minHeight: "100vh",
  background: [
    "linear-gradient(150deg, #080d18 0%, #0a1020 45%, #0d1528 100%)",
    "linear-gradient(rgba(41,98,255,0.048) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(41,98,255,0.048) 1px, transparent 1px)",
  ].join(", "),
  backgroundSize: "100% 100%, 56px 56px, 56px 56px",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  color: "white",
};

/* ─── Password rules ─────────────────────────────────────────────────────── */
const PW_SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/;
const PW_UPPER_RE   = /[A-Z]/;

/* ─── Auth component ──────────────────────────────────────────────────────── */
export default function Auth({ onAuth }) {
  const [mode, setMode]         = useState("landing");
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const { t, lang, setLang }    = useLang();

  const pwChecks = {
    length:  password.length >= 8,
    upper:   PW_UPPER_RE.test(password),
    special: PW_SPECIAL_RE.test(password),
  };
  const pwValid = pwChecks.length && pwChecks.upper && pwChecks.special;

  const reset  = () => { setName(""); setEmail(""); setPassword(""); setError(""); };
  const goMode = m  => { reset(); setMode(m); window.scrollTo(0, 0); };

  const handleLogin = async e => {
    e.preventDefault(); setError(""); setLoading(true);
    const res = await apiPost("/auth/login", { email, password });
    setLoading(false);
    if (res?.success) {
      if (res.token) localStorage.setItem("investingview_token", res.token);
      onAuth(res.user);
    } else {
      setError(res?.error || "Errore di connessione. Assicurati che il backend sia avviato su porta 3001.");
    }
  };

  const handleRegister = async e => {
    e.preventDefault(); setError("");
    if (!pwValid) { setError(t("auth.pwTooWeak")); return; }
    setLoading(true);
    const res = await apiPost("/auth/register", { name, email, password });
    setLoading(false);
    if (res?.success) {
      if (res.token) localStorage.setItem("investingview_token", res.token);
      onAuth(res.user);
    } else {
      setError(res?.error || "Errore di connessione. Assicurati che il backend sia avviato su porta 3001.");
    }
  };

  /* ────────────────────────── LANDING ──────────────────────────────────── */
  if (mode === "landing") return (
    <div style={{ ...PAGE_BG, overflowX: "hidden" }} className="iv-page">
      <style>{CSS}</style>

      {/* ── Navbar ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 300,
        height: 58, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 36px",
        background: "rgba(8,13,24,0.88)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.065)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Logo size={28} />
          <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.03em" }}>InvestingView</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* IT/EN toggle */}
          <div style={{ display: "flex", gap: 4 }}>
            {["it", "en"].map(l => (
              <button key={l} onClick={() => setLang(l)} style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid", background: lang === l ? "#2962ff" : "transparent", color: lang === l ? "#fff" : "rgba(255,255,255,0.4)", borderColor: lang === l ? "#2962ff" : "rgba(255,255,255,0.2)", letterSpacing: ".04em", transition: "all .15s" }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="iv-nav-login" onClick={() => goMode("login")} style={{
            padding: "8px 22px", borderRadius: 9,
            background: "rgba(41,98,255,0.1)", border: "1px solid rgba(41,98,255,0.32)",
            color: "#4d8dff", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>{t("auth.login")}</button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ minHeight: "100vh", display: "flex", alignItems: "center", padding: "0 36px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%", display: "flex", gap: 40, alignItems: "center", paddingTop: 58 }} className="iv-hero">

          {/* Left: text */}
          <div style={{ flex: "0 0 55%", minWidth: 0 }} className="iv-text-col">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 11, marginBottom: 32 }}>
              <Logo size={42} />
              <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-0.04em" }}>InvestingView</span>
            </div>

            <h1 className="iv-h1" style={{ fontSize: 68, fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 0.95, marginBottom: 26, background: "linear-gradient(135deg, #2962FF 0%, #5b8def 60%, #7aaaff 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              {t("auth.heroTagline").split("\n").map((line, i, arr) => <span key={i}>{line}{i < arr.length - 1 && <br />}</span>)}
            </h1>

            <p style={{ fontSize: 17, color: "rgba(255,255,255,0.5)", lineHeight: 1.72, marginBottom: 40, maxWidth: 420 }}>
              {t("auth.heroSub")}
            </p>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
              <button className="iv-btn-p" onClick={() => goMode("register")} style={{
                padding: "15px 36px", borderRadius: 12, background: "#2962FF",
                color: "white", fontSize: 16, fontWeight: 700, border: "none", cursor: "pointer", letterSpacing: "-0.01em",
              }}>{t("auth.ctaStart")}</button>
              <button className="iv-btn-g" onClick={() => goMode("login")} style={{
                padding: "15px 26px", borderRadius: 12,
                background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.78)",
                fontSize: 16, fontWeight: 600, border: "1px solid rgba(255,255,255,0.13)", cursor: "pointer",
              }}>{t("auth.ctaLogin")}</button>
            </div>

            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.22)", letterSpacing: "0.01em" }}>
              {t("auth.trustLine")}
            </p>
          </div>

          {/* Right: live mini charts */}
          <div style={{ flex: "0 0 45%", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }} className="iv-chart-col">
            <MiniChart symbol="NVDA" exchange="NASDAQ" />
            <MiniChart symbol="GOOGL" exchange="NASDAQ" />
            <MiniChart symbol="RACE.MI" exchange="Borsa Milano" />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section style={{ padding: "100px 36px", borderTop: "1px solid rgba(255,255,255,0.055)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#4d8dff", letterSpacing: "0.14em", textTransform: "uppercase", textAlign: "center", marginBottom: 14 }}>{t("auth.featuresLabel")}</p>
          <h2 className="iv-h2" style={{ fontSize: 46, fontWeight: 900, textAlign: "center", letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: 16, background: "linear-gradient(135deg, #2962FF 0%, #5b8def 60%, #7aaaff 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            {t("auth.featuresTitle").split("\n").map((line, i, arr) => <span key={i}>{line}{i < arr.length - 1 && <br />}</span>)}
          </h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.38)", textAlign: "center", marginBottom: 70, maxWidth: 460, margin: "0 auto 70px" }}>
            {t("auth.featuresSub")}
          </p>

          <div className="iv-feat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
            {FEATURES.map(({ icon }, idx) => {
              const feat = t("auth.features")[idx] || {};
              return (
              <div key={idx} className="iv-feat" style={{
                padding: "30px 28px", borderRadius: 16,
                background: "rgba(255,255,255,0.028)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}>
                <div style={{ width: 46, height: 46, borderRadius: 13, background: "rgba(41,98,255,0.11)", border: "1px solid rgba(41,98,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#4d8dff", marginBottom: 20 }}>
                  {icon}
                </div>
                <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 9, letterSpacing: "-0.01em" }}>{feat.title}</p>
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", lineHeight: 1.65 }}>{feat.desc}</p>
              </div>
            )})}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={{ padding: "100px 36px", borderTop: "1px solid rgba(255,255,255,0.055)", textAlign: "center" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <h2 className="iv-cta-h" style={{ fontSize: 50, fontWeight: 900, letterSpacing: "-0.045em", lineHeight: 1.05, marginBottom: 20, background: "linear-gradient(135deg, #2962FF 0%, #5b8def 60%, #7aaaff 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            {t("auth.ctaFinalTitle").split("\n").map((line, i, arr) => <span key={i}>{line}{i < arr.length - 1 && <br />}</span>)}
          </h2>
          <p style={{ fontSize: 17, color: "rgba(255,255,255,0.4)", marginBottom: 42, lineHeight: 1.65 }}>
            {t("auth.ctaFinalSub")}
          </p>
          <button className="iv-btn-p" onClick={() => goMode("register")} style={{
            padding: "18px 52px", borderRadius: 14, background: "#2962FF",
            color: "white", fontSize: 18, fontWeight: 700, border: "none", cursor: "pointer", letterSpacing: "-0.01em",
          }}>
            {t("auth.ctaFinalBtn")}
          </button>
          <p style={{ marginTop: 18, fontSize: 13, color: "rgba(255,255,255,0.2)" }}>{t("auth.ctaFinalNote")}</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ padding: "26px 36px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Logo size={20} />
          <span style={{ color: "rgba(255,255,255,0.32)", fontSize: 13, fontWeight: 600 }}>InvestingView</span>
        </div>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.18)" }}>© 2026 InvestingView</p>
      </footer>
    </div>
  );

  /* ────────────────────────── LOGIN / REGISTER ─────────────────────────── */
  const isLogin = mode === "login";

  return (
    <div style={{ ...PAGE_BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", minHeight: "100vh", position: "relative" }} className="iv-page">
      <style>{CSS}</style>

      <button onClick={() => goMode("landing")} style={{
        position: "absolute", top: 20, left: 20, background: "transparent", border: "none",
        cursor: "pointer", color: "rgba(255,255,255,0.36)", fontSize: 14,
        display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8,
      }}>← InvestingView</button>

      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}><Logo size={44} /></div>

        <div style={{ background: "rgba(255,255,255,0.038)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, padding: "36px 32px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.035em", color: "#ffffff" }}>
            {isLogin ? t("auth.welcomeBack") : t("auth.createAccount")}
          </h2>
          <p style={{ fontSize: 14, color: "#d1d4dc", marginBottom: 28 }}>
            {isLogin ? t("auth.loginSubtitle") : t("auth.registerSubtitle")}
          </p>

          <form onSubmit={isLogin ? handleLogin : handleRegister} noValidate>
            {!isLogin && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#d1d4dc", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 7 }}>{t("auth.nameLabel")}</label>
                <input className="iv-inp" type="text" value={name} onChange={e => setName(e.target.value)} required placeholder={t("auth.namePlaceholder")}
                  style={{ width: "100%", padding: "13px 16px", borderRadius: 10, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.11)", color: "white", fontSize: 15, boxSizing: "border-box", transition: "border-color 0.15s, box-shadow 0.15s" }} />
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#d1d4dc", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 7 }}>{t("auth.emailLabel")}</label>
              <input className="iv-inp" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder={t("auth.emailPlaceholder")}
                style={{ width: "100%", padding: "13px 16px", borderRadius: 10, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.11)", color: "white", fontSize: 15, boxSizing: "border-box", transition: "border-color 0.15s, box-shadow 0.15s" }} />
            </div>
            <div style={{ marginBottom: 26 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#d1d4dc", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 7 }}>{t("auth.passwordLabel")}</label>
              <input className="iv-inp" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder={isLogin ? t("auth.passwordLoginPlaceholder") : t("auth.passwordRegisterPlaceholder")}
                style={{ width: "100%", padding: "13px 16px", borderRadius: 10, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.11)", color: "white", fontSize: 15, boxSizing: "border-box", transition: "border-color 0.15s, box-shadow 0.15s" }} />
              {!isLogin && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px", marginTop: 10 }}>
                  {[
                    [pwChecks.length,  t("auth.pwReq.length")],
                    [pwChecks.upper,   t("auth.pwReq.upper")],
                    [pwChecks.special, t("auth.pwReq.special")],
                  ].map(([ok, label], i) => (
                    <span key={i} style={{ fontSize: 12, fontWeight: 600, color: ok ? "#00c853" : "#ff7068", display: "inline-flex", alignItems: "center", gap: 5, transition: "color 0.15s" }}>
                      {ok ? "✓" : "✗"} {label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div style={{ marginBottom: 18, padding: "12px 16px", borderRadius: 10, background: "rgba(255,59,48,0.1)", border: "1px solid rgba(255,59,48,0.28)", color: "#ff7068", fontSize: 13, lineHeight: 1.5 }}>
                {error}
              </div>
            )}

            <button className="iv-sub" type="submit" disabled={loading} style={{
              width: "100%", padding: "14px", borderRadius: 11, background: "#2962FF",
              color: "white", fontSize: 16, fontWeight: 700, border: "none",
              cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, transition: "background 0.15s",
            }}>
              {loading ? t("auth.loadingAuth") : isLogin ? t("auth.submitLogin") : t("auth.submitRegister")}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: 22, fontSize: 14, color: "#d1d4dc" }}>
            {isLogin ? t("auth.switchToRegister") : t("auth.switchToLogin")}{" "}
            <button onClick={() => goMode(isLogin ? "register" : "login")}
              style={{ background: "none", border: "none", color: "#4d8dff", cursor: "pointer", fontSize: 14, fontWeight: 700, padding: 0 }}>
              {isLogin ? t("auth.register") : t("auth.login")}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
