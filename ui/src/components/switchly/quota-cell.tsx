import { AlertTriangle } from "lucide-react";
import { clampPercent, fmtResetHint, remainingPercent, type QuotaWindow } from "../../lib/switchly";

type QuotaCellProps = {
  label: string;
  window: QuotaWindow;
  nowMs: number;
  limitReached: boolean;
};

export function QuotaCell({ label, window, nowMs, limitReached }: QuotaCellProps) {
  const used = clampPercent(window.used_percent);
  const remaining = remainingPercent(used);
  const tone = remaining >= 60 ? "success" : remaining >= 30 ? "warning" : "destructive";
  const toneText = tone === "success" ? "text-success" : tone === "warning" ? "text-yellow-700" : "text-destructive";
  const toneBar = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-destructive";

  return (
    <div className="min-w-[160px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {limitReached ? <AlertTriangle className="size-3 text-destructive" /> : null}
      </div>
      <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full transition-all ${toneBar}`} style={{ width: `${remaining}%` }} />
      </div>
      <div className="flex items-baseline justify-between gap-1">
        <span className={`text-xs font-mono font-medium ${toneText}`}>
          {remaining}% <span className="text-muted-foreground font-normal">剩余</span>
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">{fmtResetHint(window.reset_at, nowMs)}</span>
      </div>
      <div className="mt-0.5 text-[10px] font-mono text-muted-foreground">已用 {used}%</div>
    </div>
  );
}
