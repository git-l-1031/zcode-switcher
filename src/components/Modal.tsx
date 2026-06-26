import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Check, FileDown, Info, KeyRound, Megaphone, Server, Trash2, X } from "lucide-react";
import { api, type ApiFormat, type ProfileView, type QuotaInfo } from "../lib/api";
import { formatText, getTexts, type Language } from "../i18n";
import { resolveNoticeText, type NoticeItem, type NoticeKind, type NoticeLevel } from "../lib/notices";

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
  hideIdentity = false,
  onClose,
  onConfirm,
  language,
}: {
  profiles: ProfileView[];
  hideIdentity?: boolean;
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
                      {hideIdentity ? t.accountIdentityHidden : identityLine(p, language)}
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
  hideIdentity = false,
  onClose,
  onConfirm,
  language,
}: {
  profiles: ProfileView[];
  quotas: Record<string, QuotaInfo>;
  hideIdentity?: boolean;
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
                      {hideIdentity ? t.accountIdentityHidden : identityLine(p, language)}
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

export function NoticeModal({
  notices,
  initialTab,
  loading,
  loadFailed,
  language,
  onClose,
}: {
  notices: NoticeItem[];
  initialTab: NoticeKind;
  loading: boolean;
  loadFailed: boolean;
  language: Language;
  onClose: () => void;
}) {
  const t = getTexts(language);
  const [tab, setTab] = useState<NoticeKind>(initialTab);
  const systemCount = notices.filter((notice) => notice.kind === "system").length;
  const temporaryCount = notices.filter((notice) => notice.kind === "temporary").length;
  const visibleNotices = notices.filter((notice) => notice.kind === tab);

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
        className="modal-in flex max-h-[82vh] w-[500px] flex-col rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Megaphone size={17} />
              </span>
              <h2 className="text-lg font-bold text-text-primary">{t.noticeTitle}</h2>
            </div>
            <p className="mt-1 text-xs text-text-secondary">{t.noticeSubtitle}</p>
          </div>
          <button
            onClick={onClose}
            title={t.cancel}
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-base-border bg-base-card p-1">
          <NoticeTabButton
            active={tab === "system"}
            label={t.noticeSystemTab}
            count={systemCount}
            onClick={() => setTab("system")}
          />
          <NoticeTabButton
            active={tab === "temporary"}
            label={t.noticeTemporaryTab}
            count={temporaryCount}
            onClick={() => setTab("temporary")}
          />
        </div>

        <div className="mt-4 min-h-[180px] flex-1 overflow-y-auto pr-1">
          {loading ? (
            <NoticeState icon={<Info size={18} />} title={t.noticeLoading} />
          ) : loadFailed && notices.length === 0 ? (
            <NoticeState icon={<AlertTriangle size={18} />} title={t.noticeLoadFailed} />
          ) : visibleNotices.length === 0 ? (
            <NoticeState icon={<Info size={18} />} title={t.noticeEmpty} />
          ) : (
            <div className="flex flex-col gap-2">
              {visibleNotices.map((notice) => (
                <div
                  key={notice.id}
                  className="rounded-xl border border-base-border bg-base-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-text-primary">
                        {resolveNoticeText(notice.title, language)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                        <NoticeLevelBadge level={notice.level} language={language} />
                        {notice.date && <span>{notice.date}</span>}
                      </div>
                    </div>
                  </div>
                  <NoticeBody
                    text={resolveNoticeText(notice.body, language)}
                    defaultLinkText={t.noticeOpenLink}
                    defaultDownloadText={t.noticeGetLink}
                    downloadSavedText={t.noticeDownloadSaved}
                    downloadFailedText={t.noticeDownloadFailed}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:bg-accent-hover active:scale-[0.97]"
          >
            {t.noticeRead}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

function NoticeBody({
  text,
  defaultLinkText,
  defaultDownloadText,
  downloadSavedText,
  downloadFailedText,
}: {
  text: string;
  defaultLinkText: string;
  defaultDownloadText: string;
  downloadSavedText: string;
  downloadFailedText: string;
}) {
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(null);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(null);
  const handleLinkClick = async (part: Extract<NoticeInlinePart, { kind: "link" }>) => {
    if (part.openInBrowser) {
      openUrl(part.url).catch(() => {});
      return;
    }
    setDownloadingUrl(part.url);
    try {
      const info = await api.inspectDownloadUrl(part.url);
      setPendingDownload({ url: part.url, ...info });
    } catch (e) {
      setPendingDownload({
        url: part.url,
        filename: "未知文件",
        contentType: null,
        contentLength: null,
        warning: `无法预读下载信息：${String(e)}`,
      });
    }
  };

  const cancelPendingDownload = () => {
    setPendingDownload(null);
    setDownloadingUrl(null);
  };

  const confirmPendingDownload = async () => {
    if (!pendingDownload) return;
    const download = pendingDownload;
    setPendingDownload(null);
    const directory = await open({
      directory: true,
      multiple: false,
      title: "选择下载目录",
    });
    if (!directory || Array.isArray(directory)) {
      setDownloadingUrl(null);
      return;
    }
    try {
      const result = await api.downloadUrlToDirectory(download.url, directory);
      setDownloadResult({
        kind: "success",
        title: downloadSavedText,
        message: `文件名：${result.filename}`,
        detail: `保存位置：${result.path}`,
      });
    } catch (e) {
      setDownloadResult({
        kind: "error",
        title: "下载失败",
        message: formatText(downloadFailedText, { error: String(e) }),
      });
    } finally {
      setDownloadingUrl(null);
    }
  };

  return (
    <>
      <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
        {parseNoticeInline(text, defaultLinkText, defaultDownloadText).map((part, index) => {
          if (part.kind === "red") {
            return (
              <span key={index} className="font-medium text-danger">
                {part.text}
              </span>
            );
          }
          if (part.kind === "link") {
            return (
              <button
                key={index}
                type="button"
                disabled={downloadingUrl === part.url}
                onClick={() => handleLinkClick(part)}
                className="focus-ring inline rounded px-0.5 font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:text-accent-hover disabled:opacity-60"
              >
                {part.text}
              </button>
            );
          }
          return <span key={index}>{part.text}</span>;
        })}
      </div>
      {pendingDownload && (
        <NoticeDownloadConfirmModal
          download={pendingDownload}
          onCancel={cancelPendingDownload}
          onConfirm={confirmPendingDownload}
        />
      )}
      {downloadResult && (
        <NoticeDownloadResultModal
          result={downloadResult}
          onClose={() => setDownloadResult(null)}
        />
      )}
    </>
  );
}

type PendingDownload = {
  url: string;
  filename: string;
  contentType: string | null;
  contentLength: number | null;
  warning?: string;
};

type DownloadResult = {
  kind: "success" | "error";
  title: string;
  message: string;
  detail?: string;
};

function NoticeDownloadConfirmModal({
  download,
  onCancel,
  onConfirm,
}: {
  download: PendingDownload;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        className="modal-in w-[420px] rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <FileDown size={17} />
            </span>
            <h3 className="text-lg font-bold text-text-primary">确认下载</h3>
          </div>
          <button
            onClick={onCancel}
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-base-border bg-base-card p-4 text-sm">
          <DownloadInfoRow label="文件名" value={download.filename} />
          <DownloadInfoRow label="类型" value={download.contentType || "未知"} />
          <DownloadInfoRow label="大小" value={formatDownloadSize(download.contentLength)} />
        </div>

        {download.warning && (
          <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
            {download.warning}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="focus-ring rounded-lg border border-base-border bg-base-card px-4 py-2 text-sm text-text-secondary transition hover:bg-base-cardhover active:scale-[0.97]"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:bg-accent-hover active:scale-[0.97]"
          >
            选择目录
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeDownloadResultModal({
  result,
  onClose,
}: {
  result: DownloadResult;
  onClose: () => void;
}) {
  const isSuccess = result.kind === "success";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="modal-in w-[420px] rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              isSuccess ? "bg-ok/15 text-ok" : "bg-danger/10 text-danger"
            }`}
          >
            {isSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-text-primary">{result.title}</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">
              {result.message}
            </p>
            {result.detail && (
              <p className="mt-2 break-all rounded-lg bg-base-card px-3 py-2 text-xs leading-relaxed text-text-muted">
                {result.detail}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:bg-accent-hover active:scale-[0.97]"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

function DownloadInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 py-1">
      <div className="text-xs font-bold text-text-muted">{label}</div>
      <div className="break-all text-sm font-medium text-text-primary">{value}</div>
    </div>
  );
}

function formatDownloadSize(value: number | null): string {
  if (!value || value <= 0) return "未知";
  const units = ["B", "KB", "MB", "GB"] as const;
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

type NoticeInlinePart =
  | { kind: "text"; text: string }
  | { kind: "red"; text: string }
  | { kind: "link"; text: string; url: string; openInBrowser: boolean };

function parseNoticeInline(
  text: string,
  defaultLinkText: string,
  defaultDownloadText: string
): NoticeInlinePart[] {
  const parts: NoticeInlinePart[] = [];
  const tokenRe =
    /<red>(.*?)<\/red>|<link\b([^>]*)\/>|<link\b([^>]*)>(.*?)<\/link>|(https?:\/\/[^\s<]+)/gis;
  let lastIndex = 0;
  for (const match of text.matchAll(tokenRe)) {
    if (match.index > lastIndex) {
      parts.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      parts.push({ kind: "red", text: match[1] });
    } else if (match[2] !== undefined) {
      const link = parseNoticeLink(match[2], "", defaultLinkText, defaultDownloadText);
      if (link) parts.push(link);
    } else if (match[3] !== undefined) {
      const link = parseNoticeLink(match[3], match[4], defaultLinkText, defaultDownloadText);
      if (link) parts.push(link);
    } else if (match[5] !== undefined) {
      parts.push({
        kind: "link",
        url: match[5],
        text: match[5],
        openInBrowser: true,
      });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return parts;
}

function parseNoticeLink(
  attrs: string,
  label: string,
  defaultLinkText: string,
  defaultDownloadText: string
): Extract<NoticeInlinePart, { kind: "link" }> | null {
  const url = readNoticeAttr(attrs, "url");
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const openInBrowser = readNoticeAttr(attrs, "browser") !== "false";
  const text = label || (openInBrowser ? defaultLinkText : defaultDownloadText);
  return { kind: "link", url, text, openInBrowser };
}

function readNoticeAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  return re.exec(attrs)?.[1] ?? null;
}

function NoticeTabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-bold transition active:scale-[0.97] ${
        active
          ? "bg-accent text-white shadow-sm"
          : "text-text-secondary hover:bg-base-cardhover hover:text-text-primary"
      }`}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
          active ? "bg-white/20 text-white" : "bg-base-cardhover text-text-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function NoticeState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-base-border bg-base-card/60 text-center">
      <div className="text-text-muted">{icon}</div>
      <div className="text-sm font-medium text-text-secondary">{title}</div>
    </div>
  );
}

function NoticeLevelBadge({
  level,
  language,
}: {
  level: NoticeLevel;
  language: Language;
}) {
  const t = getTexts(language);
  const label =
    level === "error"
      ? t.noticeLevelError
      : level === "warn"
        ? t.noticeLevelWarn
        : t.noticeLevelInfo;
  const className =
    level === "error"
      ? "bg-danger/10 text-danger"
      : level === "warn"
        ? "bg-warn/10 text-warn"
        : "bg-accent-soft text-accent";

  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${className}`}>
      {label}
    </span>
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

/**
 * 导入方式选择面板:两张并排卡片,一张「从 JSON / ZIP 文件」,一张「OAuth 登录添加」。
 * 点哪张回调对应的 handler,父组件再去开文件选择或启动 OAuth 流程。
 */
export function ImportChoiceModal({
  language,
  showProvider = true,
  onPickFile,
  onPickOAuth,
  onPickProvider,
  onClose,
}: {
  language: Language;
  showProvider?: boolean;
  onPickFile: () => void;
  onPickOAuth: () => void;
  onPickProvider: () => void;
  onClose: () => void;
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
        className="modal-in w-[480px] rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">{t.importChoiceTitle}</h2>
        <p className="mt-1 text-xs text-text-secondary">{t.importChoiceSubtitle}</p>

        <div className={`mt-5 grid gap-3 ${showProvider ? "grid-cols-3" : "grid-cols-2"}`}>
          <button
            onClick={onPickFile}
            className="focus-ring group flex flex-col items-start gap-2 rounded-xl border-2 border-base-border bg-base-card p-4 text-left transition hover:border-accent hover:bg-accent-soft active:scale-[0.98]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-base-cardhover text-text-secondary group-hover:bg-accent group-hover:text-white transition">
              <FileDown size={18} />
            </div>
            <div className="text-sm font-bold text-text-primary">{t.importChoiceFromFile}</div>
            <div className="text-xs leading-relaxed text-text-muted">
              {t.importChoiceFromFileDesc}
            </div>
          </button>

          <button
            onClick={onPickOAuth}
            className="focus-ring group flex flex-col items-start gap-2 rounded-xl border-2 border-base-border bg-base-card p-4 text-left transition hover:border-accent hover:bg-accent-soft active:scale-[0.98]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-base-cardhover text-text-secondary group-hover:bg-accent group-hover:text-white transition">
              <KeyRound size={18} />
            </div>
            <div className="text-sm font-bold text-text-primary">{t.importChoiceOAuth}</div>
            <div className="text-xs leading-relaxed text-text-muted">
              {t.importChoiceOAuthDesc}
            </div>
          </button>

          {showProvider && (
            <button
              onClick={onPickProvider}
              className="focus-ring group flex flex-col items-start gap-2 rounded-xl border-2 border-base-border bg-base-card p-4 text-left transition hover:border-accent hover:bg-accent-soft active:scale-[0.98]"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-base-cardhover text-text-secondary transition group-hover:bg-accent group-hover:text-white">
                <Server size={18} />
              </div>
              <div className="text-sm font-bold text-text-primary">{t.importChoiceProvider}</div>
              <div className="text-xs leading-relaxed text-text-muted">
                {t.importChoiceProviderDesc}
              </div>
            </button>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="focus-ring rounded-lg border border-base-border bg-base-card px-4 py-2 text-sm text-text-secondary transition hover:bg-base-cardhover active:scale-[0.97]"
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

export function ProviderEditorModal({
  language,
  onSubmit,
  onClose,
}: {
  language: Language;
  onSubmit: (data: {
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiFormat;
    models: string[];
  }) => void;
  onClose: () => void;
}) {
  const t = getTexts(language);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiFormat, setApiFormat] = useState<ApiFormat>("anthropic");
  const [modelsText, setModelsText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = () => {
    const models = modelsText
      .split(/[\n,]/)
      .map((model) => model.trim())
      .filter(Boolean);
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim() || models.length === 0) {
      setError(t.providerRequired);
      return;
    }
    if (!/^https?:\/\//i.test(baseUrl.trim())) {
      setError(t.providerUrlInvalid);
      return;
    }
    setError("");
    onSubmit({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      apiFormat,
      models,
    });
  };

  return (
    <Backdrop onClose={onClose}>
      <div
        className="modal-in w-[540px] rounded-2xl border border-base-border bg-base-bg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">{t.providerAddTitle}</h2>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          {t.providerAddDesc}
        </p>

        <div className="mt-5 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-text-secondary">{t.providerName}</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              className="focus-ring h-10 rounded-lg border border-base-border bg-base-card px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-text-secondary">{t.providerBaseUrl}</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.currentTarget.value)}
              placeholder="https://example.com/v1"
              className="focus-ring h-10 rounded-lg border border-base-border bg-base-card px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-text-secondary">{t.providerApiKey}</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              className="focus-ring h-10 rounded-lg border border-base-border bg-base-card px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>

          <div className="grid gap-1.5">
            <span className="text-xs font-bold text-text-secondary">{t.providerApiFormat}</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-base-border bg-base-card p-1">
              {([
                ["anthropic", t.providerAnthropic],
                ["openai", t.providerOpenAI],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setApiFormat(value)}
                  aria-pressed={apiFormat === value}
                  className={`focus-ring h-8 rounded-md text-xs font-bold transition active:scale-[0.97] ${
                    apiFormat === value
                      ? "bg-accent text-white"
                      : "text-text-secondary hover:bg-base-cardhover hover:text-text-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-text-secondary">{t.providerModels}</span>
            <textarea
              value={modelsText}
              onChange={(e) => setModelsText(e.currentTarget.value)}
              placeholder={t.providerModelsHint}
              className="focus-ring min-h-20 resize-none rounded-lg border border-base-border bg-base-card px-3 py-2 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
            {error}
          </div>
        )}

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
            {t.save}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
