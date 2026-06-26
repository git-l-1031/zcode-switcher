import {
  CheckCircle2,
  Copy,
  Database,
  EyeOff,
  KeyRound,
  Play,
  PlusSquare,
  Power,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AccountPoolEntryView, CustomProviderView, ProxyStatus } from "../lib/api";
import { formatText, getTexts, type Language } from "../i18n";
import { gradientFor, initialOf } from "../lib/avatar";

function ActionIcon({
  icon,
  title,
  onClick,
  disabled,
  danger,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`focus-ring flex h-8 w-8 items-center justify-center rounded-lg transition active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? "bg-accent/15 text-accent hover:bg-accent hover:text-white"
          : danger
          ? "text-danger hover:bg-danger/10"
          : "text-text-secondary hover:bg-base-cardhover hover:text-text-primary"
      }`}
    >
      {icon}
    </button>
  );
}

function MaskedText({ value }: { value: string }) {
  if (!value) return <span>—</span>;
  const head = value.slice(0, 8);
  return <span>{head}••••••••••••</span>;
}

function InfoRow({
  label,
  value,
  mono,
  action,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="w-16 shrink-0 truncate text-text-muted">{label}</span>
      <span
        className={`min-w-0 flex-1 truncate text-text-secondary ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </span>
      {action}
    </div>
  );
}

function copyButton(title: string, onClick: () => void) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.92]"
    >
      <Copy size={13} />
    </button>
  );
}

export function ApiServiceCard({
  proxyStatus,
  proxyPort,
  proxyGatewayKey,
  providerCount,
  accountCount,
  language,
  onStart,
  onStop,
  onCopy,
  onRegenerateKey,
  onRefresh,
}: {
  proxyStatus: ProxyStatus | null;
  proxyPort: number;
  proxyGatewayKey: string;
  providerCount: number;
  accountCount: number;
  language: Language;
  onStart: () => void;
  onStop: () => void;
  onCopy: (value: string) => void;
  onRegenerateKey: () => void;
  onRefresh: () => void;
}) {
  const t = getTexts(language);
  const running = !!proxyStatus?.running;
  const baseUrl = proxyStatus?.base_url || `http://127.0.0.1:${proxyPort}/v1`;

  return (
    <div
      className={`fade-in card-hover group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border p-3.5 transition ${
        running
          ? "border-ok/60 bg-accent/5"
          : "border-base-border bg-base-card hover:bg-base-cardhover"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent shadow-md ring-2 ring-base-border">
          <Server size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-text-primary">
              {t.apiServiceCardTitle}
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                running ? "bg-ok/15 text-ok" : "bg-base-cardhover text-text-muted"
              }`}
            >
              {running ? t.proxyRunningShort : t.proxyStoppedShort}
            </span>
          </div>
          <span className="mt-0.5 block truncate text-[11px] text-text-secondary">
            {formatText(t.apiServiceProviderCount, { count: accountCount + providerCount })}
          </span>
          <span className="mt-1 inline-flex max-w-full truncate rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
            {t.proxyScopeLocal}
          </span>
        </div>
      </div>

      <div className="mt-3 flex min-h-0 flex-col gap-2 overflow-hidden border-t border-base-border/70 pt-2.5">
        <InfoRow
          label={t.proxyBaseUrl}
          value={baseUrl}
          mono
          action={copyButton(t.copy, () => onCopy(baseUrl))}
        />
        <InfoRow
          label={t.proxyGatewayKey}
          value={<MaskedText value={proxyGatewayKey} />}
          mono
          action={copyButton(t.copy, () => onCopy(proxyGatewayKey))}
        />
        <InfoRow
          label={t.accountPoolTitle}
          value={formatText(t.accountPoolCount, { count: accountCount })}
        />
      </div>

      <div className="mt-2 flex min-h-[38px] items-center text-[11px] leading-relaxed text-text-muted">
        {t.apiServiceAddAccountHint}
      </div>

      <div className="mt-auto flex items-center justify-between gap-1.5 pt-3">
        <ActionIcon
          icon={<KeyRound size={14} />}
          title={t.proxyRegenerateKey}
          onClick={onRegenerateKey}
          disabled={running}
        />
        <ActionIcon icon={<Copy size={14} />} title={t.copy} onClick={() => onCopy(baseUrl)} />
        <ActionIcon icon={<RefreshCw size={14} />} title={t.refreshListTitle} onClick={onRefresh} />
        {running ? (
          <ActionIcon icon={<Power size={15} />} title={t.proxyStop} onClick={onStop} danger />
        ) : (
          <ActionIcon icon={<Play size={15} />} title={t.proxyStart} onClick={onStart} primary />
        )}
      </div>
    </div>
  );
}

export function AccountPoolCard({
  entries,
  profiles,
  language,
  onAddAccount,
  onToggleEnabled,
  onRemove,
  onRefresh,
}: {
  entries: AccountPoolEntryView[];
  profiles: { id: string; name: string; email: string; phone: string }[];
  language: Language;
  onAddAccount: (profileId: string) => void;
  onToggleEnabled: (profileId: string, enabled: boolean) => void;
  onRemove: (profileId: string) => void;
  onRefresh: () => void;
}) {
  const t = getTexts(language);
  const [selectedId, setSelectedId] = useState("");
  const pooledIds = useMemo(
    () => new Set(entries.map((entry) => entry.profile_id)),
    [entries]
  );
  const candidates = useMemo(
    () => profiles.filter((profile) => !pooledIds.has(profile.id)),
    [pooledIds, profiles]
  );
  const activeCount = entries.filter((entry) => entry.enabled).length;

  useEffect(() => {
    if (!selectedId && candidates[0]) setSelectedId(candidates[0].id);
    if (selectedId && !candidates.some((profile) => profile.id === selectedId)) {
      setSelectedId(candidates[0]?.id ?? "");
    }
  }, [candidates, selectedId]);

  return (
    <div className="fade-in card-hover group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-base-border bg-base-card p-3.5 transition hover:bg-base-cardhover">
      <div className="flex items-start gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent shadow-md ring-2 ring-base-border">
          <Database size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-text-primary">
              {t.accountPoolTitle}
            </span>
            <span className="shrink-0 rounded-full bg-ok/15 px-1.5 py-0.5 text-[9px] font-bold text-ok">
              {formatText(t.accountPoolEnabledCount, { count: activeCount })}
            </span>
          </div>
          <span className="mt-0.5 block truncate text-[11px] text-text-secondary">
            {t.accountPoolDesc}
          </span>
        </div>
      </div>

      <div className="mt-3 flex min-h-0 flex-col gap-2 overflow-hidden border-t border-base-border/70 pt-2.5">
        <div className="flex items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.currentTarget.value)}
            className="focus-ring h-8 min-w-0 flex-1 rounded-lg border border-base-border bg-base-card px-2 text-xs text-text-primary outline-none"
          >
            {candidates.length === 0 ? (
              <option value="">{t.accountPoolNoCandidates}</option>
            ) : (
              candidates.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name || profile.email || profile.phone || profile.id}
                </option>
              ))
            )}
          </select>
          <ActionIcon
            icon={<PlusSquare size={14} />}
            title={t.addAccount}
            onClick={() => selectedId && onAddAccount(selectedId)}
            disabled={!selectedId}
            primary
          />
        </div>

        <div className="flex max-h-[92px] min-h-[66px] flex-col gap-1.5 overflow-y-auto pr-1">
          {entries.length === 0 ? (
            <div className="flex h-full items-center text-[11px] text-text-muted">
              {t.accountPoolEmpty}
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.profile_id}
                className="flex items-center gap-2 rounded-lg bg-base-cardhover/70 px-2 py-1.5"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    entry.enabled ? "bg-ok" : "bg-text-muted"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-text-primary">
                    {entry.name}
                  </div>
                  <div className="truncate text-[10px] text-text-muted">
                    {entry.mode.toUpperCase()} · {entry.email || entry.phone || "—"}
                  </div>
                </div>
                <ActionIcon
                  icon={entry.enabled ? <EyeOff size={13} /> : <CheckCircle2 size={13} />}
                  title={entry.enabled ? t.disableProvider : t.enableProvider}
                  onClick={() => onToggleEnabled(entry.profile_id, !entry.enabled)}
                />
                <ActionIcon
                  icon={<Trash2 size={13} />}
                  title={t.deleteProfile}
                  onClick={() => onRemove(entry.profile_id)}
                  danger
                />
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-end gap-1.5 pt-3">
        <ActionIcon icon={<RefreshCw size={14} />} title={t.refreshListTitle} onClick={onRefresh} />
      </div>
    </div>
  );
}

export function ProviderServiceCard({
  provider,
  language,
  onCopy,
  onActivate,
  onToggleEnabled,
  onDelete,
}: {
  provider: CustomProviderView;
  language: Language;
  onCopy: (value: string) => void;
  onActivate: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}) {
  const t = getTexts(language);
  const enabled = provider.enabled;
  const apiFormat =
    provider.api_format === "anthropic" ? t.providerAnthropic : t.providerOpenAI;
  const updatedAt = provider.updated_at
    ? new Date(provider.updated_at * 1000).toLocaleString()
    : "—";
  const visibleModels = provider.models.slice(0, 2);
  const moreModelCount = Math.max(0, provider.models.length - visibleModels.length);

  return (
    <div
      className={`fade-in card-hover group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border p-3.5 transition ${
        enabled
          ? "border-ok/60 bg-accent/5"
          : "border-base-border bg-base-card hover:bg-base-cardhover"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-md ring-2 ring-base-border"
          style={{ background: gradientFor(provider.name.length) }}
        >
          {initialOf(provider.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-text-primary">
              {provider.name}
            </span>
            {enabled && (
              <span className="shrink-0 rounded-full bg-ok/15 px-1.5 py-0.5 text-[9px] font-bold text-ok">
                {t.currentProvider}
              </span>
            )}
          </div>
          <span className="mt-0.5 block truncate text-[11px] text-text-secondary">
            {provider.base_url}
          </span>
          <span className="mt-1 inline-flex max-w-full truncate rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
            {apiFormat}
          </span>
        </div>
      </div>

      <div className="mt-3 flex min-h-0 flex-col gap-2 overflow-hidden border-t border-base-border/70 pt-2.5">
        <InfoRow
          label={t.providerApiKey}
          value="••••••••••••••••"
          mono
        />
        <InfoRow
          label={t.providerModels}
          value={formatText(t.providerModelCount, { count: provider.models.length })}
          action={copyButton(t.copy, () => onCopy(provider.models.join("\n")))}
        />
        <InfoRow
          label={t.providerBaseUrl}
          value={provider.base_url}
          mono
          action={copyButton(t.copy, () => onCopy(provider.base_url))}
        />
      </div>

      <div className="mt-2 flex min-h-[38px] flex-wrap content-start gap-1.5 overflow-hidden">
        {visibleModels.map((model) => (
          <span
            key={model}
            className="max-w-full truncate rounded-full bg-base-cardhover px-2 py-0.5 text-[10px] font-medium text-text-secondary"
            title={model}
          >
            {model}
          </span>
        ))}
        {moreModelCount > 0 && (
          <span className="rounded-full bg-base-cardhover px-2 py-0.5 text-[10px] font-medium text-text-muted">
            +{moreModelCount}
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-1.5 pt-3">
        <span
          className="min-w-0 flex-1 truncate text-[10px] text-text-muted"
          title={updatedAt}
        >
          {formatText(t.updatedAt, { time: updatedAt })}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <ActionIcon
            icon={enabled ? <EyeOff size={14} /> : <CheckCircle2 size={14} />}
            title={enabled ? t.disableProvider : t.enableProvider}
            onClick={onToggleEnabled}
          />
          <ActionIcon
            icon={<Database size={14} />}
            title={formatText(t.providerModelCount, { count: provider.models.length })}
            onClick={() => onCopy(provider.models.join("\n"))}
          />
          <ActionIcon icon={<Play size={15} />} title={t.switch} onClick={onActivate} primary={!enabled} />
          <ActionIcon icon={<Trash2 size={14} />} title={t.deleteProfile} danger onClick={onDelete} />
        </div>
      </div>
    </div>
  );
}
