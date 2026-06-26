import type { Language } from "../i18n";

export type NoticeKind = "system" | "temporary";
export type NoticeLevel = "info" | "warn" | "error";
export type LocalizedText = string | Partial<Record<Language, string>>;

export interface NoticeItem {
  id: string;
  kind: NoticeKind;
  title: LocalizedText;
  body: LocalizedText;
  enabled: boolean;
  level: NoticeLevel;
  date: string;
  showOnce: boolean;
  showOnStartup: boolean;
}

export interface NoticeLoadResult {
  notices: NoticeItem[];
  failed: boolean;
  error?: string;
}

const REMOTE_NOTICE_URL =
  "https://raw.githubusercontent.com/git-l-1031/zcode-switcher/main/public/notice.json";
const LOCAL_NOTICE_URL = "/notice.json";
const NOTICE_TIMEOUT_MS = 5000;
const SEEN_NOTICE_IDS_KEY = "zcode-switcher:seen-notice-ids";

export async function loadNotices(): Promise<NoticeLoadResult> {
  const errors: string[] = [];
  for (const url of [REMOTE_NOTICE_URL, LOCAL_NOTICE_URL]) {
    try {
      const payload = await fetchNoticeJson(url);
      return { notices: parseNotices(payload), failed: false };
    } catch (e) {
      errors.push(String(e));
    }
  }
  return { notices: [], failed: true, error: errors.join("\n") };
}

export function resolveNoticeText(text: LocalizedText, language: Language): string {
  if (typeof text === "string") return text;
  return text[language] ?? text.zh ?? text.en ?? text.ru ?? "";
}

export function readSeenNoticeIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_NOTICE_IDS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function markNoticeIdsSeen(ids: string[]) {
  if (ids.length === 0) return;
  try {
    const next = new Set([...readSeenNoticeIds(), ...ids]);
    window.localStorage.setItem(SEEN_NOTICE_IDS_KEY, JSON.stringify(Array.from(next)));
  } catch {
    /* localStorage 不可用时忽略，不影响主流程 */
  }
}

function shouldUseNoticeKind(value: unknown): value is NoticeKind {
  return value === "system" || value === "temporary";
}

function shouldUseNoticeLevel(value: unknown): value is NoticeLevel {
  return value === "info" || value === "warn" || value === "error";
}

function parseNotices(payload: unknown): NoticeItem[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as { enabled?: unknown; notices?: unknown };
  if (data.enabled === false || !Array.isArray(data.notices)) return [];

  return data.notices
    .map((item) => sanitizeNotice(item))
    .filter((notice): notice is NoticeItem => !!notice);
}

function sanitizeNotice(item: unknown): NoticeItem | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (raw.enabled === false) return null;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (!shouldUseNoticeKind(raw.kind)) return null;

  const title = sanitizeLocalizedText(raw.title);
  const body = sanitizeLocalizedText(raw.body);
  if (!title || !body) return null;

  return {
    id: raw.id.trim(),
    kind: raw.kind,
    title,
    body,
    enabled: true,
    level: shouldUseNoticeLevel(raw.level) ? raw.level : "info",
    date: typeof raw.date === "string" ? raw.date : "",
    showOnce: raw.showOnce !== false,
    showOnStartup: raw.showOnStartup !== false,
  };
}

function sanitizeLocalizedText(value: unknown): LocalizedText | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;

  const result: Partial<Record<Language, string>> = {};
  for (const key of ["zh", "en", "ru"] as Language[]) {
    const text = (value as Record<string, unknown>)[key];
    if (typeof text === "string" && text.trim()) result[key] = text.trim();
  }
  return Object.keys(result).length > 0 ? result : null;
}

async function fetchNoticeJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), NOTICE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${url} ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}
