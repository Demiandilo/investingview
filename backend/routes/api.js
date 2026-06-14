const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const { default: YahooFinance } = require('yahoo-finance2');
const { cacheGet, cacheSet, cachedDB, translateKey } = require('../cache');

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

// ─── Technical summary indicator helpers (oldest → newest input arrays) ───

/** Simple moving average of the last `period` values */
function computeSMA(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/** EMA series aligned to `values` — entries before the seed window are null */
function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/** MACD(fast,slow,signal): { macd, signal, histogram } for the latest point, or null */
function computeMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  if (!closes || closes.length < slow + signalPeriod) return null;
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine = closes
    .map((_, i) => (emaFast[i] != null && emaSlow[i] != null) ? emaFast[i] - emaSlow[i] : null)
    .filter(v => v != null);
  const signalSeries = emaSeries(macdLine, signalPeriod);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  if (macd == null || signal == null) return null;
  return { macd: +macd.toFixed(4), signal: +signal.toFixed(4), histogram: +(macd - signal).toFixed(4) };
}

/** Stochastic Oscillator: %K(period) smoothed by smoothK, %D = SMA(%K, smoothD) */
function computeStochastic(highs, lows, closes, period = 14, smoothK = 3, smoothD = 3) {
  if (!closes || closes.length < period + smoothK + smoothD) return null;
  const rawK = [];
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    rawK.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const smoothedK = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const slice = rawK.slice(i - smoothK + 1, i + 1);
    smoothedK.push(slice.reduce((s, v) => s + v, 0) / smoothK);
  }
  if (smoothedK.length < smoothD) return null;
  const d = smoothedK.slice(-smoothD).reduce((s, v) => s + v, 0) / smoothD;
  const k = smoothedK[smoothedK.length - 1];
  return { k: +k.toFixed(2), d: +d.toFixed(2) };
}

/** Bollinger Bands(period, mult): { upper, middle, lower } for the latest point */
function computeBollingerBands(closes, period = 20, mult = 2) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: +(middle + mult * sd).toFixed(4), middle: +middle.toFixed(4), lower: +(middle - mult * sd).toFixed(4) };
}

/** Average Directional Index (Wilder smoothing): { adx, plusDI, minusDI } for the latest point */
function computeADX(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (n < period * 2) return null;
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const wilderSmooth = (arr) => {
    const out = [];
    let sum = arr.slice(0, period).reduce((s, v) => s + v, 0);
    out.push(sum);
    for (let i = period; i < arr.length; i++) { sum = sum - sum / period + arr[i]; out.push(sum); }
    return out;
  };
  const trS = wilderSmooth(tr), plusS = wilderSmooth(plusDM), minusS = wilderSmooth(minusDM);
  const plusDI = plusS.map((v, i) => trS[i] ? (v / trS[i]) * 100 : 0);
  const minusDI = minusS.map((v, i) => trS[i] ? (v / trS[i]) * 100 : 0);
  const dx = plusDI.map((v, i) => {
    const sum = v + minusDI[i];
    return sum ? (Math.abs(v - minusDI[i]) / sum) * 100 : 0;
  });
  if (dx.length < period) return null;
  let adx = dx.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  return { adx: +adx.toFixed(2), plusDI: +plusDI[plusDI.length - 1].toFixed(2), minusDI: +minusDI[minusDI.length - 1].toFixed(2) };
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

  // Yahoo has no direct per-share cash flow figures — derive them from shares outstanding
  const shares = ks?.sharesOutstanding;
  const fcfPerShare = (fd?.freeCashflow      != null && shares) ? +(fd.freeCashflow      / shares).toFixed(4) : undefined;
  const ocfPerShare = (fd?.operatingCashflow != null && shares) ? +(fd.operatingCashflow / shares).toFixed(4) : undefined;

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
    freeCashFlowPerShareTTM:  fcfPerShare,
    operatingCashFlowPerShareTTM: ocfPerShare,
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

/** Returns true for futures (XX=F), crypto (*-USD), known commodity ETFs, and market indices (^XXX) */
function isCommoditySymbol(sym) {
  if (!sym) return false;
  if (sym.startsWith('^')) return true;
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

// ─── Health Score: sector benchmark peers ─────────────────────────────────────
// 5 large-cap US reference stocks per Yahoo sector, used to build the
// valuation/momentum/cashflow/profitability/growth ranges a stock is scored against.
const SECTOR_BENCHMARK_PEERS = {
  'Technology':             ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL'],
  'Healthcare':             ['UNH', 'JNJ', 'LLY', 'ABBV', 'MRK'],
  'Financial Services':     ['JPM', 'V', 'MA', 'BAC', 'GS'],
  'Consumer Cyclical':      ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE'],
  'Consumer Defensive':     ['WMT', 'PG', 'KO', 'COST', 'PEP'],
  'Industrials':            ['GE', 'CAT', 'RTX', 'UNP', 'HON'],
  'Energy':                 ['XOM', 'CVX', 'COP', 'SLB', 'EOG'],
  'Utilities':              ['NEE', 'DUK', 'SO', 'D', 'AEP'],
  'Real Estate':            ['PLD', 'AMT', 'EQIX', 'SPG', 'O'],
  'Basic Materials':        ['LIN', 'SHW', 'FCX', 'NEM', 'APD'],
  'Communication Services': ['GOOGL', 'META', 'NFLX', 'DIS', 'CMCSA'],
};
const DEFAULT_BENCHMARK_SECTOR = 'Industrials';

// Metrics evaluated per health dimension, and whether a higher value is better.
const DIMENSION_METRICS = {
  valuation:     { pe: false, pb: false, peg: false },
  momentum:      { perf3m: true, perf6m: true, perf12m: true, distMA50: true, rsi14: true },
  cashflow:      { fcfMargin: true, ocfMargin: true },
  profitability: { roe: true, roa: true, netMargin: true, opMargin: true },
  growth:        { revenueGrowth: true, epsGrowth: true },
};

/** Single combined Yahoo quoteSummary call for valuation/profitability/growth/cashflow fields */
async function fetchFundamentals(symbol) {
  const q = await yf.quoteSummary(symbol, { modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'] }).catch(() => ({}));
  return {
    sd: q?.summaryDetail        || {},
    ks: q?.defaultKeyStatistics || {},
    fd: q?.financialData        || {},
  };
}

/**
 * Raw metrics (not yet scored) for the 5 health dimensions of a single stock.
 * Used both for the analysed symbol and for each sector benchmark peer.
 */
async function getCompanyMetrics(symbol) {
  const from = new Date(Date.now() - 400 * 86400000).toISOString().split('T')[0];
  const [{ sd, ks, fd }, history] = await Promise.all([
    fetchFundamentals(symbol),
    yahooHistory(symbol, from, null).catch(() => []),
  ]);

  const closes = [...history].reverse().map(c => c.close).filter(v => v != null); // oldest -> newest
  const lastClose = closes[closes.length - 1];

  const perfPct = (tradingDaysBack) => {
    const idx = closes.length - 1 - tradingDaysBack;
    if (idx < 0 || !lastClose || closes[idx] == null) return null;
    return +(((lastClose - closes[idx]) / closes[idx]) * 100).toFixed(2);
  };

  const ma50  = computeSMA(closes, 50);
  const ma200 = computeSMA(closes, 200);
  const rsi14 = computeRSI(closes, 14);

  const revenue = fd?.totalRevenue;
  const fcf = fd?.freeCashflow;
  const ocf = fd?.operatingCashflow;

  return {
    valuation: {
      pe:  sd?.trailingPE ?? null,
      pb:  ks?.priceToBook ?? null,
      peg: ks?.pegRatio ?? null,
    },
    profitability: {
      roe:       fd?.returnOnEquity    != null ? fd.returnOnEquity    * 100 : null,
      roa:       fd?.returnOnAssets    != null ? fd.returnOnAssets    * 100 : null,
      netMargin: fd?.profitMargins     != null ? fd.profitMargins     * 100 : null,
      opMargin:  fd?.operatingMargins  != null ? fd.operatingMargins  * 100 : null,
    },
    cashflow: {
      fcfMargin: (fcf != null && revenue) ? (fcf / revenue) * 100 : null,
      ocfMargin: (ocf != null && revenue) ? (ocf / revenue) * 100 : null,
    },
    growth: {
      revenueGrowth: fd?.revenueGrowth != null ? fd.revenueGrowth * 100 : null,
      epsGrowth:     fd?.earningsGrowth != null ? fd.earningsGrowth * 100 : null,
    },
    momentum: {
      perf3m:    perfPct(63),
      perf6m:    perfPct(126),
      perf12m:   perfPct(252),
      distMA50:  (ma50  && lastClose) ? +(((lastClose - ma50)  / ma50)  * 100).toFixed(2) : null,
      distMA200: (ma200 && lastClose) ? +(((lastClose - ma200) / ma200) * 100).toFixed(2) : null,
      rsi14: rsi14 ?? null,
    },
  };
}

/** Min/max range per metric across a sector's benchmark peers, cached for 24h */
async function getSectorBenchmark(sector) {
  const key = SECTOR_BENCHMARK_PEERS[sector] ? sector : DEFAULT_BENCHMARK_SECTOR;
  return cachedDB(`sectorbench:${key}`, async () => {
    const peers = SECTOR_BENCHMARK_PEERS[key];
    const peerMetrics = await batchFetch(peers, sym => getCompanyMetrics(sym).catch(() => null), 5, 300);
    const valid = peerMetrics.filter(Boolean);

    const ranges = {};
    for (const dim of Object.keys(DIMENSION_METRICS)) {
      ranges[dim] = {};
      for (const metric of Object.keys(DIMENSION_METRICS[dim])) {
        const values = valid.map(m => m[dim]?.[metric]).filter(v => v != null && isFinite(v));
        ranges[dim][metric] = values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
      }
    }
    return ranges;
  }, 86400); // 24h TTL
}

/** Maps a value into a 1-5 score based on its position within a sector peer range */
function normalizeScore(value, range, higherIsBetter) {
  if (value == null || !isFinite(value) || !range) return null;
  const { min, max } = range;
  if (min === max) return 3;
  let pct = (value - min) / (max - min);
  pct = Math.max(0, Math.min(1, pct));
  if (!higherIsBetter) pct = 1 - pct;
  return +(1 + pct * 4).toFixed(2);
}

/** Average 1-5 score for one health dimension, or null if no metric had data */
function dimensionScore(metrics, ranges, dim) {
  const defs = DIMENSION_METRICS[dim];
  const scores = [];
  for (const metric of Object.keys(defs)) {
    const s = normalizeScore(metrics?.[dim]?.[metric], ranges?.[dim]?.[metric], defs[metric]);
    if (s != null) scores.push(s);
  }
  if (!scores.length) return null;
  return +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
}

/** 4-level rating (Debole/Discreta/Buona/Ottima) for a single dimension score */
function dimensionRating(score) {
  if (score == null) return null;
  if (score < 2) return 'weak';
  if (score < 3) return 'fair';
  if (score < 4) return 'good';
  return 'great';
}

/** 5-level rating (Debole..Eccellente) for the overall health score */
function overallRating(score) {
  if (score == null) return null;
  if (score < 1.8) return 'weak';
  if (score < 2.6) return 'fair';
  if (score < 3.4) return 'good';
  if (score < 4.2) return 'great';
  return 'excellent';
}

/**
 * Best-effort historical health scores from FMP annual data (US stocks only).
 * Returns [] for symbols without FMP fundamentals coverage (e.g. non-US tickers).
 */
async function getHealthHistory(symbol, ranges) {
  const [ratiosRes, growthRes] = await Promise.allSettled([
    fmp('/ratios', { symbol, limit: 5 }),
    fmp('/financial-growth', { symbol, limit: 5 }),
  ]);
  const ratiosArr = ratiosRes.status === 'fulfilled' && Array.isArray(ratiosRes.value) ? ratiosRes.value : [];
  if (!ratiosArr.length) return [];
  const growthArr = growthRes.status === 'fulfilled' && Array.isArray(growthRes.value) ? growthRes.value : [];
  const growthByDate = new Map(growthArr.map(g => [g.date, g]));

  const dims = ['valuation', 'profitability', 'cashflow', 'growth'];
  return [...ratiosArr].reverse().map(r => { // oldest -> newest
    const g = growthByDate.get(r.date) || {};
    const metrics = {
      valuation: {
        pe:  r.priceToEarningsRatio ?? null,
        pb:  r.priceToBookRatio ?? null,
        peg: g.priceToEarningsGrowthRatio ?? null,
      },
      profitability: {
        roe:       r.returnOnEquity          != null ? r.returnOnEquity          * 100 : null,
        roa:       r.returnOnAssets          != null ? r.returnOnAssets          * 100 : null,
        netMargin: r.netProfitMargin         != null ? r.netProfitMargin         * 100 : null,
        opMargin:  r.operatingProfitMargin   != null ? r.operatingProfitMargin   * 100 : null,
      },
      cashflow: {
        fcfMargin: (r.freeCashFlowOperatingCashFlowRatio != null && r.operatingCashFlowSalesRatio != null)
          ? r.freeCashFlowOperatingCashFlowRatio * r.operatingCashFlowSalesRatio * 100 : null,
        ocfMargin: r.operatingCashFlowSalesRatio != null ? r.operatingCashFlowSalesRatio * 100 : null,
      },
      growth: {
        revenueGrowth: g.revenueGrowth != null ? g.revenueGrowth * 100 : null,
        epsGrowth:     g.epsgrowth     != null ? g.epsgrowth     * 100 : null,
      },
    };
    const scores = {};
    for (const dim of dims) scores[dim] = dimensionScore(metrics, ranges, dim);
    const valid = Object.values(scores).filter(v => v != null);
    return {
      year: r.date?.slice(0, 4),
      ...scores,
      overall: valid.length ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2) : null,
    };
  });
}

// ─── Quote ───────────────────────────────────────────────────────────────────
router.get('/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cachedDB(`quote:${symbol}`, async () => {
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
    const data = await cachedDB(`profile:${symbol}`, async () => {
      // For commodity futures/crypto/indices, assetProfile is empty — use quote only
      if (isCommoditySymbol(symbol)) {
        const q = await yf.quote(symbol).catch(() => null);
        if (!q?.regularMarketPrice) return [];
        const isIndex = symbol.startsWith('^');
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
          _commodityType:   isIndex ? 'index' : isCrypto ? 'crypto' : isFuture ? 'futures' : 'etf',
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
    }, 86400); // 24h TTL — company profile rarely changes
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
        operatingCashFlowPerShareTTM: k.operatingCashFlowPerShareTTM,
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

// ─── Health Score: 5-dimension financial health vs sector peers ──────────────
router.get('/health-score/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cachedDB(`healthscore:${symbol}`, async () => {
      const profile = await yahooProfile(symbol).catch(() => []);
      const sector = profile[0]?.sector;

      const [metrics, ranges] = await Promise.all([
        getCompanyMetrics(symbol),
        getSectorBenchmark(sector),
      ]);

      const dimensions = {};
      for (const dim of Object.keys(DIMENSION_METRICS)) {
        const score = dimensionScore(metrics, ranges, dim);
        const sliders = {};
        for (const metric of Object.keys(DIMENSION_METRICS[dim])) {
          sliders[metric] = {
            value: metrics[dim]?.[metric] ?? null,
            min:   ranges[dim]?.[metric]?.min ?? null,
            max:   ranges[dim]?.[metric]?.max ?? null,
            higherIsBetter: DIMENSION_METRICS[dim][metric],
          };
        }
        dimensions[dim] = { score, rating: dimensionRating(score), metrics: sliders };
      }

      const dimScores = Object.values(dimensions).map(d => d.score).filter(v => v != null);
      const overallScore = dimScores.length ? +(dimScores.reduce((a, b) => a + b, 0) / dimScores.length).toFixed(2) : null;

      const history = await getHealthHistory(symbol, ranges).catch(() => []);

      return {
        symbol,
        sector: sector ?? null,
        overall: { score: overallScore, rating: overallRating(overallScore) },
        dimensions,
        history,
      };
    }, 6 * 3600); // 6h TTL
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── History (Yahoo as PRIMARY — works for all world markets) ─────────────────
router.get('/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { from, to } = req.query;
    const data = await cachedDB(`history:${symbol}:${from}:${to}`, async () => {
      // 1. Yahoo Finance — primary (OHLCV, all markets, free)
      const yData = await yahooHistory(symbol, from, to).catch(() => null);
      if (yData && yData.length > 0) return yData;
      // 2. FMP light — fallback (close only, US-heavy)
      return await fmp('/historical-price-eod/light', { symbol, from, to }).catch(() => []);
    }, 3600); // 1h TTL
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
    const data = await cachedDB(`techan:${symbol}`, async () => {
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
    }, 3600); // 1h TTL
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Technical Summary: oscillators, moving averages, aggregate verdict ──────
router.get('/technical-summary/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cachedDB(`techsummary:${symbol}`, async () => {
      const from = new Date(Date.now() - 320 * 86400000).toISOString().split('T')[0];
      const history = await yahooHistory(symbol, from, null).catch(() => []);
      const candles = [...history].reverse() // oldest -> newest
        .filter(c => c.high != null && c.low != null && c.close != null);

      if (candles.length < 35) {
        return { symbol, currentPrice: null, verdict: null, summary: null, oscillators: [], movingAverages: [] };
      }

      const closes = candles.map(c => c.close);
      const highs  = candles.map(c => c.high);
      const lows   = candles.map(c => c.low);
      const currentPrice = closes[closes.length - 1];

      const rsi14  = computeRSI(closes, 14);
      const stoch  = computeStochastic(highs, lows, closes, 14, 3, 3);
      const macd   = computeMACD(closes, 12, 26, 9);
      const adx    = computeADX(highs, lows, closes, 14);
      const bbands = computeBollingerBands(closes, 20, 2);
      const ma20   = computeSMA(closes, 20);
      const ma50   = computeSMA(closes, 50);
      const ma100  = computeSMA(closes, 100);
      const ma200  = computeSMA(closes, 200);

      const round2 = v => v == null ? null : +v.toFixed(2);

      const oscillators = [];
      if (rsi14 != null) {
        oscillators.push({ key: 'rsi14', value: rsi14, signal: rsi14 < 30 ? 'buy' : rsi14 > 70 ? 'sell' : 'neutral' });
      }
      if (stoch) {
        oscillators.push({ key: 'stoch', value: { k: stoch.k, d: stoch.d }, signal: stoch.k < 20 ? 'buy' : stoch.k > 80 ? 'sell' : 'neutral' });
      }
      if (macd) {
        oscillators.push({ key: 'macd', value: { macd: round2(macd.macd), signal: round2(macd.signal), histogram: round2(macd.histogram) }, signal: macd.macd > macd.signal ? 'buy' : macd.macd < macd.signal ? 'sell' : 'neutral' });
      }
      if (adx) {
        const trendSignal = adx.adx >= 25 ? (adx.plusDI > adx.minusDI ? 'buy' : 'sell') : 'neutral';
        oscillators.push({ key: 'adx', value: { adx: adx.adx, plusDI: adx.plusDI, minusDI: adx.minusDI }, signal: trendSignal });
      }
      if (bbands) {
        oscillators.push({ key: 'bbands', value: { upper: round2(bbands.upper), middle: round2(bbands.middle), lower: round2(bbands.lower) }, signal: currentPrice < bbands.lower ? 'buy' : currentPrice > bbands.upper ? 'sell' : 'neutral' });
      }

      const movingAverages = [];
      for (const [key, ma] of [['ma20', ma20], ['ma50', ma50], ['ma100', ma100], ['ma200', ma200]]) {
        if (ma != null) movingAverages.push({ key, value: round2(ma), signal: currentPrice > ma ? 'buy' : currentPrice < ma ? 'sell' : 'neutral' });
      }

      const allSignals = [...oscillators, ...movingAverages].map(i => i.signal);
      const buy = allSignals.filter(s => s === 'buy').length;
      const sell = allSignals.filter(s => s === 'sell').length;
      const neutral = allSignals.filter(s => s === 'neutral').length;
      const total = allSignals.length;
      const score = total ? (buy - sell) / total : 0;

      let verdict = 'neutral';
      if (score <= -0.5) verdict = 'strong_sell';
      else if (score <= -0.1) verdict = 'sell';
      else if (score < 0.1) verdict = 'neutral';
      else if (score < 0.5) verdict = 'buy';
      else verdict = 'strong_buy';

      return {
        symbol,
        currentPrice: round2(currentPrice),
        verdict,
        summary: { buy, sell, neutral, total, score: +score.toFixed(2) },
        oscillators,
        movingAverages,
      };
    }, 3600); // 1h TTL
    res.json(data);
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
    const key = translateKey(text, 'it');
    const hit = cacheGet(key);
    if (hit !== undefined) return res.json({ translated: hit });
    const prompt = `Traduci in italiano questo testo. Mantieni nomi propri, sigle e ticker invariati. Rispondi SOLO con il testo tradotto, senza spiegazioni:\n${text.slice(0, 500)}`;
    const translated = await callGemini(prompt, 12000);
    const result = translated.trim() || text;
    cacheSet(key, result); // permanent — translations never change
    res.json({ translated: result });
  } catch { res.json({ translated: req.body.text }); }
});

// ─── Translate news titles batch ──────────────────────────────────────────────
router.post('/translate-titles', async (req, res) => {
  try {
    const { titles } = req.body;
    if (!titles?.length) return res.json({ titles });

    const results = new Array(titles.length);
    const pending = []; // { index, title }
    titles.forEach((title, i) => {
      const hit = cacheGet(translateKey(title, 'it'));
      if (hit !== undefined) results[i] = hit;
      else pending.push({ index: i, title });
    });

    if (pending.length > 0) {
      const numbered = pending.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
      const prompt = `Traduci in italiano questi titoli di notizie finanziarie. Mantieni nomi propri, sigle, ticker e cifre invariati. Rispondi SOLO con i titoli tradotti numerati, uno per riga:\n${numbered}`;
      const raw = await callGemini(prompt, 15000);
      const lines = raw.trim().split('\n').filter(l => /^\d+\./.test(l.trim()));
      pending.forEach((p, i) => {
        const match = lines.find(l => l.trim().startsWith(`${i + 1}.`));
        const translated = match ? match.replace(/^\d+\.\s*/, '').trim() : p.title;
        results[p.index] = translated;
        cacheSet(translateKey(p.title, 'it'), translated); // permanent
      });
    }

    res.json({ titles: results });
  } catch { res.json({ titles: req.body.titles }); }
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

    const data = await cachedDB(`sentiment:${symbol}`, async () => {
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

      return { ...result, articles: articles.slice(0, 8) };
    }, 1800); // 30-min TTL

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Earnings Calendar ────────────────────────────────────────────────────────
router.get('/earnings/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cachedDB(`earnings:${symbol}`, async () => {
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
    }, 21600); // 6h TTL
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
    const data = await cachedDB(`analysts:${symbol}`, async () => {
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
    }, 21600); // 6h TTL
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Insider Trading ──────────────────────────────────────────────────────────
// Classify a Yahoo `transactionText` (e.g. "Sale at price 311.02 per share.")
// into a normalized type + buy/sell direction + price-per-share.
function classifyInsiderTransaction(text) {
  const t = text || '';
  let type = 'Other', isBuy = null;
  if (/gift/i.test(t))                  { type = 'Stock Gift';     isBuy = null;  }
  else if (/tax/i.test(t))              { type = 'Tax';            isBuy = false; }
  else if (/purchase/i.test(t))         { type = 'Purchase';       isBuy = true;  }
  else if (/sale/i.test(t))             { type = 'Sale';           isBuy = false; }
  else if (/exercise|conversion/i.test(t)) { type = 'Option Exercise'; isBuy = true; }
  else if (/award|grant/i.test(t))      { type = 'Award';          isBuy = null;  }

  let price = null;
  const m = t.match(/at price\s+\$?([\d,]+\.?\d*)(?:\s*-\s*\$?([\d,]+\.?\d*))?\s*per share/i);
  if (m) {
    const p1 = parseFloat(m[1].replace(/,/g, ''));
    const p2 = m[2] != null ? parseFloat(m[2].replace(/,/g, '')) : null;
    const avg = p2 != null ? (p1 + p2) / 2 : p1;
    if (avg > 0) price = avg;
  }
  return { type, isBuy, price };
}

// Convert ALL-CAPS SEC filer names (e.g. "COOK TIMOTHY D") to readable form.
function toTitleCase(name) {
  if (!name) return null;
  return name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

router.get('/insider/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await cachedDB(`insider:${symbol}`, async () => {
      const yRes = await yf.quoteSummary(symbol, { modules: ['insiderTransactions', 'price'] }).catch(() => null);
      const currency = yRes?.price?.currency ?? null;
      const transactions = yRes?.insiderTransactions?.transactions || [];

      return transactions
        .map(t => {
          const { type, isBuy, price } = classifyInsiderTransaction(t.transactionText);
          const shares = t.shares ?? null;
          let value = t.value ?? ((shares != null && price != null) ? Math.round(shares * price) : null);
          if (value === 0) value = null;
          return {
            name:     toTitleCase(t.filerName),
            role:     t.filerRelation || null,
            type,
            isBuy,
            shares,
            price,
            value,
            currency,
            date:     t.startDate instanceof Date ? t.startDate.toISOString().split('T')[0] : null,
          };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 10);
    }, 21600); // 6h TTL
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
