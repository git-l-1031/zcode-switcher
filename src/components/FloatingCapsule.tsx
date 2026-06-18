import { X, Zap } from "lucide-react";
import { computeGlm52PoolStats, formatQuotaUnits } from "../lib/glm52";
import type { ProfileView, QuotaInfo } from "../lib/api";
import { formatText, getTexts, type Language } from "../i18n";

interface Props {
  profiles: ProfileView[];
  quotas: Record<string, QuotaInfo>;
  thresholdWan: number;
  language: Language;
  onClose: () => void;
}

export default function FloatingCapsule({
  profiles,
  quotas,
  thresholdWan,
  language,
  onClose,
}: Props) {
  const t = getTexts(language);
  const stats = computeGlm52PoolStats(profiles, quotas, thresholdWan);
  const pct =
    stats.totalUnits > 0
      ? Math.min(100, Math.max(0, (stats.usedUnits / stats.totalUnits) * 100))
      : 0;

  return (
    <div className="floating-window-root flex h-full w-full items-center justify-center bg-transparent p-1">
      <div
        data-tauri-drag-region
        className="flex h-14 w-full items-center gap-2.5 rounded-full border border-base-border bg-base-card/95 px-3 shadow-2xl"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow">
          <Zap size={16} />
        </div>

        <div data-tauri-drag-region className="min-w-0 flex-1">
          <div data-tauri-drag-region className="flex items-baseline gap-3">
            <div className="shrink-0">
              <span className="text-base font-black tabular-nums text-text-primary">
                {stats.usedAccounts}
              </span>
              <span className="ml-1 text-[10px] font-medium text-text-muted">
                / {stats.remainingAccounts}
              </span>
            </div>
            <div
              data-tauri-drag-region
              className="min-w-0 truncate text-[11px] font-semibold text-text-secondary"
            >
              {formatText(t.floatingWindowAccountStats, {
                used: stats.usedAccounts,
                remaining: stats.remainingAccounts,
              })}
            </div>
          </div>

          <div data-tauri-drag-region className="mt-0.5 flex items-center gap-2">
            <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-base-cardhover">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-[10px] text-text-muted">
              {formatQuotaUnits(stats.usedUnits)} / {formatQuotaUnits(stats.totalUnits)}
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          title={t.closeFloatingWindow}
          className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
