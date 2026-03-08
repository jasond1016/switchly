import { AlertTriangle } from "lucide-react";
import { clampPercent, fmtResetExactUTC, fmtResetHint, remainingPercent, type QuotaWindow } from "../../lib/switchly";

type QuotaCellProps = {
  label: string;
  window: QuotaWindow;
  nowMs: number;
  limitReached: boolean;
  supported?: boolean;
};

function quotaTone(remaining: number): {
  badgeClass: string;
  ringColor: string;
  fillClass: string;
  textClass: string;
  label: string;
} {
  if (remaining >= 60) {
    return {
      badgeClass: "bg-success/12 text-success border-success/20",
      ringColor: "var(--success)",
      fillClass: "bg-success",
      textClass: "text-success",
      label: "余量充足",
    };
  }
  if (remaining >= 30) {
    return {
      badgeClass: "bg-warning/14 text-[oklch(0.42_0.11_82)] border-warning/25",
      ringColor: "var(--warning)",
      fillClass: "bg-warning",
      textClass: "text-[oklch(0.42_0.11_82)]",
      label: "需要关注",
    };
  }
  return {
    badgeClass: "bg-destructive/12 text-destructive border-destructive/20",
    ringColor: "var(--destructive)",
    fillClass: "bg-destructive",
    textClass: "text-destructive",
    label: "接近上限",
  };
}

export function QuotaCell({ label, window, nowMs, limitReached, supported = true }: QuotaCellProps) {
  if (!supported) {
    return (
      <div className="min-w-[220px] rounded-[1.25rem] border border-border/70 bg-secondary/30 p-3" role="group" aria-label={`${label} quota`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Unavailable</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex size-16 items-center justify-center rounded-full border border-border/80 bg-card text-xs font-mono text-muted-foreground">N/A</div>
          <div>
            <div className="text-sm font-medium text-foreground">免费账号无该额度窗口</div>
            <div className="mt-1 text-[11px] text-muted-foreground">当前账户不会返回这类额度数据。</div>
          </div>
        </div>
      </div>
    );
  }

  const used = clampPercent(window.used_percent);
  const remaining = remainingPercent(used);
  const resetHint = fmtResetHint(window.reset_at, nowMs);
  const resetExactUTC = fmtResetExactUTC(window.reset_at);
  const tone = quotaTone(remaining);
  const gaugeBackground = `conic-gradient(${tone.ringColor} 0deg ${remaining * 3.6}deg, color-mix(in oklab, ${tone.ringColor} 16%, white) ${remaining * 3.6}deg 360deg)`;

  return (
    <div className="min-w-[220px] rounded-[1.25rem] border border-border/70 bg-secondary/26 p-3 transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] hover:-translate-y-0.5" role="group" aria-label={`${label} quota`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.badgeClass}`}>
          {limitReached ? <AlertTriangle className="size-3" /> : null}
          {tone.label}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center">
        <div className="flex justify-center sm:justify-start">
          <div className="quota-gauge" style={{ backgroundImage: gaugeBackground }} aria-hidden="true">
            <div className="quota-gauge-inner">
              <div className={`text-2xl font-semibold tracking-[-0.04em] ${tone.textClass}`}>{remaining}</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">remain</div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{remaining}% 剩余</span>
            <span className="text-[10px] font-mono text-muted-foreground" title={resetExactUTC}>
              {resetHint}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-card">
            <div className={`h-full rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${tone.fillClass}`} style={{ width: `${remaining}%` }} />
          </div>
          <div className="quota-segments mt-2" aria-hidden="true">
            <span className={`quota-segment ${remaining >= 75 ? tone.fillClass : ""}`} />
            <span className={`quota-segment ${remaining >= 50 ? tone.fillClass : ""}`} />
            <span className={`quota-segment ${remaining >= 25 ? tone.fillClass : ""}`} />
            <span className={`quota-segment ${remaining > 0 ? tone.fillClass : ""}`} />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-mono text-muted-foreground">
        <span className="rounded-full bg-card px-2 py-1">已用 {used}%</span>
        <span className="rounded-full bg-card px-2 py-1">重置 {resetHint}</span>
      </div>
    </div>
  );
}
