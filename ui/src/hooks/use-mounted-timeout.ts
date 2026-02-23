import { useCallback, useEffect, useRef } from "react";

type TimeoutCallback = () => void;

export function useMountedTimeout() {
  const timeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (callback: TimeoutCallback, delayMs: number) => {
      cancel();
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        if (!isMountedRef.current) {
          return;
        }
        callback();
      }, delayMs);
    },
    [cancel],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancel();
    };
  }, [cancel]);

  return {
    isMountedRef,
    cancel,
    schedule,
  };
}
