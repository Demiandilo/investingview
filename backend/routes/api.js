const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const { default: YahooFinance } = require('yahoo-finance2');

const router = express.Router();
const cache = new NodeCache({ stdTTL: 300 });

// Single shared Yahoo Finance instance
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// ─── Yahoo helpers ────────────────────────────────────────────────────────────

/** OHLCV history from Yahoo chart() — works for all world markets */
async function yahooHistory(symbol, from, to) {
  const period1 = from || new Date(Date.now() - 400 * 86400000).toISOString().split('T')[0];
  const period2 = to   || new Date().toISOString().split('T')[0];
  const result = await yf.chart(symbol, { period1, period2, interval: '1d' });
  const quotes = result?.quotes || [];
  if (!quotes.length) return [];
  return quotes
    .filter(d => d.close != null)
    .map(d => {
      const dateStr = (d.date instanceof Date ? d.date : new Date(d.date)).toISOString().split('T')[0];
      return {
        date:   dateStr,
        open:   d.open    != null ? +d.open.toFixed(4)    : undefined,
        high:   d.high    != null ? +d.high.toFixed(4)    : undefined,
        low:    d.low     != null ? +d.low.toFixed(4)     : undefined,
        close:  d.adjclose != null ? +d.adjclose.toFixed(4) : +d.close.toFixed(4),
        volume: d.volume  != null ? Math.round(d.volume)  : undefined,
      };
    })
    .reverse(); // newest first (FMP convention)
}

/** Rich quote data from Yahoo (MA50/200, yearHigh/Low, volume etc.) */
async function yahooQuoteFull(symbol) {
  const q = await yf.quote(symbol);
  if (!q || !q.regularMarketPrice) return null;
  return [{
    symbol,
    name:             q.longName || q.shortName || symbol,
    price:            q.regularMarketPrice,
    change:           q.regularMarketChange,
    changePercentage: q.regularMarketChangePercent,
    open:             q.regularMarketOpen,
    dayHigh:          q.regularMarketDayHigh,
    dayLow:           q.regularMarketDayLow,
    volume:           q.regularMarketVolume,
    marketCap:        q.marketCap,
    priceAvg50:       q.fiftyDayAverage,
    priceAvg200:      q.twoHundredDayAverage,
    yearHigh:         q.fiftyTwoWeekHigh,
    yearLow:          q.fiftyTwoWeekLow,
    avgVolume:        q.averageDailyVolume3Month || q.averageDailyVolume10Day,
    currency:         q.currency || 'USD',
    marketState:              q.marketState ?? null,
    preMarketPrice:           q.preMarketPrice ?? null,
    preMarketChange:          q.preMarketChange ?? null,
    preMarketChangePercent:   q.preMarketChangePercent ?? null,
    postMarketPrice:          q.postMarketPrice ?? null,
    postMarketChange:         q.postMarketChange ?? null,
    postMarketChangePercent:  q.postMarketChangePercent ?? null,
    _source: 'yahoo',
  }];
}

/** Company profile from Yahoo (sector, description, country etc.) */
async function yahooProfile(symbol) {
  const [apRes, qRes] = await Promise.allSettled([
    yf.quoteSummary(symbol, { modules: ['assetProfile', 'price'] }),
    yf.quote(symbol),
  ]);
  const sum = apRes.status === 'fulfilled' ? apRes.value : {};
  const q   = qRes.status  === 'fulfilled' ? qRes.value  : {};
  const ap  = sum.assetProfile || {};
  const p   = sum.price        || {};

  const price   = q.regularMarketPrice ?? p.regularMarketPrice;
  const mcap    = q.marketCap          ?? p.marketCap;
  if (!price && !ap.sector) return [];
  return [{
    symbol,
    price,
    marketCap:        mcap,
    change:           q.regularMarketChange,
    changePercentage: q.regularMarketChangePercent,
    volume:           q.regularMarketVolume,
    averageVolume:    q.averageDailyVolume3Month,
    companyName:      q.longName || q.shortName || p.longName || symbol,
    currency:         q.currency || p.currency || 'USD',
    exchangeFullName: p.exchangeName || q.fullExchangeName,
    exchange:         q.exchange,
    industry:         ap.industry,
    sector:           ap.sector,
    country:          ap.country,
    description:      ap.longBusinessSummary,
    website:          ap.website,
    fullTimeEmployees: ap.fullTimeEmployees?.toString(),
    range:            q.fiftyTwoWeekLow && q.fiftyTwoWeekHigh
                        ? `${q.fiftyTwoWeekLow}-${q.fiftyTwoWeekHigh}` : undefined,
    _source: 'yahoo',
  }];
}

/** EPS / revenue growth from Yahoo financialData */
async function yahooGrowth(symbol) {
  const q = await yf.quoteSummary(symbol, { modules: ['financialData', 'defaultKeyStatistics'] });
  const fd = q?.financialData        || {};
  const ks = q?.defaultKeyStatistics || {};
  return [{
    epsgrowth:               fd.earningsGrowth       ?? ks.earningsQuarterlyGrowth ?? undefined,
    revenueGrowth:           fd.revenueGrowth         ?? undefined,
    netIncomeGrowth:         fd.earningsGrowth        ?? undefined,
    _source: 'yahoo',
  }];
}

/** Wilder's RSI from an array of closing prices (oldest → newest) */
function computeRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  const deltas = closes.slice(1).map((c, i) => c - closes[i]);
  const gains  = deltas.map(d => Math.max(d, 0));
  const losses = deltas.map(d => Math.max(-d, 0));
  let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  return +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2);
}

// ─── Technical analysis helpers (support/resistance, trend, patterns) ─────

/** Local pivot highs/lows: a candle whose high/low is the extreme within `window` candles on each side */
function findPivots(candles, window = 3) {
  const highs = [], lows = [];
  for (let i = window; i < candles.length - window; i++) {
    const slice = candles.slice(i - window, i + window + 1);
    const h = candles[i].high, l = candles[i].low;
    if (h === Math.max(...slice.map(c => c.high))) highs.push({ index: i, date: candles[i].date, price: h });
    if (l === Math.min(...slice.map(c => c.low))) lows.push({ index: i, date: candles[i].date, price: l });
  }
  return { highs, lows };
}

/** Groups pivot prices within `tolerance` (relative) into levels touched at least twice */
function groupLevels(pivots, tolerance = 0.015) {
  const groups = [];
  for (const p of pivots) {
    const g = groups.find(g => Math.abs(p.price - g.avg) / g.avg <= tolerance);
    if (g) { g.touches.push(p); g.avg = g.touches.reduce((s, t) => s + t.price, 0) / g.touches.length; }
    else groups.push({ avg: p.price, touches: [p] });
  }
  return groups.filter(g => g.touches.length >= 2);
}

/** Least-squares linear regression: y = slope*x + intercept */
function linearRegression(values) {
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) { sumX += i; sumY += values[i]; sumXY += i * values[i]; sumXX += i * i; }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

/** Double top / double bottom: last two similar pivots with an opposite extreme between them */
function detectDoubleTopBottom(highs, lows) {
  if (highs.length >= 2) {
    const [a, b] = highs.slice(-2);
    const avg = (a.price + b.price) / 2;
    if (Math.abs(a.price - b.price) / avg <= 0.025) {
      const between = lows.filter(l => l.index > a.index && l.index < b.index);
      if (between.length) {
        const neckline = Math.min(...between.map(l => l.price));
        if ((avg - neckline) / avg >= 0.03) return { type: 'double_top', level: avg, neckline };
      }
    }
  }
  if (lows.length >= 2) {
    const [a, b] = lows.slice(-2);
    const avg = (a.price + b.price) / 2;
    if (Math.abs(a.price - b.price) / avg <= 0.025) {
      const between = highs.filter(h => h.index > a.index && h.index < b.index);
      if (between.length) {
        const neckline = Math.max(...between.map(h => h.price));
        if ((neckline - avg) / avg >= 0.03) return { type: 'double_bottom', level: avg, neckline };
      }
    }
  }
  return null;
}

/** Head & shoulders: middle pivot high notably higher than two similar surrounding highs, with a roughly flat neckline */
function detectHeadShoulders(highs, lows) {
  if (highs.length < 3 || lows.length < 2) return null;
  const [left, head, right] = highs.slice(-3);
  if (!(head.price > left.price && head.price > right.price)) return null;
  if (Math.abs(left.price - right.price) / ((left.price + right.price) / 2) > 0.04) return null;
  if ((head.price - left.price) / left.price < 0.02) return null;
  const neck1 = lows.filter(l => l.index > left.index && l.index < head.index);
  const neck2 = lows.filter(l => l.index > head.index && l.index < right.index);
  if (!neck1.length || !neck2.length) return null;
  const n1 = Math.min(...neck1.map(l => l.price));
  const n2 = Math.min(...neck2.map(l => l.price));
  if (Math.abs(n1 - n2) / ((n1 + n2) / 2) > 0.04) return null;
  return { type: 'head_shoulders', leftShoulder: left.price, head: head.price, rightShoulder: right.price, neckline: (n1 + n2) / 2 };
}

/** Symmetrical/converging triangle: last 3 pivot highs descending and last 3 pivot lows ascending */
function detectTriangle(highs, lows) {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3), l = lows.slice(-3);
  const highsDescending = h[0].price > h[1].price && h[1].price > h[2].price;
  const lowsAscending = l[0].price < l[1].price && l[1].price < l[2].price;
  if (highsDescending && lowsAscending) {
    return { type: 'triangle', resistanceFrom: h[0].price, resistanceTo: h[2].price, supportFrom: l[0].price, supportTo: l[2].price };
  }
  return null;
}

// ─── Yahoo Finance fallback for fundamental ratios ─────────────────────────
async function yahooRatios(symbol) {
  const [sumRes, ksRes, fdRes] = await Promise.allSettled([
    yf.quoteSummary(symbol, { modules: ['summaryDetail'] }),
    yf.quoteSummary(symbol, { modules: ['defaultKeyStatistics'] }),
    yf.quoteSummary(symbol, { modules: ['financialData'] }),
  ]);
  const sd = sumRes.status === 'fulfilled' ? sumRes.value.summaryDetail      : {};
  const ks = ksRes.status  === 'fulfilled' ? ksRes.value.defaultKeyStatistics : {};
  const fd = fdRes.status  === 'fulfilled' ? fdRes.value.financialData        : {};

  // Yahoo returns debtToEquity as a percentage (79.5 = 79.5%), FMP uses a ratio (0.795).
  // Divide by 100 to normalise to FMP format so the frontend eval thresholds stay consistent.
  const debtEq = fd?.debtToEquity != null ? +(fd.debtToEquity / 100).toFixed(4) : undefined;

  return {
    peRatioTTM:               sd?.trailingPE          ?? undefined,
    pegRatioTTM:              ks?.pegRatio             ?? undefined,
    priceToBookRatioTTM:      ks?.priceToBook          ?? undefined,
    priceToSalesRatioTTM:     sd?.priceToSalesTrailing12Months ?? undefined,
    netProfitMarginTTM:       fd?.profitMargins        ?? undefined,
    grossProfitMarginTTM:     fd?.grossMargins         ?? undefined,
    operatingProfitMarginTTM: fd?.operatingMargins     ?? undefined,
    returnOnEquityTTM:        fd?.returnOnEquity       ?? undefined,
    returnOnAssetsTTM:        fd?.returnOnAssets       ?? undefined,
    returnOnInvestedCapitalTTM: undefined,
    debtEquityRatioTTM:       debtEq,
    debtToAssetsTTM:          undefined,
    currentRatioTTM:          fd?.currentRatio        ?? undefined,
    dividendYielTTM:          sd?.trailingAnnualDividendYield ?? undefined,
    netIncomePerShareTTM:     ks?.trailingEps          ?? undefined,
    bookValuePerShareTTM:     ks?.bookValue            ?? undefined,
    freeCashFlowPerShareTTM:  undefined,
    evToEBITDATTM:            ks?.enterpriseToEbitda   ?? undefined,
    evToSalesTTM:             ks?.enterpriseToRevenue  ?? undefined,
    _source: 'yahoo',
  };
}

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GEMINI_KEY = process.env.GEMINI_KEY;

// ─── Commodity dictionary — Italian + English terms → ticker ─────────────────
const COMMODITY_DICT = {
  // Italian
  'oro':           { symbol: 'GC=F',    name: 'Oro (Gold Futures)',                   exchange: 'COMEX',  type: 'futures' },
  'petrolio':      { symbol: 'CL=F',    name: 'Petrolio WTI (Crude Oil Futures)',      exchange: 'NYMEX',  type: 'futures' },
  'petrolio wti':  { symbol: 'CL=F',    name: 'Petrolio WTI (Crude Oil Futures)',      exchange: 'NYMEX',  type: 'futures' },
  'petrolio brent':{ symbol: 'BZ=F',    name: 'Petrolio Brent (Brent Crude Futures)', exchange: 'ICE',    type: 'futures' },
  'brent':         { symbol: 'BZ=F',    name: 'Petrolio Brent (Brent Crude Futures)', exchange: 'ICE',    type: 'futures' },
  'argento':       { symbol: 'SI=F',    name: 'Argento (Silver Futures)',              exchange: 'COMEX',  type: 'futures' },
  'gas':           { symbol: 'NG=F',    name: 'Gas Naturale (Natural Gas Futures)',    exchange: 'NYMEX',  type: 'futures' },
  'gas naturale':  { symbol: 'NG=F',    name: 'Gas Naturale (Natural Gas Futures)',    exchange: 'NYMEX',  type: 'futures' },
  'rame':          { symbol: 'HG=F',    name: 'Rame (Copper Futures)',                 exchange: 'COMEX',  type: 'futures' },
  'grano':         { symbol: 'ZW=F',    name: 'Grano (Wheat Futures)',                 exchange: 'CBOT',   type: 'futures' },
  'mais':          { symbol: 'ZC=F',    name: 'Mais (Corn Futures)',                   exchange: 'CBOT',   type: 'futures' },
  'caffe':         { symbol: 'KC=F',    name: 'Caffè (Coffee Futures)',                exchange: 'ICE',    type: 'futures' },
  'caffè':         { symbol: 'KC=F',    name: 'Caffè (Coffee Futures)',                exchange: 'ICE',    type: 'futures' },
  'bitcoin':       { symbol: 'BTC-USD', name: 'Bitcoin',                               exchange: 'Crypto', type: 'crypto' },
  'btc':           { symbol: 'BTC-USD', name: 'Bitcoin',                               exchange: 'Crypto', type: 'crypto' },
  'ethereum':      { symbol: 'ETH-USD', name: 'Ethereum',                              exchange: 'Crypto', type: 'crypto' },
  'eth':           { symbol: 'ETH-USD', name: 'Ethereum',                              exchange: 'Crypto', type: 'crypto' },
  // English
  'gold':          { symbol: 'GC=F',    name: 'Oro (Gold Futures)',                   exchange: 'COMEX',  type: 'futures' },
  'oil':           { symbol: 'CL=F',    name: 'Petrolio WTI (Crude Oil Futures)',      exchange: 'NYMEX',  type: 'futures' },
  'crude oil':     { symbol: 'CL=F',    name: 'Petrolio WTI (Crude Oil Futures)',      exchange: 'NYMEX',  type: 'futures' },
  'wti':           { symbol: 'CL=F',    name: 'Petrolio WTI (Crude Oil Futures)',      exchange: 'NYMEX',  type: 'futures' },
  'silver':        { symbol: 'SI=F',    name: 'Argento (Silver Futures)',              exchange: 'COMEX',  type: 'futures' },
  'natural gas':   { symbol: 'NG=F',    name: 'Gas Naturale (Natural Gas Futures)',    exchange: 'NYMEX',  type: 'futures' },
  'copper':        { symbol: 'HG=F',    name: 'Rame (Copper Futures)',                 exchange: 'COMEX',  type: 'futures' },
  'wheat':         { symbol: 'ZW=F',    name: 'Grano (Wheat Futures)',                 exchange: 'CBOT',   type: 'futures' },
  'corn':          { symbol: 'ZC=F',    name: 'Mais (Corn Futures)',                   exchange: 'CBOT',   type: 'futures' },
  'coffee':        { symbol: 'KC=F',    name: 'Caffè (Coffee Futures)',                exchange: 'ICE',    type: 'futures' },
};

/** Returns true for futures (XX=F), crypto (*-USD), known commodity ETFs */
function isCommoditySymbol(sym) {
  if (!sym) return false;
  if (/^[A-Z]{1,4}=F$/.test(sym)) return true;
  if (/^[A-Z]+-USD$/.test(sym)) return true;
  return ['GLD','SLV','USO','UNG','WEAT','CPER','IAU','PDBC'].includes(sym);
}

function cached(key, fn, ttl) {
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return fn().then(data => {
    if (ttl !== undefined) cache.set(key, data, ttl);
    else cache.set(key, data);
    return data;
  });
}

// Short-lived cache for real-time price/change data (90s)
const rtCache = new NodeCache({ stdTTL: 90 });
function cachedRT(key, fn) {
  const hit = rtCache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return fn().then(data => { rtCache.set(key, data); return data; });
}

// Separate cache for slow-changing data (earnings, analysts, insider)
const longCache = new NodeCache({ stdTTL: 3600 });
function cachedLong(key, fn) {
  const hit = longCache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return fn().then(data => { longCache.set(key, data); return data; });
}

async function batchFetch(items, fetchFn, batchSize = 6, delayMs = 250) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fetchFn));
    results.push(...batchResults);
    if (i + batchSize < items.length) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}

async function fmp(path, params = {}) {
  const { data } = await axios.get(`${FMP_BASE}${path}`, {
    params: { apikey: FMP_KEY, ...params },
  });
  return data;
}

// Static pool for screener — sector/exchange/market/marketCap pre-defined.
// market: 'USA' | 'ITALIA' | 'EUROPA' | 'CINA' | 'GIAPPONE'
const STATIC_POOL = [
  // ── USA — Technology ──
  { symbol:'AAPL',  companyName:'Apple Inc.',            sector:'Technology',            exchange:'NASDAQ',  market:'USA', marketCap:3.5e12, lastDividend:1.0 },
  { symbol:'MSFT',  companyName:'Microsoft Corp.',       sector:'Technology',            exchange:'NASDAQ',  market:'USA', marketCap:3.2e12, lastDividend:3.0 },
  { symbol:'NVDA',  companyName:'NVIDIA Corp.',          sector:'Technology',            exchange:'NASDAQ',  market:'USA', marketCap:2.8e12, lastDividend:0.16 },
  { symbol:'GOOGL', companyName:'Alphabet Inc.',         sector:'Technology',            exchange:'NASDAQ',  market:'USA', marketCap:2.0e12, lastDividend:0 },
  { symbol:'META',  companyName:'Meta Platforms',        sector:'Technology',            exchange:'NASDAQ',  market:'USA', marketCap:1.3e12, lastDividend:2.0 },
  { symbol:'AMD',   companyName:'Advanced Micro Devices',sector:'Technology',            exchange:'NASDAQ',  market:'USA', marketCap:2.5e11, lastDividend:0 },
  { symbol:'INTC',  companyName:'Intel Corp.',           sector:'Technology',            exchange:'NASDAQ',  market:'USA', marketCap:9e10,   lastDividend:1.0 },
  { symbol:'CRM',   companyName:'Salesforce Inc.',       sector:'Technology',            exchange:'NYSE',    market:'USA', marketCap:3e11,   lastDividend:0 },
  { symbol:'ORCL',  companyName:'Oracle Corp.',          sector:'Technology',            exchange:'NYSE',    market:'USA', marketCap:4e11,   lastDividend:1.6 },
  { symbol:'ADBE',  companyName:'Adobe Inc.',            sector:'Technology',            exchange:'NASDAQ',  market:'USA', marketCap:2e11,   lastDividend:0 },
  { symbol:'NFLX',  companyName:'Netflix Inc.',          sector:'Technology',            exchange:'NASDAQ',  market:'USA', marketCap:3.5e11, lastDividend:0 },
  // ── USA — Consumer ──
  { symbol:'AMZN',  companyName:'Amazon.com Inc.',       sector:'Consumer Cyclical',     exchange:'NASDAQ',  market:'USA', marketCap:2.2e12, lastDividend:0 },
  { symbol:'TSLA',  companyName:'Tesla Inc.',            sector:'Consumer Cyclical',     exchange:'NASDAQ',  market:'USA', marketCap:8e11,   lastDividend:0 },
  { symbol:'UBER',  companyName:'Uber Technologies',     sector:'Consumer Cyclical',     exchange:'NYSE',    market:'USA', marketCap:1.5e11, lastDividend:0 },
  { symbol:'MCD',   companyName:"McDonald's Corp.",      sector:'Consumer Cyclical',     exchange:'NYSE',    market:'USA', marketCap:2e11,   lastDividend:6.68 },
  { symbol:'SBUX',  companyName:'Starbucks Corp.',       sector:'Consumer Cyclical',     exchange:'NASDAQ',  market:'USA', marketCap:8e10,   lastDividend:2.28 },
  { symbol:'NKE',   companyName:'Nike Inc.',             sector:'Consumer Cyclical',     exchange:'NYSE',    market:'USA', marketCap:7e10,   lastDividend:1.48 },
  { symbol:'KO',    companyName:'Coca-Cola Co.',         sector:'Consumer Defensive',    exchange:'NYSE',    market:'USA', marketCap:2.5e11, lastDividend:1.94 },
  { symbol:'PG',    companyName:'Procter & Gamble',      sector:'Consumer Defensive',    exchange:'NYSE',    market:'USA', marketCap:3.5e11, lastDividend:3.76 },
  { symbol:'WMT',   companyName:'Walmart Inc.',          sector:'Consumer Defensive',    exchange:'NYSE',    market:'USA', marketCap:6e11,   lastDividend:0.83 },
  { symbol:'COST',  companyName:'Costco Wholesale',      sector:'Consumer Defensive',    exchange:'NASDAQ',  market:'USA', marketCap:3.5e11, lastDividend:4.64 },
  { symbol:'HD',    companyName:'Home Depot Inc.',       sector:'Consumer Defensive',    exchange:'NYSE',    market:'USA', marketCap:3.5e11, lastDividend:9.0  },
  // ── USA — Healthcare ──
  { symbol:'JNJ',   companyName:'Johnson & Johnson',     sector:'Healthcare',            exchange:'NYSE',    market:'USA', marketCap:3.8e11, lastDividend:4.96 },
  { symbol:'UNH',   companyName:'UnitedHealth Group',    sector:'Healthcare',            exchange:'NYSE',    market:'USA', marketCap:4.5e11, lastDividend:8.0  },
  { symbol:'AMGN',  companyName:'Amgen Inc.',            sector:'Healthcare',            exchange:'NASDAQ',  market:'USA', marketCap:1.6e11, lastDividend:9.0  },
  { symbol:'ABT',   companyName:'Abbott Laboratories',   sector:'Healthcare',            exchange:'NYSE',    market:'USA', marketCap:2e11,   lastDividend:2.2  },
  { symbol:'PFE',   companyName:'Pfizer Inc.',           sector:'Healthcare',            exchange:'NYSE',    market:'USA', marketCap:1.3e11, lastDividend:1.68 },
  { symbol:'MRK',   companyName:'Merck & Co.',           sector:'Healthcare',            exchange:'NYSE',    market:'USA', marketCap:2.2e11, lastDividend:3.0  },
  { symbol:'ABBV',  companyName:'AbbVie Inc.',           sector:'Healthcare',            exchange:'NYSE',    market:'USA', marketCap:3.2e11, lastDividend:6.4  },
  { symbol:'LLY',   companyName:'Eli Lilly & Co.',       sector:'Healthcare',            exchange:'NYSE',    market:'USA', marketCap:7e11,   lastDividend:5.2  },
  // ── USA — Financials ──
  { symbol:'JPM',   companyName:'JPMorgan Chase',        sector:'Financial Services',    exchange:'NYSE',    market:'USA', marketCap:6.5e11, lastDividend:4.6  },
  { symbol:'BAC',   companyName:'Bank of America',       sector:'Financial Services',    exchange:'NYSE',    market:'USA', marketCap:3e11,   lastDividend:1.0  },
  { symbol:'GS',    companyName:'Goldman Sachs',         sector:'Financial Services',    exchange:'NYSE',    market:'USA', marketCap:2e11,   lastDividend:11.0 },
  { symbol:'MS',    companyName:'Morgan Stanley',        sector:'Financial Services',    exchange:'NYSE',    market:'USA', marketCap:2e11,   lastDividend:3.7  },
  { symbol:'V',     companyName:'Visa Inc.',             sector:'Financial Services',    exchange:'NYSE',    market:'USA', marketCap:6e11,   lastDividend:2.08 },
  { symbol:'MA',    companyName:'Mastercard Inc.',       sector:'Financial Services',    exchange:'NYSE',    market:'USA', marketCap:4.5e11, lastDividend:2.64 },
  // ── USA — Energy / Industrials / Communication ──
  { symbol:'XOM',   companyName:'ExxonMobil Corp.',      sector:'Energy',                exchange:'NYSE',    market:'USA', marketCap:5e11,   lastDividend:3.8  },
  { symbol:'CVX',   companyName:'Chevron Corp.',         sector:'Energy',                exchange:'NYSE',    market:'USA', marketCap:2.5e11, lastDividend:6.52 },
  { symbol:'BA',    companyName:'Boeing Co.',            sector:'Industrials',           exchange:'NYSE',    market:'USA', marketCap:1e11,   lastDividend:0 },
  { symbol:'CAT',   companyName:'Caterpillar Inc.',      sector:'Industrials',           exchange:'NYSE',    market:'USA', marketCap:1.5e11, lastDividend:5.2  },
  { symbol:'GE',    companyName:'GE Aerospace',          sector:'Industrials',           exchange:'NYSE',    market:'USA', marketCap:2e11,   lastDividend:0.28 },
  { symbol:'HON',   companyName:'Honeywell Intl.',       sector:'Industrials',           exchange:'NASDAQ',  market:'USA', marketCap:1.3e11, lastDividend:4.52 },
  { symbol:'T',     companyName:'AT&T Inc.',             sector:'Communication Services',exchange:'NYSE',    market:'USA', marketCap:1.7e11, lastDividend:1.11 },
  { symbol:'VZ',    companyName:'Verizon Communications',sector:'Communication Services',exchange:'NYSE',    market:'USA', marketCap:1.7e11, lastDividend:2.66 },

  // ── ITALIA — FTSE MIB ──
  { symbol:'ENI.MI',   companyName:'Eni S.p.A.',              sector:'Energy',               exchange:'BIT', market:'ITALIA', marketCap:4.0e10, lastDividend:0.94 },
  { symbol:'ENEL.MI',  companyName:'Enel S.p.A.',             sector:'Utilities',            exchange:'BIT', market:'ITALIA', marketCap:5.5e10, lastDividend:0.43 },
  { symbol:'ISP.MI',   companyName:'Intesa Sanpaolo',         sector:'Financial Services',   exchange:'BIT', market:'ITALIA', marketCap:5.0e10, lastDividend:0.35 },
  { symbol:'UCG.MI',   companyName:'UniCredit S.p.A.',        sector:'Financial Services',   exchange:'BIT', market:'ITALIA', marketCap:5.8e10, lastDividend:2.0  },
  { symbol:'RACE.MI',  companyName:'Ferrari N.V.',            sector:'Consumer Cyclical',    exchange:'BIT', market:'ITALIA', marketCap:7.5e10, lastDividend:2.19 },
  { symbol:'STM.MI',   companyName:'STMicroelectronics',      sector:'Technology',           exchange:'BIT', market:'ITALIA', marketCap:1.2e10, lastDividend:0.36 },
  { symbol:'TIT.MI',   companyName:'Telecom Italia',          sector:'Communication Services',exchange:'BIT',market:'ITALIA', marketCap:7.0e9,  lastDividend:0 },
  { symbol:'MB.MI',    companyName:'Mediobanca',              sector:'Financial Services',   exchange:'BIT', market:'ITALIA', marketCap:1.1e10, lastDividend:1.0  },
  { symbol:'PRY.MI',   companyName:'Prysmian S.p.A.',         sector:'Industrials',          exchange:'BIT', market:'ITALIA', marketCap:2.0e10, lastDividend:0.59 },
  { symbol:'BMED.MI',  companyName:'Banca Mediolanum',        sector:'Financial Services',   exchange:'BIT', market:'ITALIA', marketCap:7.0e9,  lastDividend:1.1  },
  { symbol:'AZM.MI',   companyName:'Azimut Holding',          sector:'Financial Services',   exchange:'BIT', market:'ITALIA', marketCap:2.5e9,  lastDividend:1.5  },
  { symbol:'LDO.MI',   companyName:'Leonardo S.p.A.',         sector:'Industrials',          exchange:'BIT', market:'ITALIA', marketCap:1.4e10, lastDividend:0.28 },
  { symbol:'MONC.MI',  companyName:'Moncler S.p.A.',          sector:'Consumer Cyclical',    exchange:'BIT', market:'ITALIA', marketCap:1.5e10, lastDividend:0.70 },
  { symbol:'PIRC.MI',  companyName:'Pirelli & C.',            sector:'Consumer Cyclical',    exchange:'BIT', market:'ITALIA', marketCap:5.5e9,  lastDividend:0.29 },
  { symbol:'G.MI',     companyName:'Assicurazioni Generali',  sector:'Financial Services',   exchange:'BIT', market:'ITALIA', marketCap:3.2e10, lastDividend:1.34 },
  { symbol:'SRG.MI',   companyName:'Snam S.p.A.',             sector:'Utilities',            exchange:'BIT', market:'ITALIA', marketCap:1.5e10, lastDividend:0.30 },
  { symbol:'A2A.MI',   companyName:'A2A S.p.A.',              sector:'Utilities',            exchange:'BIT', market:'ITALIA', marketCap:4.5e9,  lastDividend:0.10 },
  { symbol:'HER.MI',   companyName:'Hera S.p.A.',             sector:'Utilities',            exchange:'BIT', market:'ITALIA', marketCap:3.5e9,  lastDividend:0.16 },
  { symbol:'CPR.MI',   companyName:'Davide Campari-Milano',   sector:'Consumer Defensive',   exchange:'BIT', market:'ITALIA', marketCap:7.5e9,  lastDividend:0.06 },
  { symbol:'BPSO.MI',  companyName:'Banca Popolare di Sondrio',sector:'Financial Services',  exchange:'BIT', market:'ITALIA', marketCap:2.0e9,  lastDividend:0.40 },

  // ── EUROPA — DAX ──
  { symbol:'SAP.DE',   companyName:'SAP SE',                  sector:'Technology',           exchange:'XETRA',market:'EUROPA', marketCap:2.2e11, lastDividend:2.2  },
  { symbol:'ALV.DE',   companyName:'Allianz SE',              sector:'Financial Services',   exchange:'XETRA',market:'EUROPA', marketCap:9.5e10, lastDividend:13.8 },
  { symbol:'SIE.DE',   companyName:'Siemens AG',              sector:'Industrials',          exchange:'XETRA',market:'EUROPA', marketCap:1.4e11, lastDividend:4.7  },
  { symbol:'BMW.DE',   companyName:'BMW AG',                  sector:'Consumer Cyclical',    exchange:'XETRA',market:'EUROPA', marketCap:4.8e10, lastDividend:6.0  },
  { symbol:'BAS.DE',   companyName:'BASF SE',                 sector:'Basic Materials',      exchange:'XETRA',market:'EUROPA', marketCap:3.6e10, lastDividend:3.4  },
  // ── EUROPA — CAC 40 ──
  { symbol:'MC.PA',    companyName:'LVMH',                    sector:'Consumer Cyclical',    exchange:'Euronext Paris', market:'EUROPA', marketCap:2.8e11, lastDividend:13.0 },
  { symbol:'OR.PA',    companyName:"L'Oréal S.A.",            sector:'Consumer Defensive',   exchange:'Euronext Paris', market:'EUROPA', marketCap:2.0e11, lastDividend:6.6  },
  { symbol:'TTE.PA',   companyName:'TotalEnergies SE',        sector:'Energy',               exchange:'Euronext Paris', market:'EUROPA', marketCap:1.4e11, lastDividend:3.22 },
  { symbol:'BNP.PA',   companyName:'BNP Paribas',             sector:'Financial Services',   exchange:'Euronext Paris', market:'EUROPA', marketCap:7.5e10, lastDividend:4.6  },
  { symbol:'SAN.PA',   companyName:'Sanofi S.A.',             sector:'Healthcare',           exchange:'Euronext Paris', market:'EUROPA', marketCap:1.2e11, lastDividend:3.92 },
  // ── EUROPA — AEX ──
  { symbol:'ASML.AS',  companyName:'ASML Holding',            sector:'Technology',           exchange:'Euronext Amsterdam', market:'EUROPA', marketCap:3.1e11, lastDividend:6.4  },
  { symbol:'PHIA.AS',  companyName:'Philips N.V.',            sector:'Healthcare',           exchange:'Euronext Amsterdam', market:'EUROPA', marketCap:1.5e10, lastDividend:0.85 },
  { symbol:'SHELL.AS', companyName:'Shell plc',               sector:'Energy',               exchange:'Euronext Amsterdam', market:'EUROPA', marketCap:2.1e11, lastDividend:1.93 },
  // ── EUROPA — FTSE 100 ──
  { symbol:'ULVR.L',   companyName:'Unilever PLC',            sector:'Consumer Defensive',   exchange:'LSE',  market:'EUROPA', marketCap:1.3e11, lastDividend:1.81 },
  { symbol:'HSBA.L',   companyName:'HSBC Holdings',           sector:'Financial Services',   exchange:'LSE',  market:'EUROPA', marketCap:1.9e11, lastDividend:0.87 },
  { symbol:'BP.L',     companyName:'BP p.l.c.',               sector:'Energy',               exchange:'LSE',  market:'EUROPA', marketCap:8.5e10, lastDividend:0.31 },
  { symbol:'GSK.L',    companyName:'GSK plc',                 sector:'Healthcare',           exchange:'LSE',  market:'EUROPA', marketCap:7.0e10, lastDividend:0.60 },
  { symbol:'AZN.L',    companyName:'AstraZeneca PLC',         sector:'Healthcare',           exchange:'LSE',  market:'EUROPA', marketCap:2.3e11, lastDividend:3.1  },

  // ── CINA — Shanghai + Shenzhen + HK ──
  { symbol:'600519.SS',companyName:'Kweichow Moutai',         sector:'Consumer Defensive',   exchange:'SHA',  market:'CINA', marketCap:2.5e11, lastDividend:0 },
  { symbol:'601398.SS',companyName:'ICBC',                    sector:'Financial Services',   exchange:'SHA',  market:'CINA', marketCap:2.0e11, lastDividend:0 },
  { symbol:'601288.SS',companyName:'Agricultural Bank of China',sector:'Financial Services', exchange:'SHA',  market:'CINA', marketCap:1.8e11, lastDividend:0 },
  { symbol:'000858.SZ',companyName:'Wuliangye Yibin',         sector:'Consumer Defensive',   exchange:'SHZ',  market:'CINA', marketCap:8.0e10, lastDividend:0 },
  { symbol:'600036.SS',companyName:'China Merchants Bank',    sector:'Financial Services',   exchange:'SHA',  market:'CINA', marketCap:1.2e11, lastDividend:0 },
  { symbol:'9988.HK',  companyName:'Alibaba Group',           sector:'Technology',           exchange:'HKEX', market:'CINA', marketCap:2.0e11, lastDividend:0 },
  { symbol:'700.HK',   companyName:'Tencent Holdings',        sector:'Technology',           exchange:'HKEX', market:'CINA', marketCap:4.2e11, lastDividend:0 },
  { symbol:'3690.HK',  companyName:'Meituan',                 sector:'Consumer Cyclical',    exchange:'HKEX', market:'CINA', marketCap:9.0e10, lastDividend:0 },
  { symbol:'9618.HK',  companyName:'JD.com Inc.',             sector:'Consumer Cyclical',    exchange:'HKEX', market:'CINA', marketCap:5.0e10, lastDividend:0 },
  { symbol:'1299.HK',  companyName:'AIA Group',               sector:'Financial Services',   exchange:'HKEX', market:'CINA', marketCap:9.0e10, lastDividend:0 },

  // ── GIAPPONE — TSE ──
  { symbol:'7203.T',   companyName:'Toyota Motor Corp.',      sector:'Consumer Cyclical',    exchange:'TSE',  market:'GIAPPONE', marketCap:2.5e11, lastDividend:0 },
  { symbol:'6758.T',   companyName:'Sony Group Corp.',        sector:'Technology',           exchange:'TSE',  market:'GIAPPONE', marketCap:1.0e11, lastDividend:0 },
  { symbol:'9984.T',   companyName:'SoftBank Group',          sector:'Technology',           exchange:'TSE',  market:'GIAPPONE', marketCap:9.0e10, lastDividend:0 },
  { symbol:'7974.T',   companyName:'Nintendo Co.',            sector:'Technology',           exchange:'TSE',  market:'GIAPPONE', marketCap:5.0e10, lastDividend:0 },
  { symbol:'6861.T',   companyName:'Keyence Corp.',           sector:'Technology',           exchange:'TSE',  market:'GIAPPONE', marketCap:9.0e10, lastDividend:0 },
];

// ─── Quote ───────────────────────────────────────────────────────────────────
router.get('/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cached(`quote_${symbol}`, async () => {
      // 1. Try FMP (has priceAvg50/200 etc. for US stocks)
      const fmpData = await fmp('/quote', { symbol }).catch(() => null);
      if (Array.isArray(fmpData) && fmpData[0]?.price) {
        const f = fmpData[0];
        // Always enrich from Yahoo to get pre/post market + any missing fields
        const yFull = await yahooQuoteFull(symbol).catch(() => null);
        const y = yFull?.[0] || {};
        return [{ ...f,
          priceAvg50:  f.priceAvg50  ?? y.priceAvg50,
          priceAvg200: f.priceAvg200 ?? y.priceAvg200,
          yearHigh:    f.yearHigh    ?? y.yearHigh,
          yearLow:     f.yearLow     ?? y.yearLow,
          avgVolume:   f.avgVolume   ?? y.avgVolume,
          currency:    y.currency    ?? f.currency ?? 'USD',
          marketState:             y.marketState,
          preMarketPrice:          y.preMarketPrice,
          preMarketChange:         y.preMarketChange,
          preMarketChangePercent:  y.preMarketChangePercent,
          postMarketPrice:         y.postMarketPrice,
          postMarketChange:        y.postMarketChange,
          postMarketChangePercent: y.postMarketChangePercent,
        }];
      }
      // 2. Yahoo Finance full quote (works for ALL symbols/exchanges)
      const yData = await yahooQuoteFull(symbol).catch(() => null);
      if (yData) return yData;
      return null;
    }, 60); // 60s TTL so pre/post market data stays fresh
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Profile ─────────────────────────────────────────────────────────────────
router.get('/profile/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cached(`profile_${symbol}`, async () => {
      // For commodity futures/crypto, assetProfile is empty — use quote only
      if (isCommoditySymbol(symbol)) {
        const q = await yf.quote(symbol).catch(() => null);
        if (!q?.regularMarketPrice) return [];
        const isCrypto = /^[A-Z]+-USD$/.test(symbol);
        const isFuture = /^[A-Z]{1,4}=F$/.test(symbol);
        return [{
          symbol,
          companyName:      q.longName || q.shortName || symbol,
          price:            q.regularMarketPrice,
          change:           q.regularMarketChange,
          changePercentage: q.regularMarketChangePercent,
          volume:           q.regularMarketVolume,
          currency:         q.currency,
          exchange:         q.fullExchangeName || q.exchange,
          range:            q.fiftyTwoWeekLow && q.fiftyTwoWeekHigh
                              ? `${q.fiftyTwoWeekLow}-${q.fiftyTwoWeekHigh}` : undefined,
          _isCommodity:     true,
          _commodityType:   isCrypto ? 'crypto' : isFuture ? 'futures' : 'etf',
        }];
      }

      // 1. FMP profile (good for US stocks, has logo/image)
      const fmpData = await fmp('/profile', { symbol }).catch(() => null);
      if (Array.isArray(fmpData) && fmpData[0]?.companyName) {
        const p = fmpData[0];
        // Fill missing fields from Yahoo (sector/country often missing for non-US on FMP free)
        if (!p.sector || !p.description) {
          const yProf = await yahooProfile(symbol).catch(() => []);
          const y = yProf[0] || {};
          return [{ ...p,
            sector:      p.sector      || y.sector,
            industry:    p.industry    || y.industry,
            country:     p.country     || y.country,
            description: p.description || y.description,
          }];
        }
        return fmpData;
      }
      // 2. Yahoo Finance profile (works for all world markets)
      const yData = await yahooProfile(symbol).catch(() => []);
      if (yData.length) return yData;
      return [];
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Ratios — FMP primary, Yahoo Finance fallback ────────────────────────────
router.get('/ratios/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cached(`ratios_${symbol}`, async () => {
      // 1) Try FMP (allSettled so a 402 on one endpoint doesn't block the other)
      const [rtResult, kmResult] = await Promise.allSettled([
        fmp('/ratios-ttm', { symbol }),
        fmp('/key-metrics-ttm', { symbol }),
      ]);
      const r = (rtResult.status === 'fulfilled' ? rtResult.value[0] : null) || {};
      const k = (kmResult.status === 'fulfilled' ? kmResult.value[0] : null) || {};

      const fmpRatios = {
        peRatioTTM:               r.priceToEarningsRatioTTM,
        pegRatioTTM:              r.priceToEarningsGrowthRatioTTM,
        priceToBookRatioTTM:      r.priceToBookRatioTTM,
        priceToSalesRatioTTM:     r.priceToSalesRatioTTM,
        netProfitMarginTTM:       r.netProfitMarginTTM,
        grossProfitMarginTTM:     r.grossProfitMarginTTM,
        operatingProfitMarginTTM: r.operatingProfitMarginTTM,
        returnOnEquityTTM:        k.returnOnEquityTTM,
        returnOnAssetsTTM:        k.returnOnAssetsTTM,
        returnOnInvestedCapitalTTM: k.returnOnInvestedCapitalTTM,
        debtEquityRatioTTM:       r.debtToEquityRatioTTM,
        debtToAssetsTTM:          r.debtToAssetsRatioTTM,
        currentRatioTTM:          k.currentRatioTTM,
        dividendYielTTM:          r.dividendYieldTTM,
        netIncomePerShareTTM:     r.netIncomePerShareTTM,
        bookValuePerShareTTM:     r.bookValuePerShareTTM,
        freeCashFlowPerShareTTM:  r.freeCashFlowPerShareTTM,
        evToEBITDATTM:            k.evToEBITDATTM,
        evToSalesTTM:             k.evToSalesTTM,
      };

      // 2) If FMP returned no meaningful data, fall back to Yahoo Finance
      const hasFmpData = Object.values(fmpRatios).some(v => v != null);
      if (!hasFmpData) {
        try {
          const yData = await yahooRatios(symbol);
          return [yData];
        } catch (yErr) {
          // Yahoo also failed — return empty ratios rather than an error
          return [fmpRatios];
        }
      }

      // 3) FMP has some data — fill any null fields from Yahoo Finance
      try {
        const yData = await yahooRatios(symbol);
        const merged = { ...fmpRatios };
        for (const key of Object.keys(fmpRatios)) {
          if (merged[key] == null && yData[key] != null) merged[key] = yData[key];
        }
        return [merged];
      } catch {
        // Yahoo failed — return whatever FMP gave us
        return [fmpRatios];
      }
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Growth ───────────────────────────────────────────────────────────────────
router.get('/growth/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cached(`growth_${symbol}`, async () => {
      // 1. FMP (detailed multi-year growth)
      const fmpData = await fmp('/financial-growth', { symbol, limit: 5 }).catch(() => null);
      if (Array.isArray(fmpData) && fmpData.length > 0) return fmpData;
      // 2. Yahoo Finance (earningsGrowth / revenueGrowth for any symbol)
      return await yahooGrowth(symbol).catch(() => []);
    });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── History (Yahoo as PRIMARY — works for all world markets) ─────────────────
router.get('/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { from, to } = req.query;
    const data = await cached(`history_${symbol}_${from}_${to}`, async () => {
      // 1. Yahoo Finance — primary (OHLCV, all markets, free)
      const yData = await yahooHistory(symbol, from, to).catch(() => null);
      if (yData && yData.length > 0) return yData;
      // 2. FMP light — fallback (close only, US-heavy)
      return await fmp('/historical-price-eod/light', { symbol, from, to }).catch(() => []);
    });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Sectors — Yahoo Finance (sector ETFs as representatives) ─────────────────
router.get('/sectors', async (req, res) => {
  try {
    const sectorEtfs = [
      { sector: 'Technology',             symbol: 'XLK' },
      { sector: 'Healthcare',             symbol: 'XLV' },
      { sector: 'Financial Services',     symbol: 'XLF' },
      { sector: 'Energy',                 symbol: 'XLE' },
      { sector: 'Consumer Cyclical',      symbol: 'XLY' },
      { sector: 'Consumer Defensive',     symbol: 'XLP' },
      { sector: 'Industrials',            symbol: 'XLI' },
      { sector: 'Communication Services', symbol: 'XLC' },
      { sector: 'Utilities',              symbol: 'XLU' },
      { sector: 'Basic Materials',        symbol: 'XLB' },
      { sector: 'Real Estate',            symbol: 'XLRE' },
    ];
    const data = await cached('sectors', async () => {
      const results = await Promise.allSettled(sectorEtfs.map(({ symbol }) => yf.quote(symbol)));
      return sectorEtfs.map(({ sector, symbol }, i) => {
        const q = results[i].status === 'fulfilled' ? results[i].value : null;
        return {
          sector,
          representative: symbol,
          changesPercentage: q?.regularMarketChangePercent ?? 0,
          price: q?.regularMarketPrice ?? 0,
        };
      });
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Indexes — Yahoo Finance (real world indices) ────────────────────────────
router.get('/indexes', async (req, res) => {
  try {
    const INDICES = [
      { symbol: '^GSPC',      displayName: 'S&P 500 (USA)' },
      { symbol: '^IXIC',      displayName: 'NASDAQ (USA)' },
      { symbol: 'FTSEMIB.MI', displayName: 'FTSE MIB (Italia)' },
      { symbol: '^GDAXI',     displayName: 'DAX (Germania)' },
      { symbol: '^FTSE',      displayName: 'FTSE 100 (UK)' },
      { symbol: '000001.SS',  displayName: 'Shanghai (Cina)' },
      { symbol: '^N225',      displayName: 'Nikkei 225 (Giappone)' },
      { symbol: '^FCHI',      displayName: 'CAC 40 (Francia)' },
    ];
    const data = await cached('indexes', async () => {
      const results = await Promise.allSettled(INDICES.map(({ symbol }) => yf.quote(symbol)));
      return INDICES.map(({ symbol, displayName }, i) => {
        const q = results[i].status === 'fulfilled' ? results[i].value : null;
        return {
          symbol,
          displayName,
          name:              q?.longName || q?.shortName || displayName,
          price:             q?.regularMarketPrice ?? null,
          change:            q?.regularMarketChange ?? null,
          changesPercentage: q?.regularMarketChangePercent ?? null,
          changePercentage:  q?.regularMarketChangePercent ?? null,
          currency:          q?.currency,
        };
      }).filter(i => i.price != null);
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Global Ticker Band ───────────────────────────────────────────────────────
const TICKER_META = [
  { symbol: '^GSPC',      name: 'S&P 500'    },
  { symbol: '^IXIC',      name: 'NASDAQ'     },
  { symbol: 'FTSEMIB.MI', name: 'FTSE MIB'  },
  { symbol: '^GDAXI',     name: 'DAX'        },
  { symbol: '^FTSE',      name: 'FTSE 100'   },
  { symbol: '^N225',      name: 'Nikkei'     },
  { symbol: '000001.SS',  name: 'Shanghai'   },
  { symbol: 'GC=F',       name: 'Oro'        },
  { symbol: 'CL=F',       name: 'WTI'        },
  { symbol: 'SI=F',       name: 'Argento'    },
  { symbol: 'BTC-USD',    name: 'BTC'        },
  { symbol: 'ETH-USD',    name: 'ETH'        },
  { symbol: 'EURUSD=X',   name: 'EUR/USD'    },
  { symbol: 'GBPUSD=X',   name: 'GBP/USD'   },
  { symbol: '^VIX',       name: 'VIX'        },
  { symbol: '^TNX',       name: 'T-Note 10Y' },
];

router.get('/ticker', async (req, res) => {
  try {
    const quotes = await Promise.allSettled(
      TICKER_META.map(m => cachedRT(`ticker_${m.symbol}`, () => yf.quote(m.symbol)))
    );
    const items = TICKER_META.map((m, i) => {
      const q = quotes[i].status === 'fulfilled' ? quotes[i].value : null;
      return {
        symbol:        m.symbol,
        name:          m.name,
        price:         q?.regularMarketPrice         ?? null,
        changePercent: q?.regularMarketChangePercent ?? null,
        currency:      q?.currency                   ?? null,
      };
    }).filter(x => x.price != null);
    res.json({ items, fetchedAt: Date.now() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Search helpers ────────────────────────────────────────────────────────────
const US_EXCHANGES_FMP   = new Set(['NASDAQ','NYSE','AMEX']);
const US_EXCHANGES_YAHOO = new Set(['NCM','NMS','NGM','NYQ','NAS','NGS','AMX','PCX','BTS','NasdaqGS','NasdaqCM','NasdaqGM']);
const MAIN_EXCHANGES     = new Set(['MIL','PAR','LON','TYO','SHH','SZI','XETRA','GER','FRA','STO','SIX']);

function exchangePriorityFmp(exch = '') {
  if (US_EXCHANGES_FMP.has(exch)) return 0;
  if (MAIN_EXCHANGES.has(exch))   return 1;
  if (exch === 'OTC')             return 3;
  return 2;
}
function exchangePriorityYahoo(exch = '') {
  if (US_EXCHANGES_YAHOO.has(exch)) return 0;
  if (MAIN_EXCHANGES.has(exch))     return 1;
  if (/otc|pink/i.test(exch))       return 3;
  return 2;
}
function isEtf(name = '', type = '') {
  return /\betf\b/i.test(name) || /fund|trust|etf/i.test(type);
}

// ─── Search by name ───────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);
    const query   = q.trim();
    const noSpace = query.replace(/\s+/g, '');  // "Service Now" → "ServiceNow"

    // ── 0. Commodity / futures dictionary — Italian + English terms ───────────
    const commodityHit = COMMODITY_DICT[query.toLowerCase()];
    if (commodityHit) {
      return res.json([{
        symbol:   commodityHit.symbol,
        name:     commodityHit.name,
        exchange: commodityHit.exchange,
        _type:    commodityHit.type,
      }]);
    }

    // ── 1. FMP stable search-name (try original + no-space variant together) ──
    const fmpQueries = [query];
    if (noSpace !== query && noSpace.length >= 2) fmpQueries.push(noSpace);

    const fmpResults = await Promise.any(
      fmpQueries.map(qv => fmp('/search-name', { query: qv, limit: 10 }))
    ).catch(() => []);

    // ── 2. Yahoo Finance search (always run in parallel for richer coverage) ──
    const yahooRaw = await yf.search(query, { newsCount: 0, quotesCount: 10 }).catch(() => null);
    const ALLOWED_TYPES = new Set(['EQUITY','ETF','FUTURE','CRYPTOCURRENCY','CURRENCY']);
    const yahooResults = (yahooRaw?.quotes || [])
      .filter(item => item?.symbol && ALLOWED_TYPES.has(item.quoteType))
      .map(item => ({
        symbol:           item.symbol,
        name:             item.longname || item.shortname || item.symbol,
        exchange:         item.exchDisp || item.exchange || '',
        exchangeFullName: item.exchDisp || item.exchange || '',
        _fromYahoo:       true,
        _quoteType:       item.quoteType,
      }));

    // ── 3. If both empty and query had spaces → try Yahoo with no-space variant ──
    let yahooFallback = [];
    if ((fmpResults || []).length === 0 && yahooResults.length === 0 && noSpace !== query) {
      const yRaw2 = await yf.search(noSpace, { newsCount: 0, quotesCount: 10 }).catch(() => null);
      yahooFallback = (yRaw2?.quotes || [])
        .filter(item => item?.symbol && item.quoteType === 'EQUITY')
        .map(item => ({ symbol: item.symbol, name: item.longname || item.shortname || item.symbol, exchange: item.exchange || '', exchangeFullName: item.exchDisp || '', _fromYahoo: true, _quoteType: item.quoteType }));
    }

    // ── 4. CamelCase fallback — if the query is one CamelCase word (e.g. "MicroStrategy"),
    //       split it at uppercase boundaries and search each meaningful part.
    //       This handles company renames (MicroStrategy → Strategy → MSTR).
    let camelResults = [];
    if (yahooFallback.length === 0 && /^[A-Z][a-z]/.test(query) && !query.includes(' ')) {
      // Split "MicroStrategy" → ["Micro", "Strategy"]
      const parts = query.split(/(?=[A-Z][a-z])/).filter(p => p.length >= 3);
      if (parts.length > 1) {
        // Try parts from the end backwards (most specific part last)
        for (const part of [...parts].reverse()) {
          if (part === query) continue; // skip if same as full query
          const yPart = await yf.search(part, { newsCount: 0, quotesCount: 5 }).catch(() => null);
          const partEquities = (yPart?.quotes || [])
            .filter(item => item?.symbol && item.quoteType === 'EQUITY' && US_EXCHANGES_YAHOO.has(item.exchange))
            .map(item => ({ symbol: item.symbol, name: item.longname || item.shortname || item.symbol, exchange: item.exchange, exchangeFullName: item.exchDisp || item.exchange, _fromYahoo: true, _quoteType: item.quoteType }));
          if (partEquities.length > 0) { camelResults = partEquities; break; }
        }
      }
    }

    // ── 5. Merge — FMP results first, then Yahoo, then CamelCase (deduplicate by symbol) ──
    const seen = new Set();
    const combined = [];
    for (const item of [...(fmpResults || []), ...yahooResults, ...yahooFallback, ...camelResults]) {
      if (!item?.symbol || seen.has(item.symbol)) continue;
      seen.add(item.symbol);
      combined.push(item);
    }

    if (combined.length === 0) return res.json([]);

    // ── 6. Rank: exact ticker match first, then US stocks, ETFs last ──
    const queryUpper = query.toUpperCase();
    combined.sort((a, b) => {
      // Exact ticker match always wins
      const aExact = a.symbol.toUpperCase() === queryUpper ? 0 : 1;
      const bExact = b.symbol.toUpperCase() === queryUpper ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      // Then exchange priority
      const ap = a._fromYahoo ? exchangePriorityYahoo(a.exchange) : exchangePriorityFmp(a.exchange);
      const bp = b._fromYahoo ? exchangePriorityYahoo(b.exchange) : exchangePriorityFmp(b.exchange);
      if (ap !== bp) return ap - bp;
      // Same tier: prefer non-ETFs
      const ae = isEtf(a.name, a._quoteType) ? 1 : 0;
      const be = isEtf(b.name, b._quoteType) ? 1 : 0;
      return ae - be;
    });

    // ── 7. Clean up internal fields before sending ──
    const final = combined.slice(0, 6).map(({ _fromYahoo, _quoteType, ...rest }) => rest);
    res.json(final);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Gainers — Yahoo Finance screener ────────────────────────────────────────
router.get('/gainers', async (req, res) => {
  try {
    const data = await cached('gainers', async () => {
      const result = await yf.screener({ scrIds: 'day_gainers', count: 12, region: 'US', lang: 'en-US' });
      return (result?.quotes || [])
        .filter(q => q.regularMarketPrice > 1)
        .slice(0, 8)
        .map(q => ({
          symbol:            q.symbol,
          name:              q.longName || q.shortName || q.symbol,
          price:             q.regularMarketPrice,
          change:            q.regularMarketChange,
          changePercentage:  q.regularMarketChangePercent,
          changesPercentage: q.regularMarketChangePercent,
          volume:            q.regularMarketVolume,
        }));
    });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Losers — Yahoo Finance screener ─────────────────────────────────────────
router.get('/losers', async (req, res) => {
  try {
    const data = await cached('losers', async () => {
      const result = await yf.screener({ scrIds: 'day_losers', count: 12, region: 'US', lang: 'en-US' });
      return (result?.quotes || [])
        .filter(q => q.regularMarketPrice > 1)
        .slice(0, 8)
        .map(q => ({
          symbol:            q.symbol,
          name:              q.longName || q.shortName || q.symbol,
          price:             q.regularMarketPrice,
          change:            q.regularMarketChange,
          changePercentage:  q.regularMarketChangePercent,
          changesPercentage: q.regularMarketChangePercent,
          volume:            q.regularMarketVolume,
        }));
    });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Screener — Yahoo Finance for all markets ────────────────────────────────
router.get('/screen', async (req, res) => {
  try {
    const { sector, exchange, marketCapMin, marketCapMax, limit = 20 } = req.query;

    let filtered = [...STATIC_POOL];

    // Market filter
    if (exchange && exchange !== '') {
      if (exchange === 'USA' || exchange === 'NASDAQ,NYSE' || exchange === 'NASDAQ' || exchange === 'NYSE') {
        filtered = filtered.filter(p => p.market === 'USA');
      } else if (['ITALIA', 'EUROPA', 'CINA', 'GIAPPONE'].includes(exchange)) {
        filtered = filtered.filter(p => p.market === exchange);
      }
      // '' = all markets — no filter
    }

    if (sector && sector !== '')
      filtered = filtered.filter(p => p.sector.toLowerCase().includes(sector.toLowerCase()));

    if (marketCapMin && Number(marketCapMin) > 0)
      filtered = filtered.filter(p => p.marketCap >= Number(marketCapMin) * 1e9);
    if (marketCapMax && Number(marketCapMax) > 0)
      filtered = filtered.filter(p => p.marketCap <= Number(marketCapMax) * 1e9);

    const top = filtered.slice(0, Number(limit));

    const fetchedAt = Date.now();

    // Fetch fundamentals (5 min cache) + RSI histories (5 min) + real-time quotes (90s) in parallel
    const [summaries, rsiHistories, rtQuotes] = await Promise.all([
      Promise.allSettled(top.map(p => cached(`screen_fund_${p.symbol}`, () =>
        yf.quoteSummary(p.symbol, {
          modules: ['defaultKeyStatistics', 'financialData', 'summaryDetail'],
        })
      ))),
      Promise.allSettled(top.map(p => cached(`rsi_${p.symbol}`, async () => {
        const from = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
        return yahooHistory(p.symbol, from, null);
      }))),
      Promise.allSettled(top.map(p => cachedRT(`screen_rt_${p.symbol}`, () =>
        yf.quote(p.symbol)
      ))),
    ]);

    const out = top.map((p, i) => {
      const r   = summaries[i].status === 'fulfilled' ? summaries[i].value : null;
      const qt  = rtQuotes[i].status === 'fulfilled' ? rtQuotes[i].value : null;
      const ks  = r?.defaultKeyStatistics || {};
      const fd  = r?.financialData        || {};
      const sd  = r?.summaryDetail        || {};

      // Yahoo debtToEquity is in % (e.g. 79.5 = 0.795x), normalise to ratio
      const debtEq = fd.debtToEquity != null ? +(fd.debtToEquity / 100).toFixed(4) : undefined;

      // RSI from history (hist is newest-first, need oldest-first for computeRSI)
      const hist = rsiHistories[i].status === 'fulfilled' ? (rsiHistories[i].value || []) : [];
      const closes = [...hist].reverse().map(d => d.close).filter(Boolean);
      const rsi = closes.length >= 15 ? computeRSI(closes) : null;

      return {
        symbol:             p.symbol,
        companyName:        p.companyName,
        sector:             p.sector,
        exchange:           p.exchange,
        market:             p.market,
        marketCap:          qt?.marketCap ?? p.marketCap,
        price:              qt?.regularMarketPrice       ?? null,
        changePercentage:   qt?.regularMarketChangePercent ?? null,
        volume:             qt?.regularMarketVolume      ?? null,
        currency:           qt?.currency ?? sd.currency ?? 'USD',
        yearHigh:           qt?.fiftyTwoWeekHigh ?? sd.fiftyTwoWeekHigh ?? null,
        yearLow:            qt?.fiftyTwoWeekLow  ?? sd.fiftyTwoWeekLow  ?? null,
        avgVolume:          qt?.averageDailyVolume3Month ?? sd.averageVolume ?? null,
        rsi,
        beta:               qt?.beta ?? ks.beta ?? null,
        lastAnnualDividend: p.lastDividend || 0,
        fetchedAt,
        _ratios: r ? {
          peRatioTTM:          qt?.trailingPE ?? sd.trailingPE ?? undefined,
          pegRatioTTM:         ks.pegRatio              ?? undefined,
          priceToBookRatioTTM: ks.priceToBook           ?? undefined,
          netProfitMarginTTM:  fd.profitMargins         ?? undefined,
          returnOnEquityTTM:   fd.returnOnEquity        ?? undefined,
          debtEquityRatioTTM:  debtEq,
          dividendYielTTM:     sd.trailingAnnualDividendYield ?? undefined,
          netIncomePerShareTTM: ks.trailingEps          ?? undefined,
          epsGrowth:           fd.earningsGrowth != null ? +(fd.earningsGrowth * 100).toFixed(1) : null,
        } : null,
      };
    });

    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Candles — Yahoo PRIMARY (full OHLCV for all markets) ────────────────────
router.get('/candles/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { from, to } = req.query;
    const data = await cached(`candles_${symbol}_${from}`, async () => {
      // 1. Yahoo chart() — primary (full OHLCV, all world markets, free)
      const yData = await yahooHistory(symbol, from, to).catch(() => null);
      if (yData && yData.length > 0) return yData;
      // 2. FMP full OHLCV — fallback
      const full = await fmp('/historical-price-eod', { symbol, from, to }).catch(() => null);
      if (Array.isArray(full) && full.length > 0 && full[0]?.open != null) return full;
      // 3. FMP light — last resort (close only)
      const light = await fmp('/historical-price-eod/light', { symbol, from, to }).catch(() => []);
      return Array.isArray(light) ? light : (light?.historical || []);
    });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── RSI — calculated server-side from 60 days of Yahoo history ──────────────
router.get('/rsi/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cached(`rsi_${symbol}`, async () => {
      const from = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
      const history = await yahooHistory(symbol, from, null).catch(() => []);
      if (!history || history.length < 16) return { symbol, rsi: null };
      const closes = [...history].reverse().map(d => d.close).filter(c => c != null);
      const rsi = computeRSI(closes);
      return { symbol, rsi };
    }, 300); // 5-min TTL
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Technical Analysis: support/resistance, trend line, basic patterns ──────
router.get('/technical-analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cached(`techan_${symbol}`, async () => {
      const from = new Date(Date.now() - 185 * 86400000).toISOString().split('T')[0];
      const history = await yahooHistory(symbol, from, null).catch(() => []);
      const candles = [...history].reverse() // oldest -> newest
        .filter(c => c.high != null && c.low != null && c.close != null);

      if (candles.length < 20) {
        return { symbol, currentPrice: null, trend: null, trendLine: null, supports: [], resistances: [], pattern: null };
      }

      const currentPrice = candles[candles.length - 1].close;

      const { highs, lows } = findPivots(candles, 3);
      const levels = groupLevels([...highs, ...lows], 0.015);

      const supports = levels.filter(g => g.avg < currentPrice)
        .sort((a, b) => b.avg - a.avg).slice(0, 3)
        .map(g => ({ price: +g.avg.toFixed(2), touches: g.touches.length }));

      const resistances = levels.filter(g => g.avg > currentPrice)
        .sort((a, b) => a.avg - b.avg).slice(0, 3)
        .map(g => ({ price: +g.avg.toFixed(2), touches: g.touches.length }));

      // Trend over the last 30 trading days: linear regression slope -> direction
      const trendWindow = candles.slice(-30);
      const closes = trendWindow.map(c => c.close);
      const { slope, intercept } = linearRegression(closes);
      const startVal = intercept;
      const endVal = slope * (closes.length - 1) + intercept;
      const avgVal = closes.reduce((s, v) => s + v, 0) / closes.length;
      const changePercent = avgVal ? +(((endVal - startVal) / avgVal) * 100).toFixed(2) : 0;
      const direction = Math.abs(changePercent) < 3 ? 'sideways' : (changePercent > 0 ? 'bullish' : 'bearish');
      const trendLine = {
        from: { date: trendWindow[0].date, price: +startVal.toFixed(2) },
        to:   { date: trendWindow[trendWindow.length - 1].date, price: +endVal.toFixed(2) },
      };

      let pattern = detectDoubleTopBottom(highs, lows) || detectHeadShoulders(highs, lows) || detectTriangle(highs, lows);
      if (pattern) {
        pattern = { ...pattern };
        for (const k of Object.keys(pattern)) { if (typeof pattern[k] === 'number') pattern[k] = +pattern[k].toFixed(2); }
      }

      return {
        symbol,
        currentPrice: +currentPrice.toFixed(2),
        trend: { direction, changePercent },
        trendLine,
        supports,
        resistances,
        pattern,
      };
    }, 1800); // 30-min TTL
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Peers (similar companies) ────────────────────────────────────────────────
router.get('/peers/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cached(`peers_${symbol}`, async () => {
      const fmpPeers = await fmp('/stock-peers', { symbol }).catch(() => null);
      if (fmpPeers?.[0]?.peersList) return fmpPeers[0].peersList.slice(0, 6);
      // Fallback: sector-based from STATIC_POOL
      const prof = await fmp('/profile', { symbol }).catch(() => []);
      const sector = prof?.[0]?.sector || '';
      return STATIC_POOL
        .filter(s => s.symbol !== symbol && s.sector.toLowerCase().includes(sector.toLowerCase().split(' ')[0]))
        .slice(0, 6).map(s => s.symbol);
    });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Dividends ────────────────────────────────────────────────────────────────
router.get('/dividends/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cached(`dividends_${symbol}`, async () => {
      const divs = await fmp('/dividends', { symbol, limit: 20 }).catch(() => null);
      if (Array.isArray(divs) && divs.length > 0) return divs;
      // Fallback: construct from profile lastDividend
      const prof = await fmp('/profile', { symbol }).catch(() => []);
      const p = prof?.[0];
      if (p?.lastDividend > 0) {
        const yr = new Date().getFullYear();
        return Array.from({ length: 5 }, (_, i) => ({
          date: `${yr - i}-12-15`, dividend: +(p.lastDividend).toFixed(4),
          adjDividend: +(p.lastDividend).toFixed(4), label: `${yr - i}`,
        }));
      }
      return [];
    });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Crypto via CoinGecko ─────────────────────────────────────────────────────
router.get('/crypto', async (req, res) => {
  try {
    const data = await cached('crypto', async () => {
      const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: { ids: 'bitcoin,ethereum,solana', vs_currencies: 'usd', include_24hr_change: true },
      });
      return [
        { symbol: 'BTC', name: 'Bitcoin',  price: data.bitcoin?.usd,  change: data.bitcoin?.usd_24h_change  },
        { symbol: 'ETH', name: 'Ethereum', price: data.ethereum?.usd, change: data.ethereum?.usd_24h_change },
        { symbol: 'SOL', name: 'Solana',   price: data.solana?.usd,   change: data.solana?.usd_24h_change   },
      ];
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Market news (top headlines) — must come BEFORE /news/:query ──────────────
router.get('/news/market', async (req, res) => {
  try {
    const data = await cached('news_market', async () => {
      const { data } = await axios.get('https://newsapi.org/v2/top-headlines', {
        params: { category: 'business', language: 'en', pageSize: 8, apiKey: NEWS_API_KEY },
      });
      return data;
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── News ────────────────────────────────────────────────────────────────────
router.get('/news/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const data = await cached(`news_${query}`, async () => {
      const { data } = await axios.get('https://newsapi.org/v2/everything', {
        params: { q: query, sortBy: 'publishedAt', pageSize: 10, language: 'en', apiKey: NEWS_API_KEY },
      });
      return data;
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Gemini helper — tries gemini-2.0-flash, falls back to gemini-1.5-flash ──
async function callGemini(prompt, timeout = 15000) {
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastErr;
  for (const model of models) {
    try {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        { contents: [{ parts: [{ text: prompt }] }] },
        { timeout }
      );
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (err) {
      lastErr = err;
      if (err.response?.status === 503) continue;
      throw err;
    }
  }
  throw lastErr;
}

// ─── Translate text via Gemini ────────────────────────────────────────────────
router.post('/translate', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.json({ translated: text });
    const prompt = `Traduci in italiano questo testo. Mantieni nomi propri, sigle e ticker invariati. Rispondi SOLO con il testo tradotto, senza spiegazioni:\n${text.slice(0, 500)}`;
    const translated = await callGemini(prompt, 12000);
    res.json({ translated: translated.trim() || text });
  } catch { res.json({ translated: req.body.text }); }
});

// ─── Translate news titles batch ──────────────────────────────────────────────
router.post('/translate-titles', async (req, res) => {
  try {
    const { titles } = req.body;
    if (!titles?.length) return res.json({ titles });
    const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const prompt = `Traduci in italiano questi titoli di notizie finanziarie. Mantieni nomi propri, sigle, ticker e cifre invariati. Rispondi SOLO con i titoli tradotti numerati, uno per riga:\n${numbered}`;
    const raw = await callGemini(prompt, 15000);
    const lines = raw.trim().split('\n').filter(l => /^\d+\./.test(l.trim()));
    const translated = titles.map((orig, i) => {
      const match = lines.find(l => l.trim().startsWith(`${i + 1}.`));
      return match ? match.replace(/^\d+\.\s*/, '').trim() : orig;
    });
    res.json({ titles: translated });
  } catch { res.json({ titles: req.body.titles }); }
});

// ─── Gemini generic ───────────────────────────────────────────────────────────
router.post('/gemini', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const text = await callGemini(prompt, 10000);
    res.json({ text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Short interest analysis ──────────────────────────────────────────────────
router.post('/short/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    // 1. Yahoo Finance real data — populated for most US stocks
    const yStats = await yf.quoteSummary(symbol, { modules: ['defaultKeyStatistics'] }).catch(() => null);
    const ks = yStats?.defaultKeyStatistics || {};
    if (ks.sharesShort != null && ks.shortPercentOfFloat != null) {
      return res.json({
        shortInterest: +(ks.shortPercentOfFloat * 100).toFixed(2),
        daysToCover:   ks.shortRatio     != null ? +ks.shortRatio.toFixed(1)            : null,
        sharesShorted: ks.sharesShort    != null ? +(ks.sharesShort / 1e6).toFixed(2)   : null,
        trend: null, analisi: null, _realData: true,
      });
    }

    // 2. Gemini estimate with non-US aware prompt
    const [quote, profile, ratios] = await Promise.all([
      cached(`quote_${symbol}`, () => fmp('/quote', { symbol })).catch(() => [null]),
      cached(`profile_${symbol}`, () => fmp('/profile', { symbol })).catch(() => [{}]),
      cached(`ratios_short_${symbol}`, async () => {
        const [rtR, kmR] = await Promise.allSettled([fmp('/ratios-ttm', { symbol }), fmp('/key-metrics-ttm', { symbol })]);
        return [{
          peRatioTTM: (rtR.status === 'fulfilled' ? rtR.value[0] : null)?.priceToEarningsRatioTTM,
          returnOnEquityTTM: (kmR.status === 'fulfilled' ? kmR.value[0] : null)?.returnOnEquityTTM,
        }];
      }).catch(() => [{}]),
    ]);

    const isNonUS = symbol.includes('.') || /^\d/.test(symbol);
    const companyName = profile[0]?.companyName || symbol;
    const prompt = isNonUS
      ? `Fornisci i dati short interest pubblici più recenti per il titolo ${symbol} (${companyName}).${symbol.endsWith('.MI') ? ' Per titoli italiani verifica le posizioni short CONSOB pubbliche.' : ''} Rispondi SOLO in JSON: {"shortInterest":<% float o null>,"daysToCover":<giorni o null>,"sharesShorted":<milioni o null>,"trend":"aumentando|stabile|diminuendo","analisi":"..."}`
      : `Analizza brevemente il titolo ${symbol} (${companyName}) come potenziale short sell. Prezzo: ${quote[0]?.price}, P/E: ${ratios[0]?.peRatioTTM?.toFixed(2)}, Settore: ${profile[0]?.sector}. Fornisci in JSON: {"shortInterest":<numero % stimato 0-30>,"daysToCover":<numero 1-10>,"sharesShorted":<numero milioni>,"trend":"aumentando|stabile|diminuendo","analisi":"...testo breve..."}`;

    let result = { shortInterest: null, daysToCover: null, sharesShorted: null, trend: null, analisi: null };
    try {
      const raw = await callGemini(prompt, 10000);
      const parsed = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      result = { ...result, ...parsed };
    } catch {}

    // Flag when all key fields are null so frontend can show proper empty state
    if (result.shortInterest == null && result.daysToCover == null && result.sharesShorted == null) {
      result._noData = true;
      result._isNonUS = isNonUS;
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Commodity-specific news queries ─────────────────────────────────────────
const COMMODITY_NEWS_QUERY = {
  'GC=F':    'gold price commodity market',
  'SI=F':    'silver price commodity market',
  'CL=F':    'crude oil WTI price',
  'BZ=F':    'brent crude oil price',
  'NG=F':    'natural gas price energy',
  'HG=F':    'copper price commodity',
  'ZW=F':    'wheat price commodity grain',
  'ZC=F':    'corn price commodity grain',
  'KC=F':    'coffee price commodity',
  'BTC-USD': 'bitcoin price crypto',
  'ETH-USD': 'ethereum price crypto',
};

// Common corporate suffixes to exclude from keyword extraction
const CORP_SUFFIXES = new Set(['inc','ltd','corp','llc','plc','nv','sa','spa','ag','se','co','the']);

/** Extract relevance keywords from a ticker + optional company name.
 *  Skips the root ticker when it's a short ambiguous common word and company
 *  name provides stronger (longer) keywords — prevents "NOW" matching everything.
 */
function buildKeywords(symbol, companyName) {
  const root = symbol.split('.')[0].split('-')[0].toLowerCase();
  const nameKws = new Set();
  if (companyName) {
    companyName.replace(/[,\.\(\)]/g, '').split(/\s+/).forEach(w => {
      const wl = w.toLowerCase();
      if (wl.length >= 2 && !CORP_SUFFIXES.has(wl)) nameKws.add(wl);
    });
  }
  const kws = new Set(nameKws);
  // Add root ticker only if ≥ 4 chars (unambiguous) OR name provides no long keyword
  const hasStrongNameKw = [...nameKws].some(kw => kw.length >= 4);
  if (root.length >= 4 || !hasStrongNameKw) kws.add(root);
  return [...kws];
}

/** Match title against keywords: word-boundary match for terms < 4 chars. */
function titleMatchesKeywords(title, keywords) {
  if (!keywords.length) return true;
  const t = title.toLowerCase();
  return keywords.some(kw => {
    if (kw.length >= 4) return t.includes(kw);
    return new RegExp(`\\b${kw}\\b`, 'i').test(title);
  });
}

// ─── Sentiment ───────────────────────────────────────────────────────────────
router.post('/sentiment/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { companyName } = req.body || {};

    const isCom = isCommoditySymbol(symbol);
    const comNewsQ = COMMODITY_NEWS_QUERY[symbol];
    const keywords = isCom ? [] : buildKeywords(symbol, companyName);

    // ── 1. Yahoo Finance news — primary source, pre-filtered per symbol ──────
    const toArticle = n => ({
      title:       n.title,
      url:         n.link,
      publishedAt: n.providerPublishTime
        ? new Date(n.providerPublishTime * 1000).toISOString()
        : new Date().toISOString(),
      source: { name: n.publisher || 'Yahoo Finance' },
    });

    let yahooArticles = [];
    try {
      const yRes = await yf.search(symbol, { newsCount: 10, quotesCount: 0 });
      const raw = (yRes?.news || []).map(toArticle);

      if (!isCom && keywords.length > 0) {
        const filtered = raw.filter(a => titleMatchesKeywords(a.title, keywords));
        // Never fall back to unrelated articles: prefer 0 relevant over 8 irrelevant
        yahooArticles = filtered;
      } else {
        yahooArticles = raw;
      }

      // For non-US tickers (exchange suffix .MI .DE .PA .L etc.), also query
      // Yahoo by company name first word to catch English-language coverage
      if (!isCom && symbol.includes('.') && companyName) {
        const nameRoot = companyName.split(/\s+/)[0];
        if (nameRoot && nameRoot.length >= 2) {
          const yRes2 = await yf.search(nameRoot, { newsCount: 10, quotesCount: 0 }).catch(() => null);
          const extra = (yRes2?.news || []).map(toArticle)
            .filter(a => titleMatchesKeywords(a.title, keywords));
          yahooArticles = [...yahooArticles, ...extra];
        }
      }
    } catch {}

    // ── 2. NewsAPI — precise query, relevance-filtered ────────────────────────
    let newsApiArticles = [];
    try {
      let newsQ;
      if (comNewsQ) {
        newsQ = comNewsQ;
      } else if (companyName) {
        newsQ = `"${companyName}" OR "${symbol.split('.')[0]}"`;
      } else {
        newsQ = `"${symbol.split('.')[0]}"`;
      }

      const { data: newsData } = await axios.get('https://newsapi.org/v2/everything', {
        params: { q: newsQ, sortBy: 'publishedAt', pageSize: 12, language: 'en', apiKey: NEWS_API_KEY },
        timeout: 8000,
      });

      newsApiArticles = (newsData?.articles || []).filter(a => {
        if (!a.title) return false;
        if (isCom) return true;
        return titleMatchesKeywords(a.title, keywords);
      });
    } catch {}

    // ── 3. Merge: Yahoo first, then NewsAPI; deduplicate by title prefix ──────
    const seen = new Set();
    const articles = [];
    for (const a of [...yahooArticles, ...newsApiArticles]) {
      if (!a.title || !a.url) continue;
      const key = a.title.slice(0, 80).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      articles.push(a);
    }
    articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // ── 4. Gemini sentiment analysis ──────────────────────────────────────────
    const headlines = articles.slice(0, 10).map(a => a.title).filter(Boolean).join('\n') || 'No news available';
    const subjectLabel = companyName ? `${symbol} (${companyName})` : symbol;
    const prompt = `Analizza il sentiment per ${subjectLabel} da queste notizie:\n${headlines}\nRispondi in JSON: {"label":"Bullish|Bearish|Neutro","score":<numero -100 a +100>,"positive":<count>,"neutral":<count>,"negative":<count>,"summary":"...breve in italiano..."}`;

    let result = { label: 'Neutro', score: 0, positive: 0, neutral: 0, negative: 0, summary: '' };
    try {
      const raw = await callGemini(prompt, 10000);
      result = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch {}

    res.json({ ...result, articles: articles.slice(0, 8) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── AI Full Analysis ─────────────────────────────────────────────────────────
router.post('/analyze/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const [quote, profile, ratiosRaw, kmRaw, growth] = await Promise.all([
      cached(`quote_${symbol}`, () => fmp('/quote', { symbol })),
      cached(`profile_${symbol}`, () => fmp('/profile', { symbol })),
      fmp('/ratios-ttm', { symbol }),
      fmp('/key-metrics-ttm', { symbol }),
      cached(`growth_${symbol}`, () => fmp('/financial-growth', { symbol, limit: 3 })),
    ]);
    const q = quote[0] || {}, p = profile[0] || {}, r = ratiosRaw[0] || {}, k = kmRaw[0] || {}, g = growth[0] || {};
    const pe       = r.priceToEarningsRatioTTM?.toFixed(2) || 'N/D';
    const pb       = r.priceToBookRatioTTM?.toFixed(2) || 'N/D';
    const roe      = k.returnOnEquityTTM != null ? (k.returnOnEquityTTM * 100).toFixed(1) + '%' : 'N/D';
    const margin   = r.netProfitMarginTTM != null ? (r.netProfitMarginTTM * 100).toFixed(1) + '%' : 'N/D';
    const debtEq   = r.debtToEquityRatioTTM?.toFixed(2) || 'N/D';
    const revGrowth = g.revenueGrowth != null ? (g.revenueGrowth * 100).toFixed(1) + '%' : 'N/D';
    const prompt = `Fai un'analisi fondamentale completa di ${symbol} (${p.companyName}) in italiano.
Dati chiave:
- Prezzo: $${q.price}, 52W: $${q.yearLow}–$${q.yearHigh}
- Market Cap: $${p.marketCap ? (p.marketCap / 1e9).toFixed(1) : '?'}B, Settore: ${p.sector || 'N/D'}
- P/E: ${pe}, P/B: ${pb}, ROE: ${roe}, Margine: ${margin}
- Rev Growth: ${revGrowth}, Debt/Equity: ${debtEq}
Rispondi SOLO in JSON (niente markdown):
{"verdict":"Forte Acquisto|Acquisto|Neutro|Vendita|Forte Vendita","score":<0-100>,"orizzonte":"Breve|Medio|Lungo termine","target_price":<numero|null>,"punti_forza":["...","...","..."],"rischi":["...","...","..."],"analisi_fondamentale":"...","analisi_tecnica":"..."}`;
    let aiData;
    try {
      const raw = await callGemini(prompt, 15000);
      try { aiData = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()); }
      catch { aiData = { verdict: 'Neutro', score: 50, punti_forza: [], rischi: [], analisi_fondamentale: raw }; }
    } catch {
      aiData = {
        verdict: 'N/D', score: null, orizzonte: null, target_price: null,
        punti_forza: [], rischi: [],
        analisi_fondamentale: 'Analisi AI temporaneamente non disponibile',
        analisi_tecnica: '',
      };
    }
    res.json(aiData);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Earnings Calendar ────────────────────────────────────────────────────────
router.get('/earnings/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cachedLong(`earnings_${symbol}`, async () => {
      const [calRes, histRes] = await Promise.allSettled([
        yf.quoteSummary(symbol, { modules: ['calendarEvents'] }),
        yf.quoteSummary(symbol, { modules: ['earningsHistory'] }),
      ]);
      const cal  = calRes.status  === 'fulfilled' ? calRes.value  : {};
      const hist = histRes.status === 'fulfilled' ? histRes.value : {};

      const earnings  = cal.calendarEvents?.earnings || {};
      const rawDate   = earnings.earningsDate?.[0];
      const nextDate  = rawDate instanceof Date ? rawDate.toISOString().split('T')[0] : null;

      const history = (hist.earningsHistory?.history || [])
        .filter(h => h.epsActual != null)
        .slice(0, 4)
        .map(h => ({
          quarter:     h.period || '',
          date:        h.quarter instanceof Date ? h.quarter.toISOString().split('T')[0] : null,
          epsEstimate: h.epsEstimate ?? null,
          epsActual:   h.epsActual   ?? null,
          surprise:    h.surprisePercent != null ? +(h.surprisePercent * 100).toFixed(1) : null,
        }));

      return {
        nextDate,
        epsEstimate: earnings.earningsAverage ?? null,
        epsLow:      earnings.earningsLow     ?? null,
        epsHigh:     earnings.earningsHigh    ?? null,
        history,
      };
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Calendar-quarter label for a period end date, e.g. "Q1 2026" */
function quarterLabel(dateStr) {
  const d = new Date(dateStr);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

/** Builds period rows (oldest→newest input) with net margin and YoY changes vs `yoyLag` periods back */
function buildFinancialPeriods(rows, yoyLag) {
  return rows.map((p, i) => {
    const prev = rows[i - yoyLag];
    const netMargin    = p.revenue ? +((p.netIncome / p.revenue) * 100).toFixed(2) : null;
    const yoyRevenue   = prev?.revenue   ? +(((p.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100).toFixed(2) : null;
    const yoyNetIncome = prev?.netIncome ? +(((p.netIncome - prev.netIncome) / Math.abs(prev.netIncome)) * 100).toFixed(2) : null;
    return { period: p.period, revenue: p.revenue, netIncome: p.netIncome, netMargin, yoyRevenue, yoyNetIncome };
  }).reverse(); // most recent first
}

// ─── Income Statement History (Revenue & Net Income, annual + quarterly) ─────
router.get('/income-statement/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cachedLong(`incomestmt_${symbol}`, async () => {
      const [annualRes, quarterlyRes, priceRes] = await Promise.allSettled([
        yf.quoteSummary(symbol, { modules: ['incomeStatementHistory'] }),
        yf.quoteSummary(symbol, { modules: ['incomeStatementHistoryQuarterly'] }),
        yf.quoteSummary(symbol, { modules: ['price'] }),
      ]);
      const currency = priceRes.status === 'fulfilled' ? (priceRes.value.price?.currency ?? null) : null;
      const annualHistory = annualRes.status === 'fulfilled'
        ? (annualRes.value.incomeStatementHistory?.incomeStatementHistory || []) : [];
      const quarterlyHistory = quarterlyRes.status === 'fulfilled'
        ? (quarterlyRes.value.incomeStatementHistoryQuarterly?.incomeStatementHistory || []) : [];

      let annualRows = annualHistory
        .filter(p => p.totalRevenue != null && p.netIncome != null && p.endDate)
        .map(p => ({ period: new Date(p.endDate).getFullYear().toString(), revenue: p.totalRevenue, netIncome: p.netIncome, sortKey: new Date(p.endDate).getTime() }));

      let quarterlyRows = quarterlyHistory
        .filter(p => p.totalRevenue != null && p.netIncome != null && p.endDate)
        .map(p => ({ period: quarterLabel(p.endDate), revenue: p.totalRevenue, netIncome: p.netIncome, sortKey: new Date(p.endDate).getTime() }));

      // FMP fallback if Yahoo gave nothing usable
      if (!annualRows.length) {
        const fmpData = await fmp('/income-statement', { symbol, limit: 5 }).catch(() => null);
        if (Array.isArray(fmpData)) {
          annualRows = fmpData
            .filter(p => p.revenue != null && p.netIncome != null && p.date)
            .map(p => ({ period: (p.calendarYear || p.date || '').toString().slice(0, 4), revenue: p.revenue, netIncome: p.netIncome, sortKey: new Date(p.date).getTime() }))
            .filter(p => p.period);
        }
      }
      if (!quarterlyRows.length) {
        const fmpData = await fmp('/income-statement', { symbol, period: 'quarter', limit: 8 }).catch(() => null);
        if (Array.isArray(fmpData)) {
          quarterlyRows = fmpData
            .filter(p => p.revenue != null && p.netIncome != null && p.date)
            .map(p => ({ period: quarterLabel(p.date), revenue: p.revenue, netIncome: p.netIncome, sortKey: new Date(p.date).getTime() }));
        }
      }

      // Oldest → newest so YoY can be computed against the prior period(s)
      annualRows.sort((a, b) => a.sortKey - b.sortKey);
      quarterlyRows.sort((a, b) => a.sortKey - b.sortKey);

      const periods   = buildFinancialPeriods(annualRows.slice(-5), 1);
      const quarterly = buildFinancialPeriods(quarterlyRows.slice(-8), 4);

      return { symbol, currency, periods, quarterly };
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Analyst Ratings ──────────────────────────────────────────────────────────
router.get('/analysts/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cachedLong(`analysts_${symbol}`, async () => {
      const [recRes, fdRes] = await Promise.allSettled([
        yf.quoteSummary(symbol, { modules: ['recommendationTrend'] }),
        yf.quoteSummary(symbol, { modules: ['financialData'] }),
      ]);
      const rec = recRes.status === 'fulfilled' ? recRes.value.recommendationTrend : null;
      const fd  = fdRes.status  === 'fulfilled' ? fdRes.value.financialData        : null;

      const trend = rec?.trend?.find(t => t.period === '0m') || rec?.trend?.[0] || {};

      return {
        strongBuy:        trend.strongBuy  ?? 0,
        buy:              trend.buy        ?? 0,
        hold:             trend.hold       ?? 0,
        sell:             trend.sell       ?? 0,
        strongSell:       trend.strongSell ?? 0,
        targetMean:       fd?.targetMeanPrice          ?? null,
        targetHigh:       fd?.targetHighPrice          ?? null,
        targetLow:        fd?.targetLowPrice           ?? null,
        recommendation:   fd?.recommendationKey        ?? null,
        numberOfAnalysts: fd?.numberOfAnalystOpinions  ?? null,
      };
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Insider Trading ──────────────────────────────────────────────────────────
router.get('/insider/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cachedLong(`insider_${symbol}`, async () => {
      // 1. FMP /api/v3/insider-trading
      const fmpData = await axios.get('https://financialmodelingprep.com/api/v3/insider-trading', {
        params: { symbol, limit: 10, apikey: FMP_KEY },
        timeout: 8000,
      }).then(r => r.data).catch(() => null);

      if (Array.isArray(fmpData) && fmpData.length > 0) {
        return fmpData.slice(0, 10).map(t => ({
          name:   t.reportingName  || t.reportingOwner || 'N/D',
          role:   t.typeOfOwner    || '',
          type:   t.transactionType || '',
          shares: t.securitiesTransacted ?? null,
          price:  t.price ?? null,
          value:  (t.securitiesTransacted && t.price)
            ? Math.round(t.securitiesTransacted * t.price) : null,
          date:   t.transactionDate || t.filingDate || null,
        }));
      }

      // 2. Yahoo Finance insiderTransactions fallback
      const yRes = await yf.quoteSummary(symbol, { modules: ['insiderTransactions'] }).catch(() => null);
      return (yRes?.insiderTransactions?.transactions || []).slice(0, 10).map(t => ({
        name:   t.filerName       || 'N/D',
        role:   t.filerRelation   || '',
        type:   t.transactionDescription || '',
        shares: t.shares  ?? null,
        price:  null,
        value:  t.value   ?? null,
        date:   t.startDate instanceof Date ? t.startDate.toISOString().split('T')[0] : null,
      }));
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Fear & Greed Index (CNN) ────────────────────────────────────────────────
router.get('/feargreed', async (req, res) => {
  try {
    const data = await cached('feargreed', async () => {
      const { data: cnn } = await axios.get(
        'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
        { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 InvestAI/1.0' } }
      );
      const fg = cnn.fear_and_greed || {};
      const history = (cnn.fear_and_greed_historical?.data || [])
        .slice(-7)
        .map(d => ({
          date:   new Date(+d.x).toISOString().split('T')[0],
          score:  Math.round(+d.y),
          rating: d.rating,
        }));
      return {
        score:     Math.round(fg.score || 0),
        rating:    fg.rating    || 'N/D',
        timestamp: fg.timestamp || new Date().toISOString(),
        previousClose: fg.previous_close ?? null,
        prev1Week:     fg.previous_1_week  ?? null,
        history,
      };
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
