import { useCallback, useEffect, useRef, useState } from "react";

export type ErrorLevel = "info" | "warning" | "error";

type ErrorState = {
  message: string;
  level: ErrorLevel;
  updatedAt: number;
};

type SetErrorOptions = {
  level?: ErrorLevel;
  autoClearMs?: number;
  dedupeWindowMs?: number;
};

const DEFAULT_ERROR_LEVEL: ErrorLevel = "error";
const DEFAULT_DEDUPE_WINDOW_MS = 800;
const DEFAULT_AUTO_CLEAR_MS = 8_000;

export function useErrorState() {
  const [state, setState] = useState<ErrorState>({ message: "", level: DEFAULT_ERROR_LEVEL, updatedAt: 0 });
  const clearTimerRef = useRef<number | null>(null);
  const lastEmitRef = useRef<{ message: string; level: ErrorLevel; at: number }>({ message: "", level: DEFAULT_ERROR_LEVEL, at: 0 });

  const clearError = useCallback(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setState((prev) => (prev.message ? { ...prev, message: "" } : prev));
  }, []);

  const setError = useCallback(
    (message: string, opts?: SetErrorOptions) => {
      if (!message) {
        clearError();
        return;
      }

      const now = Date.now();
      const level = opts?.level ?? DEFAULT_ERROR_LEVEL;
      const dedupeWindowMs = opts?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
      const autoClearMs = opts?.autoClearMs ?? DEFAULT_AUTO_CLEAR_MS;

      if (
        lastEmitRef.current.message === message &&
        lastEmitRef.current.level === level &&
        now - lastEmitRef.current.at < dedupeWindowMs
      ) {
        return;
      }

      lastEmitRef.current = { message, level, at: now };
      setState({ message, level, updatedAt: now });

      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      if (autoClearMs > 0) {
        clearTimerRef.current = window.setTimeout(() => {
          clearTimerRef.current = null;
          setState((prev) => ({ ...prev, message: "" }));
        }, autoClearMs);
      }
    },
    [clearError],
  );

  useEffect(
    () => () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    },
    [],
  );

  return {
    errorMessage: state.message,
    errorLevel: state.level,
    errorUpdatedAt: state.updatedAt,
    setError,
    clearError,
  };
}
