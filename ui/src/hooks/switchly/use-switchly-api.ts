import { useCallback } from "react";
import type { ApiRequest, SwitchlyRequestInit } from "../../lib/switchly";

const DEFAULT_TIMEOUT_MS = 15_000;

export function useSwitchlyApi(baseURL: string): ApiRequest {
  return useCallback(
    async <T,>(path: string, init?: SwitchlyRequestInit): Promise<T> => {
      const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const headers = new Headers(init?.headers);
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const controller = new AbortController();
      let timeoutID: number | null = null;
      let timedOut = false;
      let detachUpstreamAbort: (() => void) | null = null;

      if (init?.signal) {
        if (init.signal.aborted) {
          controller.abort(init.signal.reason);
        } else {
          const onAbort = () => controller.abort(init.signal?.reason);
          init.signal.addEventListener("abort", onAbort, { once: true });
          detachUpstreamAbort = () => init.signal?.removeEventListener("abort", onAbort);
        }
      }

      if (timeoutMs > 0) {
        timeoutID = window.setTimeout(() => {
          timedOut = true;
          controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      try {
        const response = await fetch(`${baseURL}${path}`, { ...init, headers, signal: controller.signal });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
        }
        if (response.status === 204) {
          return undefined as T;
        }
        return (await response.json()) as T;
      } catch (error) {
        if (timedOut) {
          throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new Error("Request aborted");
        }
        throw error;
      } finally {
        if (timeoutID !== null) {
          window.clearTimeout(timeoutID);
        }
        if (detachUpstreamAbort) {
          detachUpstreamAbort();
        }
      }
    },
    [baseURL],
  );
}
