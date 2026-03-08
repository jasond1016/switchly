import { Activity, Shuffle, User, Users } from "lucide-react";
import { type RoutingStrategy } from "../../lib/switchly";

type SummaryRowProps = {
  activeAccountId: string;
  strategy?: RoutingStrategy;
  accountCount: number;
  daemonRunning: boolean;
};

export function SummaryRow({ activeAccountId, strategy, accountCount, daemonRunning }: SummaryRowProps) {
  return (
    <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
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
