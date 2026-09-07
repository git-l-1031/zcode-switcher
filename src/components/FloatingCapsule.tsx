import { X, Zap } from "lucide-react";
import { computeGlm52PoolStats, formatQuotaUnits } from "../lib/glm52";
import type { ProfileView, QuotaInfo } from "../lib/api";
import { getTexts, type Language } from "../i18n";

interface Props {
  profiles: ProfileView[];
  quotas: Record<string, QuotaInfo>;
  thresholdWan: number;
  language: Language;
  scale: number;
  resizerOpen: boolean;
  onScaleChange: (v: number) => void;
  onToggleResizer: () => void;
  onClose: () => void;
}

// 1× 时的内部 CSS 像素尺寸 —— 窗口实际像素 = 这些值 × scale
export const FLOATING_BASE_W = 460;
export const FLOATING_BASE_H = 96;
export const FLOATING_RESIZER_EXTRA_H = 44;
export const FLOATING_SCALE_MIN = 0.7;
export const FLOATING_SCALE_MAX = 1.6;

export default function FloatingCapsule({
  profiles,
  quotas,
  thresholdWan,
  language,
  scale,
  resizerOpen,
  onScaleChange,
  onToggleResizer,
  onClose,
}: Props) {
  const t = getTexts(language);
  const stats = computeGlm52PoolStats(profiles, quotas, thresholdWan);
  const pct =
    stats.totalUnits > 0
      ? Math.min(100, Math.max(0, (stats.usedUnits / stats.totalUnits) * 100))
      : 0;

  const innerH = FLOATING_BASE_H + (resizerOpen ? FLOATING_RESIZER_EXTRA_H : 0);

  return (
    <div
      data-tauri-drag-region
      className="floating-window-root flex h-full w-full select-none items-center justify-center overflow-hidden bg-transparent"
    >
      <div
        style={{
          width: FLOATING_BASE_W,
          height: innerH,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
        className="flex flex-col items-stretch"
      >
        <div
          data-tauri-drag-region
          className="mx-3 mt-[14px] flex h-[68px] cursor-move items-center gap-3 rounded-full border border-base-border bg-base-card px-4 shadow-xl"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleResizer();
            }}
            title={t.resizeFloatingWindow}
            className={`focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow transition hover:bg-accent-hover active:scale-95 ${
              resizerOpen ? "ring-2 ring-offset-1 ring-offset-base-card" : ""
            }`}
            style={{
              boxShadow: resizerOpen
                ? "0 0 0 2px var(--accent-soft)"
                : undefined,
            }}
          >
            <Zap size={16} />
          </button>

          <div data-tauri-drag-region className="shrink-0 leading-none">
            <span
              data-tauri-drag-region
              className="text-xl font-black tabular-nums text-text-primary"
            >
              {stats.usedAccounts}
            </span>
            <span
              data-tauri-drag-region
              className="ml-1 text-[11px] font-semibold text-text-muted"
            >
              / {stats.totalAccounts}
            </span>
          </div>

          <div
            data-tauri-drag-region
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <div
              data-tauri-drag-region
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-base-cardhover"
            >
              <div
                data-tauri-drag-region
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span
              data-tauri-drag-region
              className="shrink-0 font-mono text-[11px] tabular-nums text-text-secondary"
            >
              {formatQuotaUnits(stats.usedUnits)} / {formatQuotaUnits(stats.totalUnits)}
            </span>
          </div>

          <button
            onClick={onClose}
            title={t.closeFloatingWindow}
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
          >
            <X size={14} />
          </button>
        </div>

        {resizerOpen && (
          <div className="mx-8 mt-2 flex h-[32px] items-center gap-2.5 rounded-full border border-base-border bg-base-card px-3 shadow-lg">
            <span className="shrink-0 select-none text-[9px] font-bold text-text-muted">
              A
            </span>
            <input
              type="range"
              min={FLOATING_SCALE_MIN}
              max={FLOATING_SCALE_MAX}
              step={0.05}
              value={scale}
              onChange={(e) => onScaleChange(Number(e.target.value))}
              className="floating-resize-slider h-1 w-full cursor-pointer appearance-none rounded-full bg-base-cardhover"
              style={{ accentColor: "var(--accent)" }}
              title={t.resizeFloatingWindow}
            />
            <span className="shrink-0 select-none text-[13px] font-bold text-text-muted">
              A
            </span>
            <span className="ml-1 shrink-0 font-mono text-[10px] tabular-nums text-text-secondary">
              {Math.round(scale * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
