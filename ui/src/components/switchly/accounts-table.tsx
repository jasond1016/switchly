import { Play, RotateCcw } from "lucide-react";
import type { CSSProperties } from "react";
import { fmtTime, type Account } from "../../lib/switchly";
import { QuotaCell } from "./quota-cell";

type AccountsTableProps = {
  accounts: Account[];
  activeAccountID?: string;
  nowMs: number;
  onUseAccount: (id: string) => void;
  onOAuthReauth: () => void;
};

function statusPill(status: string, isActive: boolean): { className: string; label: string } {
  if (isActive) {
    return { className: "bg-success/15 text-success border-success/20", label: "活跃" };
  }
  if (status === "need_reauth") {
    return { className: "bg-destructive/15 text-destructive border-destructive/20", label: "需重登" };
  }
  if (status === "disabled") {
    return { className: "bg-muted text-muted-foreground border-border", label: "禁用" };
  }
  return { className: "bg-secondary text-muted-foreground border-border", label: "就绪" };
}

function accountBandClass(status: string, isActive: boolean): string {
  if (isActive) {
    return "from-success/95 via-primary/75 to-primary/20";
  }
  if (status === "need_reauth") {
    return "from-destructive/95 via-destructive/70 to-destructive/15";
  }
  if (status === "disabled") {
    return "from-muted-foreground/80 via-muted-foreground/45 to-transparent";
  }
  return "from-primary/90 via-primary/60 to-primary/10";
}

function statusSummary(accounts: Account[], activeAccountID?: string): { active: number; needsAttention: number } {
  return {
    active: accounts.filter((acc) => acc.id === activeAccountID).length,
    needsAttention: accounts.filter((acc) => acc.status === "need_reauth" || acc.status === "disabled" || acc.quota.limit_reached).length,
  };
}

export function AccountsTable({ accounts, activeAccountID, nowMs, onUseAccount, onOAuthReauth }: AccountsTableProps) {
  const summary = statusSummary(accounts, activeAccountID);

  return (
    <section className="surface-panel mb-4 overflow-hidden rounded-2xl" aria-labelledby="accounts-section-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 px-4 py-3.5">
        <div>
          <p className="section-title mb-1">Accounts</p>
          <h2 id="accounts-section-title" className="text-sm font-semibold text-foreground">
            已接入账号与额度状态
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="chip">{accounts.length} 个账号</span>
          <span className="chip">{summary.active} 个活跃</span>
          <span className={`chip ${summary.needsAttention > 0 ? "border-warning/30 text-[oklch(0.42_0.11_82)]" : ""}`}>
            {summary.needsAttention} 个需关注
          </span>
        </div>
      </div>
      {accounts.length > 0 ? (
        <ul className="accounts-deck p-3 sm:p-4" role="list">
          {accounts.map((acc, index) => {
            const active = acc.id === activeAccountID;
            const badge = statusPill(acc.status, active);
            const bandClass = accountBandClass(acc.status, active);
            const headingId = `account-card-${acc.id}`;

            return (
              <li
                key={acc.id}
                className={`account-card group relative overflow-hidden rounded-[1.5rem] border border-border/80 bg-card px-4 py-4 transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] hover:-translate-y-1 ${
                  active ? "ring-1 ring-primary/20" : ""
                }`}
                style={{ "--i": index } as CSSProperties}
              >
                <div className={`account-band bg-gradient-to-b ${bandClass}`} aria-hidden="true" />
                <article aria-labelledby={headingId} className="account-card-content grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto] xl:items-start">
                  <div className="min-w-0 pr-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="section-title mb-1">Account</p>
                        <h3 id={headingId} className="truncate font-mono text-lg font-semibold tracking-[-0.03em] text-foreground">
                          {acc.id}
                        </h3>
                        <p className="mt-1 truncate text-sm text-muted-foreground">{acc.email || acc.provider}</p>
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.04em] ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>

                    <dl className="mt-4 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                      <div className="rounded-2xl bg-secondary/35 px-3 py-2">
                        <dt className="metric-kicker">访问过期</dt>
                        <dd className="mt-1 font-mono text-xs text-foreground">{fmtTime(acc.access_expires_at)}</dd>
                      </div>
                      <div className="rounded-2xl bg-secondary/35 px-3 py-2">
                        <dt className="metric-kicker">上次刷新</dt>
                        <dd className="mt-1 font-mono text-xs text-foreground">{fmtTime(acc.last_refresh_at)}</dd>
                      </div>
                    </dl>

                    {acc.last_error ? (
                      <div className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/6 px-3 py-2 text-[11px] text-destructive">
                        {acc.last_error}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <QuotaCell
                      label="Session"
                      window={acc.quota.session}
                      nowMs={nowMs}
                      limitReached={acc.quota.limit_reached}
                      supported={acc.quota.session_supported !== false}
                    />
                    <div aria-label="Weekly quota">
                      <QuotaCell label="Weekly" window={acc.quota.weekly} nowMs={nowMs} limitReached={acc.quota.limit_reached} />
                      <div className="mt-2 px-1 text-[10px] font-mono text-muted-foreground">更新于 {fmtTime(acc.quota.last_updated)}</div>
                    </div>
                  </div>

                  <div className="flex min-w-[140px] flex-col items-stretch gap-2 xl:items-end">
                    {active ? (
                      <span className="inline-flex justify-center rounded-full bg-primary/10 px-3 py-2 text-[11px] font-medium text-primary">当前使用中</span>
                    ) : (
                      <button
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-[11px] font-medium transition hover:bg-accent"
                        onClick={() => onUseAccount(acc.id)}
                      >
                        <Play className="size-3" />
                        使用
                      </button>
                    )}
                    {acc.status === "need_reauth" || acc.status === "disabled" ? (
                      <button
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-[11px] font-medium transition hover:bg-accent"
                        onClick={onOAuthReauth}
                      >
                        <RotateCcw className="size-3" />
                        重新授权
                      </button>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-4 py-10 text-center">
          <div className="mx-auto max-w-sm">
            <p className="text-sm font-medium text-foreground">No accounts yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">先通过 OAuth 或导入本地 Codex 登录，把第一个账号接入到当前工作台。</p>
          </div>
        </div>
      )}
    </section>
  );
}
