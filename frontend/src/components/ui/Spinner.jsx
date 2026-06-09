export function Spinner({ size = 18 }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#d1d5db" strokeWidth="2.5"/>
      <path d="M12 3a9 9 0 0 1 9 9" stroke="var(--blue)" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

export function Skeleton({ w = "100%", h = 18, r = 8 }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r }} />;
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ padding: "20px 24px" }}>
      <Skeleton h={14} w="40%" r={6} />
      <div style={{ marginTop: 16 }}>
        <Skeleton h={28} w="60%" r={6} />
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton h={12} r={6} />
        <Skeleton h={12} w="80%" r={6} />
        <Skeleton h={12} w="60%" r={6} />
      </div>
    </div>
  );
}

export function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" style={{ color: "var(--text3)" }}>
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 16v-4M12 8h.01"/>
    </svg>
  );
}
