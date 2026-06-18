import type { BalanceItem } from "../lib/api";

interface Props {
  item: BalanceItem;
  /** 紧凑模式：适配窄卡片，单行显示，不使用固定宽度列。 */
  compact?: boolean;
}

/** 把数值格式化成易读字符串（万 / 百万 / 亿）。 */
function fmt(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + " 亿";
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + " 万";
  if (abs >= 1) return Math.round(n).toLocaleString();
  return n.toFixed(2);
}

/** 颜色类名：按剩余额度判断，足够为绿，偏低转橙/红。 */
function colorFor(remainingPct: number): string {
  if (remainingPct <= 10) return "bg-danger";
  if (remainingPct <= 30) return "bg-warn";
  return "bg-ok";
}

export function QuotaBar({ item, compact = false }: Props) {
  const total = item.total_units || 0;
  const used = item.used_units || 0;
  const remaining = item.remaining_units || Math.max(0, total - used);
  const remainingPct =
    total > 0 ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 0;
  const color = colorFor(remainingPct);

  if (compact) {
    // 紧凑模式：单行，名称弹性截断，进度条细，剩余值在右
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="w-16 shrink-0 truncate text-[10px] font-medium text-text-muted"
          title={item.show_name}
        >
          {item.show_name}
        </span>
        <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-base-cardhover">
          <div
            className={`h-full rounded-full transition-all duration-500 ${color}`}
            style={{ width: `${remainingPct}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[9px] leading-none text-text-muted">
          {fmt(remaining)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-[11px] font-medium text-text-secondary" title={item.show_name}>
        {item.show_name}
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-base-cardhover">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${remainingPct}%` }}
        />
      </div>
      <span className="w-36 shrink-0 text-right font-mono text-[11px] text-text-muted">
        {fmt(remaining)} / {fmt(total)}
      </span>
    </div>
  );
}

export default QuotaBar;
