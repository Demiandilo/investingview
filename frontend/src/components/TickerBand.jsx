import { useState, useEffect } from "react";
import { API } from "../api.js";

const TICKER_H = 36;

function fmtTickerPrice(price, symbol) {
  if (price == null) return "—";
  if (symbol?.includes("=X")) return price.toFixed(4);
  if (symbol === "^TNX") return price.toFixed(2) + "%";
  if (price >= 10000)
    return price.toLocaleString("it-IT", { maximumFractionDigits: 0 });
  if (price >= 100)
    return price.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return price.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function TickerItem({ item }) {
  const up = (item.changePercent ?? 0) >= 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "0 18px",
        borderRight: "1px solid rgba(255,255,255,0.4)",
        height: TICKER_H,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#ffffff",
          textTransform: "uppercase",
          letterSpacing: ".06em",
          whiteSpace: "nowrap",
        }}
      >
        {item.name}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "'Roboto Mono', 'Courier New', monospace",
          color: "#ffffff",
          whiteSpace: "nowrap",
          letterSpacing: "-.01em",
        }}
      >
        {fmtTickerPrice(item.price, item.symbol)}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "'Roboto Mono', 'Courier New', monospace",
          color: up ? "#a5d6a7" : "#ef9a9a",
          whiteSpace: "nowrap",
        }}
      >
        {up ? "+" : ""}
        {item.changePercent?.toFixed(2)}%
      </span>
    </span>
  );
}

export default function TickerBand() {
  const [items, setItems] = useState([]);

  const load = () => {
    API.getTicker()
      .then(d => { if (d?.items?.length) setItems(d.items); })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 90_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      style={{
        height: TICKER_H,
        background: "#2962ff",
        borderRadius: 12,
        margin: "0 0 20px 0",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
      }}
    >
      {items.length === 0 ? (
        /* skeleton while loading */
        <div style={{ display: "flex", gap: 0, height: "100%", alignItems: "center", padding: "0 20px", opacity: 0.3 }}>
          {[120, 90, 110, 95, 105].map((w, i) => (
            <div key={i} className="skeleton" style={{ width: w, height: 12, borderRadius: 3, marginRight: 28 }} />
          ))}
        </div>
      ) : (
        <div className="ticker-wrap" style={{ flex: 1, height: "100%", display: "flex", alignItems: "center" }}>
          <div className="ticker-scroll">
            {items.map((item, i) => <TickerItem key={`a-${i}`} item={item} />)}
            {items.map((item, i) => <TickerItem key={`b-${i}`} item={item} />)}
          </div>
        </div>
      )}
    </div>
  );
}

export { TICKER_H };
