import { useState } from "react";
import { ArrowUpDown, Check } from "lucide-react";
import { getTexts, type Language } from "../i18n";
import type { AccountSortMode } from "../store";

interface Props {
  value: AccountSortMode;
  onChange: (v: AccountSortMode) => void;
  language: Language;
}

const OPTIONS: AccountSortMode[] = [
  "name-asc",
  "name-desc",
  "quota-desc",
  "quota-asc",
  "expiry-asc",
];

export default function SortMenu({ value, onChange, language }: Props) {
  const t = getTexts(language);
  const [open, setOpen] = useState(false);

  const labels: Record<AccountSortMode, string> = {
    "name-asc": t.sortNameAsc,
    "name-desc": t.sortNameDesc,
    "quota-desc": t.sortQuotaDesc,
    "quota-asc": t.sortQuotaAsc,
    "expiry-asc": t.sortExpiryAsc,
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={t.sortButtonTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-base-border bg-base-card text-text-secondary transition hover:bg-base-cardhover hover:text-text-primary active:scale-[0.96]"
      >
        <ArrowUpDown size={16} />
      </button>
      {open && (
        <>
          {/* 外部点击关闭 */}
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-40 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-base-border bg-base-card shadow-lg"
          >
            {OPTIONS.map((mode) => {
              const isActive = value === mode;
              return (
                <button
                  key={mode}
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => {
                    onChange(mode);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium transition ${
                    isActive
                      ? "bg-accent-soft text-accent"
                      : "text-text-secondary hover:bg-base-cardhover hover:text-text-primary"
                  }`}
                >
                  <span>{labels[mode]}</span>
                  {isActive && <Check size={14} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
