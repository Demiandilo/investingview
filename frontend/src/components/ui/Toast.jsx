import { createContext, useContext, useState, useCallback } from "react";

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

function ToastItem({ toast }) {
  const bg = toast.type === "error" ? "var(--red)" : toast.type === "info" ? "var(--blue)" : "var(--green)";
  const icon = toast.type === "error" ? "✕" : toast.type === "info" ? "ℹ" : "✓";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: bg, color: "#fff",
      padding: "12px 18px", borderRadius: 12,
      boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
      fontSize: 14, fontWeight: 500,
      animation: "fadeUp .3s cubic-bezier(.22,1,.36,1) both",
      maxWidth: 340,
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      {toast.msg}
    </div>
  );
}

function ToastContainer({ toasts }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24,
      zIndex: 9999, display: "flex", flexDirection: "column", gap: 8,
    }}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((msg, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={addToast}>
      {children}
      <ToastContainer toasts={toasts} />
    </ToastCtx.Provider>
  );
}
