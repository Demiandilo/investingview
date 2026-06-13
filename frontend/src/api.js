const BASE = (import.meta.env.VITE_API_URL || "http://localhost:3001") + "/api";

// ─── In-memory frontend cache (avoids redundant backend calls) ───────────────
const _fCache = new Map();
async function cachedGet(path, ttlMs = 300_000) {
  const now = Date.now();
  const hit = _fCache.get(path);
  if (hit && now - hit.ts < ttlMs) return hit.data;
  const data = await get(path);
  if (data !== null) _fCache.set(path, { data, ts: now });
  return data;
}
export function clearFrontendCache(sym) {
  if (sym) { for (const k of _fCache.keys()) { if (k.includes(sym)) _fCache.delete(k); } }
  else _fCache.clear();
}

async function get(path) {
  try { const r = await fetch(`${BASE}${path}`); return await r.json(); } catch { return null; }
}
async function post(path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
    return await r.json();
  } catch { return null; }
}

// Authenticated request (PUT/DELETE) — attaches the JWT from localStorage
async function authFetch(path, method, body) {
  try {
    const token = localStorage.getItem("investingview_token");
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return await r.json();
  } catch { return { error: "Impossibile connettersi al server." }; }
}

// Treat as ticker only if original input is already uppercase (no lowercase = user typed a ticker).
// Supports international: AAPL, BRK.A, ISP.MI, 600519.SS (up to 12 chars), and indices: ^IXIC, ^GSPC.
export const looksLikeTicker = s => /^\^?[A-Z0-9.\-]{1,12}$/.test(s.trim());

export const API = {
  get, post,

  async resolveSymbol(input) {
    const trimmed = input.trim();
    const s = trimmed.toUpperCase();
    if (looksLikeTicker(trimmed)) return s;
    const results = await cachedGet(`/search?q=${encodeURIComponent(trimmed)}`, 60_000);
    if (Array.isArray(results) && results.length > 0) return results[0].symbol;
    return s;
  },

  // TTLs: price-sensitive = 60s, fundamentals = 1h, static = 24h
  async getQuote(sym)   { const d = await cachedGet(`/quote/${sym}`, 60_000);        return Array.isArray(d) ? d[0] : d; },
  async getProfile(sym) { const d = await cachedGet(`/profile/${sym}`, 3_600_000);   return Array.isArray(d) ? d[0] : d; },
  async getRatios(sym)  { const d = await cachedGet(`/ratios/${sym}`, 3_600_000);    return Array.isArray(d) ? d[0] : d; },
  async getGrowth(sym)  { const d = await cachedGet(`/growth/${sym}`, 3_600_000);    return Array.isArray(d) ? d[0] : d; },
  async getDividends(sym){ const d = await cachedGet(`/dividends/${sym}`, 3_600_000); return Array.isArray(d) ? d : []; },

  async getHistory(sym, from) {
    const url = `/history/${sym}` + (from ? `?from=${from}` : "");
    const d = await cachedGet(url, 3_600_000);
    return Array.isArray(d) ? d : (d?.historical || []);
  },
  async getCandles(sym, from, to) {
    const d = await cachedGet(`/candles/${sym}?from=${from}&to=${to}`, 3_600_000);
    return Array.isArray(d) ? d : [];
  },
  async getTechnicalAnalysis(sym) { return await cachedGet(`/technical-analysis/${sym}`, 1_800_000); },

  async getSectors()    { return await cachedGet("/sectors?v=2",   300_000) || []; },
  async getIndexes()    { return await cachedGet("/indexes",       60_000) || []; },
  async getGainers()    { return await cachedGet("/gainers",       60_000) || []; },
  async getLosers()     { return await cachedGet("/losers",        60_000) || []; },
  async getCrypto()     { return await cachedGet("/crypto",        60_000) || []; },
  async getTicker()     { return await cachedGet("/ticker",         90_000) || null; },
  async getMarketNews() { return await cachedGet("/news/market",  900_000) || {}; },

  async screen(p) {
    const qs = new URLSearchParams(p).toString();
    return await get(`/screen?${qs}`) || [];
  },
  async shortInterest(sym) { return await post(`/short/${sym}`, {}); },
  async sentiment(sym, companyName) { return await post(`/sentiment/${sym}`, { companyName: companyName || null }); },
  async getEarnings(sym)  { return await cachedGet(`/earnings/${sym}`,  3_600_000); },
  async getIncomeStatement(sym) { return await cachedGet(`/income-statement/${sym}`, 3_600_000); },
  async getAnalysts(sym)  { return await cachedGet(`/analysts/${sym}`,  3_600_000); },
  async getInsider(sym)   { return await cachedGet(`/insider/${sym}`,   3_600_000); },
  async getFearGreed()    { return await cachedGet('/feargreed',         900_000);  },
  async translate(text)    { return await post("/translate", { text }); },
  async translateTitles(titles) { return await post("/translate-titles", { titles }); },
  async getStockNews(q)    { const d = await get(`/news/${encodeURIComponent(q)}`); return d?.articles || []; },

  async updateProfile(payload)  { return await authFetch("/auth/profile",  "PUT",    payload); },
  async updatePassword(payload) { return await authFetch("/auth/password", "PUT",    payload); },
  async deleteAccount()         { return await authFetch("/auth/account",  "DELETE"); },

  // Watchlist / Portfolio persistence
  async getWatchlist()              { const d = await authFetch("/watchlist", "GET"); return Array.isArray(d) ? d : []; },
  async addToWatchlist(symbol)      { return await authFetch("/watchlist", "POST", { symbol }); },
  async removeFromWatchlist(symbol) { return await authFetch(`/watchlist/${encodeURIComponent(symbol)}`, "DELETE"); },

  async getPortfolio()                  { const d = await authFetch("/portfolio", "GET"); return Array.isArray(d) ? d : []; },
  async addPosition(payload)            { return await authFetch("/portfolio", "POST", payload); },
  async updatePosition(id, payload)     { return await authFetch(`/portfolio/${id}`, "PUT", payload); },
  async deletePosition(id)              { return await authFetch(`/portfolio/${id}`, "DELETE"); },
};

/* ─── Formatters ─────────────────────────────────────────────────────────── */
const CURRENCY_SYMS = { USD: '$', EUR: '€', GBP: '£', GBp: 'p', GBX: 'p', JPY: '¥', CHF: 'CHF ', HKD: 'HK$', CNY: '¥', CAD: 'CA$', AUD: 'A$' };
export function fmtPrice(n, currency) {
  if (n == null) return "—";
  const sym = CURRENCY_SYMS[currency] || (currency ? currency + ' ' : '$');
  return `${sym}${Number(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Currency-aware large number formatter: €1.23B, $456.78M, etc. */
export function fmtMoneyShort(n, currency) {
  if (n == null) return "—";
  const sym = CURRENCY_SYMS[currency] || (currency ? currency + ' ' : '$');
  const a = Math.abs(n);
  if (a >= 1e12) return `${sym}${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `${sym}${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6)  return `${sym}${(n / 1e6).toFixed(2)}M`;
  return `${sym}${Number(n).toLocaleString("it-IT")}`;
}

export const fmt = {
  price: n => fmtPrice(n, 'USD'),
  pct:   n => n == null ? "—" : `${n > 0 ? "+" : ""}${Number(n).toFixed(2)}%`,
  num:   n => n == null ? "—" : Number(n).toLocaleString("it-IT"),
  dec:   (n, d = 2) => n == null ? "—" : Number(n).toFixed(d),
  bn:    n => {
    if (n == null) return "—";
    const a = Math.abs(n);
    if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (a >= 1e9)  return `${(n / 1e9).toFixed(2)}B`;
    if (a >= 1e6)  return `${(n / 1e6).toFixed(2)}M`;
    return Number(n).toLocaleString("it-IT");
  },
  date: s => { if (!s) return ""; const d = new Date(s); return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }); },
  time: d => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
};

/* ─── localStorage hook ──────────────────────────────────────────────────── */
import { useState, useCallback } from "react";

export function useLocalStorage(key, init) {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s !== null ? JSON.parse(s) : init; }
    catch { return init; }
  });
  const setStored = useCallback(v => {
    setVal(prev => {
      const next = typeof v === "function" ? v(prev) : v;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);
  return [val, setStored];
}

/* ─── Timezone helpers ───────────────────────────────────────────────────── */
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Returns { minutes: minutes-since-midnight, weekday: 0=Sun..6=Sat } for `date` in `timeZone`, DST-safe.
function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return { minutes: (Number(map.hour) % 24) * 60 + Number(map.minute), weekday: WEEKDAYS[map.weekday] };
}

export function getZonedMinutes(date, timeZone) {
  return getZonedParts(date, timeZone).minutes;
}

/* ─── Global markets open/closed ─────────────────────────────────────────── */
const GLOBAL_MARKETS = [
  { key: 'italy', tz: 'Europe/Rome',      sessions: [[9 * 60, 17 * 60 + 30]] },
  { key: 'usa',   tz: 'America/New_York', sessions: [[9 * 60 + 30, 16 * 60]] },
  { key: 'japan', tz: 'Asia/Tokyo',       sessions: [[9 * 60, 11 * 60 + 30], [12 * 60 + 30, 15 * 60]] },
  { key: 'china', tz: 'Asia/Shanghai',    sessions: [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]] },
];

// Open/closed status for Italy (FTSE MIB), USA (NYSE/NASDAQ), Japan (Nikkei) and China (Shanghai/HK), Mon-Fri only.
export function getGlobalMarketsStatus(now = new Date()) {
  return GLOBAL_MARKETS.map(({ key, tz, sessions }) => {
    const { minutes, weekday } = getZonedParts(now, tz);
    const open = weekday >= 1 && weekday <= 5 && sessions.some(([start, end]) => minutes >= start && minutes < end);
    return { key, open };
  });
}

/* ─── Market status ──────────────────────────────────────────────────────── */
export function getMarketStatus(now = new Date()) {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return { open: false, label: "Mercati Chiusi", sub: "Weekend", color: "var(--text3)" };
  const month = now.getUTCMonth() + 1;
  const isDST = month > 3 || (month === 3 && now.getUTCDate() >= 8);
  const utcOff = isDST ? 4 : 5;
  const etMin = (now.getUTCHours() - utcOff) * 60 + now.getUTCMinutes();
  if (etMin >= 9 * 60 + 30 && etMin < 16 * 60) return { open: true,  label: "Mercati Aperti", sub: "NYSE/NASDAQ", color: "var(--green)" };
  if (etMin >= 4 * 60 && etMin < 9 * 60 + 30)  return { open: false, label: "Pre-Market",     sub: "NYSE/NASDAQ", color: "var(--gold)"  };
  if (etMin >= 16 * 60 && etMin < 20 * 60)      return { open: false, label: "After-Hours",    sub: "NYSE/NASDAQ", color: "var(--gold)"  };
  return { open: false, label: "Mercati Chiusi", sub: "NYSE/NASDAQ", color: "var(--text3)" };
}

/* ─── RSI calculator ─────────────────────────────────────────────────────── */
export function calcRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  const deltas = prices.slice(1).map((p, i) => p - prices[i]);
  const gains  = deltas.map(d => Math.max(d, 0));
  const losses = deltas.map(d => Math.max(-d, 0));
  let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  return +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(1);
}

/* ─── Metrics config — eval returns { c, t } where c = green|gold|orange|red|gray ── */
export const M = {
  pe: {
    tip: "Quante volte il mercato paga gli utili. Sotto 15 = economica. Sopra 30 = alte aspettative.",
    eval: v => {
      if (v == null) return null;
      if (v < 10) return { c:"green",  t:"Molto basso" };
      if (v < 15) return { c:"green",  t:"Basso" };
      if (v < 25) return { c:"gold",   t:"Equo" };
      if (v < 35) return { c:"orange", t:"Elevato" };
      return            { c:"red",    t:"Molto elevato" };
    }
  },
  peg: {
    tip: "P/E diviso crescita utili. Sotto 1 = attraente rispetto alla crescita.",
    eval: v => {
      if (v == null) return null;
      if (v < 0.5) return { c:"green",  t:"Molto attraente" };
      if (v < 1)   return { c:"green",  t:"Attraente" };
      if (v < 2)   return { c:"gold",   t:"Equo" };
      return             { c:"red",    t:"Caro" };
    }
  },
  roe: {
    tip: "Rendimento sul patrimonio. Sopra 15% = buono, sopra 25% = eccellente.",
    eval: v => {
      if (v == null) return null;
      if (v < 5)   return { c:"red",    t:"Molto basso" };
      if (v < 10)  return { c:"orange", t:"Basso" };
      if (v < 15)  return { c:"gold",   t:"Nella media" };
      if (v < 25)  return { c:"green",  t:"Buono" };
      return             { c:"green",  t:"Eccellente" };
    }
  },
  debtEq: {
    tip: "Debiti / patrimonio netto. Sotto 0.3 = quasi privo di debiti.",
    eval: v => {
      if (v == null) return null;
      if (v < 0.3)  return { c:"green",  t:"Minimo" };
      if (v < 0.8)  return { c:"green",  t:"Basso" };
      if (v < 1.5)  return { c:"gold",   t:"Moderato" };
      if (v < 2.5)  return { c:"orange", t:"Elevato" };
      return              { c:"red",    t:"Molto elevato" };
    }
  },
  divYield: {
    tip: "Dividendo annuale / prezzo. Yield > 6% può segnalare rischio di taglio.",
    eval: v => {
      if (!v || v === 0) return { c:"gray",   t:"Nessun dividendo" };
      if (v < 2)         return { c:"gold",   t:"Basso — <2%" };
      if (v < 4)         return { c:"green",  t:"Buono — 2-4%" };
      if (v < 6)         return { c:"green",  t:"Alto — 4-6%" };
      return                   { c:"orange", t:"Sospetto — >6%" };
    }
  },
  pb: {
    tip: "Prezzo / valore contabile. Sotto 1 = compri sotto il valore di bilancio.",
    eval: v => {
      if (v == null) return null;
      if (v < 1)  return { c:"green",  t:"Sotto valore" };
      if (v < 2)  return { c:"green",  t:"Equo" };
      if (v < 4)  return { c:"gold",   t:"Elevato" };
      return            { c:"red",    t:"Molto elevato" };
    }
  },
  netMargin: {
    tip: "% del fatturato che diventa profitto netto. Sopra 15% ottimo.",
    eval: v => {
      if (v == null) return null;
      if (v < 0)   return { c:"red",    t:"In perdita" };
      if (v < 5)   return { c:"orange", t:"Basso" };
      if (v < 15)  return { c:"gold",   t:"Nella media" };
      if (v < 25)  return { c:"green",  t:"Buono" };
      return             { c:"green",  t:"Eccellente" };
    }
  },
  epsGrowth: {
    tip: "Crescita utili per azione anno su anno.",
    eval: v => {
      if (v == null) return null;
      if (v < 0)   return { c:"red",    t:"Negativa" };
      if (v < 5)   return { c:"orange", t:"Bassa" };
      if (v < 15)  return { c:"gold",   t:"Moderata" };
      if (v < 30)  return { c:"green",  t:"Buona" };
      return             { c:"green",  t:"Forte" };
    }
  },
  short: {
    tip: "% di azioni vendute allo scoperto. Sopra 15% rischio squeeze.",
    eval: v => {
      if (v == null) return null;
      if (v < 3)   return { c:"green",  t:"Minimo" };
      if (v < 7)   return { c:"green",  t:"Basso" };
      if (v < 15)  return { c:"gold",   t:"Moderato" };
      if (v < 25)  return { c:"orange", t:"Elevato" };
      return             { c:"red",    t:"Molto elevato" };
    }
  },
  daysToCover: {
    tip: "Giorni necessari per chiudere tutte le posizioni short.",
    eval: v => {
      if (v == null) return null;
      if (v < 1)  return { c:"green",  t:"Minimo" };
      if (v < 3)  return { c:"green",  t:"Basso" };
      if (v < 7)  return { c:"gold",   t:"Moderato" };
      return            { c:"red",    t:"Alto — rischio squeeze" };
    }
  },
  rsi: {
    tip: "RSI 0-100. Sotto 30 = ipervenduto (potenziale rimbalzo). Sopra 70 = ipercomprato.",
    eval: v => {
      if (v == null) return null;
      if (v < 20)  return { c:"green",  t:"Fortemente ipervenduto" };
      if (v < 30)  return { c:"green",  t:"Ipervenduto" };
      if (v < 70)  return { c:"gold",   t:"Neutrale" };
      if (v < 80)  return { c:"orange", t:"Ipercomprato" };
      return             { c:"red",    t:"Fortemente ipercomprato" };
    }
  },
  volRatio: {
    tip: "Volume odierno vs media. >200% segnala attività anomala.",
    eval: v => {
      if (v == null) return null;
      if (v < 50)  return { c:"orange", t:"Molto basso" };
      if (v < 80)  return { c:"gold",   t:"Basso" };
      if (v < 120) return { c:"green",  t:"Normale" };
      if (v < 200) return { c:"green",  t:"Alto" };
      return             { c:"orange", t:"Anomalo" };
    }
  },
};
