import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { G, RESP } from "./styles.js";
import { API, useLocalStorage } from "./api.js";
import { LangProvider, useLang } from "./i18n.js";
import { ToastProvider, useToast } from "./components/ui/Toast.jsx";
import { SearchModal } from "./components/ui/SearchModal.jsx";
import { Sidebar, BottomNav } from "./components/Sidebar.jsx";
import { Skeleton } from "./components/ui/Spinner.jsx";
import Auth from "./components/Auth.jsx";
import { trackPageView, trackEvent } from "./analytics.js";

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

function AppInner() {
  const { lang, setLang } = useLang();
  const [user, setUser]           = useLocalStorage("investingview_user", null);
  const [page, setPage]           = useState("dashboard");
  const [activeSym, setActiveSym] = useState(null);
  const [positions, setPositions] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
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

  // Track a page view every time the active page changes (incl. initial load)
  useEffect(() => {
    trackPageView(page);
  }, [page]);

  // Load watchlist & portfolio from backend on login (replaces localStorage persistence)
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem("investingview_token");
    if (!token) return;

    (async () => {
      const [wl, pf] = await Promise.all([
        API.getWatchlist().catch(() => []),
        API.getPortfolio().catch(() => []),
      ]);

      const hydratedWatchlist = await Promise.all((wl || []).map(async w => {
        const q = await API.getQuote(w.symbol).catch(() => null);
        return { symbol: w.symbol, name: q?.name || w.symbol, price: q?.price ?? null, change: q?.changePercentage ?? null };
      }));
      setWatchlist(hydratedWatchlist);

      setPositions((pf || []).map(p => ({
        id: p.id, symbol: p.symbol, name: p.symbol,
        qty: p.quantity, avg: p.buyPrice, buyDate: p.buyDate,
        cur: null, ch: null, loading: true,
      })));
    })();
  }, [user?.id]);

  // Load live prices + names for positions pending a quote
  useEffect(() => {
    positions.forEach((p, i) => {
      if (!p.loading) return;
      Promise.all([
        API.getQuote(p.symbol).catch(() => null),
        API.getProfile(p.symbol).catch(() => null),
      ]).then(([q, prof]) => {
        setPositions(prev => {
          if (!prev[i] || prev[i].symbol !== p.symbol) return prev;
          const x = [...prev];
          x[i] = { ...x[i], cur: q?.price ?? x[i].avg, ch: q?.changePercentage ?? null, name: prof?.companyName || x[i].name, loading: false };
          return x;
        });
      });
    });
  }, [positions]);

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
    trackEvent("search", "ricerca_titolo", s);
    try {
      const prev = JSON.parse(localStorage.getItem("recent_searches") || "[]");
      const next = [s, ...prev.filter(x => x !== s)].slice(0, 5);
      localStorage.setItem("recent_searches", JSON.stringify(next));
    } catch {}
  }, []);

  const onAddWatch = useCallback(it => {
    setWatchlist(p => p.find(w => w.symbol === it.symbol) ? p : [...p, it]);
    API.addToWatchlist(it.symbol).catch(() => {});
    trackEvent("watchlist", "aggiungi_watchlist", it.symbol);
  }, [setWatchlist]);

  const onRemoveWatch = useCallback(sym => {
    setWatchlist(p => p.filter(w => w.symbol !== sym));
    API.removeFromWatchlist(sym).catch(() => {});
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
          onOpenSearch={() => setShowSearch(true)}
          user={user}
          onLogout={handleLogout}
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
                  onRemove={onRemoveWatch}
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
                  lang={lang}
                  onSetLang={setLang}
                  dark={dark}
                  onToggleDark={() => setDark(d => !d)}
                  watchlist={watchlist}
                  positions={positions}
                />
              )}
            </Suspense>
          </div>
        </main>

        <BottomNav
          page={page}
          onNav={p => go(p)}
          watchlistCount={watchlist.length}
          user={user}
          onLogout={handleLogout}
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
