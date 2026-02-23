import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorageState } from "../use-local-storage-state";
import { MESSAGES } from "../../lib/messages";
import { getCadenceIntervalMs, isRefreshCadence, type ApiRequest, type QuotaSyncAllResponse, type RefreshCadence, type SyncNotice, toErrorMessage } from "../../lib/switchly";

const QUOTA_REFRESH_CADENCE_KEY = "switchly-ui-quota-refresh-cadence";

type UseQuotaSyncArgs = {
  apiRequest: ApiRequest;
  loadStatus: () => Promise<void>;
  activeAccountID?: string;
  onError: (message: string) => void;
  onNotice: (notice: SyncNotice) => void;
};

export function useQuotaSync({ apiRequest, loadStatus, activeAccountID, onError, onNotice }: UseQuotaSyncArgs) {
  const [quotaRefreshCadence, setQuotaRefreshCadence] = useLocalStorageState<RefreshCadence>(QUOTA_REFRESH_CADENCE_KEY, "10min", (raw) =>
    isRefreshCadence(raw) ? raw : null,
  );
  const [quotaSyncBusy, setQuotaSyncBusy] = useState(false);
  const [quotaSyncAllBusy, setQuotaSyncAllBusy] = useState(false);

  const quotaSyncInFlightRef = useRef(false);
  const quotaSyncFailureCountRef = useRef(0);
  const quotaSyncBackoffUntilRef = useRef(0);

  const resetQuotaSyncBackoff = useCallback(() => {
    quotaSyncFailureCountRef.current = 0;
    quotaSyncBackoffUntilRef.current = 0;
  }, []);

  const applyQuotaSyncBackoff = useCallback(() => {
    quotaSyncFailureCountRef.current += 1;
    const backoffMinutes = Math.min(15, 2 ** (quotaSyncFailureCountRef.current - 1));
    quotaSyncBackoffUntilRef.current = Date.now() + backoffMinutes * 60_000;
  }, []);

  const runQuotaSync = useCallback(
    async (opts?: { accountID?: string; silent?: boolean; showBusy?: boolean }) => {
      const accountID = (opts?.accountID ?? activeAccountID ?? "").trim();
      if (!accountID || quotaSyncInFlightRef.current) {
        return false;
      }

      quotaSyncInFlightRef.current = true;
      if (opts?.showBusy) {
        setQuotaSyncBusy(true);
      }
      if (!opts?.silent) {
        onError("");
        onNotice({ tone: "info", message: MESSAGES.quota.syncingAccount(accountID) });
      }

      try {
        await apiRequest("/v1/quota/sync", { method: "POST", body: JSON.stringify({ account_id: accountID }) });
        await loadStatus();
        resetQuotaSyncBackoff();
        if (!opts?.silent) {
          onNotice({ tone: "success", message: MESSAGES.quota.syncAccountSuccess(accountID) });
        }
        return true;
      } catch (error) {
        applyQuotaSyncBackoff();
        const msg = toErrorMessage(error);
        if (!opts?.silent) {
          onError(msg);
          onNotice({ tone: "error", message: MESSAGES.quota.syncAccountFailed(msg) });
        }
        return false;
      } finally {
        quotaSyncInFlightRef.current = false;
        if (opts?.showBusy) {
          setQuotaSyncBusy(false);
        }
      }
    },
    [activeAccountID, apiRequest, applyQuotaSyncBackoff, loadStatus, onError, onNotice, resetQuotaSyncBackoff, setQuotaSyncBusy],
  );

  const runQuotaSyncAll = useCallback(
    async (opts?: { silent?: boolean; showBusy?: boolean }) => {
      if (quotaSyncInFlightRef.current) {
        return false;
      }

      quotaSyncInFlightRef.current = true;
      if (opts?.showBusy) {
        setQuotaSyncAllBusy(true);
      }
      if (!opts?.silent) {
        onError("");
        onNotice({ tone: "info", message: MESSAGES.quota.syncingAll });
      }

      try {
        const out = await apiRequest<QuotaSyncAllResponse>("/v1/quota/sync-all", { method: "POST", body: JSON.stringify({}) });
        await loadStatus();
        if (out.failed === 0) {
          resetQuotaSyncBackoff();
        }

        if (!opts?.silent) {
          if (out.failed > 0) {
            onNotice({ tone: "warning", message: MESSAGES.quota.syncAllPartial(out.succeeded, out.failed) });
          } else {
            onNotice({ tone: "success", message: MESSAGES.quota.syncAllSuccess(out.succeeded) });
          }
        }
        return out.failed === 0;
      } catch (error) {
        applyQuotaSyncBackoff();
        const msg = toErrorMessage(error);
        if (!opts?.silent) {
          onError(msg);
          onNotice({ tone: "error", message: MESSAGES.quota.syncAllFailed(msg) });
        }
        return false;
      } finally {
        quotaSyncInFlightRef.current = false;
        if (opts?.showBusy) {
          setQuotaSyncAllBusy(false);
        }
      }
    },
    [apiRequest, applyQuotaSyncBackoff, loadStatus, onError, onNotice, resetQuotaSyncBackoff, setQuotaSyncAllBusy],
  );

  useEffect(() => {
    const intervalMs = getCadenceIntervalMs(quotaRefreshCadence);
    if (intervalMs === null) {
      return;
    }

    const timer = window.setInterval(() => {
      void (async () => {
        if (Date.now() < quotaSyncBackoffUntilRef.current) {
          return;
        }
        await runQuotaSyncAll({ silent: true });
      })();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [quotaRefreshCadence, runQuotaSyncAll]);

  return {
    quotaRefreshCadence,
    setQuotaRefreshCadence,
    quotaSyncBusy,
    quotaSyncAllBusy,
    runQuotaSync,
    runQuotaSyncAll,
  };
}
