import { Copy, Loader2, Play, RotateCcw, Server, Square, Terminal } from "lucide-react";
import { type DaemonInfo } from "../../lib/switchly";

type DaemonPanelProps = {
  addr: string;
  publicBaseURL: string;
  daemonBusy: "start" | "stop" | "restart" | "";
  daemonRunning: boolean;
  daemonInfo: DaemonInfo | null;
  daemonLogs: string[];
  onDaemonCommand: (cmd: "start" | "stop" | "restart") => void;
};

export function DaemonPanel({ addr, publicBaseURL, daemonBusy, daemonRunning, daemonInfo, daemonLogs, onDaemonCommand }: DaemonPanelProps) {
  return (
    <div className="rounded-lg border border-border bg-card lg:col-span-2">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Server className="size-4 text-primary" />
          Daemon 控制
        </h2>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">Addr</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-foreground">{addr}</span>
              <button className="text-muted-foreground transition hover:text-foreground" onClick={() => void navigator.clipboard.writeText(addr)}>
                <Copy className="size-3" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">Callback</span>
            <div className="flex items-center gap-1.5">
              <span className="max-w-[320px] truncate font-mono text-xs text-foreground">{publicBaseURL}</span>
              <button className="text-muted-foreground transition hover:text-foreground" onClick={() => void navigator.clipboard.writeText(publicBaseURL)}>
                <Copy className="size-3" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={daemonBusy !== ""}
            onClick={() => onDaemonCommand("start")}
          >
            {daemonBusy === "start" ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            启动
          </button>

          <button
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={daemonBusy !== ""}
            onClick={() => onDaemonCommand("stop")}
          >
            {daemonBusy === "stop" ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
            停止
          </button>

          <button
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={daemonBusy !== ""}
            onClick={() => onDaemonCommand("restart")}
          >
            {daemonBusy === "restart" ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
            重启
          </button>
        </div>

        <div className="overflow-hidden rounded-md border border-border bg-secondary/60">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
            <Terminal className="size-3 text-muted-foreground" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Output</span>
            <div className="ml-auto flex items-center gap-1">
              <span className={`size-1.5 rounded-full ${daemonRunning ? "bg-success" : "bg-muted-foreground"}`} />
              <span className={`text-[10px] ${daemonRunning ? "text-success" : "text-muted-foreground"}`}>{daemonRunning ? "running" : "stopped"}</span>
            </div>
          </div>
          <div className="h-[160px] overflow-auto p-3">
            {daemonLogs.length > 0 ? (
              daemonLogs.map((line, i) => (
                <p key={`${line}-${i}`} className="font-mono text-[11px] leading-5 text-muted-foreground">
                  {line}
                </p>
              ))
            ) : (
              <p className="font-mono text-[11px] leading-5 text-muted-foreground">No command output yet.</p>
            )}
            {daemonInfo ? (
              <p className="mt-2 font-mono text-[11px] leading-5 text-muted-foreground">
                daemon pid={daemonInfo.pid} restart_supported={daemonInfo.restart_supported ? "true" : "false"}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
