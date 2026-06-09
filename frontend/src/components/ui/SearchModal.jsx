import { useState, useEffect, useRef } from "react";
import { API, fmt } from "../../api.js";
import { Spinner } from "./Spinner.jsx";
import { useLocalStorage } from "../../api.js";

export function SearchModal({ onClose, onSearch }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useLocalStorage("recent_searches", []);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!q.trim() || q.trim().length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      const d = await API.get(`/search?q=${encodeURIComponent(q.trim())}`);
      setResults(Array.isArray(d) ? d.slice(0, 6) : []);
      setSel(0);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [q]);

  const pick = item => {
    const sym = item.symbol || item;
    setRecent(r => [sym, ...r.filter(x => x !== sym)].slice(0, 5));
    onSearch(sym);
    onClose();
  };

  const handleKey = e => {
    const list = results.length ? results : recent.map(r => ({ symbol: r }));
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, list.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && list[sel]) pick(list[sel]);
  };

  const list = results.length ? results : recent.map(r => ({ symbol: r, name: "", exchange: "Recente" }));

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card fade" style={{ width: 560, maxWidth: "94vw", overflow: "hidden", marginTop: 0 }}>
        {/* Input */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border2)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Cerca ticker o nome azienda…"
            style={{ flex: 1, border: "none", background: "transparent", fontSize: 16, color: "var(--text)" }}
          />
          {loading && <Spinner size={16} />}
          <kbd style={{ padding: "2px 7px", borderRadius: 5, background: "var(--surface2)", fontSize: 11, color: "var(--text3)", border: "1px solid var(--border)" }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          {!q.trim() && recent.length > 0 && (
            <div style={{ padding: "8px 12px 4px", fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: ".06em", textTransform: "uppercase" }}>
              Ricerche recenti
            </div>
          )}
          {list.length === 0 && q.trim().length >= 2 && !loading && (
            <div style={{ padding: "32px", textAlign: "center", fontSize: 14, color: "var(--text3)" }}>
              Nessun risultato per "{q}"
            </div>
          )}
          {list.map((item, i) => (
            <div
              key={item.symbol + i}
              onClick={() => pick(item)}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "11px 20px", cursor: "pointer",
                background: i === sel ? "var(--surface2)" : "transparent",
                transition: "background .1s",
              }}
              onMouseEnter={() => setSel(i)}
            >
              <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--blue-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--blue)", fontFamily: "monospace", flexShrink: 0 }}>
                {item.symbol?.slice(0, 3)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, fontFamily: "monospace" }}>{item.symbol}</div>
                {item.name && <div style={{ fontSize: 12, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>}
              </div>
              {item.exchange && (
                <span className="pill pill-gray" style={{ fontSize: 10 }}>{item.exchange}</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border2)", display: "flex", gap: 16, fontSize: 11, color: "var(--text3)" }}>
          <span>↑↓ naviga</span><span>↵ seleziona</span><span>Esc chiudi</span>
          <span style={{ marginLeft: "auto" }}>⌘K per aprire</span>
        </div>
      </div>
    </div>
  );
}
