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
    <section className="mb-4 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-secondary p-0.5">
          <button
            onClick={() => onStrategyChange("round-robin")}
            className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
              strategy === "round-robin" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Round-Robin
          </button>
          <button
            onClick={() => onStrategyChange("fill-first")}
            className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
              strategy === "fill-first" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Fill-First
          </button>
        </div>

        <div className="h-6 w-px bg-border" />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">自动刷新</span>
          <div className="relative">
            <select
              className="h-8 appearance-none rounded-md border border-input bg-secondary px-2.5 pr-7 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              value={quotaRefreshCadence}
              onChange={(e) => onQuotaRefreshCadenceChange(e.currentTarget.value as RefreshCadence)}
            >
              {REFRESH_CADENCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        <div className="h-6 w-px bg-border" />

        <button
          onClick={onSyncQuota}
          disabled={quotaSyncBusy || quotaSyncAllBusy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {quotaSyncBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Sync Quota (OpenAI API)
        </button>

        <button
          onClick={onSyncQuotaAll}
          disabled={quotaSyncBusy || quotaSyncAllBusy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {quotaSyncAllBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
          Sync All Quotas
        </button>

        <div className="h-6 w-px bg-border" />

        <button
          onClick={onSimulateLimit}
          disabled={simBusy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/30 bg-card px-3 text-xs font-medium text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {simBusy ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
          Simulate Limit Error
        </button>
      </div>

      {syncNotice ? <div className={`mt-3 rounded-md border px-3 py-2 text-xs font-mono ${toneClass(syncNotice.tone)}`}>{syncNotice.message}</div> : null}
      {error ? <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div> : null}
    </section>
  );
}
