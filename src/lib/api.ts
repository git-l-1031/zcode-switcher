import { invoke } from "@tauri-apps/api/core";

export interface ProfileView {
  id: string;
  name: string;
  user_id: string;
  email: string;
  phone: string;
  avatar: string;
  cred_hash: string;
  cred_file: string;
  created_at: number;
  updated_at: number;
  active: boolean;
  short_id: string;
}

export interface CurrentStatus {
  logged_in: boolean;
  active_profile_id: string | null;
  active_profile_name: string | null;
  current_username: string;
  current_email: string;
  current_phone: string;
}

/** 单个模型的用量条目。 */
export interface BalanceItem {
  show_name: string;
  used_units: number;
  total_units: number;
  remaining_units: number;
  unit_type: string | null;
  period: string | null;
}

/** 一个账号的订阅/额度汇总。 */
export interface QuotaInfo {
  plan_name: string | null;
  plan_description: string | null;
  plan_status: string | null;
  /** 套餐到期时间（Unix 秒，null 表示无） */
  plan_ends_at: number | null;
  balances: BalanceItem[];
  /** 前端附加：拉取失败时的错误信息 */
  error?: string | null;
  /** 前端附加：拉取时间戳（秒） */
  fetched_at?: number;
}

export interface BatchImportReport {
  imported: number;
  skipped: number;
  failed: number;
  messages: string[];
}

/** OAuth 初始化响应:用 authorize_url 让用户在浏览器登录,留 pollToken 给后续 acquire 用 */
export interface OAuthInit {
  flow_id: string;
  authorize_url: string;
  poll_token: string;
}

export interface RefreshZcodeAppServerReport {
  killed: number;
  recovered: boolean;
  restarted: boolean;
}

export type ApiFormat = "anthropic" | "openai";

export interface CustomProviderView {
  id: string;
  name: string;
  base_url: string;
  api_format: ApiFormat;
  models: string[];
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface ProxyStatus {
  running: boolean;
  port: number;
  base_url: string;
}

export interface AccountPoolEntryView {
  profile_id: string;
  name: string;
  email: string;
  phone: string;
  avatar: string;
  family: string;
  mode: string;
  active: boolean;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

/** 调用后端命令，错误会被 reject 成字符串。 */
export async function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(name, args);
}

export const api = {
  listProfiles: () => cmd<ProfileView[]>("list_profiles"),
  currentStatus: () => cmd<CurrentStatus>("current_status"),
  captureCurrent: (name: string) =>
    cmd<{ id: string; name: string; email: string; phone: string; avatar: string }>(
      "capture_current",
      { name }
    ),
  switchTo: (id: string) => cmd<{ id: string; name: string }>("switch_to", { id }),
  renameProfile: (id: string, name: string) => cmd<boolean>("rename_profile", { id, name }),
  deleteProfile: (id: string) => cmd<boolean>("delete_profile", { id }),
  exportProfileToFile: (id: string, path: string) =>
    cmd<void>("export_profile_to_file", { id, path }),
  importProfileFromFile: (path: string) =>
    cmd<{ id: string; name: string; email: string; phone: string; avatar: string }>(
      "import_profile_from_file",
      {
        path,
      }
    ),
  exportProfilesBundleToFile: (path: string) =>
    cmd<void>("export_profiles_bundle_to_file", { path }),
  exportProfilesToFile: (ids: string[], path: string) =>
    cmd<void>("export_profiles_to_file", { ids, path }),
  importProfilesFromFiles: (paths: string[]) =>
    cmd<BatchImportReport>("import_profiles_from_files", { paths }),
  openConfigDir: () => cmd<void>("open_config_dir"),
  fetchQuota: (id?: string) =>
    cmd<Omit<QuotaInfo, "error" | "fetched_at">>("fetch_quota", { id: id ?? null }),
  zcodeRunning: () => cmd<Option<string>>("zcode_running"),
  refreshZcodeAppServer: () =>
    cmd<RefreshZcodeAppServerReport>("refresh_zcode_app_server"),
  restartZcode: () => cmd<void>("restart_zcode"),
  killZcodeForSwitch: () => cmd<void>("kill_zcode_for_switch"),
  oauthInit: () => cmd<OAuthInit>("oauth_init"),
  oauthAcquireAndImport: (flowId: string, pollToken: string, deadlineSeconds?: number) =>
    cmd<{ id: string; name: string; email: string; phone: string; avatar: string }>(
      "oauth_acquire_and_import",
      {
        flowId,
        pollToken,
        deadlineSeconds: deadlineSeconds ?? null,
      }
    ),
  listCustomProviders: () => cmd<CustomProviderView[]>("list_custom_providers"),
  addCustomProvider: (
    name: string,
    baseUrl: string,
    apiKey: string,
    apiFormat: ApiFormat,
    models: string[]
  ) =>
    cmd<CustomProviderView>("add_custom_provider", {
      name,
      baseUrl,
      apiKey,
      apiFormat,
      models,
    }),
  updateCustomProvider: (
    id: string,
    name: string,
    baseUrl: string,
    apiKey: string | null,
    apiFormat: ApiFormat,
    models: string[],
    enabled: boolean
  ) =>
    cmd<CustomProviderView>("update_custom_provider", {
      id,
      name,
      baseUrl,
      apiKey,
      apiFormat,
      models,
      enabled,
    }),
  deleteCustomProvider: (id: string) =>
    cmd<boolean>("delete_custom_provider", { id }),
  listAccountPool: () => cmd<AccountPoolEntryView[]>("list_account_pool"),
  addAccountToPool: (profileId: string) =>
    cmd<AccountPoolEntryView>("add_account_to_pool", { profileId }),
  setAccountPoolEnabled: (profileId: string, enabled: boolean) =>
    cmd<AccountPoolEntryView>("set_account_pool_enabled", { profileId, enabled }),
  removeAccountFromPool: (profileId: string) =>
    cmd<boolean>("remove_account_from_pool", { profileId }),
  startProxy: (port: number, gatewayKey: string) =>
    cmd<ProxyStatus>("start_proxy", { port, gatewayKey }),
  stopProxy: () => cmd<ProxyStatus>("stop_proxy"),
  proxyStatus: () => cmd<ProxyStatus>("proxy_status"),
  inspectDownloadUrl: (url: string) =>
    cmd<{ filename: string; contentType: string | null; contentLength: number | null }>(
      "inspect_download_url",
      { url }
    ),
  downloadUrlToFile: (url: string, path: string) =>
    cmd<void>("download_url_to_file", { url, path }),
  downloadUrlToDirectory: (url: string, directory: string) =>
    cmd<{ path: string; filename: string }>("download_url_to_directory", { url, directory }),
};

type Option<T> = T | null;
