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
    <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
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
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/10">
            <Users className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="section-title mb-1">账号数</p>
            <p className="text-base font-medium text-foreground">{accountCount} 个账号</p>
          </div>
        </div>
      </div>

      <div className="surface-panel rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-success/12 ring-1 ring-success/15">
            <CheckCircle2 className="size-4 text-success" />
          </div>
          <div className="min-w-0">
            <p className="section-title mb-1">就绪账号</p>
            <p className="text-base font-medium text-foreground">{readyCount} 个可切换</p>
          </div>
        </div>
      </div>

      <div className="surface-panel rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-warning/12 ring-1 ring-warning/20">
            <AlertTriangle className="size-4 text-[oklch(0.42_0.11_82)]" />
          </div>
          <div className="min-w-0">
            <p className="section-title mb-1">需关注</p>
            <p className="text-base font-medium text-foreground">{attentionCount} 个账号</p>
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
