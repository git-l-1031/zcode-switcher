import type { ProfileView, QuotaInfo } from "./api";
import { glm52Remaining } from "./glm52";
import type { AccountSortMode } from "../store";

/** 排序账号列表：active 永远置顶，缺数据的账号排最后 */
export function sortProfiles(
  profiles: ProfileView[],
  quotas: Record<string, QuotaInfo>,
  mode: AccountSortMode
): ProfileView[] {
  const sorted = [...profiles];
  sorted.sort((a, b) => {
    // active 永远置顶
    if (a.active !== b.active) return a.active ? -1 : 1;

    switch (mode) {
      case "name-asc":
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      case "name-desc":
        return b.name.localeCompare(a.name, undefined, { numeric: true });
      case "quota-desc": {
        // 多 → 少：缺数据的视为 -1，排最后
        const ar = glm52Remaining(quotas[a.id]) ?? -1;
        const br = glm52Remaining(quotas[b.id]) ?? -1;
        return br - ar;
      }
      case "quota-asc": {
        // 少 → 多：缺数据的视为很大，排最后
        const ar = glm52Remaining(quotas[a.id]) ?? Number.MAX_SAFE_INTEGER;
        const br = glm52Remaining(quotas[b.id]) ?? Number.MAX_SAFE_INTEGER;
        return ar - br;
      }
      case "expiry-asc": {
        // 快到期 → 远；无到期信息的排最后
        const ae = quotas[a.id]?.plan_ends_at ?? Number.MAX_SAFE_INTEGER;
        const be = quotas[b.id]?.plan_ends_at ?? Number.MAX_SAFE_INTEGER;
        return ae - be;
      }
    }
  });
  return sorted;
}
