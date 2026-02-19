import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const DEFAULT_BASE_URL = "http://127.0.0.1:7777";
const BASE_URL_KEY = "switchly-ui-base-url";

type RoutingStrategy = "round-robin" | "fill-first";

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
  last_applied_at?: string;
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
  const pollRef = useRef<number | null>(null);

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
    void refreshAll();
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
      }
    };
  }, [refreshAll]);

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
    [apiRequest, refreshAll],
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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [apiRequest, refreshAll],
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
    setQuotaSyncBusy(true);
    setError("");
    try {
      await apiRequest("/v1/quota/sync", {
        method: "POST",
        body: JSON.stringify({ account_id: status?.active_account_id ?? "" }),
      });
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setQuotaSyncBusy(false);
    }
  }, [apiRequest, loadStatus, status?.active_account_id]);

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
          void refreshAll();
        }, 500);
      }
    },
    [daemonParams.addr, daemonParams.publicBaseURL, refreshAll],
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
          <button onClick={() => void onSyncQuota()} disabled={quotaSyncBusy}>
            {quotaSyncBusy ? "Syncing Quota..." : "Sync Quota (Auto Warmup)"}
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
                <th>Last Applied</th>
                <th>Access Expiry</th>
                <th>Last Refresh</th>
                <th>Quota</th>
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
                  <td>{fmtTime(acc.last_applied_at)}</td>
                  <td>{fmtTime(acc.access_expires_at)}</td>
                  <td>{fmtTime(acc.last_refresh_at)}</td>
                  <td>
                    <div>
                      S {acc.quota.session.used_percent}% / W {acc.quota.weekly.used_percent}%
                    </div>
                    <small>Updated: {fmtTime(acc.quota.last_updated)}</small>
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
                  <td colSpan={7}>No accounts yet.</td>
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
