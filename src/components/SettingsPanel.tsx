import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Download,
  FolderOpen,
  Info,
  ShieldCheck,
  Power,
  Zap,
  Clock,
  Moon,
  Sun,
  Check,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { useStore, type Theme } from "../store";
import { api } from "../lib/api";
import { formatText, getTexts, type Language } from "../i18n";
import { UpdateModal } from "./Modal";

function Toggle({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className="focus-ring relative h-6 w-11 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ backgroundColor: on ? "var(--accent)" : "var(--border)" }}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200"
        style={{ left: on ? "22px" : "2px" }}
      />
    </button>
  );
}

function Row({
  icon,
  title,
  desc,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  const hasDesc = !!desc;
  return (
    <div
      className={`flex justify-between gap-3 px-5 py-3.5 ${
        hasDesc ? "items-start" : "items-center"
      }`}
    >
      <div className={`flex min-w-0 gap-3 ${hasDesc ? "items-start" : "items-center"}`}>
        {icon && (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-base-cardhover text-text-secondary">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          {desc && (
            <div className="mt-0.5 text-xs leading-relaxed text-text-muted">
              {desc}
            </div>
          )}
        </div>
      </div>
      <div className={`shrink-0 ${hasDesc ? "pt-0.5" : ""}`}>{children}</div>
    </div>
  );
}

interface ShortcutInfo {
  path: string;
  target: string;
  arguments: string;
  hasFlag?: boolean;
  // 兼容后端字段命名
  has_flag?: boolean;
}

/** 无感切换合并开关：一个 toggle 同时控制设置项和快捷方式增强；附带"还原快捷方式"按钮 */
function NoRestartSwitchRow({
  language,
  on,
  setOn,
  toast,
}: {
  language: Language;
  on: boolean;
  setOn: (v: boolean) => void;
  toast: (text: string, kind?: "info" | "success" | "error" | "warn") => void;
}) {
  const t = getTexts(language);
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const arr = await invoke<ShortcutInfo[]>("zcode_launcher_scan");
      setShortcuts(arr);
    } catch {
      setShortcuts([]);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const enabled = (shortcuts ?? []).filter((s) => s.has_flag ?? s.hasFlag).length;
  const total = (shortcuts ?? []).length;

  let status = t.launcherEnhanceStatusNone;
  if (total > 0) {
    status =
      enabled === total
        ? formatText(t.launcherEnhanceStatusAll, { total })
        : formatText(t.launcherEnhanceStatusPartial, { enabled, total });
  }

  const desc = `${t.noRestartDesc}\n${status}`;

  const handleToggle = async () => {
    if (busy) return;
    if (on) {
      setOn(false);
      return;
    }
    // 打开：先翻 toggle，再改快捷方式；改写失败也不回滚 toggle
    setOn(true);
    setBusy(true);
    try {
      const res = await invoke<{ modified: number; already: number; total: number }>(
        "zcode_launcher_enable"
      );
      if (res.total === 0) {
        toast(t.launcherEnhanceNoneFoundToast, "warn");
      } else if (res.modified > 0) {
        toast(
          formatText(t.launcherEnhanceEnabledToast, {
            modified: res.modified,
            already: res.already,
          }),
          "success"
        );
      }
      await refresh();
    } catch (e) {
      toast(formatText(t.launcherEnhanceFailedToast, { error: String(e) }), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const restored = await invoke<number>("zcode_launcher_disable");
      toast(formatText(t.launcherEnhanceDisabledToast, { restored }), "success");
      await refresh();
    } catch (e) {
      toast(formatText(t.launcherEnhanceFailedToast, { error: String(e) }), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row icon={<Zap size={15} />} title={t.noRestartTitle} desc={desc}>
      <div className="flex flex-col items-end gap-1.5">
        <Toggle on={on} onClick={handleToggle} disabled={busy} />
        {enabled > 0 && (
          <button
            onClick={handleRestore}
            disabled={busy}
            className="focus-ring rounded-lg border border-base-border bg-base-card px-2.5 py-1 text-[11px] text-text-secondary transition hover:bg-base-cardhover active:scale-[0.97] disabled:opacity-50"
          >
            {t.launcherEnhanceDisable}
          </button>
        )}
      </div>
    </Row>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-text-muted">
      {children}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="focus-ring flex items-center gap-1.5 rounded-lg border border-base-border bg-base-card px-3 py-1.5 text-xs font-bold text-text-primary transition hover:bg-base-cardhover active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
    >
      {icon}
      <span className="max-w-28 truncate">{label}</span>
    </button>
  );
}

/** 主题选项卡片 */
function ThemeOption({
  active,
  label,
  icon,
  onClick,
  previewTheme,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  previewTheme: Theme;
}) {
  const isDarkPreview = previewTheme === "dark";
  const previewColors = isDarkPreview
    ? {
        bg: "#111317",
        panel: "#1a1d24",
        rail: "#2a2e38",
        text: "#9aa0b0",
        accent: "#14b8a6",
      }
    : {
        bg: "#f6f7f9",
        panel: "#ffffff",
        rail: "#d9dde5",
        text: "#5b6170",
        accent: "#0d9488",
      };

  return (
    <button
      onClick={onClick}
      title={label}
      className={`focus-ring relative flex flex-1 flex-col items-center gap-2 rounded-xl border-2 px-3 py-3 transition active:scale-[0.98] ${
        active
          ? "border-accent bg-accent-soft"
          : "border-base-border bg-base-card hover:bg-base-cardhover"
      }`}
    >
      {/* 预览色块 */}
      <div
        className="flex h-10 w-full items-center justify-center overflow-hidden rounded-lg"
        style={{
          background: previewColors.bg,
          border: `1px solid ${previewColors.rail}`,
        }}
      >
        <div
          className="flex h-6 w-16 items-center gap-1.5 rounded-md px-2"
          style={{ background: previewColors.panel }}
        >
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: previewColors.accent }}
          />
          <span
            className="h-1.5 flex-1 rounded-full"
            style={{ background: previewColors.text }}
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs font-bold text-text-primary">
        {icon}
        {label}
      </div>
      {active && (
        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

export default function SettingsPanel() {
  const {
    quotaRefreshIntervalMinutes,
    setQuotaRefreshIntervalMinutes,
    glm52AutoSwitchEnabled,
    setGlm52AutoSwitchEnabled,
    glm52AutoSwitchThresholdWan,
    setGlm52AutoSwitchThresholdWan,
    autoRestart,
    setAutoRestart,
    tryNoRestartSwitch,
    setTryNoRestartSwitch,
    theme,
    setTheme,
    floatingWindowMode,
    setFloatingWindowMode,
    language,
    toast,
  } = useStore();
  const t = getTexts(language);

  const setUpdateAvailable = useStore((s) => s.setUpdateAvailable);

  const [version, setVersion] = useState("v 1.1.6");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateModal, setUpdateModal] = useState<
    | {
        title: string;
        message: string;
        confirmText: string;
        downloading: boolean;
        progress: number | null;
        resolve: ((ok: boolean) => void) | null;
      }
    | null
  >(null);

  useEffect(() => {
    getVersion()
      .then((appVersion) => setVersion(`v ${appVersion}`))
      .catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const update = await check();
      if (!update) {
        setUpdateAvailable(false);
        toast(t.updateNoUpdate, "success");
        return;
      }
      setUpdateAvailable(true);
      const releaseNotes = (update.body || "").trim() || t.updateNoNotes;
      const confirmed = await new Promise<boolean>((resolve) => {
        setUpdateModal({
          title: t.updateAvailableTitle,
          message: formatText(t.updateAvailableBody, {
            version: update.version,
            body: releaseNotes,
          }),
          confirmText: t.downloadInstall,
          downloading: false,
          progress: null,
          resolve,
        });
      });
      if (!confirmed) {
        setUpdateModal(null);
        return;
      }

      setUpdateModal((m) =>
        m ? { ...m, downloading: true, progress: 0, resolve: null } : m
      );

      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          downloaded = 0;
          total = event.data.contentLength ?? 0;
          setUpdateModal((m) =>
            m ? { ...m, downloading: true, progress: total > 0 ? 0 : null } : m
          );
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            const percent = Math.min(
              100,
              Math.round((downloaded / total) * 100)
            );
            setUpdateModal((m) =>
              m ? { ...m, downloading: true, progress: percent } : m
            );
          }
        } else {
          // 下载完成：进度填满 → 关弹窗 → 重启安装
          setUpdateModal((m) =>
            m ? { ...m, downloading: true, progress: 100 } : m
          );
        }
      });
      setUpdateModal(null);
      await relaunch();
    } catch (e) {
      setUpdateModal(null);
      toast(formatText(t.updateCheckFailed, { error: String(e) }), "error");
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="flex flex-col divide-y divide-base-border/70">
      <SectionTitle>{t.appearance}</SectionTitle>

      <div className="flex gap-2.5 px-5 py-4">
        <ThemeOption
          active={theme === "light"}
          label={t.light}
          icon={<Sun size={13} />}
          onClick={() => setTheme("light" as Theme)}
          previewTheme="light"
        />
        <ThemeOption
          active={theme === "dark"}
          label={t.dark}
          icon={<Moon size={13} />}
          onClick={() => setTheme("dark" as Theme)}
          previewTheme="dark"
        />
      </div>

      <SectionTitle>{t.switching}</SectionTitle>

      <NoRestartSwitchRow
        language={language}
        on={tryNoRestartSwitch}
        setOn={setTryNoRestartSwitch}
        toast={toast}
      />

      <Row
        icon={<Zap size={15} />}
        title={t.floatingWindowTitle}
        desc={
          tryNoRestartSwitch
            ? t.floatingWindowDesc
            : t.floatingWindowDescDisabled
        }
      >
        <Toggle
          on={floatingWindowMode}
          onClick={() => setFloatingWindowMode(!floatingWindowMode)}
          disabled={!tryNoRestartSwitch}
        />
      </Row>

      <Row
        icon={<Power size={15} />}
        title={t.autoRestartTitle}
        desc={
          tryNoRestartSwitch
            ? t.autoRestartDescNoRestart
            : t.autoRestartDescDefault
        }
      >
        <Toggle
          on={autoRestart}
          onClick={() => setAutoRestart(!autoRestart)}
          disabled={tryNoRestartSwitch}
        />
      </Row>

      <SectionTitle>{t.quota}</SectionTitle>

      <Row
        icon={<Zap size={15} />}
        title={t.glmAutoTitle}
        desc={t.glmAutoDesc}
      >
        <Toggle
          on={glm52AutoSwitchEnabled}
          onClick={() => setGlm52AutoSwitchEnabled(!glm52AutoSwitchEnabled)}
        />
      </Row>

      <Row
        icon={<Clock size={15} />}
        title={t.glmThresholdTitle}
        desc={t.glmThresholdDesc}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={10}
            max={100}
            step={1}
            value={glm52AutoSwitchThresholdWan}
            onChange={(e) =>
              setGlm52AutoSwitchThresholdWan(Number(e.currentTarget.value))
            }
            className="focus-ring h-8 w-20 rounded-lg border border-base-border bg-base-card px-2 text-right text-sm font-semibold text-text-primary outline-none transition hover:bg-base-cardhover"
          />
          <span className="text-xs font-medium text-text-muted">{t.tenThousandUnit}</span>
        </div>
      </Row>

      <Row
        icon={<Clock size={15} />}
        title={t.timedRefreshTitle}
        desc={t.timedRefreshDesc}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={1440}
            step={1}
            value={quotaRefreshIntervalMinutes}
            onChange={(e) =>
              setQuotaRefreshIntervalMinutes(Number(e.currentTarget.value))
            }
            className="focus-ring h-8 w-20 rounded-lg border border-base-border bg-base-card px-2 text-right text-sm font-semibold text-text-primary outline-none transition hover:bg-base-cardhover"
          />
          <span className="text-xs font-medium text-text-muted">{t.minutesUnit}</span>
        </div>
      </Row>

      <SectionTitle>{t.data}</SectionTitle>

      <Row
        icon={<FolderOpen size={15} />}
        title={t.configDir}
        desc={t.configDirDesc}
      >
        <ActionButton
          icon={<FolderOpen size={13} />}
          label={t.open}
          onClick={() =>
            api
              .openConfigDir()
              .catch((e) =>
                toast(formatText(t.configOpenFailed, { error: String(e) }), "error")
              )
          }
        />
      </Row>

      <SectionTitle>{t.about}</SectionTitle>

      <Row icon={<Info size={15} />} title={formatText(t.version, { version })}>
        <ActionButton
          icon={
            <Download
              size={13}
              className={checkingUpdate ? "animate-pulse" : ""}
            />
          }
          label={checkingUpdate ? t.checkingUpdate : t.checkUpdate}
          onClick={handleCheckUpdate}
          disabled={checkingUpdate}
        />
      </Row>

      <div className="px-5 py-4 text-[11px] leading-relaxed text-text-muted">
        <div className="mb-2 flex items-center gap-1.5 text-text-secondary">
          <ShieldCheck size={13} /> {t.localFirst}
        </div>
        {t.privacyBeforePath}{" "}
        <code className="rounded bg-base-cardhover px-1 py-0.5">
          ~/.zcode/v2
        </code>{" "}
        {t.privacyAfterPath}
      </div>

      <div className="px-5 py-3 text-[11px] text-text-muted">
        <Info size={11} className="mr-1 inline" />
        {t.disclaimer}
      </div>

      {updateModal && (
        <UpdateModal
          title={updateModal.title}
          message={updateModal.message}
          confirmText={updateModal.confirmText}
          downloading={updateModal.downloading}
          progress={updateModal.progress}
          language={language}
          onYes={() => updateModal.resolve?.(true)}
          onClose={() => updateModal.resolve?.(false)}
        />
      )}
    </div>
  );
}
