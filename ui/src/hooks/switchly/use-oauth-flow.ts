import { useCallback, useState } from "react";
import { type ApiRequest, type OAuthSession, toErrorMessage } from "../../lib/switchly";
import { useMountedTimeout } from "../use-mounted-timeout";

const OAUTH_POLL_INTERVAL_MS = 2000;

type UseOAuthFlowArgs = {
  apiRequest: ApiRequest;
  refreshAll: () => Promise<void>;
  runQuotaSync: (opts?: { accountID?: string; silent?: boolean; showBusy?: boolean }) => Promise<boolean>;
  onError: (message: string) => void;
};

export function useOAuthFlow({ apiRequest, refreshAll, runQuotaSync, onError }: UseOAuthFlowArgs) {
  const [oauthSession, setOAuthSession] = useState<OAuthSession | null>(null);
  const [oauthPolling, setOAuthPolling] = useState(false);

  const { isMountedRef, cancel: cancelPoll, schedule: schedulePoll } = useMountedTimeout();

  const startOAuthPolling = useCallback(
    (state: string) => {
      cancelPoll();
      setOAuthPolling(true);

      const pollOnce = async (): Promise<void> => {
        try {
          const session = await apiRequest<OAuthSession>(`/v1/oauth/status?state=${encodeURIComponent(state)}`);
          if (!isMountedRef.current) {
            return;
          }
          setOAuthSession(session);

          if (session.status === "pending") {
            schedulePoll(() => {
              void pollOnce();
            }, OAUTH_POLL_INTERVAL_MS);
            return;
          }

          setOAuthPolling(false);
          if (session.status === "success") {
            await refreshAll();
            await runQuotaSync({ accountID: session.account_id, silent: true });
          }
        } catch (error) {
          if (!isMountedRef.current) {
            return;
          }
          onError(toErrorMessage(error));
          setOAuthPolling(false);
          cancelPoll();
        }
      };

      void pollOnce();
    },
    [apiRequest, cancelPoll, isMountedRef, onError, refreshAll, runQuotaSync, schedulePoll],
  );

  const loginWithBrowser = useCallback(async () => {
    onError("");
    try {
      const session = await apiRequest<OAuthSession>("/v1/oauth/start", { method: "POST", body: JSON.stringify({ provider: "codex" }) });
      setOAuthSession(session);
      if (session.auth_url) {
        window.open(session.auth_url, "_blank", "noopener,noreferrer");
      }
      startOAuthPolling(session.state);
    } catch (error) {
      onError(toErrorMessage(error));
    }
  }, [apiRequest, onError, startOAuthPolling]);

  return {
    oauthSession,
    oauthPolling,
    loginWithBrowser,
  };
}
