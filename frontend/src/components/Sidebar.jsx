import { Logo } from "./Auth.jsx";
import { useLang } from "../i18n.js";

const NAV_IDS = ["dashboard", "analisi", "screener", "portfolio", "watchlist", "glossario"];
const NAV_KEYS = { dashboard: "home", analisi: "analisi", screener: "screener", portfolio: "portfolio", watchlist: "watch", glossario: "glossario" };

function NavIcon({ id, active }) {
  const c = active ? "var(--blue)" : "var(--text3)";
  const s = { width: 22, height: 22 };
  const icons = {
    dashboard: <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
    analisi:   <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    screener:  <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M7 12h10M10 18h4"/></svg>,
    portfolio: <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>,
    watchlist: <svg {...s} viewBox="0 0 24 24" fill={active ? "var(--blue)" : "none"} stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    glossario: <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  };
  return icons[id] || null;
}

function LangToggle({ lang, onSetLang }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {["it", "en"].map(l => (
        <button
          key={l}
          onClick={() => onSetLang(l)}
          style={{
            padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
            cursor: "pointer", border: "1px solid",
            background: lang === l ? "var(--blue)" : "transparent",
            color: lang === l ? "#fff" : "var(--text3)",
            borderColor: lang === l ? "var(--blue)" : "var(--border)",
            letterSpacing: ".04em", transition: "all .15s",
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function Sidebar({ page, onNav, watchlistCount, dark, onToggleDark, onOpenSearch, user, onLogout, lang, onSetLang }) {
  const { t } = useLang();

  return (
    <aside className="desktop-sidebar" style={{ width: 216, background: "var(--surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, height: "100vh", zIndex: 100 }}>
      {/* Logo */}
      <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid var(--border2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo size={32} />
            <div>
              <p style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>InvestingView</p>
              <p style={{ fontSize: 10, color: "var(--text3)", letterSpacing: "0.01em" }}>{t("nav.appTagline")}</p>
            </div>
          </div>
          {/* Dark mode toggle */}
          <button onClick={onToggleDark} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "var(--text2)" }} title={dark ? t("nav.lightMode") : t("nav.darkMode")}>
            {dark ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
        </div>
        {/* Search shortcut */}
        <button onClick={onOpenSearch} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)", cursor: "pointer", color: "var(--text3)", fontSize: 13 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          {t("nav.search")}
          <kbd style={{ marginLeft: "auto", padding: "1px 5px", borderRadius: 4, background: "var(--border)", fontSize: 10, border: "1px solid var(--border2)" }}>⌘K</kbd>
        </button>
      </div>

      {/* Nav */}
      <nav style={{ padding: "12px 10px", flex: 1 }}>
        {NAV_IDS.map(id => (
          <button key={id} className={`nav-item${page === id ? " active" : ""}`} onClick={() => onNav(id)}>
            <NavIcon id={id} active={page === id} />
            {t(`nav.${NAV_KEYS[id]}`)}
            {id === "watchlist" && watchlistCount > 0 && (
              <span style={{ marginLeft: "auto", background: "var(--blue)", color: "white", borderRadius: 10, fontSize: 10, padding: "2px 7px", fontWeight: 700 }}>{watchlistCount}</span>
            )}
          </button>
        ))}
      </nav>

      {/* User + Logout */}
      <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 50, background: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              {(user?.name?.[0] || "U").toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name || "Utente"}</p>
            </div>
          </div>
          <LangToggle lang={lang} onSetLang={onSetLang} />
        </div>
        <button
          onClick={onLogout}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 9, background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          {t("nav.logout")}
        </button>
      </div>
    </aside>
  );
}

export function BottomNav({ page, onNav, watchlistCount }) {
  const { t } = useLang();
  return (
    <nav className="mobile-tabbar" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200, background: "var(--surface)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderTop: "1px solid var(--border2)", display: "flex", alignItems: "stretch", paddingBottom: "env(safe-area-inset-bottom, 6px)" }}>
      {NAV_IDS.map(id => {
        const active = page === id;
        return (
          <button key={id} onClick={() => onNav(id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "10px 2px 8px", background: "none", border: "none", cursor: "pointer", position: "relative", WebkitTapHighlightColor: "transparent" }}>
            <NavIcon id={id} active={active} />
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, color: active ? "var(--blue)" : "var(--text3)" }}>{t(`nav.${NAV_KEYS[id]}`)}</span>
            {id === "watchlist" && watchlistCount > 0 && (
              <span style={{ position: "absolute", top: 6, right: "calc(50% - 16px)", background: "var(--red)", color: "white", borderRadius: 8, fontSize: 9, padding: "1px 5px", fontWeight: 700 }}>{watchlistCount}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
