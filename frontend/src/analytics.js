// Thin wrapper around the GA4 gtag.js loaded in index.html.
// Safe to call even before gtag is ready or if GA is blocked (ad blockers, etc).
function gtag(...args) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag(...args);
  }
}

/** Tracks a virtual page view, e.g. trackPageView("dashboard"), trackPageView("analisi"). */
export function trackPageView(page) {
  gtag("event", "page_view", {
    page_title: page,
    page_path: `/${page}`,
  });
}

/** Tracks a custom interaction, e.g. trackEvent("search", "ricerca_titolo", "AAPL"). */
export function trackEvent(category, action, label) {
  gtag("event", action, {
    event_category: category,
    event_label: label,
  });
}
