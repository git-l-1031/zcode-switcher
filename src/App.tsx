import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Plus,
  RefreshCw,
  FolderOpen,
  Download,
  Upload,
  Trash2,
  Settings as SettingsIcon,
  X,
  LayoutGrid,
  List,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useStore } from "./store";
import { api, type CurrentStatus } from "./lib/api";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { LANGUAGES, formatText, getTexts } from "./i18n";
import zcodeLogo from "./assets/zcode-logo.png";
import AccountCard from "./components/AccountCard";
import EmptyState from "./components/EmptyState";
import ToastStack from "./components/Toast";
import { NameModal, ConfirmModal, BatchExportModal, BatchDeleteModal } from "./components/Modal";
import SettingsPanel from "./components/SettingsPanel";
import FloatingCapsule, {
  FLOATING_BASE_H,
  FLOATING_BASE_W,
  FLOATING_RESIZER_EXTRA_H,
} from "./components/FloatingCapsule";

interface DialogState {
  kind:
    | "none"
    | "capture"
    | "rename"
    | "switch"
    | "delete"
    | "batch-export"
    | "batch-delete";
  targetId?: string;
  targetName?: string;
}

type StartupIssue =
  | { kind: "none" }
  | { kind: "offline" }
  | { kind: "local"; error: string };

export default function App() {
  const {
    profiles,
    loading,
    busy,
    quotas,
    loadingQuota,
    accountViewMode,
    language,
    quotaRefreshIntervalMinutes,
    glm52AutoSwitchEnabled,
    glm52AutoSwitchThresholdWan,
    floatingWindowMode,
    floatingWindowScale,
    theme,
    refresh,
    refreshAllQuota,
    refreshActiveQuotaForAutoSwitch,
    refreshQuota,
    captureCurrent,
    switchTo,
    renameProfile,
    deleteProfile,
    deleteProfiles,
    setAccountViewMode,
    setLanguage,
    setFloatingWindowMode,
    setFloatingWindowScale,
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
  const activeProfile = profiles.find((p) => p.active);

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
    if (quotaRefreshIntervalMinutes <= 0) return;
    const timer = window.setInterval(() => {
      refreshAllQuota();
    }, quotaRefreshIntervalMinutes * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [quotaRefreshIntervalMinutes, refreshAllQuota]);

  useEffect(() => {
    if (!glm52AutoSwitchEnabled || !activeProfile) return;
    const timer = window.setInterval(() => {
      refreshActiveQuotaForAutoSwitch();
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [glm52AutoSwitchEnabled, activeProfile, refreshActiveQuotaForAutoSwitch]);

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
      const floatW = Math.round(FLOATING_BASE_W * floatingWindowScale);
      const floatH = Math.round(
        (FLOATING_BASE_H + (floatingResizerOpen ? FLOATING_RESIZER_EXTRA_H : 0)) *
          floatingWindowScale
      );
      await win.setSize(
        floatingWindowMode ? new LogicalSize(floatW, floatH) : new LogicalSize(680, 720)
      );
      if (!floatingWindowMode) {
        await win.center();
      }
    };
    apply().catch(() => {});
  }, [floatingWindowMode, floatingWindowScale, floatingResizerOpen, theme]);

  useEffect(() => {
    if (!floatingWindowMode) setFloatingResizerOpen(false);
  }, [floatingWindowMode]);

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

  // 顶部状态文字
  let statusText = "";
  let statusColor = "text-text-muted";
  if (!status || !status.logged_in) {
    statusText = `● ${t.statusNotSignedIn}`;
    statusColor = "text-warn";
  } else if (status.active_profile_name) {
    statusText = `● ${formatText(t.statusCurrentLogin, { name: status.active_profile_name })}`;
    statusColor = "text-ok";
  } else {
    statusText = `● ${t.statusUnsaved}`;
    statusColor = "text-warn";
  }

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

  const handleImport = async () => {
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
      await refresh(true);
      if (report.imported > 0) refreshAllQuota();
    } catch (e) {
      toast(formatText(t.importFailed, { error: String(e) }), "error");
    }
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
        <span className={`min-w-0 flex-1 truncate text-xs font-medium ${statusColor}`}>
          {statusText}
        </span>
        <div className="flex shrink-0 items-center gap-2">
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
            onClick={handleCapture}
            disabled={busy}
            className="focus-ring flex max-w-44 items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white shadow transition hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            <Plus size={16} className="shrink-0" />
            <span
              className={`truncate ${
                t.saveCurrentAccount.length > 18
                  ? "text-[10px]"
                  : t.saveCurrentAccount.length > 12
                  ? "text-[11px]"
                  : ""
              }`}
            >
              {t.saveCurrentAccount}
            </span>
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
          <button
            onClick={() => setShowSettings(true)}
            title={t.settingsTitle}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-base-border bg-base-card text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.96]"
          >
            <SettingsIcon size={16} />
          </button>
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
                : "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-3 px-3"
            }
          >
            {profiles.map((p, i) => (
              <AccountCard
                key={p.id}
                profile={p}
                index={i}
                busy={busy}
                viewMode={accountViewMode}
                quota={quotas[p.id]}
                quotaLoading={!!loadingQuota[p.id]}
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
          language={language}
          onClose={closeDialog}
          onConfirm={confirmBatchExport}
        />
      )}

      {dialog.kind === "batch-delete" && (
        <BatchDeleteModal
          profiles={profiles}
          quotas={quotas}
          language={language}
          onClose={closeDialog}
          onConfirm={confirmBatchDelete}
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
