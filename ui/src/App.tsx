import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountsTable } from "./components/switchly/accounts-table";
import { ActionBar } from "./components/switchly/action-bar";
import { DaemonPanel } from "./components/switchly/daemon-panel";
import { OAuthPanel } from "./components/switchly/oauth-panel";
import { SummaryRow } from "./components/switchly/summary-row";
import {
  type CodexImportCandidateResponse,
  type CodexImportResponse,
  type DaemonInfo,
  deriveDaemonParams,
  type OAuthSession,
  oauthStatus,
  type QuotaSyncAllResponse,
  type RefreshCadence,
  type RoutingStrategy,
  type StatusSnapshot,
  type SyncNotice,
  isRefreshCadence,
} from "./lib/switchly";

const DEFAULT_BASE_URL = "http://127.0.0.1:7777";
const BASE_URL_KEY = "switchly-ui-base-url";
const QUOTA_REFRESH_CADENCE_KEY = "switchly-ui-quota-refresh-cadence";

function App() {
  const [baseURL, setBaseURL] = useState<string>(() => localStorage.getItem(BASE_URL_KEY) ?? DEFAULT_BASE_URL);
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [daemonInfo, setDaemonInfo] = useState<DaemonInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syncNotice, setSyncNotice] = useState<SyncNotice | null>(null);
  const [oauthSession, setOAuthSession] = useState<OAuthSession | null>(null);
  const [oauthPolling, setOAuthPolling] = useState(false);
  const [daemonBusy, setDaemonBusy] = useState<"start" | "stop" | "restart" | "">("");
  const [daemonOutput, setDaemonOutput] = useState("");
  const [simBusy, setSimBusy] = useState(false);
  const [quotaSyncBusy, setQuotaSyncBusy] = useState(false);
  const [quotaSyncAllBusy, setQuotaSyncAllBusy] = useState(false);
  const [codexImportCandidate, setCodexImportCandidate] = useState<CodexImportCandidateResponse | null>(null);
  const [codexImportBusy, setCodexImportBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [quotaRefreshCadence, setQuotaRefreshCadence] = useState<RefreshCadence>(() => {
    const raw = localStorage.getItem(QUOTA_REFRESH_CADENCE_KEY);
    return isRefreshCadence(raw) ? raw : "10min";
  });

  const pollRef = useRef<number | null>(null);
  const importDismissedRef = useRef(false);
  const quotaSyncInFlightRef = useRef(false);
  const quotaSyncFailureCountRef = useRef(0);
  const quotaSyncBackoffUntilRef = useRef(0);

  const daemonParams = useMemo(() => deriveDaemonParams(baseURL), [baseURL]);

  const apiRequest = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers);
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(`${baseURL}${path}`, { ...init, headers });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    },
    [baseURL],
  );

  const loadStatus = useCallback(async () => {
    const next = await apiRequest<StatusSnapshot>("/v1/status");
    setStatus(next);
  }, [apiRequest]);

  const loadDaemonInfo = useCallback(async () => {
    try {
      const info = await apiRequest<DaemonInfo>("/v1/daemon/info");
      setDaemonInfo(info);
    } catch {
      setDaemonInfo(null);
    }
  }, [apiRequest]);

  const discoverCodexImportCandidate = useCallback(async () => {
    if (importDismissedRef.current || codexImportCandidate?.found) {
      return;
    }
    try {
      const out = await apiRequest<CodexImportCandidateResponse>("/v1/accounts/import/codex/candidate");
      if (out.found && out.candidate) {
        setCodexImportCandidate(out);
      }
    } catch {
      // Ignore discovery errors to keep normal dashboard loading smooth.
    }
  }, [apiRequest, codexImportCandidate?.found]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadStatus(), loadDaemonInfo()]);
      await discoverCodexImportCandidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [discoverCodexImportCandidate, loadDaemonInfo, loadStatus]);

  useEffect(() => {
    localStorage.setItem(BASE_URL_KEY, baseURL);
  }, [baseURL]);

  useEffect(() => {
    localStorage.setItem(QUOTA_REFRESH_CADENCE_KEY, quotaRefreshCadence);
  }, [quotaRefreshCadence]);

  useEffect(() => {
    void refreshAll();
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
      }
    };
  }, [refreshAll]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const runQuotaSync = useCallback(
    async (opts?: { accountID?: string; silent?: boolean; showBusy?: boolean }) => {
      const accountID = (opts?.accountID ?? status?.active_account_id ?? "").trim();
      if (!accountID || quotaSyncInFlightRef.current) {
        return false;
      }

      quotaSyncInFlightRef.current = true;
      if (opts?.showBusy) {
        setQuotaSyncBusy(true);
      }
      if (!opts?.silent) {
        setError("");
        setSyncNotice({ tone: "info", message: `正在同步账号 ${accountID} 的 Quota...` });
      }

      try {
        await apiRequest("/v1/quota/sync", { method: "POST", body: JSON.stringify({ account_id: accountID }) });
        await loadStatus();
        quotaSyncFailureCountRef.current = 0;
        quotaSyncBackoffUntilRef.current = 0;
        if (!opts?.silent) {
          setSyncNotice({ tone: "success", message: `✓ 账号 ${accountID} Quota 同步成功` });
        }
        return true;
      } catch (e) {
        quotaSyncFailureCountRef.current += 1;
        const backoffMinutes = Math.min(15, 2 ** (quotaSyncFailureCountRef.current - 1));
        quotaSyncBackoffUntilRef.current = Date.now() + backoffMinutes * 60_000;
        const msg = e instanceof Error ? e.message : String(e);
        if (!opts?.silent) {
          setError(msg);
          setSyncNotice({ tone: "error", message: `Quota 同步失败: ${msg}` });
        }
        return false;
      } finally {
        quotaSyncInFlightRef.current = false;
        if (opts?.showBusy) {
          setQuotaSyncBusy(false);
        }
      }
    },
    [apiRequest, loadStatus, status?.active_account_id],
  );

  const runQuotaSyncAll = useCallback(
    async (opts?: { silent?: boolean; showBusy?: boolean }) => {
      if (quotaSyncInFlightRef.current) {
        return false;
      }

      quotaSyncInFlightRef.current = true;
      if (opts?.showBusy) {
        setQuotaSyncAllBusy(true);
      }
      if (!opts?.silent) {
        setError("");
        setSyncNotice({ tone: "info", message: "正在同步所有账号 Quota..." });
      }

      try {
        const out = await apiRequest<QuotaSyncAllResponse>("/v1/quota/sync-all", { method: "POST", body: JSON.stringify({}) });
        await loadStatus();
        quotaSyncFailureCountRef.current = out.failed > 0 ? quotaSyncFailureCountRef.current : 0;
        quotaSyncBackoffUntilRef.current = 0;
        if (!opts?.silent) {
          if (out.failed > 0) {
            setSyncNotice({ tone: "warning", message: `⚠ 同步完成: ${out.succeeded} 个成功, ${out.failed} 个失败` });
          } else {
            setSyncNotice({ tone: "success", message: `✓ 全部 ${out.succeeded} 个账号 Quota 同步成功` });
          }
        }
        return out.failed === 0;
      } catch (e) {
        quotaSyncFailureCountRef.current += 1;
        const backoffMinutes = Math.min(15, 2 ** (quotaSyncFailureCountRef.current - 1));
        quotaSyncBackoffUntilRef.current = Date.now() + backoffMinutes * 60_000;
        const msg = e instanceof Error ? e.message : String(e);
        if (!opts?.silent) {
          setError(msg);
          setSyncNotice({ tone: "error", message: `Sync All 失败: ${msg}` });
        }
        return false;
      } finally {
        quotaSyncInFlightRef.current = false;
        if (opts?.showBusy) {
          setQuotaSyncAllBusy(false);
        }
      }
    },
    [apiRequest, loadStatus],
  );

  const startOAuthPolling = useCallback(
    (state: string) => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
      }
      setOAuthPolling(true);
      pollRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const sess = await apiRequest<OAuthSession>(`/v1/oauth/status?state=${encodeURIComponent(state)}`);
            setOAuthSession(sess);
            if (sess.status !== "pending") {
              if (pollRef.current !== null) {
                window.clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setOAuthPolling(false);
              if (sess.status === "success") {
                await refreshAll();
                await runQuotaSync({ accountID: sess.account_id, silent: true });
              }
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            if (pollRef.current !== null) {
              window.clearInterval(pollRef.current);
              pollRef.current = null;
            }
            setOAuthPolling(false);
          }
        })();
      }, 2000);
    },
    [apiRequest, refreshAll, runQuotaSync],
  );

  const onUseAccount = useCallback(
    async (id: string) => {
      setError("");
      try {
        await apiRequest<{ status: string }>(`/v1/accounts/${encodeURIComponent(id)}/activate`, { method: "POST", body: JSON.stringify({}) });
        await refreshAll();
        await runQuotaSync({ accountID: id, silent: true });
        setSyncNotice({ tone: "success", message: `已切换到账号 ${id}` });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [apiRequest, refreshAll, runQuotaSync],
  );

  const onStrategy = useCallback(
    async (strategy: RoutingStrategy) => {
      setError("");
      try {
        await apiRequest<{ status: string }>("/v1/strategy", { method: "PATCH", body: JSON.stringify({ strategy }) });
        await loadStatus();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [apiRequest, loadStatus],
  );

  const onOAuthLogin = useCallback(async () => {
    setError("");
    try {
      const session = await apiRequest<OAuthSession>("/v1/oauth/start", { method: "POST", body: JSON.stringify({ provider: "codex" }) });
      setOAuthSession(session);
      if (session.auth_url) {
        window.open(session.auth_url, "_blank", "noopener,noreferrer");
      }
      startOAuthPolling(session.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiRequest, startOAuthPolling]);

  const onSimulateLimit = useCallback(async () => {
    setSimBusy(true);
    setError("");
    try {
      await apiRequest("/v1/switch/on-error", { method: "POST", body: JSON.stringify({ status_code: 429, error_message: "quota exceeded" }) });
      await refreshAll();
      setSyncNotice({ tone: "warning", message: "已触发限额模拟，请检查账号切换结果" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSimBusy(false);
    }
  }, [apiRequest, refreshAll]);

  const onImportLocalCodexAccount = useCallback(async () => {
    setCodexImportBusy(true);
    setError("");
    try {
      const out = await apiRequest<CodexImportResponse>("/v1/accounts/import/codex", {
        method: "POST",
        body: JSON.stringify({ overwrite_existing: true }),
      });
      importDismissedRef.current = true;
      setCodexImportCandidate(null);
      await refreshAll();
      await runQuotaSync({ accountID: out.account.id, silent: true });
      setSyncNotice({ tone: "success", message: out.action === "updated" ? `已更新本地账号 ${out.account.id}` : `已导入本地账号 ${out.account.id}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCodexImportBusy(false);
    }
  }, [apiRequest, refreshAll, runQuotaSync]);

  const onDismissLocalCodexImport = useCallback(() => {
    importDismissedRef.current = true;
    setCodexImportCandidate(null);
  }, []);

  useEffect(() => {
    const selected = quotaRefreshCadence;
    const matched = selected === "manual" ? null : selected;
    if (!matched) {
      return;
    }
    const intervalMs = { "1min": 60_000, "2min": 120_000, "5min": 300_000, "10min": 600_000, "15min": 900_000 }[matched];
    const timer = window.setInterval(() => {
      void (async () => {
        if (Date.now() < quotaSyncBackoffUntilRef.current) {
          return;
        }
        await runQuotaSyncAll({ silent: true });
      })();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [quotaRefreshCadence, runQuotaSyncAll]);

  const onDaemonCommand = useCallback(
    async (cmd: "start" | "stop" | "restart") => {
      setDaemonBusy(cmd);
      setError("");
      setDaemonOutput("");
      try {
        let output = "";
        if (cmd === "start") {
          output = await invoke<string>("daemon_start", { addr: daemonParams.addr, publicBaseUrl: daemonParams.publicBaseURL });
        } else if (cmd === "stop") {
          output = await invoke<string>("daemon_stop", { addr: daemonParams.addr });
        } else {
          output = await invoke<string>("daemon_restart", { addr: daemonParams.addr, publicBaseUrl: daemonParams.publicBaseURL });
        }
        setDaemonOutput(output);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDaemonBusy("");
        setTimeout(() => {
          void (async () => {
            await refreshAll();
            if (cmd === "start" || cmd === "restart") {
              await runQuotaSync({ silent: true });
            }
          })();
        }, 500);
      }
    },
    [daemonParams.addr, daemonParams.publicBaseURL, refreshAll, runQuotaSync],
  );

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
          onOAuthReauth={() => void onOAuthLogin()}
        />

        <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <OAuthPanel oauthPolling={oauthPolling} oauthUIStatus={oauthUIStatus} oauthSession={oauthSession} onOAuthLogin={() => void onOAuthLogin()} />
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
