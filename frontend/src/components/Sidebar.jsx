import { useState } from "react";
import { Logo } from "./Auth.jsx";
import { useLang } from "../i18n.js";

/* ─── Nav ids ──────────────────────────────────────────────────────────────── */
const SIDEBAR_IDS    = ["dashboard", "analisi", "screener", "portfolio", "watchlist", "glossario"];
const BOTTOM_NAV_IDS = ["dashboard", "analisi", "screener", "watchlist", "portfolio"];
const NAV_KEYS = {
  dashboard: "home", analisi: "analisi", screener: "screener",
  portfolio: "portfolio", watchlist: "watch", glossario: "glossario",
};

/* ─── Icons ────────────────────────────────────────────────────────────────── */
function NavIcon({ id, active, size = 22 }) {
  const c = active ? "var(--blue)" : "var(--text3)";
  const s = { width: size, height: size };
  const icons = {
    dashboard: <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
    analisi:   <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    screener:  <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M7 12h10M10 18h4"/></svg>,
    portfolio: <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>,
    watchlist: <svg {...s} viewBox="0 0 24 24" fill={active ? "var(--blue)" : "none"} stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    glossario: <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
    profilo:   <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    settings:  <svg {...s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 13.09H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  };
  return icons[id] || null;
}

/* ─── Profile Drawer (mobile only) ────────────────────────────────────────── */
function ProfileDrawer({ open, onClose, user, onNav, onLogout }) {
  const { t } = useLang();
  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
        zIndex: 299, backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
      }} />
      {/* Drawer */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "var(--surface)", borderRadius: "20px 20px 0 0",
        zIndex: 300, padding: "0 24px calc(env(safe-area-inset-bottom, 12px) + 16px)",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.28)",
        animation: "slideUp .3s cubic-bezier(.22,1,.36,1)",
      }}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: "var(--border)", borderRadius: 2, margin: "12px auto 20px" }} />

        {/* User info */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "var(--surface2)", borderRadius: 14, marginBottom: 20 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 20, fontWeight: 700, flexShrink: 0 }}>
            {(user?.name?.[0] || "U").toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>{user?.name || "Utente"}</p>
            <p style={{ fontSize: 12, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email || ""}</p>
          </div>
        </div>

        {/* Settings */}
        <div>
          {/* Impostazioni Account */}
          <button onClick={() => { onNav("account"); onClose(); }} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12,
            padding: "15px 0", borderBottom: "1px solid var(--border2)",
            background: "none", border: "none",
            cursor: "pointer", fontSize: 15, fontWeight: 500, color: "var(--text)",
          }}>
            <NavIcon id="settings" active={false} size={20} />
            {t("nav.account")}
          </button>

          {/* Glossario */}
          <button onClick={() => { onNav("glossario"); onClose(); }} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12,
            padding: "15px 0", borderBottom: "1px solid var(--border2)",
            background: "none", border: "none", borderBottom: "1px solid var(--border2)",
            cursor: "pointer", fontSize: 15, fontWeight: 500, color: "var(--text)",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            {t("nav.glossario")}
          </button>

          {/* Logout */}
          <button onClick={() => { onLogout(); onClose(); }} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12,
            padding: "16px 0", marginTop: 4,
            background: "none", border: "none", cursor: "pointer",
            fontSize: 15, fontWeight: 600, color: "var(--red)",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            {t("nav.logout")}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Desktop Sidebar ──────────────────────────────────────────────────────── */
export function Sidebar({ page, onNav, watchlistCount, onOpenSearch, user, onLogout }) {
  const { t } = useLang();

  return (
    <aside className="desktop-sidebar" style={{ width: 216, background: "var(--surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, height: "100vh", zIndex: 100 }}>
      {/* Logo */}
      <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid var(--border2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Logo size={32} />
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>InvestingView</p>
            <p style={{ fontSize: 10, color: "var(--text3)", letterSpacing: "0.01em" }}>{t("nav.appTagline")}</p>
          </div>
        </div>
        <button onClick={onOpenSearch} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)", cursor: "pointer", color: "var(--text3)", fontSize: 13 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          {t("nav.search")}
          <kbd style={{ marginLeft: "auto", padding: "1px 5px", borderRadius: 4, background: "var(--border)", fontSize: 10, border: "1px solid var(--border2)" }}>⌘K</kbd>
        </button>
      </div>

      {/* Nav */}
      <nav style={{ padding: "12px 10px", flex: 1 }}>
        {SIDEBAR_IDS.map(id => (
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, marginBottom: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 50, background: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            {(user?.name?.[0] || "U").toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name || "Utente"}</p>
          </div>
          <button onClick={() => onNav("account")} title={t("nav.account")} style={{ background: page === "account" ? "var(--blue-light)" : "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: page === "account" ? "var(--blue)" : "var(--text2)" }}>
            <NavIcon id="settings" active={page === "account"} size={14} />
          </button>
        </div>
        <button onClick={onLogout} style={{ width: "100%", padding: "8px 12px", borderRadius: 9, background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          {t("nav.logout")}
        </button>
      </div>
    </aside>
  );
}

/* ─── Mobile Bottom Nav ────────────────────────────────────────────────────── */
export function BottomNav({ page, onNav, watchlistCount, user, onLogout }) {
  const { t } = useLang();
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <>
      <nav className="mobile-tabbar" style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200,
        background: "var(--surface)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        borderTop: "1px solid var(--border2)", display: "flex", alignItems: "stretch",
        paddingBottom: "env(safe-area-inset-bottom, 6px)",
      }}>
        {BOTTOM_NAV_IDS.map(id => {
          const active = page === id;
          return (
            <button key={id} onClick={() => onNav(id)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: 3, padding: "10px 2px 8px",
              background: "none", border: "none", cursor: "pointer", position: "relative",
              WebkitTapHighlightColor: "transparent",
            }}>
              <NavIcon id={id} active={active} />
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, color: active ? "var(--blue)" : "var(--text3)" }}>
                {t(`nav.${NAV_KEYS[id]}`)}
              </span>
              {id === "watchlist" && watchlistCount > 0 && (
                <span style={{ position: "absolute", top: 6, right: "calc(50% - 16px)", background: "var(--red)", color: "white", borderRadius: 8, fontSize: 9, padding: "1px 5px", fontWeight: 700 }}>{watchlistCount}</span>
              )}
            </button>
          );
        })}

        {/* Profilo tab */}
        <button onClick={() => setProfileOpen(true)} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 3, padding: "10px 2px 8px",
          background: "none", border: "none", cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}>
          <NavIcon id="profilo" active={profileOpen} />
          <span style={{ fontSize: 10, fontWeight: profileOpen ? 700 : 400, color: profileOpen ? "var(--blue)" : "var(--text3)" }}>
            Profilo
          </span>
        </button>
      </nav>

      <ProfileDrawer
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        onNav={id => { onNav(id); setProfileOpen(false); }}
        onLogout={onLogout}
      />
    </>
  );
}
