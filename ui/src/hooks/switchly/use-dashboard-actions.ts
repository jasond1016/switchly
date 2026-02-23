import { useCallback, useRef, useState } from "react";
import { MESSAGES } from "../../lib/messages";
import { type ApiRequest, type CodexImportCandidateResponse, type CodexImportResponse, type RoutingStrategy, type SyncNotice, toErrorMessage } from "../../lib/switchly";

type RunQuotaSync = (opts?: { accountID?: string; silent?: boolean; showBusy?: boolean }) => Promise<boolean>;

type UseDashboardActionsArgs = {
  apiRequest: ApiRequest;
  loadStatus: () => Promise<void>;
  reloadDashboard?: () => Promise<void>;
  runQuotaSync: RunQuotaSync;
  onError: (message: string) => void;
  onNotice: (notice: SyncNotice) => void;
};

export function useDashboardActions({ apiRequest, loadStatus, reloadDashboard, runQuotaSync, onError, onNotice }: UseDashboardActionsArgs) {
  const [simBusy, setSimBusy] = useState(false);
  const [codexImportCandidate, setCodexImportCandidate] = useState<CodexImportCandidateResponse | null>(null);
  const [codexImportBusy, setCodexImportBusy] = useState(false);

  const importDismissedRef = useRef(false);
  const useAccountInFlightRef = useRef(false);
  const strategyInFlightRef = useRef(false);
  const simulateInFlightRef = useRef(false);
  const importInFlightRef = useRef(false);

  const discoverCodexImportCandidate = useCallback(async () => {
    if (importDismissedRef.current) {
      return;
    }
    try {
      const out = await apiRequest<CodexImportCandidateResponse>("/v1/accounts/import/codex/candidate");
      if (out.found && out.candidate) {
        setCodexImportCandidate((prev) => (prev?.found ? prev : out));
      }
    } catch {
      // Keep dashboard rendering smooth when discovery API is unavailable.
    }
  }, [apiRequest]);

  const onUseAccount = useCallback(
    async (id: string) => {
      if (useAccountInFlightRef.current) {
        return;
      }
      useAccountInFlightRef.current = true;
      onError("");
      try {
        await apiRequest<{ status: string }>(`/v1/accounts/${encodeURIComponent(id)}/activate`, { method: "POST", body: JSON.stringify({}) });
        if (reloadDashboard) {
          await reloadDashboard();
        } else {
          await loadStatus();
        }
        await runQuotaSync({ accountID: id, silent: true });
        onNotice({ tone: "success", message: MESSAGES.dashboard.switchedAccount(id) });
      } catch (error) {
        onError(toErrorMessage(error));
      } finally {
        useAccountInFlightRef.current = false;
      }
    },
    [apiRequest, loadStatus, onError, onNotice, reloadDashboard, runQuotaSync],
  );

  const onStrategy = useCallback(
    async (strategy: RoutingStrategy) => {
      if (strategyInFlightRef.current) {
        return;
      }
      strategyInFlightRef.current = true;
      onError("");
      try {
        await apiRequest<{ status: string }>("/v1/strategy", { method: "PATCH", body: JSON.stringify({ strategy }) });
        await loadStatus();
      } catch (error) {
        onError(toErrorMessage(error));
      } finally {
        strategyInFlightRef.current = false;
      }
    },
    [apiRequest, loadStatus, onError],
  );

  const onSimulateLimit = useCallback(async () => {
    if (simulateInFlightRef.current) {
      return;
    }
    simulateInFlightRef.current = true;
    setSimBusy(true);
    onError("");
    try {
      await apiRequest("/v1/switch/on-error", { method: "POST", body: JSON.stringify({ status_code: 429, error_message: "quota exceeded" }) });
      if (reloadDashboard) {
        await reloadDashboard();
      } else {
        await loadStatus();
      }
      onNotice({ tone: "warning", message: MESSAGES.dashboard.simulateLimitDone });
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setSimBusy(false);
      simulateInFlightRef.current = false;
    }
  }, [apiRequest, loadStatus, onError, onNotice, reloadDashboard]);

  const onImportLocalCodexAccount = useCallback(async () => {
    if (importInFlightRef.current) {
      return;
    }
    importInFlightRef.current = true;
    setCodexImportBusy(true);
    onError("");
    try {
      const out = await apiRequest<CodexImportResponse>("/v1/accounts/import/codex", {
        method: "POST",
        body: JSON.stringify({ overwrite_existing: true }),
      });
      importDismissedRef.current = true;
      setCodexImportCandidate(null);
      if (reloadDashboard) {
        await reloadDashboard();
      } else {
        await loadStatus();
      }
      await runQuotaSync({ accountID: out.account.id, silent: true });
      onNotice({ tone: "success", message: MESSAGES.dashboard.importedAccount(out.account.id, out.action) });
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setCodexImportBusy(false);
      importInFlightRef.current = false;
    }
  }, [apiRequest, loadStatus, onError, onNotice, reloadDashboard, runQuotaSync]);

  const onDismissLocalCodexImport = useCallback(() => {
    importDismissedRef.current = true;
    setCodexImportCandidate(null);
  }, []);

  return {
    simBusy,
    codexImportCandidate,
    codexImportBusy,
    discoverCodexImportCandidate,
    onUseAccount,
    onStrategy,
    onSimulateLimit,
    onImportLocalCodexAccount,
    onDismissLocalCodexImport,
  };
}
