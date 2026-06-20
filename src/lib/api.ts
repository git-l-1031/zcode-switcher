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

export interface RefreshZcodeAppServerReport {
  killed: number;
  recovered: boolean;
  restarted: boolean;
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
};

type Option<T> = T | null;
