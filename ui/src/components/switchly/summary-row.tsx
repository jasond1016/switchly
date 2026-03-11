import { Activity, AlertTriangle, CheckCircle2, Shuffle, User, Users } from "lucide-react";
import { type RoutingStrategy } from "../../lib/switchly";

type SummaryRowProps = {
  activeAccountId: string;
  strategy?: RoutingStrategy;
  accountCount: number;
  readyCount: number;
  attentionCount: number;
  daemonRunning: boolean;
};

export function SummaryRow({ activeAccountId, strategy, accountCount, readyCount, attentionCount, daemonRunning }: SummaryRowProps) {
  return (
    <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.15fr_1fr_1.65fr_1fr]">
      <div className="surface-panel rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/10">
            <User className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="section-title mb-1">当前账号</p>
            <p className="truncate font-mono text-base font-medium text-foreground">{activeAccountId}</p>
          </div>
        </div>
      </div>

      <div className="surface-panel rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/10">
            <Shuffle className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="section-title mb-1">切换策略</p>
            <p className="mt-0.5 inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-mono text-foreground">
              {strategy ?? "-"}
            </p>
          </div>
        </div>
      </div>

      <div className="surface-panel rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/10">
            <Users className="size-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="section-title mb-2">账号概览</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-secondary/55 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Users className="size-3.5 text-primary" />
                  <p className="text-[11px] font-medium text-muted-foreground">账号数</p>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">{accountCount} 个账号</p>
              </div>
              <div className="rounded-xl bg-success/8 px-3 py-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 text-success" />
                  <p className="text-[11px] font-medium text-muted-foreground">就绪账号</p>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">{readyCount} 个可切换</p>
              </div>
              <div className="rounded-xl bg-warning/8 px-3 py-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-3.5 text-[oklch(0.42_0.11_82)]" />
                  <p className="text-[11px] font-medium text-muted-foreground">需关注</p>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">{attentionCount} 个账号</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="surface-panel rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/10">
            <Activity className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="section-title mb-1">Daemon</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`inline-block size-2 rounded-full ${daemonRunning ? "bg-success" : "bg-muted-foreground"}`} />
              <span className="text-base font-medium text-foreground">{daemonRunning ? "运行中" : "已停止"}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
