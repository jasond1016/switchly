import { AlertTriangle, ChevronDown, Loader2, RefreshCcw, RefreshCw } from "lucide-react";
import { type RefreshCadence, REFRESH_CADENCE_OPTIONS, type RoutingStrategy, type SyncNotice, toneClass } from "../../lib/switchly";

type ActionBarProps = {
  strategy?: RoutingStrategy;
  quotaRefreshCadence: RefreshCadence;
  quotaSyncBusy: boolean;
  quotaSyncAllBusy: boolean;
  simBusy: boolean;
  syncNotice: SyncNotice | null;
  error: string;
  onStrategyChange: (strategy: RoutingStrategy) => void;
  onQuotaRefreshCadenceChange: (value: RefreshCadence) => void;
  onSyncQuota: () => void;
  onSyncQuotaAll: () => void;
  onSimulateLimit: () => void;
};

export function ActionBar({
  strategy,
  quotaRefreshCadence,
  quotaSyncBusy,
  quotaSyncAllBusy,
  simBusy,
  syncNotice,
  error,
  onStrategyChange,
  onQuotaRefreshCadenceChange,
  onSyncQuota,
  onSyncQuotaAll,
  onSimulateLimit,
}: ActionBarProps) {
  return (
    <section className="surface-panel mb-4 rounded-2xl p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-1">
              <span className="section-title">Routing Strategy</span>
              <div className="flex items-center gap-1 rounded-xl border border-border bg-secondary p-1">
                <button
                  onClick={() => onStrategyChange("round-robin")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    strategy === "round-robin" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Round-Robin
                </button>
                <button
                  onClick={() => onStrategyChange("fill-first")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    strategy === "fill-first" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Fill-First
                </button>
              </div>
            </div>

            <div className="hidden h-10 w-px bg-border xl:block" />

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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onSyncQuota}
              disabled={quotaSyncBusy || quotaSyncAllBusy}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-primary/20 bg-primary px-3.5 text-xs font-medium text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {quotaSyncBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Sync Quota (OpenAI API)
            </button>

            <button
              onClick={onSyncQuotaAll}
              disabled={quotaSyncBusy || quotaSyncAllBusy}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-xs font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {quotaSyncAllBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
              Sync All Quotas
            </button>
          </div>
        </div>

        <details className="rounded-2xl border border-border/70 bg-secondary/25 px-3 py-2.5">
          <summary className="cursor-pointer list-none text-xs font-medium text-foreground">
            Diagnostics
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">调试和故障模拟操作放在这里，避免和主流程并列。</span>
          </summary>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={onSimulateLimit}
              disabled={simBusy}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 text-xs font-medium text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {simBusy ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
              Simulate Limit Error
            </button>
          </div>
        </details>
      </div>

      {syncNotice ? <div className={`mt-3 rounded-xl border px-3 py-2.5 text-xs font-mono ${toneClass(syncNotice.tone)}`}>{syncNotice.message}</div> : null}
      {error ? <div className="mt-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">{error}</div> : null}
    </section>
  );
}
