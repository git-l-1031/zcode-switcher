import { useState } from "react";
import {
  MoreVertical,
  RefreshCw,
  Trash2,
  Pencil,
  CalendarClock,
  Upload,
  LogIn,
  CheckCircle2,
} from "lucide-react";
import type { ProfileView, QuotaInfo } from "../lib/api";
import { gradientFor, initialOf } from "../lib/avatar";
import { QuotaBar } from "./QuotaBar";
import { formatText, getTexts, type Language } from "../i18n";

interface Props {
  profile: ProfileView;
  index: number;
  busy: boolean;
  viewMode?: "card" | "list";
  quota?: QuotaInfo;
  quotaLoading?: boolean;
  hideIdentity?: boolean;
  onSwitch: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onRefreshQuota: (id: string) => void;
  language: Language;
}

/** 格式化日期：YYYY-MM-DD */
function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 计算到期剩余天数（向上取整，<0 表示已过期） */
function daysLeft(endsAt: number): number {
  const ms = endsAt * 1000 - Date.now();
  return Math.ceil(ms / 86400000);
}

function planBadgeClass(status?: string | null): string {
  const s = (status || "").toLowerCase();
  if (s.includes("active") || s.includes("有效") || s === "running") {
    return "bg-ok/15 text-ok";
  }
  if (s.includes("expire") || s.includes("过期") || s.includes("expired")) {
    return "bg-danger/15 text-danger";
  }
  return "bg-accent/15 text-accent";
}

export default function AccountCard({
  profile,
  index,
  busy,
  viewMode = "card",
  quota,
  quotaLoading,
  hideIdentity = false,
  onSwitch,
  onRename,
  onDelete,
  onExport,
  onRefreshQuota,
  language,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const t = getTexts(language);

  const hasEmail = !!profile.email;
  const hasPhone = !!profile.phone;
  const identityText = hasEmail ? profile.email : hasPhone ? profile.phone : "";
  const sub = hideIdentity
    ? t.accountIdentityHidden
    : hasEmail
    ? profile.email
    : hasPhone
    ? formatText(t.phonePrefix, { phone: profile.phone })
    : profile.short_id
    ? formatText(t.idPrefix, { id: profile.short_id })
    : t.noIdentity;
  const initialSource = identityText || profile.name;

  // 到期槽位：endsAt → 占位 "—"。所有卡片都渲染同一行，缺数据时显示 "—"，保持高度一致。
  const endsAt = quota?.plan_ends_at ?? null;
  let dateText: string;
  let dateColor = "text-text-muted";
  if (endsAt) {
    const dl = daysLeft(endsAt);
    if (dl < 0) {
      dateText = formatText(t.expiredAt, { date: formatDate(endsAt) });
      dateColor = "text-danger/90";
    } else if (dl === 0) {
      dateText = formatText(t.expiresToday, { date: formatDate(endsAt) });
      dateColor = "text-warn";
    } else if (dl <= 3) {
      dateText = formatText(t.expiresInDays, {
        days: dl,
        date: formatDate(endsAt),
      });
      dateColor = "text-warn";
    } else {
      dateText = formatText(t.expiresAt, { date: formatDate(endsAt) });
    }
  } else {
    dateText = "—";
  }

  const hasQuotaBars = !!quota?.balances?.length;
  const isListView = viewMode === "list";
  // 列表视图仍按"有数据才画"逻辑（卡片视图已统一为永远画骨架/数据）
  const showQuota =
    !!quota && (!!quota.plan_name || hasQuotaBars);

  if (!isListView) {
    return (
      <div
        className={`fade-in card-hover group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border p-3.5 transition ${
          profile.active
            ? "border-ok/60 bg-accent/5"
            : "border-base-border bg-base-card hover:bg-base-cardhover"
        }`}
      >
        {/* === 顶部行：头像（左上，小）+ 身份信息 === */}
        <div className="flex items-start gap-2.5">
          {profile.avatar ? (
            <img
              src={profile.avatar}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover shadow-md ring-2 ring-base-border"
            />
          ) : (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-md"
              style={{ background: gradientFor(index) }}
            >
              {initialOf(initialSource)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold text-text-primary">
                {profile.name}
              </span>
              {profile.active && (
                <span className="shrink-0 rounded-full bg-ok/15 px-1.5 py-0.5 text-[9px] font-bold text-ok">
                  {t.activeBadge}
                </span>
              )}
            </div>
            <span className="mt-0.5 block truncate text-[11px] text-text-secondary">
              {sub}
            </span>
            {/* 到期槽：始终渲染一行，缺数据显示 — */}
            <span className={`mt-0.5 flex items-center gap-1 truncate text-[10px] ${dateColor}`}>
              <CalendarClock size={10} className="shrink-0" />
              <span className="truncate">{dateText}</span>
            </span>
            {/* 套餐徽章槽：始终占位（无套餐时透明保留高度） */}
            <span
              className={`mt-1 inline-flex max-w-full truncate rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                quota?.plan_name
                  ? planBadgeClass(quota.plan_status)
                  : "invisible bg-base-cardhover text-text-muted"
              }`}
              title={quota?.plan_description || ""}
            >
              {quota?.plan_name || "—"}
            </span>
          </div>
        </div>

        {/* === 中部：额度区，始终渲染。有数据画两条，没数据画骨架灰条。 === */}
        <div className="mt-3 flex min-h-0 flex-col gap-1.5 overflow-hidden border-t border-base-border/70 pt-2.5">
          {hasQuotaBars
            ? quota!.balances
                .slice(0, 2)
                .map((b, i) => (
                  <QuotaBar key={`${b.show_name}-${i}`} item={b} compact />
                ))
            : [0, 1].map((i) => (
                <div key={i} className="flex min-w-0 items-center gap-1.5">
                  <span className="w-16 shrink-0 truncate text-[10px] font-medium text-text-muted">
                    —
                  </span>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-base-cardhover" />
                  <span className="shrink-0 font-mono text-[9px] leading-none text-text-muted">
                    —
                  </span>
                </div>
              ))}
        </div>

        {/* === 状态槽：始终保留一行，无错时透明占位 === */}
        <span
          className={`mt-1 block truncate text-[10px] ${
            quota?.error && hasQuotaBars ? "text-warn" : "invisible text-text-muted"
          }`}
          title={quota?.error || ""}
        >
          {quota?.error && hasQuotaBars ? t.quotaRefreshFailedKeep : "—"}
        </span>

        {/* === 底部行：常用操作直接露出，避免多一层菜单 === */}
        <div className="mt-auto flex items-center justify-between gap-1.5 pt-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRefreshQuota(profile.id);
            }}
            title={t.refreshQuota}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
          >
            <RefreshCw size={14} className={quotaLoading ? "animate-spin" : ""} />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onRename(profile.id);
            }}
            title={t.rename}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
          >
            <Pencil size={14} />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onExport(profile.id);
            }}
            title={t.exportJson}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
          >
            <Upload size={14} />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(profile.id);
            }}
            title={t.deleteProfile}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-danger transition hover:bg-danger/10 active:scale-[0.92]"
          >
            <Trash2 size={14} />
          </button>

          {profile.active ? (
            <span
              title={t.currentAccount}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-ok/15 text-ok"
            >
              <CheckCircle2 size={15} />
            </span>
          ) : (
            <button
              disabled={busy}
              title={t.switchAccount}
              onClick={(e) => {
                e.stopPropagation();
                onSwitch(profile.id);
              }}
              className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent transition hover:bg-accent hover:text-white active:scale-[0.92] disabled:opacity-50 disabled:active:scale-100"
            >
              <LogIn size={15} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fade-in card-hover group relative flex flex-col border transition ${
        menuOpen ? "z-20" : "z-0"
      } ${
        profile.active
          ? "border-ok/60 bg-accent/5"
          : "border-base-border bg-base-card hover:bg-base-cardhover"
      } ${
        isListView
          ? "gap-2 rounded-xl px-3.5 py-3"
          : "gap-3 rounded-2xl px-4 py-4"
      }`}
    >
      {/* === 顶部行：头像 + 身份 + 操作 === */}
      <div className={`flex items-center ${isListView ? "gap-3" : "gap-4"}`}>
        {/* 头像：优先用存储的 data URI，否则渐变首字母 */}
        {profile.avatar ? (
          <img
            src={profile.avatar}
            alt=""
            className={`shrink-0 rounded-full object-cover shadow-lg ring-2 ring-base-border ${
              isListView ? "h-10 w-10" : "h-14 w-14"
            }`}
          />
        ) : (
          <div
            className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-lg ${
              isListView ? "h-10 w-10 text-base" : "h-14 w-14 text-xl"
            }`}
            style={{ background: gradientFor(index) }}
          >
            {initialOf(initialSource)}
          </div>
        )}

        {/* 文字区 */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`truncate font-bold text-text-primary ${
                isListView ? "text-sm" : "text-base"
              }`}
            >
              {profile.name}
            </span>
            {profile.active && (
              <span className="shrink-0 rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-bold text-ok">
                ● {t.activeBadge}
              </span>
            )}
            {quota?.plan_name && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${planBadgeClass(
                  quota.plan_status
                )}`}
                title={quota.plan_description || ""}
              >
                {quota.plan_name}
              </span>
            )}
          </div>
          {/* 副标题：邮箱 + 到期/更新时间 */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-xs text-text-secondary">{sub}</span>
            {dateText && (
              <>
                <span className="text-text-muted">·</span>
                <span
                  className={`inline-flex items-center gap-1 text-xs ${dateColor}`}
                >
                  <CalendarClock size={11} />
                  {dateText}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 操作区 */}
        <div className={`flex shrink-0 items-center ${isListView ? "gap-1" : "gap-2"}`}>
          {profile.active ? (
            <span className="flex items-center gap-1.5 rounded-lg bg-ok/15 px-3 py-2 text-xs font-bold text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> {t.currentAccount}
            </span>
          ) : (
            <button
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                onSwitch(profile.id);
              }}
              className={`focus-ring flex items-center gap-1.5 rounded-lg bg-accent font-bold text-white shadow transition hover:bg-accent-hover active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${
                isListView ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
              }`}
            >
              {t.switch}
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onRefreshQuota(profile.id);
            }}
            title={t.refreshQuota}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
          >
            <RefreshCw size={15} className={quotaLoading ? "animate-spin" : ""} />
          </button>

          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
              title={t.more}
              className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
            >
              <MoreVertical size={18} />
            </button>
            {menuOpen && (
              <div className="fade-in absolute right-0 top-11 z-40 w-36 overflow-hidden rounded-xl border border-base-border bg-base-card py-1 shadow-2xl">
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    onRename(profile.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary transition hover:bg-base-cardhover"
                >
                  <Pencil size={14} /> {t.rename}
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    onExport(profile.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary transition hover:bg-base-cardhover"
                >
                  <Upload size={14} /> {t.exportJson}
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    onDelete(profile.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition hover:bg-danger/10"
                >
                  <Trash2 size={14} /> {t.deleteProfile}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* === 底部：额度条 === */}
      {showQuota ? (
        <div
          className={`flex flex-col gap-1.5 border-t border-base-border/70 ${
            isListView ? "pt-2" : "pt-3"
          }`}
        >
          {quota!.balances.slice(0, isListView ? 2 : 4).map((b, i) => (
            <QuotaBar key={`${b.show_name}-${i}`} item={b} />
          ))}
          {quota?.error && hasQuotaBars && (
            <div className="text-[11px] text-warn" title={quota.error}>
              {t.quotaRefreshFailedKeep}
            </div>
          )}
        </div>
      ) : quota?.error ? (
        <div className="border-t border-base-border/70 pt-2 text-[11px] text-danger/80">
          {formatText(t.quotaFetchFailed, { error: quota.error })}
        </div>
      ) : null}
    </div>
  );
}
