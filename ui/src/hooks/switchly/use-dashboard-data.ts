import { useCallback, useEffect, useState } from "react";
import { type ApiRequest, type DaemonInfo, type StatusSnapshot, toErrorMessage } from "../../lib/switchly";

type UseDashboardDataArgs = {
  apiRequest: ApiRequest;
  onError: (message: string) => void;
};

export function useDashboardData({ apiRequest, onError }: UseDashboardDataArgs) {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [daemonInfo, setDaemonInfo] = useState<DaemonInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadStatus = useCallback(async () => {
    const next = await apiRequest<StatusSnapshot>("/v1/status");
    setStatus(next);
  }, [apiRequest]);

  const loadDaemonInfo = useCallback(async () => {
    try {
      const info = await apiRequest<DaemonInfo>("/v1/daemon/info");
      setDaemonInfo(info);
    } catch {
      setDaemonInfo(null);
    }
  }, [apiRequest]);

  const refreshAllBase = useCallback(async () => {
    setLoading(true);
    onError("");
    try {
      await Promise.all([loadStatus(), loadDaemonInfo()]);
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadDaemonInfo, loadStatus, onError]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return {
    status,
    daemonInfo,
    loading,
    nowMs,
    loadStatus,
    refreshAllBase,
  };
}
