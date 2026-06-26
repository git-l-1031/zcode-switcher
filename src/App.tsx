import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Save,
  RefreshCw,
  FolderOpen,
  Download,
  Upload,
  Trash2,
  Settings as SettingsIcon,
  X,
  LayoutGrid,
  List,
  Megaphone,
  Eye,
  EyeOff,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { useStore } from "./store";
import { api, type CurrentStatus } from "./lib/api";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { LANGUAGES, formatText, getTexts } from "./i18n";
import zcodeLogo from "./assets/zcode-logo.png";
import AccountCard from "./components/AccountCard";
import EmptyState from "./components/EmptyState";
import ToastStack from "./components/Toast";
import {
  NameModal,
  ConfirmModal,
  BatchExportModal,
  BatchDeleteModal,
  ImportChoiceModal,
  NoticeModal,
  ProviderEditorModal,
} from "./components/Modal";
import SettingsPanel from "./components/SettingsPanel";
import SortMenu from "./components/SortMenu";
import { AccountPoolCard, ApiServiceCard, ProviderServiceCard } from "./components/ApiServiceCard";
import FloatingCapsule, {
  FLOATING_BASE_H,
  FLOATING_BASE_W,
  FLOATING_RESIZER_EXTRA_H,
} from "./components/FloatingCapsule";
import { sortProfiles } from "./lib/sortProfiles";
import {
  loadNotices,
  markNoticeIdsSeen,
  readSeenNoticeIds,
  type NoticeItem,
  type NoticeKind,
} from "./lib/notices";

interface DialogState {
  kind:
    | "none"
    | "capture"
    | "rename"
    | "switch"
    | "delete"
    | "batch-export"
    | "batch-delete"
    | "import-choice"
    | "provider";
  targetId?: string;
  targetName?: string;
}

type StartupIssue =
  | { kind: "none" }
  | { kind: "offline" }
  | { kind: "local"; error: string };

const NORMAL_WINDOW_WIDTH = 960;
const NORMAL_WINDOW_HEIGHT = 780;
// 临时下线：API Key 导入供应商与本地 API 服务是两套不相关的能力，
// 重新开启时需要拆开入口和数据流，不能再把 API Key 上游挂到本地反代里。
const LOCAL_API_FEATURE_ENABLED = false;

export default function App() {
  const {
    profiles,
    loading,
    busy,
    quotas,
    loadingQuota,
    recentlyRefreshed,
    accountViewMode,
    accountSortMode,
    hideAccountIdentity,
    language,
    quotaRefreshIntervalMinutes,
    activeQuotaRefreshIntervalMinutes,
    glm52AutoSwitchEnabled,
    glm52AutoSwitchThresholdWan,
    floatingWindowMode,
    floatingWindowScale,
    theme,
    refresh,
    refreshMissingQuota,
    scheduledRefreshAllQuota,
    scheduledRefreshSeq,
    refreshActiveQuotaForAutoSwitch,
    refreshQuota,
    captureCurrent,
    switchTo,
    renameProfile,
    deleteProfile,
    deleteProfiles,
    addCustomProvider,
    customProviders,
    accountPool,
    proxyStatus,
    proxyPort,
    proxyGatewayKey,
    refreshCustomProviders,
    refreshAccountPool,
    refreshProxyStatus,
    startLocalProxy,
    stopLocalProxy,
    regenerateProxyGatewayKey,
    setCustomProviderEnabled,
    activateCustomProvider,
    deleteCustomProvider,
    addAccountToPool,
    setAccountPoolEnabled,
    removeAccountFromPool,
    setAccountViewMode,
    setAccountSortMode,
    setHideAccountIdentity,
    setLanguage,
    setFloatingWindowMode,
    setFloatingWindowScale,
    updateAvailable,
    setUpdateAvailable,
    toast,
  } = useStore();
  const t = getTexts(language);
  const autoRestart = useStore((s) => s.autoRestart);
  const tryNoRestartSwitch = useStore((s) => s.tryNoRestartSwitch);

  const [status, setStatus] = useState<CurrentStatus | null>(null);
  const [startupIssue, setStartupIssue] = useState<StartupIssue>({ kind: "none" });
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [showSettings, setShowSettings] = useState(false);
  const [floatingResizerOpen, setFloatingResizerOpen] = useState(false);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [noticesLoading, setNoticesLoading] = useState(false);
  const [noticeLoadFailed, setNoticeLoadFailed] = useState(false);
  const [seenNoticeIds, setSeenNoticeIds] = useState<Set<string>>(
    () => readSeenNoticeIds()
  );
  const [noticeDialog, setNoticeDialog] = useState<{
    open: boolean;
    initialTab: NoticeKind;
  }>({ open: false, initialTab: "system" });
  const wasFloatingWindowMode = useRef(floatingWindowMode);
  const activeProfile = profiles.find((p) => p.active);
  const batchQuotaRefreshDueAt = useRef(0);
  const activeQuotaRefreshDueAt = useRef(0);
  const sortedProfiles = useMemo(
    () => sortProfiles(profiles, quotas, accountSortMode),
    [profiles, quotas, accountSortMode]
  );
  const sortedProfileIds = useMemo(
    () => sortedProfiles.map((profile) => profile.id),
    [sortedProfiles]
  );
  const unreadNoticeCount = useMemo(
    () => notices.filter((notice) => !seenNoticeIds.has(notice.id)).length,
    [notices, seenNoticeIds]
  );
  const refreshNotices = useCallback(async (showStartup = false) => {
    setNoticesLoading(true);
    try {
      const result = await loadNotices();
      setNotices(result.notices);
      setNoticeLoadFailed(result.failed);
      if (showStartup) {
        const seenIds = readSeenNoticeIds();
        const startupNotices = result.notices.filter(
          (notice) =>
            notice.showOnStartup &&
            (notice.showOnce === false || !seenIds.has(notice.id))
        );
        if (startupNotices.length > 0) {
          setNoticeDialog({ open: true, initialTab: startupNotices[0].kind });
        }
      }
      return result.notices;
    } catch {
      setNoticeLoadFailed(true);
      return [];
    } finally {
      setNoticesLoading(false);
    }
  }, []);

  useEffect(() => {
    setStartupIssue(navigator.onLine ? { kind: "none" } : { kind: "offline" });
    refresh(true).catch((e) => {
      setStartupIssue({ kind: "local", error: String(e) });
    });
    api
      .currentStatus()
      .then((s) => {
        setStatus(s);
        setStartupIssue((prev) => (prev.kind === "local" ? { kind: "none" } : prev));
      })
      .catch((e) => {
        setStartupIssue({ kind: "local", error: String(e) });
      });

    const handleOnline = () => setStartupIssue({ kind: "none" });
    const handleOffline = () => setStartupIssue({ kind: "offline" });
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refresh]);

  useEffect(() => {
    if (!LOCAL_API_FEATURE_ENABLED) return;
    refreshCustomProviders();
    refreshAccountPool();
    refreshProxyStatus();
  }, [refreshCustomProviders, refreshAccountPool, refreshProxyStatus]);

  useEffect(() => {
    refreshNotices(true);
    const timer = window.setInterval(() => {
      refreshNotices(true);
    }, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refreshNotices]);

  useEffect(() => {
    let releaseLock: (() => void) | null = null;
    let stopped = false;
    const locks = (
      navigator as Navigator & {
        locks?: {
          request: (
            name: string,
            options: { mode: "shared" },
            callback: () => Promise<void>
          ) => Promise<unknown>;
        };
      }
    ).locks;
    if (!locks?.request) return;
    locks
      .request("zcode-switcher-refresh-keepalive", { mode: "shared" }, async () => {
        if (stopped) return;
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      })
      .catch(() => {});
    return () => {
      stopped = true;
      releaseLock?.();
    };
  }, []);

  useEffect(() => {
    if (quotaRefreshIntervalMinutes <= 0) {
      batchQuotaRefreshDueAt.current = 0;
      return;
    }
    // 依赖 scheduledRefreshSeq：手动批量刷新会 ++ 它，触发 effect 重启 → 倒计时归零。
    const intervalMs = quotaRefreshIntervalMinutes * 60 * 1000;
    batchQuotaRefreshDueAt.current = Date.now() + intervalMs;
    const timer = window.setInterval(() => {
      scheduledRefreshAllQuota(sortedProfileIds);
      batchQuotaRefreshDueAt.current = Date.now() + intervalMs;
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [quotaRefreshIntervalMinutes, scheduledRefreshAllQuota, scheduledRefreshSeq, sortedProfileIds]);

  useEffect(() => {
    if (!activeProfile) return;
    const intervalMs = glm52AutoSwitchEnabled
      ? 20 * 1000
      : activeQuotaRefreshIntervalMinutes * 60 * 1000;
    activeQuotaRefreshDueAt.current = Date.now() + intervalMs;
    const timer = window.setInterval(() => {
      refreshActiveQuotaForAutoSwitch();
      activeQuotaRefreshDueAt.current = Date.now() + intervalMs;
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [
    activeProfile,
    activeQuotaRefreshIntervalMinutes,
    glm52AutoSwitchEnabled,
    refreshActiveQuotaForAutoSwitch,
  ]);

  useEffect(() => {
    const refreshIfOverdue = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      const batchIntervalMs = quotaRefreshIntervalMinutes * 60 * 1000;
      let didBatchRefresh = false;
      if (
        quotaRefreshIntervalMinutes > 0 &&
        batchQuotaRefreshDueAt.current > 0 &&
        now >= batchQuotaRefreshDueAt.current
      ) {
        scheduledRefreshAllQuota(sortedProfileIds);
        batchQuotaRefreshDueAt.current = now + batchIntervalMs;
        didBatchRefresh = true;
      }
      if (!activeProfile || didBatchRefresh || now < activeQuotaRefreshDueAt.current) return;
      refreshActiveQuotaForAutoSwitch();
      const intervalMs = glm52AutoSwitchEnabled
        ? 20 * 1000
        : activeQuotaRefreshIntervalMinutes * 60 * 1000;
      activeQuotaRefreshDueAt.current = now + intervalMs;
    };
    window.addEventListener("focus", refreshIfOverdue);
    document.addEventListener("visibilitychange", refreshIfOverdue);
    return () => {
      window.removeEventListener("focus", refreshIfOverdue);
      document.removeEventListener("visibilitychange", refreshIfOverdue);
    };
  }, [
    activeProfile,
    activeQuotaRefreshIntervalMinutes,
    glm52AutoSwitchEnabled,
    quotaRefreshIntervalMinutes,
    scheduledRefreshAllQuota,
    sortedProfileIds,
    refreshActiveQuotaForAutoSwitch,
  ]);

  // 模式/主题变化（罕见）：重新配置窗口装饰、置顶、背景等。
  // 不放 scale 在依赖里，避免拖滑块时反复 setDecorations/setShadow 引起窗口重绘抖动。
  useEffect(() => {
    const win = getCurrentWindow();
    const normalBg = theme === "dark" ? "#111317" : "#f6f7f9";
    const domBg = floatingWindowMode ? "transparent" : normalBg;
    document.documentElement.dataset.windowMode = floatingWindowMode ? "floating" : "normal";
    document.documentElement.style.backgroundColor = domBg;
    document.body.style.backgroundColor = domBg;
    document.getElementById("root")?.style.setProperty("background-color", domBg);
    const apply = async () => {
      await win.setAlwaysOnTop(floatingWindowMode);
      await win.setResizable(!floatingWindowMode);
      await win.setDecorations(!floatingWindowMode);
      await win.setShadow(!floatingWindowMode);
      await win.setBackgroundColor(floatingWindowMode ? "#00000000" : normalBg);
      if (wasFloatingWindowMode.current && !floatingWindowMode) {
        await win.setSize(new LogicalSize(NORMAL_WINDOW_WIDTH, NORMAL_WINDOW_HEIGHT));
        await win.center();
      }
      wasFloatingWindowMode.current = floatingWindowMode;
    };
    apply().catch(() => {});
  }, [floatingWindowMode, theme]);

  // 尺寸变化（拖滑块时高频触发）：用 rAF 合并连续变更，
  // 同一帧内只发一次 setSize，避免多个 IPC 调用叠加导致窗口抖动。
  // 注意：调节面板高度不参与 scale —— 它在缩放容器外，固定 RESIZER_EXTRA_H 像素。
  useEffect(() => {
    if (!floatingWindowMode) return;
    const win = getCurrentWindow();
    const floatW = Math.round(FLOATING_BASE_W * floatingWindowScale);
    const floatH =
      Math.round(FLOATING_BASE_H * floatingWindowScale) +
      (floatingResizerOpen ? FLOATING_RESIZER_EXTRA_H : 0);
    const raf = requestAnimationFrame(() => {
      win.setSize(new LogicalSize(floatW, floatH)).catch(() => {});
    });
    return () => cancelAnimationFrame(raf);
  }, [floatingWindowMode, floatingWindowScale, floatingResizerOpen]);

  useEffect(() => {
    if (!floatingWindowMode) setFloatingResizerOpen(false);
  }, [floatingWindowMode]);

  // 启动时静默检测一次新版本：找到则在设置图标旁显示小字提示，已是最新则不打扰
  useEffect(() => {
    let cancelled = false;
    checkUpdate()
      .then((update) => {
        if (cancelled) return;
        setUpdateAvailable(!!update);
      })
      .catch(() => {
        /* 离线或服务不可达时安静失败 */
      });
    return () => {
      cancelled = true;
    };
  }, [setUpdateAvailable]);

  // 当 profiles 变化时刷新登录状态
  useEffect(() => {
    api.currentStatus().then(setStatus).catch(() => {});
  }, [profiles]);

  const captureDefaultName =
    status?.current_username?.trim() ||
    status?.current_email?.split("@")[0]?.trim() ||
    status?.current_phone?.trim() ||
    (language === "en"
      ? `Account ${new Date().toLocaleDateString()}`
      : language === "ru"
      ? `Аккаунт ${new Date().toLocaleDateString()}`
      : `账号 ${new Date().toLocaleDateString()}`);

  const startupIssueText =
    startupIssue.kind === "offline"
      ? t.networkUnavailable
      : startupIssue.kind === "local"
      ? formatText(t.localIssue, { error: startupIssue.error })
      : "";

  // ---- 动作 ----
  const handleCapture = () => {
    if (!status?.logged_in) {
      toast(t.noCredentials, "error");
      return;
    }
    if (activeProfile) {
      toast(formatText(t.currentProfileExists, { name: activeProfile.name }), "warn");
      return;
    }
    setDialog({ kind: "capture" });
  };

  const handleSwitch = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setDialog({ kind: "switch", targetId: id, targetName: p.name });
  };

  const handleRename = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setDialog({ kind: "rename", targetId: id, targetName: p.name });
  };

  const handleDelete = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setDialog({ kind: "delete", targetId: id, targetName: p.name });
  };

  /** ↓导入按钮:弹两选项面板,选「文件」走 handleImportFromFile,选「OAuth」走 handleOAuthAdd。 */
  const handleImport = () => {
    setDialog({ kind: "import-choice" });
  };

  const handleImportFromFile = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: t.importFilterName, extensions: ["json", "zip"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    try {
      const report = await api.importProfilesFromFiles(paths);
      const detail =
        report.messages.length > 0
          ? `\n${report.messages.slice(0, 2).join("\n")}${report.messages.length > 2 ? "\n…" : ""}`
          : "";
      toast(
        formatText(t.importComplete, {
          imported: report.imported,
          skipped: report.skipped,
          failed: report.failed,
          detail,
        }),
        report.failed > 0 ? "warn" : "success"
      );
      // 只重载列表 + 只刷新新导入的号（没有额度缓存的），不全量刷已有账号
      await refresh(true, true);
      if (report.imported > 0) refreshMissingQuota();
    } catch (e) {
      toast(formatText(t.importFailed, { error: String(e) }), "error");
    }
  };

  /**
   * OAuth 添加账号: 后端先启动本机临时回调端口，再打开 Z.ai 授权页。
   * 浏览器授权完成后，后端拿 code 交换 token 并导入成本地 profile。
   */
  const handleOAuthAdd = async () => {
    // 1) 立刻给反馈,免得用户以为按钮没响应(init 网络往返 + 浏览器冷启动加起来要 1-3 秒)
    toast(t.oauthPreparing, "info");
    let init;
    try {
      init = await api.oauthInit();
    } catch (e) {
      toast(formatText(t.oauthFailed, { error: String(e) }), "error");
      return;
    }
    // 2) openUrl 不 await:Windows 启动 Edge/Chrome 可能要 1-2 秒,
    //    没必要让前端等它返回。失败了 toast 失败,但成功路径立刻进 acquire。
    openUrl(init.authorize_url).catch((e) => {
      toast(formatText(t.oauthFailed, { error: String(e) }), "error");
    });
    toast(t.oauthOpening, "info");
    try {
      const profile = await api.oauthAcquireAndImport(init.flow_id, init.poll_token);
      toast(formatText(t.oauthAdded, { name: profile.name }), "success");
      // 只重载列表 + 只刷新刚登录的新号，不全量刷
      await refresh(true, true);
      refreshQuota(profile.id);
    } catch (e) {
      toast(formatText(t.oauthFailed, { error: String(e) }), "error");
    }
  };

  const handleProviderAdd = async (data: {
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: "anthropic" | "openai";
    models: string[];
  }) => {
    const ok = await addCustomProvider(
      data.name,
      data.baseUrl,
      data.apiKey,
      data.apiFormat,
      data.models
    );
    if (ok) closeDialog();
  };

  const copyText = (value: string) => {
    navigator.clipboard
      .writeText(value)
      .then(() => toast(t.copied, "success"))
      .catch((e) => toast(formatText(t.copyFailed, { error: String(e) }), "error"));
  };

  const handleExport = async (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    const safeName =
      (p.name || "account")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 32) || "account";
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
      d.getHours()
    )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const suffix = (p.short_id || p.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8);
    const path = await save({
      defaultPath: `zcode-account-${safeName}-${suffix}-${timestamp}.json`,
      filters: [{ name: t.exportJsonFilterName, extensions: ["json"] }],
    });
    if (!path) return;
    try {
      await api.exportProfileToFile(id, path);
      toast(formatText(t.exportedProfile, { name: p.name }), "success");
    } catch (e) {
      toast(formatText(t.exportFailed, { error: String(e) }), "error");
    }
  };

  const handleExportAll = () => {
    if (profiles.length === 0) {
      toast(t.noProfilesToExport, "warn");
      return;
    }
    setDialog({ kind: "batch-export" });
  };

  const handleBatchDelete = () => {
    if (profiles.length === 0) {
      toast(t.noProfilesToDelete, "warn");
      return;
    }
    setDialog({ kind: "batch-delete" });
  };

  const handleOpenNotices = async () => {
    const defaultTab =
      notices.length > 0 && !notices.some((notice) => notice.kind === "system")
        ? "temporary"
        : "system";
    setNoticeDialog({ open: true, initialTab: defaultTab });
    if (!noticesLoading) refreshNotices(false);
  };

  const closeNoticeDialog = () => {
    const seenIds = notices.map((notice) => notice.id);
    markNoticeIdsSeen(seenIds);
    setSeenNoticeIds(readSeenNoticeIds());
    setNoticeDialog({ open: false, initialTab: "system" });
  };

  const confirmBatchExport = async (ids: string[]) => {
    if (ids.length === 0) return;
    closeDialog();
    const count = ids.length;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
      d.getHours()
    )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const path = await save({
      defaultPath: `zcode-accounts-${count}-${timestamp}.zip`,
      filters: [{ name: t.exportZipFilterName, extensions: ["zip"] }],
    });
    if (!path) return;
    try {
      // 全选时走全量导出命令，否则按选择导出
      if (count === profiles.length) {
        await api.exportProfilesBundleToFile(path);
      } else {
        await api.exportProfilesToFile(ids, path);
      }
      toast(formatText(t.batchExported, { count }), "success");
    } catch (e) {
      toast(formatText(t.batchExportFailed, { error: String(e) }), "error");
    }
  };

  const confirmBatchDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    closeDialog();
    await deleteProfiles(ids);
  };

  const closeDialog = () => setDialog({ kind: "none" });

  if (floatingWindowMode && tryNoRestartSwitch) {
    return (
      <FloatingCapsule
        profiles={profiles}
        quotas={quotas}
        thresholdWan={glm52AutoSwitchThresholdWan}
        language={language}
        scale={floatingWindowScale}
        resizerOpen={floatingResizerOpen}
        onScaleChange={setFloatingWindowScale}
        onToggleResizer={() => setFloatingResizerOpen((v) => !v)}
        onClose={() => setFloatingWindowMode(false)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-full flex-col bg-base-bg">
      <ToastStack />

      {/* ===== Header ===== */}
      <header className="px-7 pt-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <img
              src={zcodeLogo}
              alt="ZCode"
              className="h-11 w-11 rounded-xl object-cover shadow-lg ring-1 ring-black/10"
            />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text-primary">
                {t.appTitle}
              </h1>
              <p className="text-xs text-text-muted">{t.appSubtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenNotices}
              title={t.noticeButtonTitle}
              aria-label={t.noticeButtonTitle}
              className="focus-ring relative flex h-9 w-9 items-center justify-center rounded-lg border border-base-border bg-base-card text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.96]"
            >
              <Megaphone size={16} />
              {unreadNoticeCount > 0 && (
                <span className="pointer-events-none absolute -right-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-white shadow-sm">
                  {unreadNoticeCount > 9 ? "9+" : unreadNoticeCount}
                </span>
              )}
            </button>
            <div
              className="flex h-9 items-center overflow-hidden rounded-lg border border-base-border bg-base-card p-0.5"
              aria-label={t.languageSwitcher}
            >
              {LANGUAGES.map((item) => (
                <button
                  key={item.code}
                  onClick={() => setLanguage(item.code)}
                  title={item.title}
                  aria-pressed={language === item.code}
                  className={`focus-ring flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-bold transition active:scale-[0.96] ${
                    language === item.code
                      ? "bg-accent text-white shadow-sm"
                      : "text-text-secondary hover:bg-base-cardhover hover:text-text-primary"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 h-px w-full bg-base-border" />
      </header>

      {/* ===== Toolbar ===== */}
      {startupIssueText && (
        <div className="mx-7 mt-4 flex items-start gap-2 rounded-lg border border-warn/35 bg-warn/10 px-3 py-2 text-xs font-medium text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{startupIssueText}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-7 py-4">
        <span className="shrink-0 text-sm font-bold text-text-secondary">
          {formatText(t.myAccounts, { count: profiles.length })}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <SortMenu
            value={accountSortMode}
            onChange={setAccountSortMode}
            language={language}
          />
          <div className="flex h-9 overflow-hidden rounded-lg border border-base-border bg-base-card p-0.5">
            <button
              onClick={() => setAccountViewMode("card")}
              title={t.cardView}
              aria-pressed={accountViewMode === "card"}
              className={`focus-ring flex h-8 w-8 items-center justify-center rounded-md transition active:scale-[0.96] ${
                accountViewMode === "card"
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-secondary hover:bg-base-cardhover hover:text-text-primary"
              }`}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => setAccountViewMode("list")}
              title={t.listView}
              aria-pressed={accountViewMode === "list"}
              className={`focus-ring flex h-8 w-8 items-center justify-center rounded-md transition active:scale-[0.96] ${
                accountViewMode === "list"
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-secondary hover:bg-base-cardhover hover:text-text-primary"
              }`}
            >
              <List size={16} />
            </button>
          </div>
          <button
            onClick={() => setHideAccountIdentity(!hideAccountIdentity)}
            title={
              hideAccountIdentity
                ? t.showAccountIdentity
                : t.hideAccountIdentity
            }
            aria-pressed={hideAccountIdentity}
            className={`focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-base-border transition active:scale-[0.96] ${
              hideAccountIdentity
                ? "bg-accent text-white shadow-sm"
                : "bg-base-card text-text-secondary hover:bg-base-cardhover hover:text-text-primary"
            }`}
          >
            {hideAccountIdentity ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button
            onClick={handleCapture}
            disabled={busy}
            title={t.saveCurrentAccount}
            aria-label={t.saveCurrentAccount}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-base-border bg-white text-accent shadow-sm transition hover:bg-white/90 active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100"
          >
            <Save size={16} />
          </button>
          <button
            onClick={handleImport}
            disabled={busy}
            title={t.importAccountTitle}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-base-border bg-base-card text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.96] disabled:opacity-50"
          >
            <Download size={16} />
          </button>
          <button
            onClick={handleExportAll}
            disabled={busy || profiles.length === 0}
            title={t.exportAllTitle}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-base-border bg-base-card text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.96] disabled:opacity-50"
          >
            <Upload size={16} />
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={busy || profiles.length === 0}
            title={t.batchDeleteTitle}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-base-border bg-base-card text-danger transition hover:bg-danger/10 active:scale-[0.96] disabled:opacity-50"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={() => refresh()}
            disabled={busy}
            title={t.refreshListTitle}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-base-border bg-base-card text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.96] disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
          <div className="relative flex items-center gap-1.5">
            {updateAvailable && (
              <span className="select-none text-[10px] font-semibold text-accent">
                {t.updateNewVersionBadge}
              </span>
            )}
            <button
              onClick={() => setShowSettings(true)}
              title={t.settingsTitle}
              className="focus-ring relative flex h-9 w-9 items-center justify-center rounded-lg border border-base-border bg-base-card text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.96]"
            >
              <SettingsIcon size={16} />
              {updateAvailable && (
                <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ===== List ===== */}
      <div className="flex-1 overflow-y-auto px-5 pb-3">
        {profiles.length === 0 ? (
          <div className="px-3">
            <EmptyState language={language} />
          </div>
        ) : (
          <div
            className={
              accountViewMode === "list"
                ? "flex flex-col gap-2 px-3"
                : sortedProfiles.length <= 2
                ? "grid grid-cols-[repeat(auto-fit,minmax(260px,330px))] auto-rows-fr gap-3 px-3"
                : "grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] auto-rows-fr gap-3 px-3"
            }
          >
            {LOCAL_API_FEATURE_ENABLED && (
              <>
                <ApiServiceCard
                  proxyStatus={proxyStatus}
                  proxyPort={proxyPort}
                  proxyGatewayKey={proxyGatewayKey}
                  providerCount={customProviders.length}
                  accountCount={accountPool.length}
                  language={language}
                  onStart={startLocalProxy}
                  onStop={stopLocalProxy}
                  onCopy={copyText}
                  onRegenerateKey={regenerateProxyGatewayKey}
                  onRefresh={() => {
                    refreshCustomProviders();
                    refreshAccountPool();
                    refreshProxyStatus();
                  }}
                />
                <AccountPoolCard
                  entries={accountPool}
                  profiles={profiles}
                  language={language}
                  onAddAccount={addAccountToPool}
                  onToggleEnabled={setAccountPoolEnabled}
                  onRemove={removeAccountFromPool}
                  onRefresh={refreshAccountPool}
                />
                {customProviders.map((provider) => (
                  <ProviderServiceCard
                    key={provider.id}
                    provider={provider}
                    language={language}
                    onCopy={copyText}
                    onActivate={() => activateCustomProvider(provider.id)}
                    onToggleEnabled={() =>
                      setCustomProviderEnabled(provider.id, !provider.enabled)
                    }
                    onDelete={() => deleteCustomProvider(provider.id)}
                  />
                ))}
              </>
            )}
            {sortedProfiles.map((p, i) => (
              <AccountCard
                key={p.id}
                profile={p}
                index={i}
                busy={busy}
                viewMode={accountViewMode}
                quota={quotas[p.id]}
                quotaLoading={!!loadingQuota[p.id]}
                refreshOk={!!recentlyRefreshed[p.id]}
                hideIdentity={hideAccountIdentity}
                onSwitch={handleSwitch}
                onRename={handleRename}
                onDelete={handleDelete}
                onExport={handleExport}
                onRefreshQuota={(id) => refreshQuota(id)}
                language={language}
              />
            ))}
          </div>
        )}
      </div>

      {/* ===== Footer ===== */}
      <footer className="flex items-center justify-between px-7 pb-5 pt-1">
        <p className="text-[11px] text-text-muted">
          {tryNoRestartSwitch
            ? t.footerNoRestart
            : autoRestart
            ? t.footerAutoRestart
            : t.footerHint}
        </p>
        <button
          onClick={() =>
            api
              .openConfigDir()
              .catch((e) => toast(formatText(t.configOpenFailed, { error: String(e) }), "error"))
          }
          className="focus-ring flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-accent transition hover:underline"
        >
          <FolderOpen size={12} /> {t.openConfigDir}
        </button>
      </footer>

      {/* ===== Dialogs ===== */}
      {dialog.kind === "capture" && (
        <NameModal
          title={t.captureTitle}
          prompt={t.capturePrompt}
          initial={activeProfile?.name ?? captureDefaultName}
          confirmText={t.save}
          language={language}
          onSubmit={async (name) => {
            closeDialog();
            await captureCurrent(name);
          }}
          onClose={closeDialog}
        />
      )}

      {dialog.kind === "rename" && (
        <NameModal
          title={t.renameTitle}
          prompt={t.renamePrompt}
          initial={dialog.targetName ?? ""}
          confirmText={t.save}
          language={language}
          onSubmit={async (name) => {
            closeDialog();
            if (dialog.targetId) await renameProfile(dialog.targetId, name);
          }}
          onClose={closeDialog}
        />
      )}

      {dialog.kind === "switch" && (
        <ConfirmModal
          title={t.switchTitle}
          message={formatText(t.switchMessage, { name: dialog.targetName ?? "" })}
          confirmText={t.switchConfirm}
          language={language}
          onYes={async () => {
            closeDialog();
            if (dialog.targetId) await switchTo(dialog.targetId);
          }}
          onClose={closeDialog}
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmModal
          title={t.deleteTitle}
          message={formatText(t.deleteMessage, { name: dialog.targetName ?? "" })}
          confirmText={t.deleteConfirm}
          language={language}
          danger
          onYes={async () => {
            closeDialog();
            if (dialog.targetId) await deleteProfile(dialog.targetId);
          }}
          onClose={closeDialog}
        />
      )}

      {dialog.kind === "batch-export" && (
        <BatchExportModal
          profiles={profiles}
          hideIdentity={hideAccountIdentity}
          language={language}
          onClose={closeDialog}
          onConfirm={confirmBatchExport}
        />
      )}

      {dialog.kind === "batch-delete" && (
        <BatchDeleteModal
          profiles={profiles}
          quotas={quotas}
          hideIdentity={hideAccountIdentity}
          language={language}
          onClose={closeDialog}
          onConfirm={confirmBatchDelete}
        />
      )}

      {dialog.kind === "import-choice" && (
        <ImportChoiceModal
          language={language}
          showProvider={LOCAL_API_FEATURE_ENABLED}
          onPickFile={() => {
            closeDialog();
            handleImportFromFile();
          }}
          onPickOAuth={() => {
            closeDialog();
            handleOAuthAdd();
          }}
          onPickProvider={() => setDialog({ kind: "provider" })}
          onClose={closeDialog}
        />
      )}

      {dialog.kind === "provider" && (
        <ProviderEditorModal
          language={language}
          onSubmit={handleProviderAdd}
          onClose={closeDialog}
        />
      )}

      {noticeDialog.open && (
        <NoticeModal
          notices={notices}
          initialTab={noticeDialog.initialTab}
          loading={noticesLoading}
          loadFailed={noticeLoadFailed}
          language={language}
          onClose={closeNoticeDialog}
        />
      )}

      {/* ===== Settings Drawer ===== */}
      {showSettings && (
        <>
          <div
            className="fade-in fixed inset-0 z-30 bg-black/50"
            onClick={() => setShowSettings(false)}
          />
          <div className="slide-in-right fixed right-0 top-0 z-40 flex h-full w-[360px] flex-col border-l border-base-border bg-base-bg shadow-2xl">
            <div className="flex items-center justify-between border-b border-base-border px-5 py-4">
              <h2 className="text-base font-bold text-text-primary">{t.settingsTitle}</h2>
              <button
                onClick={() => setShowSettings(false)}
                title={t.cancel}
                className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SettingsPanel />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
