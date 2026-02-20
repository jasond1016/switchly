import { CheckCircle2, Clock, Globe, Loader2, XCircle } from "lucide-react";
import { oauthText, type OAuthSession, type OAuthUIStatus } from "../../lib/switchly";

type OAuthPanelProps = {
  oauthPolling: boolean;
  oauthUIStatus: OAuthUIStatus;
  oauthSession: OAuthSession | null;
  onOAuthLogin: () => void;
};

export function OAuthPanel({ oauthPolling, oauthUIStatus, oauthSession, onOAuthLogin }: OAuthPanelProps) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Globe className="size-4 text-primary" />
          OAuth 授权
        </h2>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <button
          onClick={onOAuthLogin}
          disabled={oauthPolling}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {oauthPolling ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
          通过浏览器登录
        </button>

        <div
          className={`flex items-center gap-2 rounded-md border p-3 ${
            oauthUIStatus === "success"
              ? "border-success/30 bg-success/5"
              : oauthUIStatus === "error"
                ? "border-destructive/30 bg-destructive/5"
                : oauthUIStatus === "pending"
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-secondary/50"
          }`}
        >
          {oauthUIStatus === "success" ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : oauthUIStatus === "error" ? (
            <XCircle className="size-4 text-destructive" />
          ) : oauthUIStatus === "pending" ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : (
            <Clock className="size-4 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">Callback 状态</p>
            <p className="text-xs text-muted-foreground">{oauthText(oauthUIStatus)}</p>
          </div>
        </div>

        {oauthSession ? (
          <pre className="max-h-[220px] overflow-auto rounded-md border border-border bg-secondary/60 p-3 font-mono text-[11px] text-muted-foreground">
            {JSON.stringify(oauthSession, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
