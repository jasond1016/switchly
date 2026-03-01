export type RoutingStrategy = "round-robin" | "fill-first";
export type RefreshCadence = "manual" | "1min" | "2min" | "5min" | "10min" | "15min";
export type OAuthUIStatus = "idle" | "pending" | "success" | "error";
export type SyncTone = "info" | "success" | "warning" | "error";
export type SwitchlyRequestInit = RequestInit & { timeoutMs?: number };
export type ApiRequest = <T>(path: string, init?: SwitchlyRequestInit) => Promise<T>;

export type QuotaWindow = {
  used_percent: number;
  reset_at?: string;
};

export type QuotaSnapshot = {
  session: QuotaWindow;
  weekly: QuotaWindow;
  session_supported?: boolean;
  limit_reached: boolean;
  last_updated?: string;
};

export type Account = {
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

export type StatusSnapshot = {
  active_account_id?: string;
  strategy: RoutingStrategy;
  accounts: Account[];
};

export type QuotaSyncAllResponse = {
  total: number;
  succeeded: number;
  failed: number;
};

export type OAuthSession = {
  state: string;
  provider: string;
  status: "pending" | "success" | "error" | "expired";
  auth_url?: string;
  account_id?: string;
  error?: string;
  expires_at: string;
};

export type DaemonInfo = {
  pid: number;
  addr: string;
  public_base_url: string;
  restart_supported: boolean;
  default_restart_cmd?: string;
};

export type CodexImportCandidate = {
  id: string;
  provider: string;
  email?: string;
  account_id_present: boolean;
};

export type CodexImportCandidateResponse = {
  found: boolean;
  candidate?: CodexImportCandidate;
  already_exists?: boolean;
  needs_import: boolean;
};

export type CodexImportResponse = {
  status: "ok";
  action: "created" | "updated";
  account: Account;
};

export type SyncNotice = {
  tone: SyncTone;
  message: string;
};

export const REFRESH_CADENCE_OPTIONS: Array<{ value: RefreshCadence; label: string; intervalMs: number | null }> = [
  { value: "manual", label: "手动", intervalMs: null },
  { value: "1min", label: "1 分钟", intervalMs: 60_000 },
  { value: "2min", label: "2 分钟", intervalMs: 120_000 },
  { value: "5min", label: "5 分钟", intervalMs: 300_000 },
  { value: "10min", label: "10 分钟", intervalMs: 600_000 },
  { value: "15min", label: "15 分钟", intervalMs: 900_000 },
];

export function isRefreshCadence(value: string | null): value is RefreshCadence {
  return REFRESH_CADENCE_OPTIONS.some((x) => x.value === value);
}

export function getCadenceIntervalMs(cadence: RefreshCadence): number | null {
  return REFRESH_CADENCE_OPTIONS.find((x) => x.value === cadence)?.intervalMs ?? null;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isZeroTime(value?: string): boolean {
  return !value || value.startsWith("0001-01-01T00:00:00Z");
}

export function fmtTime(value?: string): string {
  if (isZeroTime(value)) {
    return "-";
  }
  const d = new Date(value ?? "");
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function remainingPercent(usedPercent: number): number {
  return clampPercent(100 - clampPercent(usedPercent));
}

export function fmtResetHint(value: string | undefined, nowMs: number): string {
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

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function fmtResetExactUTC(value: string | undefined): string | undefined {
  if (isZeroTime(value)) {
    return undefined;
  }
  const d = new Date(value ?? "");
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const min = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `重置时间 ${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} UTC`;
}

export function deriveDaemonParams(baseURL: string): { addr: string; publicBaseURL: string } {
  try {
    const parsed = new URL(baseURL);
    const hostname = parsed.hostname || "127.0.0.1";
    const port = parsed.port || "7777";
    return { addr: `${hostname}:${port}`, publicBaseURL: `http://localhost:${port}` };
  } catch {
    return { addr: "127.0.0.1:7777", publicBaseURL: "http://localhost:7777" };
  }
}

export function toneClass(tone: SyncTone): string {
  if (tone === "success") {
    return "border-success/30 bg-success/5 text-success";
  }
  if (tone === "warning") {
    return "border-warning/30 bg-warning/10 text-yellow-700";
  }
  if (tone === "error") {
    return "border-destructive/30 bg-destructive/5 text-destructive";
  }
  return "border-border bg-secondary text-muted-foreground";
}

export function oauthStatus(session: OAuthSession | null): OAuthUIStatus {
  if (!session) {
    return "idle";
  }
  if (session.status === "pending") {
    return "pending";
  }
  if (session.status === "success") {
    return "success";
  }
  return "error";
}

export function oauthText(status: OAuthUIStatus): string {
  if (status === "pending") {
    return "等待回调中...";
  }
  if (status === "success") {
    return "授权成功";
  }
  if (status === "error") {
    return "授权失败";
  }
  return "等待操作";
}
