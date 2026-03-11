import { AlertTriangle } from "lucide-react";
import { clampPercent, fmtResetExactUTC, fmtResetHint, remainingPercent, type QuotaWindow } from "../../lib/switchly";

type QuotaCellProps = {
  label: string;
  window: QuotaWindow;
  nowMs: number;
  limitReached: boolean;
  supported?: boolean;
  embedded?: boolean;
};

function quotaTone(remaining: number): {
  badgeClass: string;
  fillClass: string;
  softFillClass: string;
  textClass: string;
  label: string;
} {
  if (remaining >= 60) {
    return {
      badgeClass: "bg-success/12 text-success border-success/20",
      fillClass: "bg-success",
      softFillClass: "bg-success/18",
      textClass: "text-success",
      label: "余量充足",
    };
  }
  if (remaining >= 30) {
    return {
      badgeClass: "bg-warning/14 text-[oklch(0.42_0.11_82)] border-warning/25",
      fillClass: "bg-warning",
      softFillClass: "bg-warning/20",
      textClass: "text-[oklch(0.42_0.11_82)]",
      label: "需要关注",
    };
  }
  return {
    badgeClass: "bg-destructive/12 text-destructive border-destructive/20",
    fillClass: "bg-destructive",
    softFillClass: "bg-destructive/18",
    textClass: "text-destructive",
    label: "接近上限",
  };
}

export function QuotaCell({ label, window, nowMs, limitReached, supported = true, embedded = false }: QuotaCellProps) {
  const shellClass = embedded
    ? "w-full min-w-0 py-0.5"
    : "w-full min-w-0 rounded-xl border border-border/70 bg-secondary/26 px-2.5 py-1.5 transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] hover:-translate-y-0.5";

  if (!supported) {
    return (
      <div
        className={embedded ? "w-full min-w-0 py-0.5" : "w-full min-w-0 rounded-xl border border-border/70 bg-secondary/30 px-2.5 py-1.5"}
        role="group"
        aria-label={`${label} quota`}
        title={`${label} quota unavailable`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[11px] font-semibold tracking-[0.02em] text-muted-foreground">{label}</span>
            <span className="ml-2 text-[10px] text-muted-foreground">免费账号无该额度窗口</span>
          </div>
          <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[9px] font-medium text-muted-foreground">Unavailable</span>
        </div>
      </div>
    );
  }

  const used = clampPercent(window.used_percent);
  const remaining = remainingPercent(used);
  const resetHint = fmtResetHint(window.reset_at, nowMs);
  const resetExactUTC = fmtResetExactUTC(window.reset_at);
  const tone = quotaTone(remaining);
  const resetText = resetHint === "即将重置" ? resetHint : `重置 ${resetHint}`;
  const quotaTitle = `${label} 剩余 ${remaining}% · 已用 ${used}% · ${resetExactUTC ?? resetText}`;

  return (
    <div
      className={shellClass}
      role="group"
      aria-label={`${label} quota`}
      title={quotaTitle}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-semibold tracking-[0.02em] text-muted-foreground">{label}</span>
            <span className="text-[10px] text-muted-foreground" title={resetExactUTC}>
              {resetText}
            </span>
            {limitReached ? (
              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${tone.badgeClass}`}>
                <AlertTriangle className="size-2.5" />
                {tone.label}
              </span>
            ) : null}
          </div>
        </div>
        <div className={`shrink-0 text-base font-semibold tracking-[-0.03em] ${tone.textClass}`}>{remaining}%</div>
      </div>
      <div className={`mt-1.5 h-1 overflow-hidden rounded-full ${tone.softFillClass}`} aria-hidden="true">
        <div className={`h-full rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${tone.fillClass}`} style={{ width: `${remaining}%` }} />
      </div>
    </div>
  );
}
