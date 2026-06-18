import { useState, useEffect } from "react";
import { Check, Trash2 } from "lucide-react";
import type { ProfileView, QuotaInfo } from "../lib/api";
import { formatText, getTexts, type Language } from "../i18n";

/** 文本输入对话框（用于保存账号 / 重命名）。 */
export function NameModal({
  title,
  prompt,
  initial,
  confirmText,
  onSubmit,
  onClose,
  language,
}: {
  title: string;
  prompt: string;
  initial: string;
  confirmText: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
  language: Language;
}) {
  const [value, setValue] = useState(initial);
  const t = getTexts(language);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
  };

  return (
    <Backdrop onClose={onClose}>
      <div
        className="modal-in w-[400px] rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        <p className="mt-1 text-xs text-text-secondary">{prompt}</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="focus-ring mt-3 w-full rounded-lg border border-base-border bg-base-card px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-accent"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="focus-ring rounded-lg border border-base-border bg-base-card px-4 py-2 text-sm text-text-secondary transition hover:bg-base-cardhover active:scale-[0.97]"
          >
            {t.cancel}
          </button>
          <button
            onClick={submit}
            className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:bg-accent-hover active:scale-[0.97]"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/** 确认对话框（用于切换 / 删除）。 */
export function ConfirmModal({
  title,
  message,
  confirmText,
  danger,
  onYes,
  onClose,
  language,
}: {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  onYes: () => void;
  onClose: () => void;
  language: Language;
}) {
  const t = getTexts(language);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <Backdrop onClose={onClose}>
      <div
        className="modal-in w-[420px] rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="focus-ring rounded-lg border border-base-border bg-base-card px-4 py-2 text-sm text-text-secondary transition hover:bg-base-cardhover active:scale-[0.97]"
          >
            {t.cancel}
          </button>
          <button
            onClick={onYes}
            className={`focus-ring rounded-lg px-4 py-2 text-sm font-bold text-white transition active:scale-[0.97] ${
              danger ? "bg-danger hover:brightness-110" : "bg-accent hover:bg-accent-hover"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/** 批量导出选择对话框：勾选要导出的账号，确认后回调返回 id 列表。 */
export function BatchExportModal({
  profiles,
  onClose,
  onConfirm,
  language,
}: {
  profiles: ProfileView[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  language: Language;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(profiles.map((p) => p.id))
  );
  const t = getTexts(language);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = selected.size === profiles.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(profiles.map((p) => p.id)));
  };

  return (
    <Backdrop onClose={onClose}>
      <div
        className="modal-in flex max-h-[80vh] w-[440px] flex-col rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">{t.batchExportTitle}</h2>
        <p className="mt-1 text-xs text-text-secondary">
          {t.batchExportDesc}
        </p>

        <button
          onClick={toggleAll}
          className="focus-ring mt-4 flex items-center gap-2 rounded-lg border border-base-border bg-base-card px-3 py-2 text-xs font-medium text-text-secondary transition hover:bg-base-cardhover"
        >
          <span
            className={`flex h-4 w-4 items-center justify-center rounded border transition ${
              allSelected
                ? "border-accent bg-accent text-white"
                : "border-base-border bg-transparent"
            }`}
          >
            {allSelected && <Check size={12} strokeWidth={3} />}
          </span>
          {allSelected ? t.clearAll : t.selectAll}
          <span className="text-text-muted">
            {formatText(t.selectedCount, {
              selected: selected.size,
              total: profiles.length,
            })}
          </span>
        </button>

        <div className="mt-2 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            {profiles.map((p) => {
              const checked = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`focus-ring flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
                    checked
                      ? "border-accent/50 bg-accent/5"
                      : "border-base-border bg-base-card hover:bg-base-cardhover"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                      checked
                        ? "border-accent bg-accent text-white"
                        : "border-base-border bg-transparent"
                    }`}
                  >
                    {checked && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {p.name}
                      {p.active && (
                        <span className="ml-1.5 text-[10px] font-bold text-ok">
                          {t.activeBadge}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {p.email ||
                        (p.phone
                          ? formatText(t.phonePrefix, { phone: p.phone })
                          : p.short_id
                          ? formatText(t.idPrefix, { id: p.short_id })
                          : "")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <span className="text-xs text-text-muted">
            {selected.size > 0
              ? formatText(t.willExport, { count: selected.size })
              : t.noSelection}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="focus-ring rounded-lg border border-base-border bg-base-card px-4 py-2 text-sm text-text-secondary transition hover:bg-base-cardhover active:scale-[0.97]"
            >
              {t.cancel}
            </button>
            <button
              disabled={selected.size === 0}
              onClick={() => onConfirm(Array.from(selected))}
              className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:bg-accent-hover active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
            >
              {t.exportZip}
            </button>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

function identityLine(p: ProfileView, language: Language): string {
  const t = getTexts(language);
  if (p.email) return p.email;
  if (p.phone) return formatText(t.phonePrefix, { phone: p.phone });
  if (p.short_id) return formatText(t.idPrefix, { id: p.short_id });
  return t.noIdentity;
}

function isExpiredOrError(quota?: QuotaInfo): boolean {
  if (!quota) return false;
  if (quota.error) return true;
  const status = (quota.plan_status || "").toLowerCase();
  if (status.includes("expire") || status.includes("expired") || status.includes("过期")) {
    return true;
  }
  return !!quota.plan_ends_at && quota.plan_ends_at * 1000 < Date.now();
}

function profileStatusLabel(profile: ProfileView, quota: QuotaInfo | undefined, language: Language) {
  const t = getTexts(language);
  if (profile.active) return t.activeCannotDelete;
  if (quota?.error) return t.errorAccountTag;
  if (isExpiredOrError(quota)) return t.expiredAccountTag;
  return t.normalAccountTag;
}

/** 批量删除选择对话框：可手动选择，也可直接清理过期或额度错误账号。 */
export function BatchDeleteModal({
  profiles,
  quotas,
  onClose,
  onConfirm,
  language,
}: {
  profiles: ProfileView[];
  quotas: Record<string, QuotaInfo>;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  language: Language;
}) {
  const t = getTexts(language);
  const selectableIds = profiles.filter((p) => !p.active).map((p) => p.id);
  const cleanableIds = profiles
    .filter((p) => !p.active && isExpiredOrError(quotas[p.id]))
    .map((p) => p.id);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(cleanableIds));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggle = (profile: ProfileView) => {
    if (profile.active) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(profile.id)) next.delete(profile.id);
      else next.add(profile.id);
      return next;
    });
  };

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  };

  return (
    <Backdrop onClose={onClose}>
      <div
        className="modal-in flex max-h-[82vh] w-[460px] flex-col rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">{t.batchDeleteTitle}</h2>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          {t.batchDeleteDesc}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={toggleAll}
            disabled={selectableIds.length === 0}
            className="focus-ring flex items-center gap-2 rounded-lg border border-base-border bg-base-card px-3 py-2 text-xs font-medium text-text-secondary transition hover:bg-base-cardhover disabled:opacity-40"
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded border transition ${
                allSelected
                  ? "border-accent bg-accent text-white"
                  : "border-base-border bg-transparent"
              }`}
            >
              {allSelected && <Check size={12} strokeWidth={3} />}
            </span>
            {allSelected ? t.clearAll : t.selectAll}
          </button>
          <button
            onClick={() => onConfirm(cleanableIds)}
            disabled={cleanableIds.length === 0}
            className="focus-ring flex items-center justify-center gap-2 rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-xs font-bold text-danger transition hover:bg-danger/15 disabled:opacity-40"
          >
            <Trash2 size={13} />
            {t.cleanExpiredOrError}
          </button>
        </div>

        <div className="mt-2 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            {profiles.map((p) => {
              const checked = selected.has(p.id);
              const disabled = p.active;
              const status = profileStatusLabel(p, quotas[p.id], language);
              const dangerStatus = status === t.errorAccountTag || status === t.expiredAccountTag;
              return (
                <button
                  key={p.id}
                  disabled={disabled}
                  onClick={() => toggle(p)}
                  className={`focus-ring flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                    checked
                      ? "border-danger/50 bg-danger/5"
                      : "border-base-border bg-base-card hover:bg-base-cardhover"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                      checked
                        ? "border-danger bg-danger text-white"
                        : "border-base-border bg-transparent"
                    }`}
                  >
                    {checked && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">
                        {p.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          dangerStatus
                            ? "bg-danger/15 text-danger"
                            : disabled
                            ? "bg-ok/15 text-ok"
                            : "bg-base-cardhover text-text-muted"
                        }`}
                      >
                        {status}
                      </span>
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {identityLine(p, language)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <span className="text-xs text-text-muted">
            {selected.size > 0
              ? formatText(t.willDelete, { count: selected.size })
              : t.noSelection}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="focus-ring rounded-lg border border-base-border bg-base-card px-4 py-2 text-sm text-text-secondary transition hover:bg-base-cardhover active:scale-[0.97]"
            >
              {t.cancel}
            </button>
            <button
              disabled={selected.size === 0}
              onClick={() => onConfirm(Array.from(selected))}
              className="focus-ring rounded-lg bg-danger px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
            >
              {t.deleteSelected}
            </button>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

/** 检测更新对话框：先展示更新说明 + 下载按钮，确认后切换为进度条，下载完成由父组件自行关闭。 */
export function UpdateModal({
  title,
  message,
  confirmText,
  downloading,
  progress,
  onYes,
  onClose,
  language,
}: {
  title: string;
  message: string;
  confirmText: string;
  /** 是否处于下载阶段（true 时隐藏按钮、显示进度条、屏蔽关闭） */
  downloading: boolean;
  /** 0-100；未知大小时传 null 显示无定值动画 */
  progress: number | null;
  onYes: () => void;
  onClose: () => void;
  language: Language;
}) {
  const t = getTexts(language);
  useEffect(() => {
    if (downloading) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, downloading]);

  return (
    <Backdrop onClose={downloading ? () => {} : onClose}>
      <div
        className="modal-in w-[440px] rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
          {message}
        </p>
        {downloading ? (
          <div className="mt-6">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">{t.updateDownloadProgress}</span>
              <span className="font-mono tabular-nums text-text-muted">
                {progress !== null ? `${progress}%` : "…"}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-base-cardhover">
              {progress !== null ? (
                <div
                  className="h-full rounded-full bg-accent transition-all duration-150"
                  style={{ width: `${progress}%` }}
                />
              ) : (
                <div className="update-progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
              )}
            </div>
          </div>
        ) : (
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="focus-ring rounded-lg border border-base-border bg-base-card px-4 py-2 text-sm text-text-secondary transition hover:bg-base-cardhover active:scale-[0.97]"
            >
              {t.cancel}
            </button>
            <button
              onClick={onYes}
              className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:bg-accent-hover active:scale-[0.97]"
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </Backdrop>
  );
}

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      {children}
    </div>
  );
}
