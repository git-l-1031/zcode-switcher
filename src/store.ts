import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type ProfileView, type QuotaInfo } from "./lib/api";
import { glm52Remaining } from "./lib/glm52";
import { getTexts, type Language } from "./i18n";

export type ToastKind = "info" | "success" | "error" | "warn";
export type Theme = "dark" | "light";
export type AccountViewMode = "card" | "list";

const FLOATING_WINDOW_STORAGE_KEY = "zcs:floatingWindowMode";

const GLM52_CANDIDATE_MIN_UNITS = 1_500_000;
const GLM52_DEFAULT_THRESHOLD_WAN = 35;
const QUOTA_CACHE_KEY = "zcs:quotas";

interface ToastMsg {
  id: number;
  text: string;
  kind: ToastKind;
}

interface AppState {
  profiles: ProfileView[];
  /** 每个账号 id 对应的额度信息 */
  quotas: Record<string, QuotaInfo>;
  /** 正在拉取额度的账号 id 集合 */
  loadingQuota: Record<string, boolean>;
  /** 是否在 refresh 时自动拉取所有账号的额度 */
  autoRefreshQuota: boolean;
  /** 每隔多少分钟自动刷新额度，0 表示关闭 */
  quotaRefreshIntervalMinutes: number;
  /** GLM-5.2 剩余额度低于阈值时自动切换账号 */
  glm52AutoSwitchEnabled: boolean;
  /** GLM-5.2 自动切换阈值，单位：万 */
  glm52AutoSwitchThresholdWan: number;
  /** 切换账号后是否自动重启 ZCode */
  autoRestart: boolean;
  /** 切换账号后是否先尝试不重启 */
  tryNoRestartSwitch: boolean;
  /** 当前主题 */
  theme: Theme;
  /** 悬浮窗模式：无感切换下的胶囊统计窗 */
  floatingWindowMode: boolean;
  /** 悬浮窗缩放比例，1 为原始大小 */
  floatingWindowScale: number;
  /** 启动自动检测发现的新版本 */
  updateAvailable: boolean;
  /** 账号展示方式 */
  accountViewMode: AccountViewMode;
  /** 是否隐藏账号卡片里的邮箱和手机号 */
  hideAccountIdentity: boolean;
  /** 界面语言 */
  language: Language;
  loading: boolean;
  busy: boolean;
  toasts: ToastMsg[];

  refresh: (silent?: boolean) => Promise<void>;
  captureCurrent: (name: string) => Promise<boolean>;
  switchTo: (id: string) => Promise<boolean>;
  renameProfile: (id: string, name: string) => Promise<boolean>;
  deleteProfile: (id: string) => Promise<boolean>;
  deleteProfiles: (ids: string[]) => Promise<{ deleted: number; failed: number }>;

  refreshQuota: (id: string) => Promise<void>;
  refreshAllQuota: () => Promise<void>;
  refreshActiveQuotaForAutoSwitch: () => Promise<void>;
  setAutoRefreshQuota: (v: boolean) => void;
  setQuotaRefreshIntervalMinutes: (v: number) => void;
  setGlm52AutoSwitchEnabled: (v: boolean) => void;
  setGlm52AutoSwitchThresholdWan: (v: number) => void;
  setAutoRestart: (v: boolean) => void;
  setTryNoRestartSwitch: (v: boolean) => void;
  setTheme: (v: Theme) => void;
  setFloatingWindowMode: (v: boolean) => void;
  setFloatingWindowScale: (v: number) => void;
  setUpdateAvailable: (v: boolean) => void;
  setAccountViewMode: (v: AccountViewMode) => void;
  setHideAccountIdentity: (v: boolean) => void;
  setLanguage: (v: Language) => void;
  restartZcode: () => Promise<boolean>;

  toast: (text: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;
let glm52AutoSwitching = false;
let lastGlm52NoCandidateAt = 0;

function isQuotaInfo(value: unknown): value is QuotaInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Array.isArray((value as Partial<QuotaInfo>).balances);
}

function loadCachedQuotas(): Record<string, QuotaInfo> {
  try {
    const raw = localStorage.getItem(QUOTA_CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const quotas: Record<string, QuotaInfo> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (id.trim() && isQuotaInfo(value)) {
        quotas[id] = value;
      }
    }
    return quotas;
  } catch {
    return {};
  }
}

function saveCachedQuotas(quotas: Record<string, QuotaInfo>) {
  try {
    localStorage.setItem(QUOTA_CACHE_KEY, JSON.stringify(quotas));
  } catch {
    /* ignore */
  }
}

/** 从 localStorage 读取设置 */
function loadAutoRefresh(): boolean {
  try {
    return localStorage.getItem("zcs:autoRefreshQuota") !== "0";
  } catch {
    return true;
  }
}
function loadAutoRestart(): boolean {
  try {
    return localStorage.getItem("zcs:autoRestart") === "1";
  } catch {
    return false;
  }
}
function loadTryNoRestartSwitch(): boolean {
  try {
    return localStorage.getItem("zcs:tryNoRestartSwitch") === "1";
  } catch {
    return false;
  }
}
function loadQuotaRefreshIntervalMinutes(): number {
  try {
    const n = Number(localStorage.getItem("zcs:quotaRefreshIntervalMinutes"));
    return Number.isFinite(n) && n > 0 ? Math.min(1440, Math.round(n)) : 0;
  } catch {
    return 0;
  }
}
function loadGlm52AutoSwitchEnabled(): boolean {
  try {
    return localStorage.getItem("zcs:glm52AutoSwitchEnabled") === "1";
  } catch {
    return false;
  }
}
function loadGlm52AutoSwitchThresholdWan(): number {
  try {
    const n = Number(localStorage.getItem("zcs:glm52AutoSwitchThresholdWan"));
    return Number.isFinite(n) && n > 0
      ? Math.min(300, Math.round(n))
      : GLM52_DEFAULT_THRESHOLD_WAN;
  } catch {
    return GLM52_DEFAULT_THRESHOLD_WAN;
  }
}
function loadTheme(): Theme {
  try {
    const t = localStorage.getItem("zcs:theme");
    return t === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
function loadFloatingWindowMode(): boolean {
  try {
    return localStorage.getItem(FLOATING_WINDOW_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
const FLOATING_WINDOW_SCALE_KEY = "zcs:floatingWindowScale";
const FLOATING_WINDOW_SCALE_MIN = 0.7;
const FLOATING_WINDOW_SCALE_MAX = 1.6;
function clampFloatingScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(FLOATING_WINDOW_SCALE_MAX, Math.max(FLOATING_WINDOW_SCALE_MIN, v));
}
function loadFloatingWindowScale(): number {
  try {
    const raw = localStorage.getItem(FLOATING_WINDOW_SCALE_KEY);
    if (raw === null) return 1;
    return clampFloatingScale(Number(raw));
  } catch {
    return 1;
  }
}
function loadAccountViewMode(): AccountViewMode {
  try {
    const v = localStorage.getItem("zcs:accountViewMode");
    return v === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}
function loadHideAccountIdentity(): boolean {
  try {
    return localStorage.getItem("zcs:hideAccountIdentity") === "1";
  } catch {
    return false;
  }
}
function loadLanguage(): Language {
  try {
    const v = localStorage.getItem("zcs:language");
    return v === "en" || v === "ru" ? v : "zh";
  } catch {
    return "zh";
  }
}

/** 把主题应用到 <html data-theme> */
function applyTheme(theme: Theme) {
  const bg = theme === "dark" ? "#111317" : "#f6f7f9";
  const floating = document.documentElement.dataset.windowMode === "floating";
  try {
    document.documentElement.setAttribute("data-theme", theme);
    const domBg = floating ? "transparent" : bg;
    document.documentElement.style.backgroundColor = domBg;
    document.body.style.backgroundColor = domBg;
    document.getElementById("root")?.style.setProperty("background-color", domBg);
  } catch {
    /* SSR / 非 DOM 环境 */
  }
  getCurrentWindow()
    .setBackgroundColor(bg)
    .catch(() => {
      /* 浏览器预览或旧版运行时忽略 */
    });
}

async function maybeSwitchGlm52Account(state: AppState) {
  const t = getTexts(state.language);
  if (!state.glm52AutoSwitchEnabled || glm52AutoSwitching || state.busy) return;

  const active = state.profiles.find((p) => p.active);
  const activeQuota = active ? state.quotas[active.id] : undefined;
  if (!active || !activeQuota || activeQuota.error) return;

  const activeRemaining = glm52Remaining(activeQuota);
  const threshold = state.glm52AutoSwitchThresholdWan * 10_000;
  if (activeRemaining === null || activeRemaining >= threshold) return;

  const candidate = state.profiles
    .filter((p) => p.id !== active.id)
    .map((profile) => ({
      profile,
      quota: state.quotas[profile.id],
      remaining: glm52Remaining(state.quotas[profile.id]),
    }))
    .filter(
      (item) =>
        item.remaining !== null &&
        item.remaining > GLM52_CANDIDATE_MIN_UNITS &&
        !item.quota?.error
    )
    .sort((a, b) => (b.remaining ?? 0) - (a.remaining ?? 0))[0];

  if (!candidate) {
    const now = Date.now();
    if (now - lastGlm52NoCandidateAt > 60_000) {
      lastGlm52NoCandidateAt = now;
      state.toast(t.glmNoCandidate, "warn");
    }
    return;
  }

  glm52AutoSwitching = true;
  try {
    state.toast(
      t.glmAutoSwitching
        .replace("{threshold}", String(state.glm52AutoSwitchThresholdWan))
        .replace("{name}", candidate.profile.name),
      "info"
    );
    await state.switchTo(candidate.profile.id);
  } finally {
    glm52AutoSwitching = false;
  }
}

export const useStore = create<AppState>((set, get) => {
  // 初始化时立即应用主题，避免闪烁
  const initialTheme = loadTheme();
  const initialLanguage = loadLanguage();
  const initialTryNoRestartSwitch = loadTryNoRestartSwitch();
  const initialFloatingWindowMode =
    initialTryNoRestartSwitch && loadFloatingWindowMode();
  const storedAutoRestart = loadAutoRestart();
  const initialAutoRestart = initialTryNoRestartSwitch ? false : storedAutoRestart;
  applyTheme(initialTheme);
  if (!initialFloatingWindowMode) {
    try {
      localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY, "0");
    } catch {
      /* ignore */
    }
  }
  if (initialTryNoRestartSwitch && storedAutoRestart) {
    try {
      localStorage.setItem("zcs:autoRestart", "0");
    } catch {
      /* ignore */
    }
  }
  return {
    profiles: [],
    quotas: loadCachedQuotas(),
    loadingQuota: {},
    autoRefreshQuota: loadAutoRefresh(),
    quotaRefreshIntervalMinutes: loadQuotaRefreshIntervalMinutes(),
    glm52AutoSwitchEnabled: loadGlm52AutoSwitchEnabled(),
    glm52AutoSwitchThresholdWan: loadGlm52AutoSwitchThresholdWan(),
    autoRestart: initialAutoRestart,
    tryNoRestartSwitch: initialTryNoRestartSwitch,
    theme: initialTheme,
    floatingWindowMode: initialFloatingWindowMode,
    floatingWindowScale: loadFloatingWindowScale(),
    updateAvailable: false,
    accountViewMode: loadAccountViewMode(),
    hideAccountIdentity: loadHideAccountIdentity(),
    language: initialLanguage,
    loading: true,
    busy: false,
    toasts: [],

  refresh: async (silent = false) => {
    set({ loading: true });
    try {
      const profiles = await api.listProfiles();
      // 排序：活跃的排第一，然后按更新时间倒序
      profiles.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (b.updated_at || 0) - (a.updated_at || 0);
      });
      set({ profiles, loading: false });
      get().refreshAllQuota();
      if (!silent) {
        get().toast(getTexts(get().language).refreshSuccess, "success");
      }
    } catch (e) {
      set({ loading: false });
      get().toast(
        getTexts(get().language).loadFailed.replace("{error}", String(e)),
        "error"
      );
    }
  },

  captureCurrent: async (name) => {
    set({ busy: true });
    try {
      const p = await api.captureCurrent(name);
      get().toast(
        getTexts(get().language).saveProfileSuccess.replace("{name}", p.name),
        "success"
      );
      await get().refresh();
      // 捕获后顺便拉一下新账号的额度
      get().refreshQuota(p.id);
      return true;
    } catch (e) {
      get().toast(
        getTexts(get().language).saveFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    } finally {
      set({ busy: false });
    }
  },

  switchTo: async (id) => {
    set({ busy: true });
    try {
      const r = await api.switchTo(id);
      const { autoRestart, tryNoRestartSwitch, toast, refresh } = get();
      const t = getTexts(get().language);
      if (tryNoRestartSwitch) {
        await refresh();
        const report = await api.refreshZcodeAppServer().catch(() => null);
        if (!report || report.killed === 0) {
          toast(t.switchNoServer.replace("{name}", r.name), "warn");
        } else if (report.recovered) {
          toast(t.switchNoRestartSuccess.replace("{name}", r.name), "success");
        } else if (report.restarted) {
          toast(t.switchNotRecovered.replace("{name}", r.name), "warn");
        } else {
          toast(t.switchPendingManual.replace("{name}", r.name), "warn");
        }
      } else if (autoRestart) {
        toast(t.switchingRestarting.replace("{name}", r.name), "info");
        await refresh();
        await get().restartZcode();
      } else {
        toast(t.switchedManualNotice.replace("{name}", r.name), "success");
        await refresh();
      }
      return true;
    } catch (e) {
      get().toast(
        getTexts(get().language).switchFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    } finally {
      set({ busy: false });
    }
  },

  renameProfile: async (id, name) => {
    try {
      const ok = await api.renameProfile(id, name);
      if (ok) {
        get().toast(getTexts(get().language).renameSuccess, "success");
        await get().refresh();
      }
      return ok;
    } catch (e) {
      get().toast(
        getTexts(get().language).renameFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    }
  },

  deleteProfile: async (id) => {
    try {
      const ok = await api.deleteProfile(id);
      if (ok) {
        get().toast(getTexts(get().language).deleteSuccess, "success");
        // 清掉对应额度缓存
        set((s) => {
          const { [id]: _drop, ...rest } = s.quotas;
          saveCachedQuotas(rest);
          return { quotas: rest };
        });
        await get().refresh();
      }
      return ok;
    } catch (e) {
      get().toast(
        getTexts(get().language).deleteFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    }
  },

  deleteProfiles: async (ids) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return { deleted: 0, failed: 0 };
    set({ busy: true });
    const deletedIds: string[] = [];
    const errors: string[] = [];
    try {
      for (const id of uniqueIds) {
        try {
          const ok = await api.deleteProfile(id);
          if (ok) deletedIds.push(id);
          else errors.push(id);
        } catch (e) {
          errors.push(String(e));
        }
      }
      if (deletedIds.length > 0) {
        set((s) => {
          const quotas = { ...s.quotas };
          for (const id of deletedIds) delete quotas[id];
          saveCachedQuotas(quotas);
          return { quotas };
        });
      }
      await get().refresh(true);
      const t = getTexts(get().language);
      if (errors.length === 0) {
        get().toast(
          t.batchDeleteSuccess.replace("{count}", String(deletedIds.length)),
          "success"
        );
      } else if (deletedIds.length > 0) {
        get().toast(
          t.batchDeletePartial
            .replace("{deleted}", String(deletedIds.length))
            .replace("{failed}", String(errors.length)),
          "warn"
        );
      } else {
        get().toast(
          t.batchDeleteFailed.replace("{error}", errors.slice(0, 2).join("; ")),
          "error"
        );
      }
      return { deleted: deletedIds.length, failed: errors.length };
    } finally {
      set({ busy: false });
    }
  },

  refreshQuota: async (id) => {
    set((s) => ({ loadingQuota: { ...s.loadingQuota, [id]: true } }));
    try {
      const info = await api.fetchQuota(id);
      const q: QuotaInfo = { ...info, fetched_at: Date.now() / 1000, error: null };
      set((s) => {
        const quotas = { ...s.quotas, [id]: q };
        saveCachedQuotas(quotas);
        return { quotas };
      });
    } catch (e) {
      set((s) => {
        const quotas = {
          ...s.quotas,
          [id]:
            s.quotas[id]?.balances?.length > 0
              ? { ...s.quotas[id], error: String(e), fetched_at: Date.now() / 1000 }
              : {
                  plan_name: null,
                  plan_description: null,
                  plan_status: null,
                  plan_ends_at: null,
                  balances: [],
                  error: String(e),
                  fetched_at: Date.now() / 1000,
                },
        };
        saveCachedQuotas(quotas);
        return { quotas };
      });
    } finally {
      set((s) => {
        const { [id]: _drop, ...rest } = s.loadingQuota;
        return { loadingQuota: rest };
      });
    }
  },

  refreshAllQuota: async () => {
    const { profiles, refreshQuota } = get();
    for (const p of profiles) {
      await refreshQuota(p.id);
    }
    await maybeSwitchGlm52Account(get());
  },

  refreshActiveQuotaForAutoSwitch: async () => {
    const active = get().profiles.find((p) => p.active);
    if (!active) return;
    await get().refreshQuota(active.id);
    await maybeSwitchGlm52Account(get());
  },

  setAutoRefreshQuota: (v) => {
    try {
      localStorage.setItem("zcs:autoRefreshQuota", v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ autoRefreshQuota: v });
  },

  setQuotaRefreshIntervalMinutes: (v) => {
    const minutes = Number.isFinite(v) && v > 0 ? Math.min(1440, Math.round(v)) : 0;
    try {
      localStorage.setItem("zcs:quotaRefreshIntervalMinutes", String(minutes));
    } catch {
      /* ignore */
    }
    set({ quotaRefreshIntervalMinutes: minutes });
  },

  setGlm52AutoSwitchEnabled: (v) => {
    try {
      localStorage.setItem("zcs:glm52AutoSwitchEnabled", v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ glm52AutoSwitchEnabled: v });
  },

  setGlm52AutoSwitchThresholdWan: (v) => {
    const wan =
      Number.isFinite(v) && v > 0
        ? Math.min(300, Math.round(v))
        : GLM52_DEFAULT_THRESHOLD_WAN;
    try {
      localStorage.setItem("zcs:glm52AutoSwitchThresholdWan", String(wan));
    } catch {
      /* ignore */
    }
    set({ glm52AutoSwitchThresholdWan: wan });
  },

  setAutoRestart: (v) => {
    if (v && get().tryNoRestartSwitch) {
      try {
        localStorage.setItem("zcs:autoRestart", "0");
      } catch {
        /* ignore */
      }
      set({ autoRestart: false });
      get().toast(getTexts(get().language).autoRestartBlocked, "warn");
      return;
    }
    try {
      localStorage.setItem("zcs:autoRestart", v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ autoRestart: v });
  },

  setTryNoRestartSwitch: (v) => {
    try {
      localStorage.setItem("zcs:tryNoRestartSwitch", v ? "1" : "0");
      if (v) localStorage.setItem("zcs:autoRestart", "0");
      if (!v) localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY, "0");
    } catch {
      /* ignore */
    }
    set(
      v
        ? { tryNoRestartSwitch: true, autoRestart: false }
        : { tryNoRestartSwitch: false, floatingWindowMode: false }
    );
  },

  setTheme: (v) => {
    try {
      localStorage.setItem("zcs:theme", v);
    } catch {
      /* ignore */
    }
    applyTheme(v);
    set({ theme: v });
  },

  setFloatingWindowMode: (v) => {
    if (v && !get().tryNoRestartSwitch) {
      try {
        localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY, "0");
      } catch {
        /* ignore */
      }
      set({ floatingWindowMode: false });
      get().toast(getTexts(get().language).floatingWindowBlocked, "warn");
      return;
    }
    try {
      localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ floatingWindowMode: v });
  },

  setFloatingWindowScale: (v) => {
    const scale = clampFloatingScale(v);
    try {
      localStorage.setItem(FLOATING_WINDOW_SCALE_KEY, String(scale));
    } catch {
      /* ignore */
    }
    set({ floatingWindowScale: scale });
  },

  setUpdateAvailable: (v) => {
    set({ updateAvailable: v });
  },

  setAccountViewMode: (v) => {
    try {
      localStorage.setItem("zcs:accountViewMode", v);
    } catch {
      /* ignore */
    }
    set({ accountViewMode: v });
  },

  setHideAccountIdentity: (v) => {
    try {
      localStorage.setItem("zcs:hideAccountIdentity", v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ hideAccountIdentity: v });
  },

  setLanguage: (v) => {
    try {
      localStorage.setItem("zcs:language", v);
    } catch {
      /* ignore */
    }
    set({ language: v });
  },

  restartZcode: async () => {
    try {
      await api.restartZcode();
      get().toast(getTexts(get().language).restartSuccess, "success");
      return true;
    } catch (e) {
      get().toast(
        getTexts(get().language).restartFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    }
  },

  toast: (text, kind = "info") => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), 2600);
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  };
});
