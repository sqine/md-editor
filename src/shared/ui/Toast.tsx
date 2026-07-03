import { createContext, useContext, useState, useCallback, useRef } from "react";
import "./Toast.css";

// ── 타입 ─────────────────────────────────────────────────────────
export type ToastLevel = "error" | "warn" | "info" | "success";

interface ToastItem {
  id:      number;
  level:   ToastLevel;
  title:   string;
  detail?: string;
}

interface ToastCtx {
  toast: (level: ToastLevel, title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  warn:  (title: string, detail?: string) => void;
  info:  (title: string, detail?: string) => void;
}

// ── Context ───────────────────────────────────────────────────────
const ToastContext = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────
const AUTO_DISMISS_MS = 4000;
let _seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((level: ToastLevel, title: string, detail?: string) => {
    const id = ++_seq;
    setItems((prev) => [...prev.slice(-4), { id, level, title, detail }]);
    const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    timers.current.set(id, timer);
  }, [dismiss]);

  const ctx: ToastCtx = {
    toast,
    error:   (title, detail) => toast("error",   title, detail),
    warn:    (title, detail) => toast("warn",    title, detail),
    info:    (title, detail) => toast("info",    title, detail),
  };

  const ICONS: Record<ToastLevel, string> = {
    error:   "error",
    warn:    "warning",
    info:    "info",
    success: "check_circle",
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div id="toast-container" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`} role="alert">
            <span className="material-symbols-outlined toast-icon">{ICONS[t.level]}</span>
            <div className="toast-body">
              <span className="toast-title">{t.title}</span>
              {t.detail && <span className="toast-detail">{t.detail}</span>}
            </div>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="닫기">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
