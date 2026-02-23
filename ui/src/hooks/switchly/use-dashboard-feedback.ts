import { useCallback, useState } from "react";
import type { SyncNotice } from "../../lib/switchly";
import { useErrorState } from "../use-error-state";

export function useDashboardFeedback() {
  const { errorMessage, setError: setErrorState, clearError } = useErrorState();
  const [syncNotice, setSyncNoticeState] = useState<SyncNotice | null>(null);

  const setError = useCallback((message: string) => {
    if (!message) {
      clearError();
      return;
    }
    setErrorState(message);
  }, [clearError, setErrorState]);

  const setSyncNotice = useCallback((notice: SyncNotice | null) => {
    setSyncNoticeState(notice);
  }, []);

  return {
    error: errorMessage,
    setError,
    syncNotice,
    setSyncNotice,
  };
}
