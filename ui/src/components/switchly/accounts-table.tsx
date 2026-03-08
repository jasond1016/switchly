import { Play, RotateCcw } from "lucide-react";
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

export function AccountsTable({ accounts, activeAccountID, nowMs, onUseAccount, onOAuthReauth }: AccountsTableProps) {
  return (
    <section className="surface-panel mb-4 overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 px-4 py-3.5">
        <div>
          <p className="section-title mb-1">Accounts</p>
          <h2 className="text-sm font-semibold text-foreground">已接入账号与额度状态</h2>
        </div>
        <p className="text-xs text-muted-foreground">切换、重登和额度观察都集中在这里完成。</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-secondary/35">
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">ID</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">状态</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">访问过期</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">上次刷新</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Session Quota</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Weekly Quota</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((acc) => {
              const active = acc.id === activeAccountID;
              const badge = statusPill(acc.status, active);
              return (
                <tr key={acc.id} className={`border-b border-border/70 transition-colors ${active ? "bg-primary/6" : "hover:bg-secondary/30"}`}>
                  <td className="px-4 py-3.5 align-top">
                    <div className="font-mono text-sm text-foreground">{acc.id}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{acc.email || acc.provider}</div>
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.04em] ${badge.className}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 align-top font-mono text-xs text-muted-foreground">{fmtTime(acc.access_expires_at)}</td>
                  <td className="px-4 py-3.5 align-top font-mono text-xs text-muted-foreground">{fmtTime(acc.last_refresh_at)}</td>
                  <td className="px-4 py-3.5 align-top">
                    <QuotaCell
                      label="Session"
                      window={acc.quota.session}
                      nowMs={nowMs}
                      limitReached={acc.quota.limit_reached}
                      supported={acc.quota.session_supported !== false}
                    />
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <QuotaCell label="Weekly" window={acc.quota.weekly} nowMs={nowMs} limitReached={acc.quota.limit_reached} />
                    <div className="mt-1 text-[10px] text-muted-foreground">更新于 {fmtTime(acc.quota.last_updated)}</div>
                  </td>
                  <td className="px-4 py-3.5 align-top text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {active ? (
                        <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">当前使用中</span>
                      ) : (
                        <button
                          className="inline-flex h-8 items-center gap-1 rounded-xl border border-border bg-card px-3 text-[11px] transition hover:bg-accent"
                          onClick={() => onUseAccount(acc.id)}
                        >
                          <Play className="size-3" />
                          使用
                        </button>
                      )}
                      {acc.status === "need_reauth" || acc.status === "disabled" ? (
                        <button
                          className="inline-flex h-8 items-center gap-1 rounded-xl border border-border bg-card px-3 text-[11px] transition hover:bg-accent"
                          onClick={onOAuthReauth}
                        >
                          <RotateCcw className="size-3" />
                          重新授权
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <div className="mx-auto max-w-sm">
                    <p className="text-sm font-medium text-foreground">No accounts yet.</p>
                    <p className="mt-1 text-sm text-muted-foreground">先通过 OAuth 或导入本地 Codex 登录，把第一个账号接入到当前工作台。</p>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
