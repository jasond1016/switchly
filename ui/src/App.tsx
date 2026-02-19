import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const DEFAULT_BASE_URL = "http://127.0.0.1:7777";
const BASE_URL_KEY = "switchly-ui-base-url";
const QUOTA_REFRESH_CADENCE_KEY = "switchly-ui-quota-refresh-cadence";

type RoutingStrategy = "round-robin" | "fill-first";
type RefreshCadence = "manual" | "1min" | "2min" | "5min" | "10min" | "15min";

type QuotaWindow = {
  used_percent: number;
  reset_at?: string;
};

type QuotaSnapshot = {
  session: QuotaWindow;
  weekly: QuotaWindow;
  limit_reached: boolean;
  last_updated?: string;
};

type Account = {
  id: string;
  provider: string;
  email?: string;
  status: string;
  access_expires_at?: string;
  refresh_expires_at?: string;
  last_refresh_at?: string;
  last_error?: string;
  quota: QuotaSnapshot;
  created_at: string;
  updated_at: string;
};

type StatusSnapshot = {
  active_account_id?: string;
  strategy: RoutingStrategy;
  accounts: Account[];
};

type QuotaSyncAllResponse = {
  total: number;
  succeeded: number;
  failed: number;
};

type OAuthSession = {
  state: string;
  provider: string;
  status: "pending" | "success" | "error" | "expired";
  auth_url?: string;
  account_id?: string;
  error?: string;
  expires_at: string;
};

type DaemonInfo = {
  pid: number;
  addr: string;
  public_base_url: string;
  restart_supported: boolean;
  default_restart_cmd?: string;
};

type QuotaTone = "good" | "warn" | "danger";

const REFRESH_CADENCE_OPTIONS: Array<{ value: RefreshCadence; label: string; intervalMs: number | null }> = [
  { value: "manual", label: "Manual", intervalMs: null },
  { value: "1min", label: "1 min", intervalMs: 60_000 },
  { value: "2min", label: "2 min", intervalMs: 120_000 },
  { value: "5min", label: "5 min", intervalMs: 300_000 },
  { value: "10min", label: "10 min", intervalMs: 600_000 },
  { value: "15min", label: "15 min", intervalMs: 900_000 },
];

function isRefreshCadence(value: string | null): value is RefreshCadence {
  return REFRESH_CADENCE_OPTIONS.some((item) => item.value === value);
}

function isZeroTime(value?: string): boolean {
  if (!value) {
    return true;
  }
  return value.startsWith("0001-01-01T00:00:00Z");
}

function fmtTime(value?: string): string {
  if (isZeroTime(value)) {
    return "-";
  }
  const d = new Date(value ?? "");
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return d.toLocaleString();
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const rounded = Math.round(value);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 100) {
    return 100;
  }
  return rounded;
}

function remainingPercent(usedPercent: number): number {
  return clampPercent(100 - clampPercent(usedPercent));
}

function toneFromRemaining(remaining: number): QuotaTone {
  if (remaining >= 60) {
    return "good";
  }
  if (remaining >= 30) {
    return "warn";
  }
  return "danger";
}

function fmtResetHint(value: string | undefined, nowMs: number): string {
  if (isZeroTime(value)) {
    return "重置时间未获取";
  }
  const d = new Date(value ?? "");
  if (Number.isNaN(d.getTime())) {
    return "重置时间未获取";
  }

  const delta = d.getTime() - nowMs;
  if (delta <= 0) {
    return "即将重置";
  }

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < hour) {
    return `${Math.max(1, Math.ceil(delta / minute))}分钟后`;
  }
  if (delta < day) {
    return `${Math.ceil(delta / hour)}小时后`;
  }
  return `${Math.ceil(delta / day)}天后`;
}

function deriveDaemonParams(baseURL: string): { addr: string; publicBaseURL: string } {
  try {
    const parsed = new URL(baseURL);
    const hostname = parsed.hostname || "127.0.0.1";
    const port = parsed.port || "7777";
    return {
      addr: `${hostname}:${port}`,
      publicBaseURL: `http://localhost:${port}`,
    };
  } catch {
    return { addr: "127.0.0.1:7777", publicBaseURL: "http://localhost:7777" };
  }
}

function App() {
  const [baseURL, setBaseURL] = useState<string>(() => {
    return localStorage.getItem(BASE_URL_KEY) ?? DEFAULT_BASE_URL;
  });
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [daemonInfo, setDaemonInfo] = useState<DaemonInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [oauthSession, setOAuthSession] = useState<OAuthSession | null>(null);
  const [oauthPolling, setOAuthPolling] = useState(false);
  const [daemonBusy, setDaemonBusy] = useState<"start" | "stop" | "restart" | "">("");
  const [daemonOutput, setDaemonOutput] = useState("");
  const [simBusy, setSimBusy] = useState(false);
  const [quotaSyncBusy, setQuotaSyncBusy] = useState(false);
  const [quotaSyncAllBusy, setQuotaSyncAllBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [quotaRefreshCadence, setQuotaRefreshCadence] = useState<RefreshCadence>(() => {
    const raw = localStorage.getItem(QUOTA_REFRESH_CADENCE_KEY);
    if (isRefreshCadence(raw)) {
      return raw;
    }
    return "10min";
  });
  const pollRef = useRef<number | null>(null);
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
    const info = await apiRequest<DaemonInfo>("/v1/daemon/info");
    setDaemonInfo(info);
  }, [apiRequest]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadStatus(), loadDaemonInfo()]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [loadDaemonInfo, loadStatus]);

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
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
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
      }

      try {
        await apiRequest("/v1/quota/sync", {
          method: "POST",
          body: JSON.stringify({ account_id: accountID }),
        });
        await loadStatus();
        quotaSyncFailureCountRef.current = 0;
        quotaSyncBackoffUntilRef.current = 0;
        return true;
      } catch (e) {
        quotaSyncFailureCountRef.current += 1;
        const backoffMinutes = Math.min(15, 2 ** (quotaSyncFailureCountRef.current - 1));
        quotaSyncBackoffUntilRef.current = Date.now() + backoffMinutes * 60_000;
        if (!opts?.silent) {
          setError(e instanceof Error ? e.message : String(e));
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
            const message = e instanceof Error ? e.message : String(e);
            setError(message);
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
        await apiRequest<{ status: string }>(`/v1/accounts/${encodeURIComponent(id)}/activate`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        await refreshAll();
        await runQuotaSync({ accountID: id, silent: true });
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
        await apiRequest<{ status: string }>("/v1/strategy", {
          method: "PATCH",
          body: JSON.stringify({ strategy }),
        });
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
      const session = await apiRequest<OAuthSession>("/v1/oauth/start", {
        method: "POST",
        body: JSON.stringify({ provider: "codex" }),
      });
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
      await apiRequest("/v1/switch/on-error", {
        method: "POST",
        body: JSON.stringify({
          status_code: 429,
          error_message: "quota exceeded",
        }),
      });
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSimBusy(false);
    }
  }, [apiRequest, refreshAll]);

  const onSyncQuota = useCallback(async () => {
    await runQuotaSync({ showBusy: true, silent: false });
  }, [runQuotaSync]);

  const onSyncQuotaAll = useCallback(async () => {
    if (quotaSyncInFlightRef.current) {
      return;
    }
    quotaSyncInFlightRef.current = true;
    setQuotaSyncAllBusy(true);
    setError("");
    try {
      const out = await apiRequest<QuotaSyncAllResponse>("/v1/quota/sync-all", {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadStatus();
      quotaSyncFailureCountRef.current = out.failed > 0 ? quotaSyncFailureCountRef.current : 0;
      quotaSyncBackoffUntilRef.current = 0;
      if (out.failed > 0) {
        setError(`Quota sync-all finished: ${out.succeeded} succeeded, ${out.failed} failed.`);
      }
    } catch (e) {
      quotaSyncFailureCountRef.current += 1;
      const backoffMinutes = Math.min(15, 2 ** (quotaSyncFailureCountRef.current - 1));
      quotaSyncBackoffUntilRef.current = Date.now() + backoffMinutes * 60_000;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      quotaSyncInFlightRef.current = false;
      setQuotaSyncAllBusy(false);
    }
  }, [apiRequest, loadStatus]);

  useEffect(() => {
    const selected = REFRESH_CADENCE_OPTIONS.find((item) => item.value === quotaRefreshCadence);
    if (!selected || selected.intervalMs === null) {
      return;
    }

    const timer = window.setInterval(() => {
      void (async () => {
        if (Date.now() < quotaSyncBackoffUntilRef.current) {
          return;
        }
        await runQuotaSync({ silent: true });
      })();
    }, selected.intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [quotaRefreshCadence, runQuotaSync]);

  const onDaemonCommand = useCallback(
    async (cmd: "start" | "stop" | "restart") => {
      setDaemonBusy(cmd);
      setError("");
      setDaemonOutput("");
      try {
        let output = "";
        if (cmd === "start") {
          output = await invoke<string>("daemon_start", {
            addr: daemonParams.addr,
            publicBaseUrl: daemonParams.publicBaseURL,
          });
        } else if (cmd === "stop") {
          output = await invoke<string>("daemon_stop", {
            addr: daemonParams.addr,
          });
        } else {
          output = await invoke<string>("daemon_restart", {
            addr: daemonParams.addr,
            publicBaseUrl: daemonParams.publicBaseURL,
          });
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Switchly Control</h1>
          <p>Windows-first local account switcher for Codex CLI.</p>
        </div>
        <div className="topbar-actions">
          <label>
            Base URL
            <input value={baseURL} onChange={(e) => setBaseURL(e.currentTarget.value)} />
          </label>
          <button onClick={() => void refreshAll()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <section className="panel">
        <h2>Dashboard</h2>
        <div className="stats-grid">
          <article>
            <span>Active Account</span>
            <strong>{status?.active_account_id ?? "-"}</strong>
          </article>
          <article>
            <span>Strategy</span>
            <strong>{status?.strategy ?? "-"}</strong>
          </article>
          <article>
            <span>Accounts</span>
            <strong>{status?.accounts.length ?? 0}</strong>
          </article>
          <article>
            <span>Daemon</span>
            <strong>{daemonInfo ? `PID ${daemonInfo.pid}` : "Unavailable"}</strong>
          </article>
        </div>
        <div className="inline-actions">
          <button onClick={() => void onStrategy("round-robin")}>Round-robin</button>
          <button onClick={() => void onStrategy("fill-first")}>Fill-first</button>
          <label>
            Quota Auto-refresh
            <select
              value={quotaRefreshCadence}
              onChange={(e) => setQuotaRefreshCadence(e.currentTarget.value as RefreshCadence)}
            >
              {REFRESH_CADENCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void onSyncQuota()} disabled={quotaSyncBusy || quotaSyncAllBusy}>
            {quotaSyncBusy ? "Syncing Quota..." : "Sync Quota (OpenAI API)"}
          </button>
          <button onClick={() => void onSyncQuotaAll()} disabled={quotaSyncBusy || quotaSyncAllBusy}>
            {quotaSyncAllBusy ? "Syncing All..." : "Sync All Quotas"}
          </button>
          <button onClick={() => void onSimulateLimit()} disabled={simBusy}>
            {simBusy ? "Switching..." : "Simulate Limit Error"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Accounts</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Access Expiry</th>
                <th>Last Refresh</th>
                <th>Quota (Remaining)</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {status?.accounts.map((acc) => (
                <tr key={acc.id}>
                  <td>
                    <div className="account-title">
                      <strong>{acc.id}</strong>
                      <small>{acc.email || acc.provider}</small>
                    </div>
                  </td>
                  <td>{acc.status}</td>
                  <td>{fmtTime(acc.access_expires_at)}</td>
                  <td>{fmtTime(acc.last_refresh_at)}</td>
                  <td className="quota-cell">
                    <div className="quota-grid">
                      {[
                        { name: "Session Quota", window: acc.quota.session },
                        { name: "Weekly Quota", window: acc.quota.weekly },
                      ].map((item) => {
                        const used = clampPercent(item.window.used_percent);
                        const remaining = remainingPercent(used);
                        const tone = toneFromRemaining(remaining);
                        return (
                          <div key={item.name} className="quota-item">
                            <div className="quota-item-head">
                              <span className="quota-item-name">{item.name}</span>
                              <strong className={`quota-item-remaining tone-${tone}`}>剩余 {remaining}%</strong>
                            </div>
                            <div className="quota-track">
                              <div className={`quota-fill tone-${tone}`} style={{ width: `${remaining}%` }} />
                            </div>
                            <div className="quota-item-meta">
                              <span>已用 {used}%</span>
                              <span>重置于 {fmtResetHint(item.window.reset_at, nowMs)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {acc.quota.limit_reached && <div className="quota-limit">额度已用尽，请切换账号或等待重置</div>}
                    <small className="quota-updated">Last updated: {fmtTime(acc.quota.last_updated)}</small>
                  </td>
                  <td>
                    <button
                      className={acc.id === status.active_account_id ? "active-btn" : ""}
                      onClick={() => void onUseAccount(acc.id)}
                    >
                      {acc.id === status?.active_account_id ? "Re-apply" : "Use"}
                    </button>
                  </td>
                </tr>
              ))}
              {(!status || status.accounts.length === 0) && (
                <tr>
                  <td colSpan={6}>No accounts yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel two-col">
        <div>
          <h2>OAuth Login</h2>
          <p>Start browser login for provider `codex` and poll callback status.</p>
          <div className="inline-actions">
            <button onClick={() => void onOAuthLogin()} disabled={oauthPolling}>
              {oauthPolling ? "Waiting callback..." : "Login with Browser"}
            </button>
          </div>
          {oauthSession && (
            <pre className="json-box">{JSON.stringify(oauthSession, null, 2)}</pre>
          )}
        </div>
        <div>
          <h2>Daemon</h2>
          <p>
            Addr: <code>{daemonParams.addr}</code>
          </p>
          <p>
            Public callback base: <code>{daemonParams.publicBaseURL}</code>
          </p>
          <div className="inline-actions">
            <button disabled={daemonBusy !== ""} onClick={() => void onDaemonCommand("start")}>
              {daemonBusy === "start" ? "Starting..." : "Start"}
            </button>
            <button disabled={daemonBusy !== ""} onClick={() => void onDaemonCommand("stop")}>
              {daemonBusy === "stop" ? "Stopping..." : "Stop"}
            </button>
            <button disabled={daemonBusy !== ""} onClick={() => void onDaemonCommand("restart")}>
              {daemonBusy === "restart" ? "Restarting..." : "Restart"}
            </button>
          </div>
          {daemonInfo && <pre className="json-box">{JSON.stringify(daemonInfo, null, 2)}</pre>}
          {daemonOutput && (
            <>
              <h3>Command Output</h3>
              <pre className="json-box">{daemonOutput}</pre>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;

