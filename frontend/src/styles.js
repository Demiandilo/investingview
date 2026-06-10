export const G = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #f0f3fa; --surface: #ffffff; --surface2: #eef1f8;
  --border: rgba(0,0,0,0.08); --border2: rgba(0,0,0,0.05);
  --text: #131722; --text2: #787b86; --text3: #b2b5be;
  --blue: #2962ff; --blue-light: rgba(41,98,255,0.10);
  --green: #26a69a; --green-light: rgba(38,166,154,0.12);
  --red: #ef5350; --red-light: rgba(239,83,80,0.12);
  --gold: #f59e0b; --gold-light: rgba(245,158,11,0.13);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow: 0 2px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.12);
}
[data-theme="dark"] {
  --bg: #131722; --surface: #1a1e2e; --surface2: #242836;
  --border: rgba(255,255,255,0.07); --border2: rgba(255,255,255,0.06);
  --text: #d1d4dc; --text2: #9ea3ae; --text3: #787b86;
  --blue-light: rgba(41,98,255,0.15);
  --green-light: rgba(38,166,154,0.15);
  --red-light: rgba(239,83,80,0.15);
  --gold-light: rgba(245,158,11,0.15);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.45);
  --shadow: 0 2px 12px rgba(0,0,0,0.38), 0 1px 3px rgba(0,0,0,0.22);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.55);
}
html { -webkit-font-smoothing: antialiased; }
body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
button { font-family: inherit; cursor: pointer; border: none; outline: none; }
input, select, textarea { font-family: inherit; outline: none; }

@keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
.ticker-scroll { display: flex; animation: marquee 65s linear infinite; will-change: transform; }
.ticker-wrap { overflow: hidden; cursor: default; }
.ticker-wrap:hover .ticker-scroll { animation-play-state: paused; }

.fade { animation: fadeUp .35s cubic-bezier(.22,1,.36,1) both; }
@keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
.stagger > * { animation: fadeUp .35s cubic-bezier(.22,1,.36,1) both; }
.stagger > *:nth-child(1){animation-delay:.04s} .stagger > *:nth-child(2){animation-delay:.09s}
.stagger > *:nth-child(3){animation-delay:.14s} .stagger > *:nth-child(4){animation-delay:.19s}
.stagger > *:nth-child(5){animation-delay:.24s} .stagger > *:nth-child(6){animation-delay:.29s}
.stagger > *:nth-child(7){animation-delay:.34s} .stagger > *:nth-child(8){animation-delay:.39s}
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.45;transform:scale(.75)} }
.pulse { animation: pulse 2s ease-in-out infinite; }
@keyframes skeletonAnim { 0%,100%{opacity:.35} 50%{opacity:.75} }
.skeleton { background: var(--surface2); border-radius: 8px; animation: skeletonAnim 1.4s ease-in-out infinite; }
@keyframes flash-green { 0%{background:var(--green-light)} 100%{background:transparent} }
@keyframes flash-red   { 0%{background:var(--red-light)}   100%{background:transparent} }
.flash-green { animation: flash-green .9s ease-out; }
.flash-red   { animation: flash-red .9s ease-out; }
@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.card { background: var(--surface); border-radius: 12px; box-shadow: var(--shadow); border: 1px solid var(--border2); transition: box-shadow .22s, transform .22s, border-color .22s; }
.card-hover:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px) scale(1.005); cursor: pointer; border-color: rgba(41,98,255,0.18); }
.pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
.pill-green { background: var(--green-light); color: var(--green); }
.pill-red   { background: var(--red-light);   color: var(--red);   }
.pill-gold  { background: var(--gold-light);  color: var(--gold);  }
.pill-blue   { background: var(--blue-light);             color: var(--blue);   }
.pill-gray   { background: var(--surface2);               color: var(--text2);  }
.pill-orange { background: rgba(255,112,38,0.13);          color: #d95f00;       }
[data-theme="dark"] .pill-orange { background: rgba(255,112,38,0.22); color: #ff8c42; }
.input { background: var(--surface2); border: 1.5px solid transparent; color: var(--text); border-radius: 10px; padding: 13px 18px; font-size: 15px; width: 100%; transition: all .2s; }
.input:focus { background: var(--surface); border-color: var(--blue); box-shadow: 0 0 0 3px rgba(41,98,255,.12); }
.input::placeholder { color: var(--text3); }
select.input { appearance: none; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 10px; padding: 13px 22px; font-size: 15px; font-weight: 600; transition: all .18s; }
.btn-blue  { background: var(--blue); color: #fff; }
.btn-blue:hover  { background: #1749d8; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(41,98,255,.35); }
.btn-ghost { background: var(--surface2); color: var(--text2); border: 1.5px solid var(--border); }
.btn-ghost:hover { background: var(--border2); color: var(--text); }
.btn-sm { padding: 7px 14px; font-size: 13px; border-radius: 7px; }
.tabs { display: flex; gap: 2px; background: var(--surface2); border-radius: 10px; padding: 3px; }
.tab { flex: 1; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; color: var(--text2); transition: all .18s; cursor: pointer; border: none; background: transparent; white-space: nowrap; }
.tab.active { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow-sm); }
.tabs-line { display: flex; gap: 0; border-bottom: 1px solid var(--border2); }
.tab-line { padding: 10px 18px; font-size: 13px; font-weight: 500; color: var(--text2); cursor: pointer; border: none; background: transparent; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all .18s; white-space: nowrap; }
.tab-line.active { color: var(--blue); font-weight: 600; border-bottom-color: var(--blue); }
.tip-wrap { position: relative; display: inline-flex; cursor: help; }
.tip { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); background: var(--text); color: var(--surface); border-radius: 8px; padding: 10px 13px; width: 240px; font-size: 12px; line-height: 1.6; z-index: 999; pointer-events: none; opacity: 0; transition: opacity .2s; box-shadow: var(--shadow-lg); }
.tip::after { content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%); border:5px solid transparent; border-top-color: var(--text); }
.tip-wrap:hover .tip { opacity: 1; }
.divider { height: 1px; background: var(--border); margin: 0 -20px; }
.score-track { height: 6px; background: var(--surface2); border-radius: 3px; overflow: hidden; }
.score-fill { height: 100%; border-radius: 3px; transition: width .9s cubic-bezier(.22,1,.36,1); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th { padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; color: var(--text3); letter-spacing: .04em; text-transform: uppercase; border-bottom: 1px solid var(--border); }
.data-table td { padding: 13px 16px; font-size: 14px; border-bottom: 1px solid var(--border2); font-variant-numeric: tabular-nums; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--surface2); }
.nav-item { display: flex; align-items: center; gap: 11px; padding: 9px 14px; border-radius: 10px; font-size: 14px; font-weight: 500; color: var(--text2); transition: all .15s; cursor: pointer; border: none; background: transparent; width: 100%; text-align: left; position: relative; }
.nav-item:hover { background: var(--surface2); color: var(--text); }
.nav-item.active { background: var(--blue-light); color: var(--blue); font-weight: 600; }
.nav-item.active::before { content: ''; position: absolute; left: 0; top: 5px; bottom: 5px; width: 3px; background: var(--blue); border-radius: 0 3px 3px 0; }
.page-title { font-size: 28px; font-weight: 800; letter-spacing: -.04em; margin-bottom: 24px; color: var(--text); }
[data-theme="dark"] .page-title { color: #ffffff; }
[data-theme="dark"] h1 { color: #ffffff; }
[data-theme="dark"] h2 { color: var(--text); }
.section-label { font-size: 11px; font-weight: 700; color: var(--text3); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 14px; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: flex-start; justify-content: center; z-index: 1000; backdrop-filter: blur(8px); padding-top: 80px; }
.chat-bubble { max-width: 82%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.65; }
.chat-user { background: var(--blue); color: #fff; border-bottom-right-radius: 4px; align-self: flex-end; }
.chat-ai   { background: var(--surface2); color: var(--text); border-bottom-left-radius: 4px; align-self: flex-start; }
`;

export const RESP = `
@media (max-width: 767px) {
  .desktop-sidebar { display: none !important; }
  .main-content { margin-left: 0 !important; padding-bottom: 90px !important; }
  .main-content > div { padding-left: 14px !important; padding-right: 14px !important; }
  .ticker-scroll { animation-duration: 45s !important; }
  .page-pad { padding-top: 12px !important; }
  .page-title { font-size: 22px !important; margin-bottom: 16px !important; }
  .search-row { flex-direction: row !important; gap: 8px !important; align-items: stretch !important; }
  .search-btn { padding: 0 16px !important; min-width: 80px !important; font-size: 14px !important; }
  .search-input { font-size: 16px !important; padding: 13px 14px !important; }
  .dash-header { flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
  .idx-grid { grid-template-columns: repeat(2,1fr) !important; gap: 8px !important; }
  .pf-summary-grid { grid-template-columns: repeat(2,1fr) !important; gap: 8px !important; }
  .movers-container { grid-template-columns: 1fr !important; gap: 10px !important; }
  .metric-grid { grid-template-columns: repeat(2,1fr) !important; gap: 9px !important; }
  .pf-sum-grid { grid-template-columns: repeat(2,1fr) !important; gap: 9px !important; }
  .wl-grid { grid-template-columns: repeat(2,1fr) !important; gap: 9px !important; }
  .ai-str-risk { grid-template-columns: 1fr !important; }
  .screener-filters { grid-template-columns: repeat(2,1fr) !important; }
  .company-header { flex-direction: column !important; }
  .company-price-block { text-align: left !important; }
  .verdict-row { flex-direction: column !important; gap: 12px !important; }
  .tab-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .tab-wrap .tabs { min-width: max-content; width: auto; }
  .search-chips { flex-wrap: nowrap !important; overflow-x: auto; padding-bottom: 4px; }
  .pos-row { flex-direction: column; align-items: flex-start !important; gap: 10px !important; }
  .dash-split { grid-template-columns: 1fr !important; }
  .sectors-chart-wrap { height: 180px !important; }
  .dash-bottom { grid-template-columns: 1fr !important; }
  .peers-grid { grid-template-columns: repeat(2,1fr) !important; }
  .card { border-radius: 10px !important; }
  .data-table td, .data-table th { padding: 10px 12px !important; font-size: 13px !important; }
  .tabs { gap: 1px !important; }
  .tab { padding: 7px 10px !important; font-size: 12px !important; }
}
@media (min-width: 768px) {
  .mobile-tabbar { display: none !important; }
  .dash-split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .dash-bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
}
`;
