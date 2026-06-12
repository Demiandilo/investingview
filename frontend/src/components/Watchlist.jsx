import { useState, useEffect } from "react";
import { API, fmt, fmtPrice, useLocalStorage } from "../api.js";
import { Spinner } from "./ui/Spinner.jsx";
import { useToast } from "./ui/Toast.jsx";
import { useLang } from "../i18n.js";

export default function Watchlist({ items, onRemove, onAnalyze }) {
  const { t } = useLang();
  const [prices, setPrices] = useState({});
  const [editAlert, setEditAlert] = useState(null);
  const [editNote, setEditNote] = useState(null);
  const [alertInputs, setAlertInputs] = useLocalStorage("watchlist_alerts", {});
  const [notes, setNotes] = useLocalStorage("watchlist_notes", {});
  const addToast = useToast();

  useEffect(() => {
    items.forEach(async it => {
      if (!prices[it.symbol]) {
        const q = await API.getQuote(it.symbol);
        if (q) setPrices(p => ({ ...p, [it.symbol]: q }));
      }
    });
  }, [items]);

  const remove = sym => {
    onRemove(sym);
    addToast?.(t("watchlist.addedToast", { sym }), "info");
  };

  const saveAlert = (sym, target, dir) => {
    setAlertInputs(a => ({ ...a, [sym]: { target: +target, dir } }));
    setEditAlert(null);
    addToast?.(t("watchlist.alertToast", { sym, price: target }), "info");
  };

  const saveNote = (sym, text) => {
    setNotes(n => ({ ...n, [sym]: text }));
    setEditNote(null);
  };

  const isTriggered = sym => {
    const q = prices[sym];
    const alert = alertInputs[sym];
    if (!q?.price || !alert?.target) return false;
    return alert.dir === "above" ? q.price >= alert.target : q.price <= alert.target;
  };

  if (items.length === 0) return (
    <div className="fade page-pad" style={{ padding: "28px 0" }}>
      <h1 className="page-title" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.04em", marginBottom: 24 }}>{t("watchlist.title")}</h1>
      <div style={{ textAlign: "center", padding: "72px 0", color: "var(--text3)" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom: 14 }}>
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 500 }}>{t("watchlist.empty")}</div>
        <p style={{ fontSize: 13, marginTop: 8 }}>{t("watchlist.emptyHint")}</p>
      </div>
    </div>
  );

  return (
    <div className="fade page-pad" style={{ padding: "28px 0" }}>
      <h1 className="page-title" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.04em", marginBottom: 24 }}>{t("watchlist.title")}</h1>
      <div className="stagger wl-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
        {items.map((it, i) => {
          const q = prices[it.symbol];
          const alert = alertInputs[it.symbol];
          const note = notes[it.symbol];
          const triggered = isTriggered(it.symbol);
          const up = (q?.changePercentage || 0) >= 0;
          const distFromTarget = alert?.target && q?.price ? (((q.price - alert.target) / alert.target) * 100).toFixed(2) : null;

          return (
            <div key={i} className="card" style={{ padding: "20px", border: triggered ? "2px solid var(--gold)" : undefined }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <p style={{ fontWeight: 700, fontSize: 16, fontFamily: "monospace" }}>{it.symbol}</p>
                    {triggered && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--gold)" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{it.name}</p>
                </div>
                <button onClick={() => remove(it.symbol)} style={{ background: "none", color: "var(--text3)", fontSize: 18, padding: 4 }}>×</button>
              </div>

              {/* Price */}
              <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.04em", marginBottom: 8 }}>
                {q ? fmtPrice(q.price, q?.currency) : <Spinner size={18} />}
              </p>
              {q && <span className={`pill ${up ? "pill-green" : "pill-red"}`}>{fmt.pct(q.changePercentage)}</span>}

              {/* Alert info */}
              {alert?.target && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: triggered ? "var(--gold-light)" : "var(--surface2)", borderRadius: 8, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{t("watchlist.target")} </span>
                  <span>{alert.dir === "above" ? "↑" : "↓"} ${alert.target.toFixed(2)}</span>
                  {distFromTarget && <span style={{ marginLeft: 8, color: triggered ? "var(--gold)" : "var(--text3)" }}>{distFromTarget > 0 ? "+" : ""}{distFromTarget}%</span>}
                </div>
              )}

              {/* Note */}
              {note && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--surface2)", borderRadius: 8, fontSize: 12, color: "var(--text2)", fontStyle: "italic" }}>
                  {note}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
                <button className="btn btn-blue btn-sm" style={{ flex: 1 }} onClick={() => onAnalyze(it.symbol)}>{t("watchlist.analyze")}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditAlert(it.symbol)} style={{ padding: "7px 10px" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditNote(it.symbol)} style={{ padding: "7px 10px" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editAlert && (
        <AlertModal sym={editAlert} current={alertInputs[editAlert]} onSave={saveAlert} onClose={() => setEditAlert(null)} />
      )}

      {editNote && (
        <NoteModal sym={editNote} current={notes[editNote]} onSave={saveNote} onClose={() => setEditNote(null)} />
      )}
    </div>
  );
}

function AlertModal({ sym, current, onSave, onClose }) {
  const { t } = useLang();
  const [target, setTarget] = useState(current?.target?.toString() || "");
  const [dir, setDir] = useState(current?.dir || "above");
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card fade" style={{ width: 340, maxWidth: "92vw", padding: "28px", marginTop: 0 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          {t("watchlist.alertModal.title", { sym })}
        </h3>
        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>{t("watchlist.alertModal.targetLabel")}</p>
        <input className="input" type="number" placeholder={t("watchlist.alertModal.targetPlaceholder")} value={target} onChange={e => setTarget(e.target.value)} style={{ marginBottom: 14 }} />
        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>{t("watchlist.alertModal.dirLabel")}</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[{ v: "above", l: t("watchlist.alertModal.above") }, { v: "below", l: t("watchlist.alertModal.below") }].map(({ v, l }) => (
            <button key={v} onClick={() => setDir(v)} className={`btn ${dir === v ? "btn-blue" : "btn-ghost"}`} style={{ flex: 1, padding: "10px 12px", fontSize: 13 }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>{t("watchlist.alertModal.cancel")}</button>
          <button className="btn btn-blue" style={{ flex: 1 }} onClick={() => target && onSave(sym, target, dir)}>{t("watchlist.alertModal.save")}</button>
        </div>
      </div>
    </div>
  );
}

function NoteModal({ sym, current, onSave, onClose }) {
  const { t } = useLang();
  const [text, setText] = useState(current || "");
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card fade" style={{ width: 360, maxWidth: "92vw", padding: "28px", marginTop: 0 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          {t("watchlist.noteModal.title", { sym })}
        </h3>
        <textarea className="input" value={text} onChange={e => setText(e.target.value)} placeholder={t("watchlist.noteModal.placeholder")} rows={5} style={{ resize: "vertical" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>{t("watchlist.noteModal.cancel")}</button>
          <button className="btn btn-blue" style={{ flex: 1 }} onClick={() => onSave(sym, text)}>{t("watchlist.noteModal.save")}</button>
        </div>
      </div>
    </div>
  );
}
