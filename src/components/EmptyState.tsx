import { UserPlus } from "lucide-react";
import { getTexts, type Language } from "../i18n";

export default function EmptyState({ language }: { language: Language }) {
  const t = getTexts(language);
  return (
    <div className="fade-in flex flex-col items-center justify-center rounded-2xl border border-dashed border-base-border bg-base-card/50 px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-base-cardhover text-text-secondary">
        <UserPlus size={28} strokeWidth={1.8} />
      </div>
      <h3 className="text-base font-bold text-text-primary">{t.emptyTitle}</h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-text-muted">
        {t.emptyBodyBefore}
        <br />
        <span className="font-medium text-text-secondary">{t.emptyBodyAction}</span>{" "}
        {t.emptyBodyAfter}
      </p>
    </div>
  );
}
