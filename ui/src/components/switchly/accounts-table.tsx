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
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">ID</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">状态</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">访问过期</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">上次刷新</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Session Quota</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Weekly Quota</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((acc) => {
              const active = acc.id === activeAccountID;
              const badge = statusPill(acc.status, active);
              return (
                <tr key={acc.id} className={`border-b border-border ${active ? "bg-primary/5" : ""}`}>
                  <td className="px-3 py-3 align-top">
                    <div className="font-mono text-xs text-foreground">{acc.id}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{acc.email || acc.provider}</div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] ${badge.className}`}>{badge.label}</span>
                  </td>
                  <td className="px-3 py-3 align-top font-mono text-xs text-muted-foreground">{fmtTime(acc.access_expires_at)}</td>
                  <td className="px-3 py-3 align-top font-mono text-xs text-muted-foreground">{fmtTime(acc.last_refresh_at)}</td>
                  <td className="px-3 py-3 align-top">
                    <QuotaCell
                      label="Session"
                      window={acc.quota.session}
                      nowMs={nowMs}
                      limitReached={acc.quota.limit_reached}
                      supported={acc.quota.session_supported !== false}
                    />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <QuotaCell label="Weekly" window={acc.quota.weekly} nowMs={nowMs} limitReached={acc.quota.limit_reached} />
                    <div className="mt-1 text-[10px] text-muted-foreground">更新于 {fmtTime(acc.quota.last_updated)}</div>
                  </td>
                  <td className="px-3 py-3 align-top text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {active ? (
                        <span className="text-[11px] font-medium text-primary">当前使用中</span>
                      ) : (
                        <button
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[11px] transition hover:bg-accent"
                          onClick={() => onUseAccount(acc.id)}
                        >
                          <Play className="size-3" />
                          使用
                        </button>
                      )}
                      {acc.status === "need_reauth" || acc.status === "disabled" ? (
                        <button
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[11px] transition hover:bg-accent"
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
                <td colSpan={7} className="px-3 py-5 text-center text-sm text-muted-foreground">
                  No accounts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
