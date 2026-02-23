import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toErrorMessage } from "../../lib/switchly";

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

  const refreshTimeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  const onDaemonCommand = useCallback(
    async (cmd: "start" | "stop" | "restart") => {
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
        setDaemonBusy("");
        if (refreshTimeoutRef.current !== null) {
          window.clearTimeout(refreshTimeoutRef.current);
        }
        refreshTimeoutRef.current = window.setTimeout(() => {
          refreshTimeoutRef.current = null;
          void (async () => {
            if (!isMountedRef.current) {
              return;
            }
            await refreshAll();
            if (cmd === "start" || cmd === "restart") {
              await runQuotaSync({ silent: true });
            }
          })();
        }, DAEMON_POST_COMMAND_REFRESH_DELAY_MS);
      }
    },
    [daemonParams.addr, daemonParams.publicBaseURL, onError, refreshAll, runQuotaSync],
  );

  return {
    daemonBusy,
    daemonOutput,
    onDaemonCommand,
  };
}
