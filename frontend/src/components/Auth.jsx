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

/* ─── Animated chart mock ─────────────────────────────────────────────────── */
const CHART_PATH = "M50,132 L72,127 L94,140 L116,124 L138,118 L160,131 L182,119 L204,111 L226,122 L248,113 L270,100 L292,106 L314,92 L336,84 L358,91 L380,78 L402,70 L424,76 L446,62 L468,54 L490,59 L512,47 L534,41";
const CHART_AREA = CHART_PATH + " L534,153 L50,153 Z";
const VOL_H      = [18,24,16,30,22,28,15,32,24,26,19,34,20,27,36];
const YGRID      = [30, 62, 94, 126, 153];
const YPRICES    = ["$214", "$210", "$206", "$202", "$198"];
const XTIMES     = ["09:30","10:30","11:30","12:30","13:30"];
const XTIMES_X   = [50, 162, 274, 386, 498];

const CHART_X0 = 50, CHART_X1 = 534, CHART_Y0 = 30, CHART_Y1 = 153;
const VOL_BASE_Y = 197, VOL_MAX_H = 36;
const CHART_REFRESH_MS = 5 * 60 * 1000;

/** Builds SVG geometry (price line, area fill, volume bars, axis labels) from real daily history (oldest → newest) */
function buildLiveChart(history) {
  const n = history.length;
  const closes = history.map(d => d.close);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
  const yMin = lo - pad, yMax = hi + pad;
  const xStep = n > 1 ? (CHART_X1 - CHART_X0) / (n - 1) : 0;

  const pts = closes.map((c, i) => [
    CHART_X0 + i * xStep,
    CHART_Y1 - ((c - yMin) / (yMax - yMin)) * (CHART_Y1 - CHART_Y0),
  ]);

  const pathD = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${pts[n - 1][0].toFixed(1)},${CHART_Y1} L${pts[0][0].toFixed(1)},${CHART_Y1} Z`;

  const yPrices = YGRID.map(y => "$" + Math.round(yMax - ((y - CHART_Y0) / (CHART_Y1 - CHART_Y0)) * (yMax - yMin)));

  const xLabels = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const i = Math.round((n - 1) * f);
    return new Date(history[i].date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
  });

  const volumes = history.map(d => d.volume || 0);
  const maxVol = Math.max(...volumes, 1);
  const barGap = (CHART_X1 - CHART_X0) / n;
  const barW = Math.max(2, barGap * 0.6);
  const volBars = volumes.map((v, i) => ({
    x: CHART_X0 + i * barGap + (barGap - barW) / 2,
    h: Math.max(2, (v / maxVol) * VOL_MAX_H),
    w: barW,
  }));

  return { pathD, areaD, yPrices, xLabels, volBars, last: pts[n - 1], first: pts[0] };
}

function ChartPreview() {
  const [cents, setCents]   = useState(20729);
  const [prev,  setPrev]    = useState(20729);
  const [live,  setLive]    = useState(null); // { quote, geo } once real NVDA data has loaded
  const BASE_P              = 21858;

  // Fallback simulated price — only visible until/unless real data loads
  useEffect(() => {
    const t = setInterval(() => {
      setCents(p => {
        setPrev(p);
        const d = Math.round((Math.random() - 0.46) * 35);
        return Math.max(20400, Math.min(22200, p + d));
      });
    }, 2200);
    return () => clearInterval(t);
  }, []);

  // Real NVDA price + last 30 days history from the backend (Yahoo Finance), refreshed every 5 minutes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const from = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      const [q, h] = await Promise.all([apiGet("/quote/NVDA"), apiGet(`/history/NVDA?from=${from}`)]);
      if (cancelled) return;
      const quote   = Array.isArray(q) ? q[0] : q;
      const history = Array.isArray(h) ? h : [];
      if (quote?.price && history.length > 1) {
        setLive({ quote, geo: buildLiveChart(history) });
      }
    }
    load();
    const t = setInterval(load, CHART_REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  let price, chgAbs, chgPct, upTotal, pathD, areaD, yPrices, xLabels, volBars, dotX, dotY, refY, label;

  if (live) {
    const { quote, geo } = live;
    price   = quote.price.toFixed(2);
    chgAbs  = (quote.change ?? 0).toFixed(2);
    chgPct  = (quote.changePercentage ?? 0).toFixed(2);
    upTotal = (quote.change ?? 0) >= 0;
    ({ pathD, areaD, yPrices, xLabels, volBars } = geo);
    [dotX, dotY] = geo.last;
    refY  = geo.first[1];
    label = "NASDAQ · Ultimi 30gg";
  } else {
    price   = (cents / 100).toFixed(2);
    chgAbs  = ((cents - BASE_P) / 100).toFixed(2);
    chgPct  = ((cents - BASE_P) / BASE_P * 100).toFixed(2);
    upTotal = cents >= BASE_P;
    pathD   = CHART_PATH;
    areaD   = CHART_AREA;
    yPrices = YPRICES;
    xLabels = XTIMES;
    volBars = VOL_H.map((h, i) => ({ x: 52 + i * 32.5, h, w: 20 }));
    dotX = 534; dotY = 41;
    refY = 132;
    label = "NASDAQ · Intraday";
  }

  return (
    <div style={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, overflow: "hidden", maxHeight: 320, boxShadow: "0 12px 28px rgba(0,0,0,0.28)" }}>
      {/* Ticker header */}
      <div style={{ padding: "16px 22px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative", width: 10, height: 10 }}>
            <div style={{ position: "absolute", width: 8, height: 8, borderRadius: "50%", background: "#00c853", top: 1, left: 1 }} />
            <div className="iv-live-ring" style={{ position: "absolute", width: 10, height: 10, borderRadius: "50%", background: "rgba(0,200,83,0.35)" }} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 800, color: "white", letterSpacing: "0.02em" }}>NVDA</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", fontWeight: 500, letterSpacing: "0.03em" }}>{label}</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "white", letterSpacing: "-0.03em", lineHeight: 1.1 }}>${price}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: upTotal ? "#00c853" : "#ff3b30", marginTop: 2 }}>
            {upTotal ? "+" : ""}{chgAbs} ({upTotal ? "+" : ""}{chgPct}%)
          </div>
        </div>
      </div>

      {/* SVG chart */}
      <div style={{ padding: "4px 0 14px" }}>
        <svg viewBox="0 0 590 215" style={{ width: "100%", display: "block" }}>
          <defs>
            <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#2962FF" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#2962FF" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Horizontal grid */}
          {YGRID.map(y => (
            <line key={y} x1="48" y1={y} x2="545" y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          ))}
          {/* Vertical grid */}
          {XTIMES_X.slice(1, -1).map(x => (
            <line key={x} x1={x} y1="30" x2={x} y2="153" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          ))}

          {/* Y labels */}
          {YGRID.map((y, i) => (
            <text key={y} x="6" y={y + 4} fontSize="10" fill="rgba(255,255,255,0.22)" fontFamily="-apple-system,sans-serif">{yPrices[i]}</text>
          ))}

          {/* Area fill */}
          <path d={areaD} fill="url(#cg)" />

          {/* Price line — draws itself on mount */}
          <path d={pathD} stroke="#2962FF" strokeWidth="2.5" fill="none"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="1200"
            style={{ animation: "ivDrawLine 2.6s cubic-bezier(.22,1,.36,1) forwards" }}
          />

          {/* Reference line (price at start of period) */}
          <line x1={CHART_X0} y1={refY} x2={CHART_X1} y2={refY} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3 5" />

          {/* Current price live dot */}
          <circle cx={dotX} cy={dotY} r="4.5" fill="#00c853" />
          <circle cx={dotX} cy={dotY} r="10" fill="#00c853"
            style={{ animation: "ivPulseOut 2s ease-out infinite", transformBox: "fill-box", transformOrigin: "center" }}
          />

          {/* Volume bars */}
          {volBars.map((b, i) => (
            <rect key={i} x={b.x} y={VOL_BASE_Y - b.h} width={b.w} height={b.h} fill="rgba(41,98,255,0.2)" rx="1.5" />
          ))}

          {/* X labels */}
          {XTIMES_X.map((x, i) => (
            <text key={x} x={x} y="213" fontSize="10" fill="rgba(255,255,255,0.22)" fontFamily="-apple-system,sans-serif" textAnchor="middle">{xLabels[i]}</text>
          ))}
        </svg>
      </div>
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
  @keyframes ivPulseOut { 0%   { opacity: 0.7; transform: scale(0.5); } 100% { opacity: 0; transform: scale(2.2); } }
  @keyframes ivLiveRing { 0%   { opacity: 0.8; transform: scale(0.6); } 100% { opacity: 0; transform: scale(1.4); } }
  @keyframes ivFadeUp   { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
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
  @media (max-width: 940px)  { .iv-hero { flex-direction: column !important; gap: 40px !important; padding-top: 110px !important; } .iv-text-col { flex: 0 0 auto !important; max-width: 100% !important; } .iv-chart-col { flex: 0 0 auto !important; width: 100% !important; max-width: 360px !important; margin: 0 auto !important; } .iv-h1 { font-size: 52px !important; } }
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
        <div style={{ maxWidth: 1200, margin: "0 auto", width: "100%", display: "flex", gap: 72, alignItems: "center", paddingTop: 58 }} className="iv-hero">

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

          {/* Right: animated chart */}
          <div style={{ flex: "0 0 45%", minWidth: 0 }} className="iv-chart-col">
            <ChartPreview />
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
