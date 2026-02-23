import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { toErrorMessage } from "../../lib/switchly";
import { useMountedTimeout } from "../use-mounted-timeout";

const DAEMON_POST_COMMAND_REFRESH_DELAY_MS = 500;

type UseDaemonControlArgs = {
  daemonParams: { addr: string; publicBaseURL: string };
  refreshAll: () => Promise<void>;
  runQuotaSync: (opts?: { accountID?: string; silent?: boolean; showBusy?: boolean }) => Promise<boolean>;
  onError: (message: string) => void;
};

export function useDaemonControl({ daemonParams, refreshAll, runQuotaSync, onError }: UseDaemonControlArgs) {
  const [daemonBusy, setDaemonBusy] = useState<"start" | "stop" | "restart" | "">("");
  const [daemonOutput, setDaemonOutput] = useState("");

  const { isMountedRef, cancel: cancelRefresh, schedule: scheduleRefresh } = useMountedTimeout();
  const commandInFlightRef = useRef(false);

  const refreshAfterCommand = useCallback(
    async (cmd: "start" | "stop" | "restart") => {
      if (!isMountedRef.current) {
        return;
      }
      try {
        await refreshAll();
        if (cmd === "start" || cmd === "restart") {
          await runQuotaSync({ silent: true });
        }
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }
        onError(toErrorMessage(error));
      }
    },
    [isMountedRef, onError, refreshAll, runQuotaSync],
  );

  const onDaemonCommand = useCallback(
    async (cmd: "start" | "stop" | "restart") => {
      if (commandInFlightRef.current) {
        return;
      }
      commandInFlightRef.current = true;
      setDaemonBusy(cmd);
      onError("");
      setDaemonOutput("");

      try {
        let output = "";
        if (cmd === "start") {
          output = await invoke<string>("daemon_start", { addr: daemonParams.addr, publicBaseUrl: daemonParams.publicBaseURL });
        } else if (cmd === "stop") {
          output = await invoke<string>("daemon_stop", { addr: daemonParams.addr });
        } else {
          output = await invoke<string>("daemon_restart", { addr: daemonParams.addr, publicBaseUrl: daemonParams.publicBaseURL });
        }
        setDaemonOutput(output);
      } catch (error) {
        onError(toErrorMessage(error));
      } finally {
        commandInFlightRef.current = false;
        setDaemonBusy("");
        cancelRefresh();
        scheduleRefresh(() => {
          void refreshAfterCommand(cmd);
        }, DAEMON_POST_COMMAND_REFRESH_DELAY_MS);
      }
    },
    [cancelRefresh, daemonParams.addr, daemonParams.publicBaseURL, onError, refreshAfterCommand, scheduleRefresh],
  );

  return {
    daemonBusy,
    daemonOutput,
    onDaemonCommand,
  };
}
