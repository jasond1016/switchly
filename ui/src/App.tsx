import { Loader2, RefreshCw, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { AccountsTable } from "./components/switchly/accounts-table";
import { ActionBar } from "./components/switchly/action-bar";
import { DaemonPanel } from "./components/switchly/daemon-panel";
import { useDashboardData } from "./hooks/switchly/use-dashboard-data";
import { useDashboardFeedback } from "./hooks/switchly/use-dashboard-feedback";
import { OAuthPanel } from "./components/switchly/oauth-panel";
import { SummaryRow } from "./components/switchly/summary-row";
import { useLocalStorageState } from "./hooks/use-local-storage-state";
import { useDaemonControl } from "./hooks/switchly/use-daemon-control";
import { useDashboardActions } from "./hooks/switchly/use-dashboard-actions";
import { useOAuthFlow } from "./hooks/switchly/use-oauth-flow";
import { useQuotaSync } from "./hooks/switchly/use-quota-sync";
import { useSwitchlyApi } from "./hooks/switchly/use-switchly-api";
import { deriveDaemonParams, oauthStatus } from "./lib/switchly";

const DEFAULT_BASE_URL = "http://127.0.0.1:7777";
const BASE_URL_KEY = "switchly-ui-base-url";

function App() {
  const [baseURL, setBaseURL] = useLocalStorageState(BASE_URL_KEY, DEFAULT_BASE_URL);
  const { error, setError, syncNotice, setSyncNotice } = useDashboardFeedback();

  const daemonParams = useMemo(() => deriveDaemonParams(baseURL), [baseURL]);
  const apiRequest = useSwitchlyApi(baseURL);
  const { status, daemonInfo, loading, nowMs, loadStatus, refreshAllBase } = useDashboardData({
    apiRequest,
    onError: setError,
  });

  const { quotaRefreshCadence, setQuotaRefreshCadence, quotaSyncBusy, quotaSyncAllBusy, runQuotaSync, runQuotaSyncAll } = useQuotaSync({
    apiRequest,
    loadStatus,
    activeAccountID: status?.active_account_id,
    onError: setError,
    onNotice: setSyncNotice,
  });

  const { oauthSession, oauthPolling, loginWithBrowser } = useOAuthFlow({
    apiRequest,
    refreshAll: refreshAllBase,
    runQuotaSync,
    onError: setError,
  });

  const { daemonBusy, daemonOutput, onDaemonCommand } = useDaemonControl({
    daemonParams,
    refreshAll: refreshAllBase,
    runQuotaSync,
    onError: setError,
  });

  const {
    simBusy,
    codexImportCandidate,
    codexImportBusy,
    discoverCodexImportCandidate,
    onUseAccount,
    onStrategy,
    onSimulateLimit,
    onImportLocalCodexAccount,
    onDismissLocalCodexImport,
  } = useDashboardActions({
    apiRequest,
    loadStatus,
    reloadDashboard: refreshAllBase,
    runQuotaSync,
    onError: setError,
    onNotice: setSyncNotice,
  });

  const refreshAll = useCallback(async () => {
    await refreshAllBase();
    await discoverCodexImportCandidate();
  }, [discoverCodexImportCandidate, refreshAllBase]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const daemonRunning = daemonInfo !== null;
  const oauthUIStatus = oauthStatus(oauthSession);
  const daemonLogs = daemonOutput
    ? daemonOutput
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
    : [];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="size-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-foreground">Switchly</h1>
              <p className="text-xs text-muted-foreground">Codex 多账号切换器</p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Base URL
              <input
                className="h-8 w-[270px] rounded-md border border-input bg-card px-2.5 text-xs text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring/40"
                value={baseURL}
                onChange={(e) => setBaseURL(e.currentTarget.value)}
              />
            </label>
            <button
              onClick={() => void refreshAll()}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-secondary px-3 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        <SummaryRow
          activeAccountId={status?.active_account_id ?? "-"}
          strategy={status?.strategy}
          accountCount={status?.accounts.length ?? 0}
          daemonRunning={daemonRunning}
        />

        <ActionBar
          strategy={status?.strategy}
          quotaRefreshCadence={quotaRefreshCadence}
          quotaSyncBusy={quotaSyncBusy}
          quotaSyncAllBusy={quotaSyncAllBusy}
          simBusy={simBusy}
          syncNotice={syncNotice}
          error={error}
          onStrategyChange={(s) => void onStrategy(s)}
          onQuotaRefreshCadenceChange={setQuotaRefreshCadence}
          onSyncQuota={() => void runQuotaSync({ showBusy: true, silent: false })}
          onSyncQuotaAll={() => void runQuotaSyncAll({ showBusy: true, silent: false })}
          onSimulateLimit={() => void onSimulateLimit()}
        />

        {codexImportCandidate?.found && codexImportCandidate.candidate ? (
          <section className="mb-4 rounded-lg border border-success/30 bg-success/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">检测到本地 Codex 登录，可导入 Switchly 账号列表</p>
                <p className="text-xs text-muted-foreground">
                  账号 ID: {codexImportCandidate.candidate.id}
                  {codexImportCandidate.already_exists ? "（已存在，导入会覆盖 token）" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void onImportLocalCodexAccount()}
                  disabled={codexImportBusy}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {codexImportBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  导入
                </button>
                <button
                  onClick={onDismissLocalCodexImport}
                  disabled={codexImportBusy}
                  className="inline-flex h-8 items-center rounded-md border border-border bg-secondary px-3 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  暂不导入
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <AccountsTable
          accounts={status?.accounts ?? []}
          activeAccountID={status?.active_account_id}
          nowMs={nowMs}
          onUseAccount={(id) => void onUseAccount(id)}
          onOAuthReauth={() => void loginWithBrowser()}
        />

        <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <OAuthPanel oauthPolling={oauthPolling} oauthUIStatus={oauthUIStatus} oauthSession={oauthSession} onOAuthLogin={() => void loginWithBrowser()} />
          <DaemonPanel
            addr={daemonParams.addr}
            publicBaseURL={daemonParams.publicBaseURL}
            daemonBusy={daemonBusy}
            daemonRunning={daemonRunning}
            daemonInfo={daemonInfo}
            daemonLogs={daemonLogs}
            onDaemonCommand={(cmd) => void onDaemonCommand(cmd)}
          />
        </section>
      </div>
    </main>
  );
}

export default App;
