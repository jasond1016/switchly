import { Loader2, Play, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { AccountsTable } from "./components/switchly/accounts-table";
import { useDashboardData } from "./hooks/switchly/use-dashboard-data";
import { useDashboardFeedback } from "./hooks/switchly/use-dashboard-feedback";
import { useLocalStorageState } from "./hooks/use-local-storage-state";
import { useDaemonControl } from "./hooks/switchly/use-daemon-control";
import { useDashboardActions } from "./hooks/switchly/use-dashboard-actions";
import { useOAuthFlow } from "./hooks/switchly/use-oauth-flow";
import { useQuotaSync } from "./hooks/switchly/use-quota-sync";
import { useSwitchlyApi } from "./hooks/switchly/use-switchly-api";
import { deriveDaemonParams, oauthStatus } from "./lib/switchly";

const DEFAULT_BASE_URL = "http://127.0.0.1:7777";
const BASE_URL_KEY = "switchly-ui-base-url";
const DASHBOARD_REFRESH_EVENT = "switchly://dashboard-refresh";

function App() {
  const [baseURL, setBaseURL] = useLocalStorageState(BASE_URL_KEY, DEFAULT_BASE_URL);
  const { error, setError, syncNotice, setSyncNotice } = useDashboardFeedback();

  const daemonParams = useMemo(() => deriveDaemonParams(baseURL), [baseURL]);
  const apiRequest = useSwitchlyApi(baseURL);
  const { status, daemonInfo, loading, daemonInfoLoaded, nowMs, loadStatus, refreshAllBase } = useDashboardData({
    apiRequest,
    onError: setError,
  });

  const { quotaRefreshCadence, setQuotaRefreshCadence, quotaSyncAllBusy, runQuotaSync, runQuotaSyncAll } = useQuotaSync({
    apiRequest,
    loadStatus,
    activeAccountID: status?.active_account_id,
    onError: setError,
    onNotice: setSyncNotice,
  });

  const { oauthSession, oauthPolling, loginWithBrowser, cancelOAuth } = useOAuthFlow({
    apiRequest,
    refreshAll: refreshAllBase,
    runQuotaSync,
    onError: setError,
  });

  const { daemonBusy, onDaemonCommand } = useDaemonControl({
    daemonParams,
    refreshAll: refreshAllBase,
    runQuotaSync,
    onError: setError,
  });

  const { codexImportCandidate, codexImportBusy, discoverCodexImportCandidate, onUseAccount, onDeleteAccount, onStrategy, onImportLocalCodexAccount, onDismissLocalCodexImport } = useDashboardActions({
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

  const autoStartAttemptedRef = useRef("");
  const normalizedStrategyRef = useRef("");

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    void listen(DASHBOARD_REFRESH_EVENT, () => {
      void refreshAll();
    })
      .then((off) => {
        if (!active) {
          off();
          return;
        }
        unlisten = off;
      })
      .catch(() => {
        // Ignore listener setup failures in non-Tauri environments.
      });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!daemonInfoLoaded || loading || daemonInfo !== null || daemonBusy !== "") {
      return;
    }
    if (autoStartAttemptedRef.current === baseURL) {
      return;
    }
    autoStartAttemptedRef.current = baseURL;
    void onDaemonCommand("start");
  }, [baseURL, daemonBusy, daemonInfo, daemonInfoLoaded, loading, onDaemonCommand]);

  useEffect(() => {
    const strategy = status?.strategy;
    if (!strategy || strategy === "fill-first") {
      normalizedStrategyRef.current = "";
      return;
    }
    if (normalizedStrategyRef.current === strategy) {
      return;
    }
    normalizedStrategyRef.current = strategy;
    void onStrategy("fill-first");
  }, [onStrategy, status?.strategy]);

  const daemonRunning = daemonInfo !== null;
  const oauthUIStatus = oauthStatus(oauthSession);
  const accounts = status?.accounts ?? [];
  const attentionCount = accounts.filter((acc) => acc.status === "need_reauth" || acc.status === "disabled" || acc.quota.limit_reached).length;

  return (
    <main className="min-h-screen bg-background">
      <div className="dashboard-shell mx-auto max-w-[1440px] px-4 py-4 sm:px-6 sm:py-6">
        <header className="hero-panel surface-panel mb-6 rounded-[1.75rem] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-stretch xl:justify-between">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">Cross-platform local router</span>
                <span className="chip">{accounts.length} accounts loaded</span>
                <span className={`chip ${attentionCount > 0 ? "border-warning/30 text-[oklch(0.42_0.11_82)]" : ""}`}>{attentionCount} alerts</span>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex size-13 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-card/90 shadow-sm">
                  <img src="/switchly-logo.png" alt="Switchly logo" className="size-7 object-contain" />
                </div>
                <div className="max-w-3xl">
                  <p className="section-title mb-2">Local account routing dashboard</p>
                  <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">Switchly</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
                    为 Codex 多账号切换、限额同步和本地 daemon 控制提供统一桌面入口。当前界面更适合高频管理，而不是一次性设置。
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-end xl:min-w-[360px]">
              <div className="rounded-2xl border border-border/80 bg-card/72 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="section-title mb-1">Daemon</p>
                    <div className="flex items-center gap-2">
                      <span className={`status-dot ${daemonRunning ? "bg-success" : "bg-warning"}`} />
                      <span className="text-sm font-medium text-foreground">{daemonRunning ? "运行中" : "已停止"}</span>
                    </div>
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">{daemonParams.addr}</p>
                  </div>
                  <span className="chip">{daemonRunning ? "Local router ready" : "Waiting to start"}</span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 xl:justify-end">
                  <button
                    onClick={() => void onDaemonCommand("start")}
                    disabled={daemonBusy !== "" || daemonRunning}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {daemonBusy === "start" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    启动
                  </button>
                  <button
                    onClick={() => void onDaemonCommand("stop")}
                    disabled={daemonBusy !== "" || !daemonRunning}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {daemonBusy === "stop" ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
                    停止
                  </button>
                  <button
                    onClick={() => void onDaemonCommand("restart")}
                    disabled={daemonBusy !== "" || !daemonRunning || daemonInfo?.restart_supported === false}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-primary/20 bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {daemonBusy === "restart" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                    重启
                  </button>
                </div>
              </div>
            </div>
          </div>

          <details className="mt-4 rounded-2xl border border-border/80 bg-card/70 p-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
              高级连接设置
              <span className="ml-2 text-xs font-normal text-muted-foreground">当前 {baseURL}</span>
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(18rem,22rem)_auto] sm:items-end">
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                <span className="section-title">Base URL</span>
                <input
                  className="field-shell h-10 rounded-xl px-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring/35"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.currentTarget.value)}
                />
              </label>
              <p className="text-xs leading-5 text-muted-foreground">只有切换本地 daemon 地址或调试其他环境时才需要修改这里。</p>
            </div>
          </details>
        </header>

        {codexImportCandidate?.found && codexImportCandidate.candidate ? (
          <section className="surface-panel mb-4 rounded-2xl border border-success/30 bg-success/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="section-title mb-1">Codex Import</p>
                <p className="text-sm font-medium text-foreground">检测到本地 Codex 登录，可导入 Switchly 账号列表</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  账号 ID: {codexImportCandidate.candidate.id}
                  {codexImportCandidate.already_exists ? "（已存在，导入会覆盖 token）" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void onImportLocalCodexAccount()}
                  disabled={codexImportBusy}
                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-primary/20 bg-primary px-3.5 text-xs font-medium text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {codexImportBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  导入
                </button>
                <button
                  onClick={onDismissLocalCodexImport}
                  disabled={codexImportBusy}
                  className="inline-flex h-9 items-center rounded-xl border border-border bg-secondary px-3.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  暂不导入
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <AccountsTable
          accounts={accounts}
          activeAccountID={status?.active_account_id}
          nowMs={nowMs}
          quotaRefreshCadence={quotaRefreshCadence}
          quotaSyncAllBusy={quotaSyncAllBusy}
          syncNotice={syncNotice}
          error={error}
          oauthPolling={oauthPolling}
          oauthUIStatus={oauthUIStatus}
          oauthSession={oauthSession}
          onQuotaRefreshCadenceChange={setQuotaRefreshCadence}
          onSyncQuotaAll={() => void runQuotaSyncAll({ showBusy: true, silent: false })}
          onOAuthLogin={() => void loginWithBrowser()}
          onOAuthCancel={cancelOAuth}
          onUseAccount={(id) => void onUseAccount(id)}
          onDeleteAccount={(id) => void onDeleteAccount(id)}
          onOAuthReauth={() => void loginWithBrowser()}
        />
      </div>
    </main>
  );
}

export default App;
