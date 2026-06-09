import { useState, useEffect } from "react";
import TickerBand from "./TickerBand.jsx";
import { API, fmt, getMarketStatus, useLocalStorage } from "../api.js";
import { useLang } from "../i18n.js";
import { TinySparkline, MiniSparkline } from "./ui/MiniSparkline.jsx";
import { SectorBarChart, FearGreedGauge } from "./ui/Charts.jsx";
import { Skeleton } from "./ui/Spinner.jsx";

const CHIPS = ["AAPL", "MSFT", "TSLA", "NVDA", "AMZN", "GOOGL", "META", "JPM", "JNJ", "KO"];

/* ─── DashboardHeader ────────────────────────────────────────────────────── */
function DashboardHeader() {
  const { t, lang } = useLang();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer); }, []);
  const status = getMarketStatus(now);
  const locale = lang === "en" ? "en-US" : "it-IT";
  const dateStr = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="dash-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
      <div>
        <p style={{ fontSize: 13, color: "var(--text3)", fontWeight: 500, textTransform: "capitalize", marginBottom: 2 }}>{dateStr}</p>
        <p style={{ fontSize: 11, color: "var(--text3)" }}>{t("dashboard.updatedAt")} {fmt.time(now)}</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: status.open ? "var(--green-light)" : "var(--surface2)", color: status.color, padding: "9px 16px", borderRadius: 24, fontSize: 13, fontWeight: 700, border: `1px solid ${status.open ? "rgba(52,199,89,.25)" : "var(--border)"}` }}>
        <div className={status.open ? "pulse" : ""} style={{ width: 8, height: 8, borderRadius: "50%", background: status.color, flexShrink: 0 }} />
        <span>{status.label}</span>
        <span style={{ fontSize: 11, fontWeight: 400, opacity: .7 }}>{status.sub}</span>
      </div>
    </div>
  );
}

/* ─── Portfolio summary card ──────────────────────────────────────────────── */
function PortfolioSummaryCard({ positions, onGo }) {
  const { t } = useLang();
  const loaded = positions.filter(p => !p.loading && p.cur != null);
  const totInv = positions.reduce((s, p) => s + p.qty * p.avg, 0);
  const totCur = positions.reduce((s, p) => s + p.qty * (p.cur || p.avg), 0);
  const totPnL = totCur - totInv;
  const totPct = totInv > 0 ? (totPnL / totInv) * 100 : 0;
  const dayPnL = positions.reduce((s, p) => { const cur = p.cur || p.avg; return s + p.qty * cur * ((p.ch || 0) / 100); }, 0);
  const allLoaded = positions.every(p => !p.loading);
  const barW = Math.min(100, Math.max(1, 50 + totPct * 4));
  return (
    <div className="card" style={{ padding: "20px 24px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          {t("dashboard.portfolio")}
        </div>
        <button onClick={onGo} className="btn btn-ghost btn-sm">{t("dashboard.manage")}</button>
      </div>
      <div className="pf-summary-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 18 }}>
        {[{ l: t("dashboard.currentValue"), v: allLoaded ? `$${totCur.toFixed(2)}` : <Skeleton h={20} w="80%" />, c: null },
          { l: t("dashboard.todayPnL"),    v: allLoaded ? `${dayPnL >= 0 ? "+" : ""}$${dayPnL.toFixed(2)}` : "—", c: dayPnL >= 0 ? "var(--green)" : "var(--red)" },
          { l: t("dashboard.totalPnL"),    v: allLoaded ? `${totPnL >= 0 ? "+" : ""}$${totPnL.toFixed(2)}` : "—", c: totPnL >= 0 ? "var(--green)" : "var(--red)" },
        ].map(({ l, v, c }, i) => (
          <div key={i} style={{ background: "var(--surface2)", borderRadius: 12, padding: "13px 16px" }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 5, letterSpacing: ".03em" }}>{l.toUpperCase()}</p>
            <div style={{ fontSize: 18, fontWeight: 800, color: c || "var(--text)", letterSpacing: "-.03em" }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
        <div style={{ width: `${barW}%`, height: "100%", background: totPnL >= 0 ? "var(--green)" : "var(--red)", borderRadius: 3, transition: "width 1.2s cubic-bezier(.22,1,.36,1)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text3)" }}>
        <span>{t("dashboard.invested")}: ${totInv.toFixed(2)}</span>
        <span style={{ color: totPnL >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{totPct >= 0 ? "+" : ""}{totPct.toFixed(2)}%</span>
      </div>
    </div>
  );
}

/* ─── Index Card ──────────────────────────────────────────────────────────── */
function getFlag(name = "") {
  const n = name.toLowerCase();
  if (n.includes("mib") || n.includes("italia")) return "IT";
  if (n.includes("dax") || n.includes("german")) return "DE";
  if (n.includes("shanghai") || n.includes("china")) return "CN";
  if (n.includes("ftse 100") || n.includes(" uk")) return "GB";
  if (n.includes("nikkei") || n.includes("japan")) return "JP";
  if (n.includes("cac") || n.includes("france")) return "FR";
  return "US";
}
function IndexCard({ idx, history, onSearch }) {
  const pct = idx.changesPercentage || idx.changePercentage || 0;
  const up = pct >= 0;
  return (
    <div className="card card-hover" style={{ padding: "16px 18px" }} onClick={() => idx.symbol && onSearch?.(idx.symbol)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, color: "var(--text3)", fontWeight: 500, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{fontSize:9,fontWeight:700,background:"var(--surface2)",color:"var(--text3)",borderRadius:3,padding:"1px 4px",letterSpacing:".05em",flexShrink:0}}>{getFlag(idx.displayName||"")}</span>
            {idx.displayName || idx.name || idx.symbol}
          </p>
          <p style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1 }}>{fmt.num(idx.price)}</p>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
          <span className={`pill ${up ? "pill-green" : "pill-red"}`} style={{ fontSize: 11 }}>{fmt.pct(pct)}</span>
          <p style={{ fontSize: 11, fontWeight: 600, color: up ? "var(--green)" : "var(--red)", marginTop: 5 }}>{(idx.change || 0) >= 0 ? "+" : ""}{typeof idx.change === "number" ? idx.change.toFixed(2) : idx.change}</p>
        </div>
      </div>
      {history?.length > 1 ? <TinySparkline data={history} up={up} w={120} h={38} /> : <div style={{ height: 38, background: "var(--surface2)", borderRadius: 6, opacity: .5 }} />}
    </div>
  );
}

/* ─── Crypto Widget ───────────────────────────────────────────────────────── */
function CryptoWidget() {
  const { t } = useLang();
  const [data, setData] = useState([]);
  const icons = { BTC: "₿", ETH: "Ξ", SOL: "◎" };
  useEffect(() => { API.getCrypto().then(d => setData(d || [])); }, []);
  if (!data.length) return null;
  return (
    <div>
      <p className="section-label">{t("dashboard.crypto")}</p>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {data.map((c, i) => {
          const up = (c.change || 0) >= 0;
          return (
            <div key={c.symbol} style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: i < data.length - 1 ? "1px solid var(--border2)" : "none", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700 }}>{icons[c.symbol] || c.symbol[0]}</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: 14 }}>{c.symbol}</p>
                <p style={{ fontSize: 11, color: "var(--text3)" }}>{c.name}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontWeight: 700, fontSize: 15 }}>{c.price ? `$${Number(c.price).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}</p>
                <span className={`pill ${up ? "pill-green" : "pill-red"}`} style={{ fontSize: 11 }}>{fmt.pct(c.change)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── News Widget ─────────────────────────────────────────────────────────── */
function NewsWidget() {
  const { t, lang } = useLang();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    API.getMarketNews().then(d => {
      setArticles((d?.articles || []).slice(0, 5));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  const locale = lang === "en" ? "en-US" : "it-IT";
  return (
    <div>
      <p className="section-label">{t("dashboard.newsTitle")}</p>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading && [1, 2, 3].map(i => (
          <div key={i} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border2)" }}>
            <Skeleton h={13} w="90%" r={5} />
            <div style={{ marginTop: 6 }}><Skeleton h={11} w="50%" r={5} /></div>
          </div>
        ))}
        {!loading && articles.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--text3)", fontSize: 13 }}>{t("dashboard.noNews")}</div>}
        {articles.map((a, i) => (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block" }}>
            <div style={{ padding: "12px 18px", borderBottom: i < articles.length - 1 ? "1px solid var(--border2)" : "none" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--surface2)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", lineHeight: 1.5, marginBottom: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.title}</p>
              <p style={{ fontSize: 11, color: "var(--text3)" }}>{a.source?.name} · {a.publishedAt ? new Date(a.publishedAt).toLocaleDateString(locale) : ""}</p>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ─── Search Bar ──────────────────────────────────────────────────────────── */
function SearchBar({ onSearch, loading }) {
  const { t } = useLang();
  const [val, setVal] = useState("");
  const [recent] = useLocalStorage("recent_searches", []);
  const go = () => { const s = val.trim(); if (!s) return; onSearch(s); setVal(""); };
  return (
    <div className="card" style={{ padding: "20px 22px", marginBottom: 24 }}>
      <div className="search-row" style={{ display: "flex", gap: 10 }}>
        <input className="input search-input" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} placeholder={t("dashboard.searchPlaceholder")} style={{ flex: 1 }} />
        <button className="btn btn-blue search-btn" onClick={go} style={{ minWidth: 100, flexShrink: 0 }}>
          {loading ? <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#fff5" strokeWidth="2.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg> : t("dashboard.searchBtn")}
        </button>
      </div>
      <div className="search-chips" style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        {[...new Set([...recent, ...CHIPS])].slice(0, 12).map(s => (
          <button key={s} onClick={() => onSearch(s)} style={{ padding: "5px 12px", borderRadius: 18, fontSize: 12, fontWeight: 500, background: recent.includes(s) ? "var(--blue-light)" : "var(--surface2)", color: recent.includes(s) ? "var(--blue)" : "var(--text2)", border: "1px solid var(--border)", cursor: "pointer" }}>{s}</button>
        ))}
      </div>
    </div>
  );
}

/* ─── Fear & Greed Widget ─────────────────────────────────────────────────── */
function FearGreedWidget({ data }) {
  const { t, lang } = useLang();
  if (!data) return null;
  const locale = lang === "en" ? "en-US" : "it-IT";
  return (
    <div style={{ marginBottom: 28 }}>
      <p className="section-label">{t("dashboard.fearGreed")}</p>
      <div className="card" style={{ padding: "24px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
          <div style={{ flex: "0 0 auto" }}>
            <FearGreedGauge score={data.score} width={200} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)", marginBottom: 10 }}>{t("dashboard.fearGreedLast7")}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.history?.map((d, i) => {
                const c = d.score < 25 ? "#ff3b30" : d.score < 45 ? "#ff9f0a" : d.score < 55 ? "#ffd60a" : d.score < 75 ? "#34c759" : "#00c853";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "var(--text3)", width: 58, flexShrink: 0 }}>
                      {new Date(d.date).toLocaleDateString(locale, { day: "2-digit", month: "short" })}
                    </span>
                    <div style={{ flex: 1, height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${d.score}%`, height: "100%", background: c, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c, width: 24, textAlign: "right" }}>{d.score}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--surface2)", borderRadius: 10 }}>
              <p style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: t("dashboard.fearGreedExplain") }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Dashboard ───────────────────────────────────────────────────────────── */
export default function Dashboard({ onSearch, watchlist, positions, onGoPortfolio }) {
  const { t } = useLang();
  const [indexes, setIndexes] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [gainers, setGainers] = useState([]);
  const [losers, setLosers] = useState([]);
  const [weekHist, setWeekHist] = useState({});
  const [fearGreed, setFearGreed] = useState(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  useEffect(() => {
    API.getFearGreed().then(d => setFearGreed(d)).catch(() => {});
    API.getIndexes().then(d => {
      if (d?.length) {
        setIndexes(d);
        const from = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().split("T")[0];
        d.forEach(idx => {
          if (idx.symbol) API.getHistory(idx.symbol, from).then(h => {
            if (h?.length) setWeekHist(p => ({ ...p, [idx.symbol]: h.slice(0, 12) }));
          }).catch(() => {});
        });
      }
    });
    API.getSectors().then(d => setSectors(d || []));
    API.getGainers().then(d => setGainers(d || []));
    API.getLosers().then(d => setLosers(d || []));
  }, []);

  return (
    <div className="fade page-pad" style={{ padding: "28px 0" }}>
      <TickerBand />
      <DashboardHeader />
      <SearchBar onSearch={onSearch} />
      <PortfolioSummaryCard positions={positions} onGo={onGoPortfolio} />

      {/* Indexes + Gainers/Losers */}
      <div className="dash-split" style={{ marginBottom: 28 }}>
        <div>
          <p className="section-label">{t("dashboard.indices")}</p>
          <div className="stagger idx-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            {indexes.length > 0
              ? indexes.map((idx, i) => <IndexCard key={i} idx={idx} history={weekHist[idx.symbol]} onSearch={onSearch} />)
              : [1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 105, borderRadius: 16 }} />)
            }
          </div>
        </div>
        {(gainers.length > 0 || losers.length > 0) && (
          <div>
            <p className="section-label">{t("dashboard.movers")}</p>
            <div className="movers-container" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[{ label: t("dashboard.gainers"), list: gainers, up: true }, { label: t("dashboard.losers"), list: losers, up: false }].map(({ label, list, up }) => (
                <div key={label} className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border2)", fontSize: 12, fontWeight: 700, color: up ? "var(--green)" : "var(--red)" }}>{label}</div>
                  <div className="stagger">
                    {list.slice(0, 5).map((s, i) => (
                      <div key={i} onClick={() => onSearch(s.symbol)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: i < 4 ? "1px solid var(--border2)" : "none", cursor: "pointer" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--surface2)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{s.symbol}</p>
                          <p style={{ fontSize: 10, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>{s.name}</p>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600 }}>{fmt.price(s.price)}</p>
                          <span className={`pill ${up ? "pill-green" : "pill-red"}`} style={{ fontSize: 10, padding: "2px 7px" }}>{fmt.pct(s.changesPercentage)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sectors */}
      {sectors.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <p className="section-label">{t("dashboard.sectorPerf")}</p>
          <div className="card" style={{ padding: "20px 24px" }}>
            <div className="sectors-chart-wrap" style={{ height: 340 }}>
              <SectorBarChart sectors={sectors} maxItems={isMobile ? 5 : 11} />
            </div>
          </div>
        </div>
      )}

      {/* Fear & Greed */}
      <FearGreedWidget data={fearGreed} />

      {/* Crypto + News */}
      <div className="dash-bottom" style={{ marginBottom: 24 }}>
        <CryptoWidget />
        <NewsWidget />
      </div>

      {/* Watchlist rapida */}
      {watchlist.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p className="section-label">{t("dashboard.quickWatchlist")}</p>
          <div className="stagger wl-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
            {watchlist.map((it, i) => (
              <div key={i} className="card card-hover" style={{ padding: "16px 18px" }} onClick={() => onSearch(it.symbol)}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 5 }}>{it.symbol}</p>
                <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</p>
                <p style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.03em", marginBottom: 5 }}>{fmt.price(it.price)}</p>
                {it.change != null && <span className={`pill ${it.change >= 0 ? "pill-green" : "pill-red"}`}>{fmt.pct(it.change)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
