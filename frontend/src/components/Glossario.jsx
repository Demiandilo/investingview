import { useState } from "react";
import { useLang } from "../i18n.js";

const CAT_KEY = {
  Fondamentale: "fundamental", Tecnica: "technical", Speciale: "special", Generale: "general",
  Fundamental: "fundamental", Technical: "technical", Special: "special", General: "general",
};
const CAT_COLOR = { fundamental: "pill-blue", technical: "pill-green", special: "pill-gold", general: "pill-gray" };

export default function Glossario() {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [catKey, setCatKey] = useState("all");

  const terms = t("glossary.terms");
  const catLabels = t("glossary.cats");

  const filtered = terms.filter(v => {
    const k = CAT_KEY[v.c] || "general";
    return (catKey === "all" || k === catKey) &&
      (v.t.toLowerCase().includes(q.toLowerCase()) || v.d.toLowerCase().includes(q.toLowerCase()));
  });

  const CATS = [
    { key: "all",          label: catLabels.all },
    { key: "fundamental",  label: catLabels.fundamental },
    { key: "technical",    label: catLabels.technical },
    { key: "special",      label: catLabels.special },
    { key: "general",      label: catLabels.general },
  ];

  return (
    <div className="fade page-pad" style={{ padding: "28px 0" }}>
      <h1 className="page-title" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.04em", marginBottom: 6 }}>{t("glossary.title")}</h1>
      <p style={{ fontSize: 15, color: "var(--text2)", marginBottom: 24 }}>{t("glossary.subtitle")}</p>
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input className="input" placeholder={t("glossary.searchPlaceholder")} value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CATS.map(({ key, label }) => (
            <button key={key} onClick={() => setCatKey(key)} style={{ padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: "pointer", background: catKey === key ? "var(--blue)" : "var(--surface)", color: catKey === key ? "white" : "var(--text2)", border: catKey === key ? "none" : "1px solid var(--border)" }}>{label}</button>
          ))}
        </div>
      </div>
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((v, i) => {
          const k = CAT_KEY[v.c] || "general";
          return (
            <div key={i} className="card" style={{ padding: "18px 22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <p style={{ fontSize: 15, fontWeight: 700 }}>{v.t}</p>
                <span className={`pill ${CAT_COLOR[k] || "pill-gray"}`}>{v.c}</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.75 }}>{v.d}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
