import { ChevronDown, Loader2, RefreshCcw } from "lucide-react";
import { type RefreshCadence, REFRESH_CADENCE_OPTIONS, type SyncNotice, toneClass } from "../../lib/switchly";

type ActionBarProps = {
  quotaRefreshCadence: RefreshCadence;
  quotaSyncAllBusy: boolean;
  syncNotice: SyncNotice | null;
  error: string;
  onQuotaRefreshCadenceChange: (value: RefreshCadence) => void;
  onSyncQuotaAll: () => void;
};

export function ActionBar({ quotaRefreshCadence, quotaSyncAllBusy, syncNotice, error, onQuotaRefreshCadenceChange, onSyncQuotaAll }: ActionBarProps) {
  return (
    <section className="surface-panel mb-4 rounded-2xl p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-col gap-1">
          <span className="section-title">Auto Refresh</span>
          <div className="relative">
            <select
              className="field-shell h-10 appearance-none rounded-xl px-3.5 pr-9 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/35"
              value={quotaRefreshCadence}
              onChange={(e) => onQuotaRefreshCadenceChange(e.currentTarget.value as RefreshCadence)}
            >
              {REFRESH_CADENCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onSyncQuotaAll}
            disabled={quotaSyncAllBusy}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-primary/20 bg-primary px-3.5 text-xs font-medium text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {quotaSyncAllBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
            Sync All Quotas
          </button>
        </div>
      </div>

      {syncNotice ? <div className={`mt-3 rounded-xl border px-3 py-2.5 text-xs font-mono ${toneClass(syncNotice.tone)}`}>{syncNotice.message}</div> : null}
      {error ? <div className="mt-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">{error}</div> : null}
    </section>
  );
}
