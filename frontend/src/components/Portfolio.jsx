import { useState, useEffect } from "react";
import { API, fmt } from "../api.js";
import { Spinner } from "./ui/Spinner.jsx";
import { PortfolioPieChart, PortfolioHistoryChart } from "./ui/Charts.jsx";
import { useToast } from "./ui/Toast.jsx";
import { useLang } from "../i18n.js";

const PIE_COLORS = ["#0071e3","#34c759","#ff9f0a","#ff3b30","#8b5cf6","#06b6d4","#f59e0b","#10b981"];

function usePortfolioHistory(positions) {
  const [histData, setHistData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!positions.length) return;
    setLoading(true);
    const from = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
    Promise.all(positions.map(p =>
      API.getHistory(p.symbol, from)
        .then(hist => ({ qty: p.qty, hist }))
        .catch(() => ({ qty: p.qty, hist: [] }))
    )).then(results => {
      const dateMap = {};
      results.forEach(({ qty, hist }) => {
        hist.forEach(({ date, close }) => {
          if (close) dateMap[date] = (dateMap[date] || 0) + qty * close;
        });
      });
      const sorted = Object.entries(dateMap)
        .sort(([a], [b]) => a < b ? -1 : 1)
        .map(([date, value]) => ({ date, value: +value.toFixed(2) }));
      setHistData(sorted);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [positions.map(p => p.symbol + p.qty).join(",")]);

  return { histData, loading };
}

const TABS = ["posizioni", "allocazione", "andamento"];

export default function Portfolio({ positions, setPositions }) {
  const { t } = useLang();
  const [modal, setModal] = useState(false);
  const [n, setN] = useState({ symbol: "", qty: "", avg: "" });
  const [tab, setTab] = useState("posizioni");
  const addToast = useToast();
  const { histData, loading: histLoading } = usePortfolioHistory(positions);

  const totInv = positions.reduce((s, p) => s + p.qty * p.avg, 0);
  const totCur = positions.reduce((s, p) => s + p.qty * (p.cur || p.avg), 0);
  const totPnL = totCur - totInv;
  const totPct = totInv > 0 ? (totPnL / totInv) * 100 : 0;

  const tabLabels = {
    posizioni:  t("portfolio.tabs.positions"),
    allocazione: t("portfolio.tabs.allocation"),
    andamento:  t("portfolio.tabs.performance"),
  };

  const add = async () => {
    if (!n.symbol || !n.qty || !n.avg) return;
    const s = n.symbol.toUpperCase();
    const q = await API.getQuote(s);
    const prof = await API.getProfile(s);
    const buyDate = new Date().toISOString().split("T")[0];
    const res = await API.addPosition({ symbol: s, quantity: +n.qty, buyPrice: +n.avg, buyDate }).catch(() => null);
    setPositions(p => [...p, { id: res?.id, symbol: s, name: prof?.companyName || s, qty: +n.qty, avg: +n.avg, buyDate, cur: q?.price || +n.avg, ch: q?.changePercentage, loading: false }]);
    setN({ symbol: "", qty: "", avg: "" });
    setModal(false);
    addToast?.(t("portfolio.addedToast", { sym: s }));
  };

  const remove = i => {
    const pos = positions[i];
    if (pos.id != null) API.deletePosition(pos.id).catch(() => {});
    setPositions(prev => prev.filter((_, j) => j !== i));
  };

  return (
    <div className="fade page-pad" style={{ padding: "28px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 className="page-title" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.04em" }}>{t("portfolio.title")}</h1>
        <button className="btn btn-blue" onClick={() => setModal(true)}>{t("portfolio.addPosition")}</button>
      </div>

      {/* Summary tiles */}
      <div className="stagger pf-sum-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { l: t("portfolio.currentValue"), v: `$${totCur.toFixed(2)}` },
          { l: t("portfolio.invested"),     v: `$${totInv.toFixed(2)}` },
          { l: t("portfolio.totalPnL"),     v: `${totPnL > 0 ? "+" : ""}$${totPnL.toFixed(2)}`, c: totPnL > 0 ? "var(--green)" : "var(--red)" },
          { l: t("portfolio.returns"),      v: fmt.pct(totPct), c: totPct > 0 ? "var(--green)" : "var(--red)" },
        ].map((it, i) => (
          <div key={i} className="card" style={{ padding: "20px" }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>{it.l}</p>
            <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.03em", color: it.c || "var(--text)" }}>{it.v}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        {TABS.map(id => (
          <button key={id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>{tabLabels[id]}</button>
        ))}
      </div>

      {/* Posizioni tab */}
      {tab === "posizioni" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--border2)", fontSize: 14, fontWeight: 700 }}>{t("portfolio.tabs.positions")} ({positions.length})</div>
          {positions.map((p, i) => {
            const pnl = p.qty * ((p.cur || p.avg) - p.avg);
            const pnlP = p.cur ? ((p.cur - p.avg) / p.avg) * 100 : 0;
            return (
              <div key={i} className="pos-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: i < positions.length - 1 ? "1px solid var(--border2)" : "none", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 15 }}>{p.symbol}</p>
                  <p style={{ fontSize: 12, color: "var(--text2)" }}>{p.name}</p>
                  <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{t("portfolio.sharesAt", { qty: p.qty, avg: p.avg })}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 17, fontWeight: 700 }}>{p.loading ? <Spinner size={14} /> : fmt.price(p.cur)}</p>
                  {p.ch != null && <span className={`pill ${p.ch >= 0 ? "pill-green" : "pill-red"}`}>{fmt.pct(p.ch)}</span>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 16, fontWeight: 700, color: pnl > 0 ? "var(--green)" : "var(--red)" }}>{pnl > 0 ? "+" : ""}${pnl.toFixed(2)}</p>
                  <p style={{ fontSize: 12, color: pnlP > 0 ? "var(--green)" : "var(--red)" }}>{fmt.pct(pnlP)}</p>
                </div>
                <button onClick={() => remove(i)} style={{ padding: "6px 13px", borderRadius: 8, fontSize: 12, background: "var(--red-light)", color: "var(--red)", fontWeight: 600 }}>{t("common.remove")}</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Allocazione tab */}
      {tab === "allocazione" && positions.filter(p => p.cur).length > 1 && (
        <div className="card" style={{ padding: "20px 24px" }}>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t("portfolio.allocationTitle")}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <PortfolioPieChart positions={positions.filter(p => p.cur)} />
            <div>{positions.filter(p => p.cur).map((p, i) => {
              const v = p.qty * (p.cur || p.avg);
              const tot = positions.reduce((s, x) => s + x.qty * (x.cur || x.avg), 0);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span style={{ fontSize: 13 }}>{p.symbol} — {((v / tot) * 100).toFixed(1)}%</span>
                </div>
              );
            })}</div>
          </div>
        </div>
      )}

      {/* Andamento tab */}
      {tab === "andamento" && (
        <div className="card" style={{ padding: "20px 24px" }}>
          {histLoading ? <div className="skeleton" style={{ height: 160 }} /> : histData.length > 0 ? <PortfolioHistoryChart data={histData} /> : <div style={{ textAlign: "center", padding: "48px", color: "var(--text3)" }}>{t("common.loading")}</div>}
        </div>
      )}

      {/* Add modal */}
      {modal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="card fade" style={{ width: 380, maxWidth: "92vw", padding: "28px", marginTop: 0 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 22 }}>{t("portfolio.modal.title")}</h3>
            {[
              { l: t("portfolio.modal.tickerLabel"), k: "symbol", p: t("portfolio.modal.tickerPlaceholder"), tp: "text" },
              { l: t("portfolio.modal.qtyLabel"),    k: "qty",    p: t("portfolio.modal.qtyPlaceholder"),    tp: "number" },
              { l: t("portfolio.modal.avgLabel"),    k: "avg",    p: t("portfolio.modal.avgPlaceholder"),    tp: "number" },
            ].map(({ l, k, p, tp }) => (
              <div key={k} style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>{l}</p>
                <input className="input" type={tp} placeholder={p} value={n[k]} onChange={e => setN(x => ({ ...x, [k]: e.target.value }))} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setModal(false)}>{t("portfolio.modal.cancel")}</button>
              <button className="btn btn-blue" style={{ flex: 1 }} onClick={add}>{t("portfolio.modal.add")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
