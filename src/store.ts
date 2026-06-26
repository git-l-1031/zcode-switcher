import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  api,
  type ApiFormat,
  type AccountPoolEntryView,
  type CustomProviderView,
  type ProfileView,
  type ProxyStatus,
  type QuotaInfo,
} from "./lib/api";
import { glm52Remaining } from "./lib/glm52";
import { getTexts, type Language } from "./i18n";

export type ToastKind = "info" | "success" | "error" | "warn";
export type Theme = "dark" | "light";
export type AccountViewMode = "card" | "list";
export type AccountSortMode =
  | "name-asc"
  | "name-desc"
  | "quota-desc"
  | "quota-asc"
  | "expiry-asc";
const DEFAULT_ACCOUNT_SORT_MODE: AccountSortMode = "name-asc";

const FLOATING_WINDOW_STORAGE_KEY = "zcs:floatingWindowMode";

const GLM52_THRESHOLD_WAN_MIN = 10;
const GLM52_THRESHOLD_WAN_MAX = 100;
const GLM52_DEFAULT_THRESHOLD_WAN = 35;
const DEFAULT_QUOTA_REFRESH_INTERVAL_MINUTES = 10;
const DEFAULT_ACTIVE_QUOTA_REFRESH_INTERVAL_MINUTES = 1;
const ACTIVE_QUOTA_REFRESH_INTERVAL_MINUTES_KEY = "zcs:activeQuotaRefreshIntervalMinutes";
const DEFAULT_THEME: Theme = "light";
const QUOTA_CACHE_KEY = "zcs:quotas";
const DEFAULT_PROXY_PORT = 17860;
const PROXY_PORT_KEY = "zcs:proxyPort";
const PROXY_GATEWAY_KEY = "zcs:proxyGatewayKey";

interface ToastMsg {
  id: number;
  text: string;
  kind: ToastKind;
}

interface AppState {
  profiles: ProfileView[];
  /** 账号 id → 额度信息 */
  quotas: Record<string, QuotaInfo>;
  /** 正在拉取额度的账号 id */
  loadingQuota: Record<string, boolean>;
  /** 刚刷新成功的账号 id，1 秒后自动清除 */
  recentlyRefreshed: Record<string, boolean>;
  autoRefreshQuota: boolean;
  /** 自动刷新额度的间隔分钟数，0 表示关闭 */
  quotaRefreshIntervalMinutes: number;
  /** 当前账号刷新间隔分钟数，限制 1-5 分钟 */
  activeQuotaRefreshIntervalMinutes: number;
  /** 用来重置定时器倒计时的 tick */
  scheduledRefreshSeq: number;
  glm52AutoSwitchEnabled: boolean;
  /** 自动切换阈值，单位：万 */
  glm52AutoSwitchThresholdWan: number;
  autoRestart: boolean;
  tryNoRestartSwitch: boolean;
  theme: Theme;
  floatingWindowMode: boolean;
  /** 悬浮窗缩放比例，1 为原始大小 */
  floatingWindowScale: number;
  updateAvailable: boolean;
  customProviders: CustomProviderView[];
  accountPool: AccountPoolEntryView[];
  proxyStatus: ProxyStatus | null;
  proxyPort: number;
  proxyGatewayKey: string;
  accountViewMode: AccountViewMode;
  /** 账号列表排序方式（当前账号始终置顶） */
  accountSortMode: AccountSortMode;
  hideAccountIdentity: boolean;
  language: Language;
  loading: boolean;
  busy: boolean;
  toasts: ToastMsg[];

  refresh: (silent?: boolean, skipQuota?: boolean) => Promise<void>;
  captureCurrent: (name: string) => Promise<boolean>;
  switchTo: (id: string) => Promise<boolean>;
  renameProfile: (id: string, name: string) => Promise<boolean>;
  deleteProfile: (id: string) => Promise<boolean>;
  deleteProfiles: (ids: string[]) => Promise<{ deleted: number; failed: number }>;

  refreshQuota: (id: string) => Promise<void>;
  refreshAllQuota: (orderedIds?: string[]) => Promise<void>;
  /** 只刷新还没有额度数据的账号 */
  refreshMissingQuota: () => Promise<void>;
  /** 定时触发的批量刷新 */
  scheduledRefreshAllQuota: (orderedIds?: string[]) => Promise<void>;
  refreshActiveQuotaForAutoSwitch: () => Promise<void>;
  setAutoRefreshQuota: (v: boolean) => void;
  setQuotaRefreshIntervalMinutes: (v: number) => void;
  setActiveQuotaRefreshIntervalMinutes: (v: number) => void;
  setGlm52AutoSwitchEnabled: (v: boolean) => void;
  setGlm52AutoSwitchThresholdWan: (v: number) => void;
  setAutoRestart: (v: boolean) => void;
  setTryNoRestartSwitch: (v: boolean) => void;
  setTheme: (v: Theme) => void;
  setFloatingWindowMode: (v: boolean) => void;
  setFloatingWindowScale: (v: number) => void;
  setUpdateAvailable: (v: boolean) => void;
  refreshCustomProviders: () => Promise<void>;
  refreshAccountPool: () => Promise<void>;
  addAccountToPool: (profileId: string) => Promise<boolean>;
  setAccountPoolEnabled: (profileId: string, enabled: boolean) => Promise<boolean>;
  removeAccountFromPool: (profileId: string) => Promise<boolean>;
  addCustomProvider: (
    name: string,
    baseUrl: string,
    apiKey: string,
    apiFormat: ApiFormat,
    models: string[]
  ) => Promise<boolean>;
  deleteCustomProvider: (id: string) => Promise<boolean>;
  setCustomProviderEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  activateCustomProvider: (id: string) => Promise<boolean>;
  refreshProxyStatus: () => Promise<void>;
  startLocalProxy: () => Promise<boolean>;
  stopLocalProxy: () => Promise<boolean>;
  setProxyPort: (v: number) => void;
  regenerateProxyGatewayKey: () => void;
  setAccountViewMode: (v: AccountViewMode) => void;
  setAccountSortMode: (v: AccountSortMode) => void;
  setHideAccountIdentity: (v: boolean) => void;
  setLanguage: (v: Language) => void;
  restartZcode: () => Promise<boolean>;

  toast: (text: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;
let glm52AutoSwitching = false;
let lastGlm52NoCandidateAt = 0;

let refreshAllInFlight = false;

function orderedProfilesForRefresh(
  state: AppState,
  orderedIds?: string[]
): ProfileView[] {
  if (orderedIds?.length) {
    return orderedIds
      .map((id) => state.profiles.find((profile) => profile.id === id))
      .filter((profile): profile is ProfileView => !!profile);
  }
  const sorted = [...state.profiles];
  sorted.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    switch (state.accountSortMode) {
      case "name-asc":
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      case "name-desc":
        return b.name.localeCompare(a.name, undefined, { numeric: true });
      case "quota-desc":
        return (glm52Remaining(state.quotas[b.id]) ?? -1) -
          (glm52Remaining(state.quotas[a.id]) ?? -1);
      case "quota-asc":
        return (glm52Remaining(state.quotas[a.id]) ?? Number.MAX_SAFE_INTEGER) -
          (glm52Remaining(state.quotas[b.id]) ?? Number.MAX_SAFE_INTEGER);
      case "expiry-asc":
        return (state.quotas[a.id]?.plan_ends_at ?? Number.MAX_SAFE_INTEGER) -
          (state.quotas[b.id]?.plan_ends_at ?? Number.MAX_SAFE_INTEGER);
    }
  });
  return sorted;
}

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
    const saved = localStorage.getItem("zcs:quotaRefreshIntervalMinutes");
    if (saved === null) return DEFAULT_QUOTA_REFRESH_INTERVAL_MINUTES;
    const n = Number(saved);
    return Number.isFinite(n) && n > 0 ? Math.min(1440, Math.round(n)) : 0;
  } catch {
    return DEFAULT_QUOTA_REFRESH_INTERVAL_MINUTES;
  }
}
function loadGlm52AutoSwitchEnabled(): boolean {
  try {
    return localStorage.getItem("zcs:glm52AutoSwitchEnabled") === "1";
  } catch {
    return false;
  }
}
function clampGlm52ThresholdWan(n: number): number {
  return Math.max(GLM52_THRESHOLD_WAN_MIN, Math.min(GLM52_THRESHOLD_WAN_MAX, Math.round(n)));
}
function loadGlm52AutoSwitchThresholdWan(): number {
  try {
    const n = Number(localStorage.getItem("zcs:glm52AutoSwitchThresholdWan"));
    return Number.isFinite(n) && n > 0
      ? clampGlm52ThresholdWan(n)
      : GLM52_DEFAULT_THRESHOLD_WAN;
  } catch {
    return GLM52_DEFAULT_THRESHOLD_WAN;
  }
}
function loadTheme(): Theme {
  try {
    const t = localStorage.getItem("zcs:theme");
    return t === "dark" || t === "light" ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
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
const VALID_SORT_MODES: readonly AccountSortMode[] = [
  "name-asc",
  "name-desc",
  "quota-desc",
  "quota-asc",
  "expiry-asc",
];
function loadAccountSortMode(): AccountSortMode {
  try {
    const v = localStorage.getItem("zcs:accountSortMode") as AccountSortMode | null;
    return v && VALID_SORT_MODES.includes(v) ? v : DEFAULT_ACCOUNT_SORT_MODE;
  } catch {
    return DEFAULT_ACCOUNT_SORT_MODE;
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
function clampActiveQuotaRefreshIntervalMinutes(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_ACTIVE_QUOTA_REFRESH_INTERVAL_MINUTES;
  return Math.max(1, Math.min(5, Math.round(v)));
}
function loadActiveQuotaRefreshIntervalMinutes(): number {
  try {
    const saved = localStorage.getItem(ACTIVE_QUOTA_REFRESH_INTERVAL_MINUTES_KEY);
    if (saved === null) return DEFAULT_ACTIVE_QUOTA_REFRESH_INTERVAL_MINUTES;
    return clampActiveQuotaRefreshIntervalMinutes(Number(saved));
  } catch {
    return DEFAULT_ACTIVE_QUOTA_REFRESH_INTERVAL_MINUTES;
  }
}

function randomGatewayKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(32);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function loadProxyPort(): number {
  try {
    const saved = Number(localStorage.getItem(PROXY_PORT_KEY));
    return Number.isFinite(saved) && saved > 0 && saved <= 65535
      ? Math.round(saved)
      : DEFAULT_PROXY_PORT;
  } catch {
    return DEFAULT_PROXY_PORT;
  }
}

function loadProxyGatewayKey(): string {
  try {
    const saved = localStorage.getItem(PROXY_GATEWAY_KEY);
    if (saved && saved.length >= 12) return saved;
    const key = randomGatewayKey();
    localStorage.setItem(PROXY_GATEWAY_KEY, key);
    return key;
  } catch {
    return randomGatewayKey();
  }
}

function hasDisplayableQuota(quota?: QuotaInfo): boolean {
  return !!quota && !quota.error && ((quota.balances?.length ?? 0) > 0 || !!quota.plan_name);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** 把主题应用到 <html data-theme> 及窗口背景 */
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
    /* ignore */
  }
  getCurrentWindow()
    .setBackgroundColor(bg)
    .catch(() => {
      /* ignore */
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
        item.remaining > threshold &&
        !item.quota?.error
    )
    .sort((a, b) => (b.remaining ?? 0) - (a.remaining ?? 0))[0];

  if (!candidate) {
    const now = Date.now();
    if (now - lastGlm52NoCandidateAt > 60_000) {
      lastGlm52NoCandidateAt = now;
      state.toast(
        t.glmNoCandidate.replace(
          "{threshold}",
          String(state.glm52AutoSwitchThresholdWan)
        ),
        "warn"
      );
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
  // 立即应用主题，避免首屏闪烁
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
    recentlyRefreshed: {},
    autoRefreshQuota: loadAutoRefresh(),
    quotaRefreshIntervalMinutes: loadQuotaRefreshIntervalMinutes(),
    activeQuotaRefreshIntervalMinutes: loadActiveQuotaRefreshIntervalMinutes(),
    scheduledRefreshSeq: 0,
    glm52AutoSwitchEnabled: loadGlm52AutoSwitchEnabled(),
    glm52AutoSwitchThresholdWan: loadGlm52AutoSwitchThresholdWan(),
    autoRestart: initialAutoRestart,
    tryNoRestartSwitch: initialTryNoRestartSwitch,
    theme: initialTheme,
    floatingWindowMode: initialFloatingWindowMode,
    floatingWindowScale: loadFloatingWindowScale(),
    updateAvailable: false,
    customProviders: [],
    accountPool: [],
    proxyStatus: null,
    proxyPort: loadProxyPort(),
    proxyGatewayKey: loadProxyGatewayKey(),
    accountViewMode: loadAccountViewMode(),
    accountSortMode: loadAccountSortMode(),
    hideAccountIdentity: loadHideAccountIdentity(),
    language: initialLanguage,
    loading: true,
    busy: false,
    toasts: [],

  refresh: async (silent = false, skipQuota = false) => {
    set({ loading: true });
    try {
      const profiles = await api.listProfiles();
      set({ profiles, loading: false });
      // skipQuota：只重载列表，由调用方按需刷新新号
      if (!skipQuota) {
        get().refreshAllQuota();
      }
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
      // 只刷新刚捕获的新号
      await get().refresh(true, true);
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
      const { autoRestart, tryNoRestartSwitch } = get();
      // 自动重启路径：先关再写再启，避免写入期间被覆盖
      if (!tryNoRestartSwitch && autoRestart) {
        try {
          await api.killZcodeForSwitch();
        } catch {
          /* ignore */
        }
      }
      const r = await api.switchTo(id);
      // 就地翻 active 标记，排序交给渲染层
      set((s) => ({
        profiles: s.profiles.map((p) => ({ ...p, active: p.id === r.id })),
      }));
      const { toast } = get();
      const t = getTexts(get().language);
      if (tryNoRestartSwitch) {
        toast(t.switchNoRestartSuccess.replace("{name}", r.name), "success");
      } else if (autoRestart) {
        toast(t.switchingRestarting.replace("{name}", r.name), "info");
        await get().restartZcode();
      } else {
        toast(t.switchedManualNotice.replace("{name}", r.name), "success");
      }
      if (!hasDisplayableQuota(get().quotas[id])) {
        set((s) => ({ loadingQuota: { ...s.loadingQuota, [id]: true } }));
        for (let attempt = 0; attempt < 10; attempt += 1) {
          if (attempt > 0) {
            set((s) => ({ loadingQuota: { ...s.loadingQuota, [id]: true } }));
            await delay(1000);
          }
          await get().refreshQuota(id);
          if (hasDisplayableQuota(get().quotas[id])) break;
        }
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
        // 直接从本地列表移除，清掉对应额度缓存
        set((s) => {
          const { [id]: _drop, ...rest } = s.quotas;
          saveCachedQuotas(rest);
          return {
            profiles: s.profiles.filter((p) => p.id !== id),
            quotas: rest,
          };
        });
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
          return {
            profiles: s.profiles.filter((p) => !deletedIds.includes(p.id)),
            quotas,
          };
        });
      }
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
    // 单个账号刷新：立即执行，不进队列，保证手动点击响应及时
    set((s) => ({ loadingQuota: { ...s.loadingQuota, [id]: true } }));
    try {
      const info = await api.fetchQuota(id);
      const q: QuotaInfo = { ...info, fetched_at: Date.now() / 1000, error: null };
      set((s) => {
        const quotas = { ...s.quotas, [id]: q };
        saveCachedQuotas(quotas);
        return {
          quotas,
          recentlyRefreshed: { ...s.recentlyRefreshed, [id]: true },
        };
      });
      // 1 秒后清掉成功标记
      setTimeout(() => {
        set((s) => {
          const { [id]: _drop, ...rest } = s.recentlyRefreshed;
          return { recentlyRefreshed: rest };
        });
      }, 1000);
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
        // 失败时清掉可能残留的成功标记
        const { [id]: _ok, ...restOk } = s.recentlyRefreshed;
        return { quotas, recentlyRefreshed: restOk };
      });
    } finally {
      set((s) => {
        const { [id]: _drop, ...rest } = s.loadingQuota;
        return { loadingQuota: rest };
      });
    }
  },

  refreshAllQuota: async (orderedIds) => {
    // 进行中跳过，完成后 bump tick 重置定时器倒计时
    if (refreshAllInFlight) return;
    refreshAllInFlight = true;
    try {
      const state = get();
      const { refreshQuota } = state;
      const ordered = orderedProfilesForRefresh(state, orderedIds);
      for (const p of ordered) {
        await refreshQuota(p.id);
      }
      await maybeSwitchGlm52Account(get());
    } finally {
      refreshAllInFlight = false;
      set((s) => ({ scheduledRefreshSeq: s.scheduledRefreshSeq + 1 }));
    }
  },

  refreshMissingQuota: async () => {
    // 只刷新还没有额度数据的账号，逐个 await
    const { profiles, quotas, refreshQuota } = get();
    for (const p of profiles) {
      const q = quotas[p.id];
      const hasData = !!q && ((q.balances?.length ?? 0) > 0 || !!q.plan_name);
      if (!hasData) {
        await refreshQuota(p.id);
      }
    }
  },

  scheduledRefreshAllQuota: async (orderedIds) => {
    // 进行中跳过；tryNoRestartSwitch 时跳过当前活跃账号
    if (refreshAllInFlight) return;
    refreshAllInFlight = true;
    try {
      const state = get();
      const { refreshQuota, tryNoRestartSwitch } = state;
      const ordered = orderedProfilesForRefresh(state, orderedIds);
      for (const p of ordered) {
        if (tryNoRestartSwitch && p.active) continue;
        await refreshQuota(p.id);
      }
      await maybeSwitchGlm52Account(get());
    } finally {
      refreshAllInFlight = false;
    }
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

  setActiveQuotaRefreshIntervalMinutes: (v) => {
    const minutes = clampActiveQuotaRefreshIntervalMinutes(v);
    try {
      localStorage.setItem(ACTIVE_QUOTA_REFRESH_INTERVAL_MINUTES_KEY, String(minutes));
    } catch {
      /* ignore */
    }
    set({ activeQuotaRefreshIntervalMinutes: minutes });
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
        ? clampGlm52ThresholdWan(v)
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

  refreshCustomProviders: async () => {
    try {
      const customProviders = await api.listCustomProviders();
      set({ customProviders });
    } catch (e) {
      get().toast(
        getTexts(get().language).providerLoadFailed.replace("{error}", String(e)),
        "error"
      );
    }
  },

  refreshAccountPool: async () => {
    try {
      const accountPool = await api.listAccountPool();
      set({ accountPool });
    } catch (e) {
      get().toast(String(e), "error");
    }
  },

  addAccountToPool: async (profileId) => {
    try {
      const entry = await api.addAccountToPool(profileId);
      set((s) => ({
        accountPool: [
          ...s.accountPool.filter((item) => item.profile_id !== entry.profile_id),
          entry,
        ],
      }));
      return true;
    } catch (e) {
      get().toast(String(e), "error");
      return false;
    }
  },

  setAccountPoolEnabled: async (profileId, enabled) => {
    try {
      const entry = await api.setAccountPoolEnabled(profileId, enabled);
      set((s) => ({
        accountPool: s.accountPool.map((item) =>
          item.profile_id === profileId ? entry : item
        ),
      }));
      return true;
    } catch (e) {
      get().toast(String(e), "error");
      return false;
    }
  },

  removeAccountFromPool: async (profileId) => {
    try {
      const ok = await api.removeAccountFromPool(profileId);
      if (ok) {
        set((s) => ({
          accountPool: s.accountPool.filter((item) => item.profile_id !== profileId),
        }));
      }
      return ok;
    } catch (e) {
      get().toast(String(e), "error");
      return false;
    }
  },

  addCustomProvider: async (name, baseUrl, apiKey, apiFormat, models) => {
    set({ busy: true });
    try {
      const provider = await api.addCustomProvider(
        name,
        baseUrl,
        apiKey,
        apiFormat,
        models
      );
      set((s) => ({ customProviders: [...s.customProviders, provider] }));
      get().toast(getTexts(get().language).providerAdded, "success");
      return true;
    } catch (e) {
      get().toast(
        getTexts(get().language).providerAddFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    } finally {
      set({ busy: false });
    }
  },

  deleteCustomProvider: async (id) => {
    try {
      const ok = await api.deleteCustomProvider(id);
      if (ok) {
        set((s) => ({
          customProviders: s.customProviders.filter((provider) => provider.id !== id),
        }));
        get().toast(getTexts(get().language).providerDeleted, "success");
      }
      return ok;
    } catch (e) {
      get().toast(
        getTexts(get().language).providerDeleteFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    }
  },

  setCustomProviderEnabled: async (id, enabled) => {
    const provider = get().customProviders.find((item) => item.id === id);
    if (!provider) return false;
    try {
      const updated = await api.updateCustomProvider(
        provider.id,
        provider.name,
        provider.base_url,
        null,
        provider.api_format,
        provider.models,
        enabled
      );
      set((s) => ({
        customProviders: s.customProviders.map((item) =>
          item.id === id ? updated : item
        ),
      }));
      return true;
    } catch (e) {
      get().toast(
        getTexts(get().language).providerUpdateFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    }
  },

  activateCustomProvider: async (id) => {
    const providers = get().customProviders;
    const target = providers.find((item) => item.id === id);
    if (!target) return false;
    try {
      const updatedProviders = [];
      for (const provider of providers) {
        const shouldEnable = provider.id === id;
        if (provider.enabled === shouldEnable) {
          updatedProviders.push(provider);
          continue;
        }
        const updated = await api.updateCustomProvider(
          provider.id,
          provider.name,
          provider.base_url,
          null,
          provider.api_format,
          provider.models,
          shouldEnable
        );
        updatedProviders.push(updated);
      }
      set({ customProviders: updatedProviders });
      get().toast(
        getTexts(get().language).providerActivated.replace("{name}", target.name),
        "success"
      );
      return true;
    } catch (e) {
      get().toast(
        getTexts(get().language).providerActivateFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    }
  },

  refreshProxyStatus: async () => {
    try {
      const proxyStatus = await api.proxyStatus();
      set({
        proxyStatus,
        proxyPort: proxyStatus.port > 0 ? proxyStatus.port : get().proxyPort,
      });
    } catch {
      set({ proxyStatus: null });
    }
  },

  startLocalProxy: async () => {
    try {
      const proxyStatus = await api.startProxy(get().proxyPort, get().proxyGatewayKey);
      set({ proxyStatus, proxyPort: proxyStatus.port });
      try {
        localStorage.setItem(PROXY_PORT_KEY, String(proxyStatus.port));
      } catch {
        /* ignore */
      }
      get().toast(getTexts(get().language).proxyStarted, "success");
      return true;
    } catch (e) {
      get().toast(
        getTexts(get().language).proxyStartFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    }
  },

  stopLocalProxy: async () => {
    try {
      const proxyStatus = await api.stopProxy();
      set({ proxyStatus });
      get().toast(getTexts(get().language).proxyStoppedToast, "success");
      return true;
    } catch (e) {
      get().toast(
        getTexts(get().language).proxyStopFailed.replace("{error}", String(e)),
        "error"
      );
      return false;
    }
  },

  setProxyPort: (v) => {
    const port = Number.isFinite(v) && v > 0 ? Math.min(65535, Math.round(v)) : DEFAULT_PROXY_PORT;
    try {
      localStorage.setItem(PROXY_PORT_KEY, String(port));
    } catch {
      /* ignore */
    }
    set({ proxyPort: port });
  },

  regenerateProxyGatewayKey: () => {
    const proxyGatewayKey = randomGatewayKey();
    try {
      localStorage.setItem(PROXY_GATEWAY_KEY, proxyGatewayKey);
    } catch {
      /* ignore */
    }
    set({ proxyGatewayKey });
    get().toast(getTexts(get().language).proxyKeyRegenerated, "success");
  },

  setAccountViewMode: (v) => {
    try {
      localStorage.setItem("zcs:accountViewMode", v);
    } catch {
      /* ignore */
    }
    set({ accountViewMode: v });
  },

  setAccountSortMode: (v) => {
    try {
      localStorage.setItem("zcs:accountSortMode", v);
    } catch {
      /* ignore */
    }
    set({ accountSortMode: v });
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
