import { CheckCircle2, ChevronDown, Globe, Loader2, Play, RefreshCcw, RotateCcw, Square, Trash2, XCircle } from "lucide-react";
import { fmtTime, oauthText, REFRESH_CADENCE_OPTIONS, type Account, type OAuthSession, type OAuthUIStatus, type RefreshCadence, type SyncNotice, toneClass } from "../../lib/switchly";
import { QuotaCell } from "./quota-cell";

type AccountsTableProps = {
  accounts: Account[];
  activeAccountID?: string;
  nowMs: number;
  quotaRefreshCadence: RefreshCadence;
  quotaSyncAllBusy: boolean;
  syncNotice: SyncNotice | null;
  error: string;
  oauthPolling: boolean;
  oauthUIStatus: OAuthUIStatus;
  oauthSession: OAuthSession | null;
  onQuotaRefreshCadenceChange: (value: RefreshCadence) => void;
  onSyncQuotaAll: () => void;
  onOAuthLogin: () => void;
  onOAuthCancel: () => void;
  onUseAccount: (id: string) => void;
  onDeleteAccount: (id: string) => void;
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

export function AccountsTable({
  accounts,
  activeAccountID,
  nowMs,
  quotaRefreshCadence,
  quotaSyncAllBusy,
  syncNotice,
  error,
  oauthPolling,
  oauthUIStatus,
  oauthSession,
  onQuotaRefreshCadenceChange,
  onSyncQuotaAll,
  onOAuthLogin,
  onOAuthCancel,
  onUseAccount,
  onDeleteAccount,
  onOAuthReauth,
}: AccountsTableProps) {
  const oauthToneClass =
    oauthUIStatus === "success"
      ? "border-success/30 bg-success/5 text-success"
      : oauthUIStatus === "error"
        ? "border-destructive/30 bg-destructive/5 text-destructive"
        : oauthUIStatus === "pending"
          ? "border-primary/20 bg-primary/5 text-primary"
          : "border-border bg-secondary/50 text-muted-foreground";
  const oauthMessage =
    oauthUIStatus === "error"
      ? oauthSession?.error || oauthText(oauthUIStatus)
      : oauthUIStatus === "success"
        ? "授权完成，可以继续追加其他账号。"
        : oauthUIStatus === "pending"
          ? "浏览器已打开，等待 OAuth 回调。"
          : "";

  return (
    <section className="surface-panel mb-4 overflow-hidden rounded-2xl" aria-labelledby="accounts-section-title">
      <div className="border-b border-border/80 px-4 py-3.5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="section-title mb-1">Accounts</p>
            <h2 id="accounts-section-title" className="text-sm font-semibold text-foreground">
              已接入账号与额度状态
            </h2>
          </div>
          <div className="flex flex-col gap-2 xl:items-end">
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="section-title whitespace-nowrap">Auto Refresh</span>
                <span className="relative">
                  <select
                    className="field-shell h-9 appearance-none rounded-xl px-3 pr-8 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/35"
                    value={quotaRefreshCadence}
                    onChange={(e) => onQuotaRefreshCadenceChange(e.currentTarget.value as RefreshCadence)}
                  >
                    {REFRESH_CADENCE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </span>
              </label>
              <button
                onClick={onSyncQuotaAll}
                disabled={quotaSyncAllBusy}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-primary/20 bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {quotaSyncAllBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
                Sync All Quotas
              </button>
              <button
                onClick={onOAuthLogin}
                disabled={oauthPolling}
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  oauthUIStatus === "success"
                    ? "border-success/20 bg-success/12 text-success hover:bg-success/18"
                    : oauthUIStatus === "error"
                      ? "border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/15"
                      : "border-border bg-card text-foreground hover:bg-accent"
                }`}
              >
                {oauthPolling ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : oauthUIStatus === "success" ? (
                  <CheckCircle2 className="size-3.5" />
                ) : oauthUIStatus === "error" ? (
                  <XCircle className="size-3.5" />
                ) : (
                  <Globe className="size-3.5" />
                )}
                {oauthPolling ? "等待回调中" : oauthUIStatus === "success" ? "追加成功" : oauthUIStatus === "error" ? "重试追加" : "追加账号"}
              </button>
              {oauthPolling ? (
                <button
                  onClick={onOAuthCancel}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-medium text-foreground transition hover:bg-accent"
                >
                  <Square className="size-3.5" />
                  取消
                </button>
              ) : null}
            </div>
            {oauthMessage ? <div className={`max-w-[28rem] rounded-xl border px-3 py-2 text-xs ${oauthToneClass}`}>{oauthMessage}</div> : null}
            {syncNotice ? <div className={`rounded-xl border px-3 py-2 text-xs font-mono ${toneClass(syncNotice.tone)}`}>{syncNotice.message}</div> : null}
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div> : null}
          </div>
        </div>
      </div>
      {accounts.length > 0 ? (
        <div className="overflow-x-auto px-3 py-3 sm:px-4 sm:py-4">
          <table className="min-w-[960px] w-full table-fixed border-separate border-spacing-0">
            <caption className="sr-only">已接入账号与额度状态</caption>
            <colgroup>
              <col className="w-[40%]" />
              <col className="w-[14%]" />
              <col className="w-[34%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="bg-secondary/35 text-left">
                <th scope="col" className="rounded-l-2xl border-y border-l border-border/70 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  账号
                </th>
                <th scope="col" className="border-y border-border/70 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  状态
                </th>
                <th scope="col" className="border-y border-border/70 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  额度
                </th>
                <th scope="col" className="rounded-r-2xl border-y border-r border-border/70 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
          {accounts.map((acc) => {
            const active = acc.id === activeAccountID;
            const badge = statusPill(acc.status, active);
            const headingId = `account-card-${acc.id}`;
            const errorTooltipId = `account-error-${acc.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
            const accountMetaTitle = [
              `访问过期: ${fmtTime(acc.access_expires_at)}`,
              `上次刷新: ${fmtTime(acc.last_refresh_at)}`,
              `额度更新: ${fmtTime(acc.quota.last_updated)}`,
            ].join("\n");
            const deleteMessage = active
              ? `确认删除当前使用中的账号 ${acc.id} 吗？如果没有可切换账号，删除后当前将没有活跃账号。`
              : `确认删除账号 ${acc.id} 吗？`;

            return (
              <tr
                key={acc.id}
                className={`align-top transition-colors ${active ? "bg-primary/5" : "hover:bg-secondary/20"}`}
              >
                <td className={`border-b border-border/70 px-4 py-3 align-top ${active ? "border-l-4 border-l-primary" : ""}`} title={accountMetaTitle}>
                  <div className="min-w-0">
                    <h3 id={headingId} className="truncate font-mono text-sm font-semibold tracking-[-0.03em] text-foreground">
                      {acc.id}
                    </h3>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{acc.email || acc.provider}</p>
                  </div>
                </td>
                <td className="border-b border-border/70 px-4 py-3 align-top">
                  <div className="space-y-2">
                    <div className="group/tooltip relative inline-flex">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.04em] ${
                          acc.last_error ? `${badge.className} cursor-help` : badge.className
                        }`}
                        tabIndex={acc.last_error ? 0 : undefined}
                        aria-describedby={acc.last_error ? errorTooltipId : undefined}
                      >
                        {badge.label}
                      </span>
                      {acc.last_error ? (
                        <div
                          id={errorTooltipId}
                          role="tooltip"
                          className="pointer-events-none absolute top-full left-0 z-20 mt-2 hidden w-[22rem] max-w-[min(24rem,calc(100vw-4rem))] rounded-xl border border-destructive/20 bg-popover px-3 py-2 text-[11px] leading-5 text-destructive shadow-lg whitespace-pre-wrap break-words group-hover/tooltip:block group-focus-within/tooltip:block"
                        >
                          {acc.last_error}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="border-b border-border/70 px-4 py-3 align-top">
                  <div
                    aria-label="Quota summary"
                    className="min-w-0 rounded-2xl border border-border/70 bg-secondary/26 px-3 py-2"
                    title={`额度更新: ${fmtTime(acc.quota.last_updated)}`}
                  >
                    <QuotaCell
                      label="Session"
                      window={acc.quota.session}
                      nowMs={nowMs}
                      limitReached={acc.quota.limit_reached}
                      supported={acc.quota.session_supported !== false}
                      embedded
                    />
                    <div className="my-1 h-px bg-border/70" aria-hidden="true" />
                    <QuotaCell label="Weekly" window={acc.quota.weekly} nowMs={nowMs} limitReached={acc.quota.limit_reached} embedded />
                  </div>
                </td>
                <td className="border-b border-border/70 px-4 py-3 align-top">
                  <div className="flex min-w-[88px] flex-col items-start gap-2 whitespace-nowrap">
                    {active ? (
                      <span className="inline-flex h-8 items-center justify-center rounded-lg bg-primary/10 px-2.5 text-[10px] font-medium text-primary">当前使用中</span>
                    ) : (
                      <button
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border bg-card px-2.5 text-[10px] font-medium transition hover:bg-accent"
                        onClick={() => onUseAccount(acc.id)}
                      >
                        <Play className="size-2.5" />
                        使用
                      </button>
                    )}
                    {acc.status === "need_reauth" || acc.status === "disabled" ? (
                      <button
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border bg-card px-2.5 text-[10px] font-medium transition hover:bg-accent"
                        onClick={onOAuthReauth}
                      >
                        <RotateCcw className="size-2.5" />
                        重新授权
                      </button>
                    ) : null}
                    <button
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 text-[10px] font-medium text-destructive transition hover:bg-destructive/10"
                      onClick={() => {
                        const confirmed = typeof window === "undefined" ? true : window.confirm(deleteMessage);
                        if (!confirmed) {
                          return;
                        }
                        onDeleteAccount(acc.id);
                      }}
                    >
                      <Trash2 className="size-2.5" />
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
            </tbody>
          </table>
        </div>
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
