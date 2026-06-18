import { useStore } from "../store";

const COLORS: Record<string, string> = {
  info: "bg-accent",
  success: "bg-ok",
  error: "bg-danger",
  warn: "bg-warn",
};

export default function ToastStack() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed left-1/2 top-6 z-[100] flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-anim max-w-md whitespace-pre-line rounded-xl px-5 py-3 text-center text-sm font-bold text-white shadow-2xl ${
            COLORS[t.kind] ?? COLORS.info
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
