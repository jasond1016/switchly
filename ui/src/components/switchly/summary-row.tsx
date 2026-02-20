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
    <section className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <User className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">当前账号</p>
            <p className="truncate font-mono text-sm font-medium text-foreground">{activeAccountId}</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Shuffle className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">切换策略</p>
            <p className="mt-0.5 inline-flex rounded-md bg-secondary px-2 py-0.5 text-xs font-mono text-foreground">
              {strategy ?? "-"}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Users className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">账号数</p>
            <p className="text-sm font-medium text-foreground">{accountCount} 个账号</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Activity className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Daemon</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`inline-block size-2 rounded-full ${daemonRunning ? "bg-success" : "bg-muted-foreground"}`} />
              <span className="text-sm font-medium text-foreground">{daemonRunning ? "运行中" : "已停止"}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
