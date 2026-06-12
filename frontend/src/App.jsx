import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { G, RESP } from "./styles.js";
import { API, useLocalStorage } from "./api.js";
import { LangProvider, useLang } from "./i18n.js";
import { ToastProvider, useToast } from "./components/ui/Toast.jsx";
import { SearchModal } from "./components/ui/SearchModal.jsx";
import { Sidebar, BottomNav } from "./components/Sidebar.jsx";
import { Skeleton } from "./components/ui/Spinner.jsx";
import Auth from "./components/Auth.jsx";

// Dashboard loaded eagerly (first screen); everything else lazy-loaded on first visit
import Dashboard from "./components/Dashboard.jsx";
const StockAnalysis = lazy(() => import("./components/StockAnalysis.jsx"));
const Screener      = lazy(() => import("./components/Screener.jsx"));
const Portfolio     = lazy(() => import("./components/Portfolio.jsx"));
const Watchlist     = lazy(() => import("./components/Watchlist.jsx"));
const Glossario     = lazy(() => import("./components/Glossario.jsx"));
const AccountSettings = lazy(() => import("./components/AccountSettings.jsx"));

function PageLoader() {
  return (
    <div style={{ padding: "28px 0" }}>
      {[180, 90, 120].map((h, i) => <div key={i} className="skeleton" style={{ height: h, borderRadius: 16, marginBottom: 16 }} />)}
    </div>
  );
}

const INITIAL_POSITIONS = [
  { symbol:"AAPL", name:"Apple Inc.",      qty:10, avg:170.50, cur:null, ch:null, loading:true },
  { symbol:"MSFT", name:"Microsoft Corp.", qty:5,  avg:380.00, cur:null, ch:null, loading:true },
];

const DEFAULT_WATCHLIST = [
  { symbol:"AAPL", name:"Apple Inc.",       price:189.30, change:0.48 },
  { symbol:"MSFT", name:"Microsoft Corp.",  price:415.20, change:0.62 },
];

function AppInner() {
  const { lang, setLang } = useLang();
  const [user, setUser]           = useLocalStorage("investingview_user", null);
  const [page, setPage]           = useState("dashboard");
  const [activeSym, setActiveSym] = useState(null);
  const [positions, setPositions] = useState(INITIAL_POSITIONS);
  const [watchlist, setWatchlist] = useLocalStorage("watchlist_items", DEFAULT_WATCHLIST);
  const [dark, setDark]           = useLocalStorage("dark_mode", false);
  const [showSearch, setShowSearch] = useState(false);
  const addToast = useToast();

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  // Apply dark mode
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  // CMD+K shortcut
  useEffect(() => {
    const h = e => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowSearch(true); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Load live prices for initial positions
  useEffect(() => {
    if (!user) return;
    positions.forEach((p, i) => {
      if (!p.loading) return;
      API.getQuote(p.symbol).then(q => {
        if (q) setPositions(prev => { const x = [...prev]; x[i] = { ...x[i], cur: q.price || p.avg, ch: q.changePercentage, loading: false }; return x; });
      }).catch(() => {
        setPositions(prev => { const x = [...prev]; x[i] = { ...x[i], loading: false }; return x; });
      });
    });
  }, [user]);

  const go = useCallback((p, sym = null) => {
    setPage(p);
    if (sym) setActiveSym(sym);
    window.scrollTo(0, 0);
  }, []);

  const onSearch = useCallback(s => {
    if (!s) return;
    setActiveSym(s);
    setPage("analisi");
    window.scrollTo(0, 0);
    try {
      const prev = JSON.parse(localStorage.getItem("recent_searches") || "[]");
      const next = [s, ...prev.filter(x => x !== s)].slice(0, 5);
      localStorage.setItem("recent_searches", JSON.stringify(next));
    } catch {}
  }, []);

  const onAddWatch = useCallback(it => {
    setWatchlist(p => p.find(w => w.symbol === it.symbol) ? p : [...p, it]);
  }, [setWatchlist]);

  const onRemoveWatch = useCallback(sym => {
    setWatchlist(p => p.filter(w => w.symbol !== sym));
  }, [setWatchlist]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("investingview_token");
    setUser(null);
    setPage("dashboard");
    setActiveSym(null);
  }, [setUser]);

  const handleUpdateUser = useCallback(u => {
    setUser(prev => ({ ...prev, ...u }));
  }, [setUser]);

  // Show auth page if not logged in
  if (!user) {
    return <Auth onAuth={u => setUser(u)} />;
  }

  return (
    <>
      <style>{G}</style>
      <style>{RESP}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
        <Sidebar
          page={page}
          onNav={p => go(p)}
          watchlistCount={watchlist.length}
          dark={dark}
          onToggleDark={() => setDark(d => !d)}
          onOpenSearch={() => setShowSearch(true)}
          user={user}
          onLogout={handleLogout}
          lang={lang}
          onSetLang={setLang}
        />

        <main className="main-content" style={{ marginLeft: isMobile ? 0 : 216, minHeight: "100vh" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px", boxSizing: "border-box" }}>
            {page === "dashboard" && (
              <Dashboard
                onSearch={onSearch}
                watchlist={watchlist}
                positions={positions}
                onGoPortfolio={() => go("portfolio")}
              />
            )}
            <Suspense fallback={<PageLoader />}>
              {page === "analisi" && (
                <StockAnalysis
                  key={activeSym}
                  initSym={activeSym}
                  onAddWatchlist={onAddWatch}
                  onRemoveWatchlist={onRemoveWatch}
                  watchlist={watchlist}
                  onGoHome={() => go("dashboard")}
                  dark={dark}
                />
              )}
              {page === "screener" && (
                <Screener onAnalyze={s => { setActiveSym(s); setPage("analisi"); }} />
              )}
              {page === "portfolio" && (
                <Portfolio positions={positions} setPositions={setPositions} />
              )}
              {page === "watchlist" && (
                <Watchlist
                  items={watchlist}
                  setItems={setWatchlist}
                  onAnalyze={onSearch}
                />
              )}
              {page === "glossario" && <Glossario />}
              {page === "account" && (
                <AccountSettings
                  user={user}
                  onUpdateUser={handleUpdateUser}
                  onLogout={handleLogout}
                  onGoHome={() => go("dashboard")}
                />
              )}
            </Suspense>
          </div>
        </main>

        <BottomNav
          page={page}
          onNav={p => go(p)}
          watchlistCount={watchlist.length}
          dark={dark}
          onToggleDark={() => setDark(d => !d)}
          user={user}
          onLogout={handleLogout}
          lang={lang}
          onSetLang={setLang}
        />
      </div>

      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onSearch={s => { onSearch(s); setShowSearch(false); }}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <LangProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </LangProvider>
  );
}
