import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOAuthFlow } from "./use-oauth-flow";

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

describe("useOAuthFlow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("logs in and completes pending->success polling", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const startSession = {
      state: "state-1",
      provider: "codex",
      status: "pending" as const,
      auth_url: "https://example.com/auth",
      expires_at: "2099-01-01T00:00:00Z",
    };

    const statusQueue = [
      { ...startSession, auth_url: undefined },
      { ...startSession, status: "success" as const, account_id: "acc-7", auth_url: undefined },
    ];

    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/oauth/start") {
        return startSession;
      }
      if (path.startsWith("/v1/oauth/status")) {
        const next = statusQueue.shift();
        if (!next) {
          throw new Error("no status response");
        }
        return next;
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const refreshAll = vi.fn(async () => {});
    const runQuotaSync = vi.fn(async () => true);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useOAuthFlow({
        apiRequest: apiRequest as ApiRequest,
        refreshAll,
        runQuotaSync,
        onError,
      }),
    );

    await act(async () => {
      await result.current.loginWithBrowser();
    });

    expect(openSpy).toHaveBeenCalledWith("https://example.com/auth", "_blank", "noopener,noreferrer");
    expect(result.current.oauthPolling).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.oauthPolling).toBe(false);
    expect(result.current.oauthSession?.status).toBe("success");
    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(runQuotaSync).toHaveBeenCalledWith({ accountID: "acc-7", silent: true });
  });

  it("reports start errors", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/oauth/start") {
        throw new Error("start failed");
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const { result } = renderHook(() =>
      useOAuthFlow({
        apiRequest: apiRequest as ApiRequest,
        refreshAll: vi.fn(async () => {}),
        runQuotaSync: vi.fn(async () => true),
        onError: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.loginWithBrowser();
    });

    expect(result.current.oauthPolling).toBe(false);
    expect(result.current.oauthSession).toBeNull();
  });

  it("cleans up polling timer on unmount", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/oauth/start") {
        return {
          state: "state-2",
          provider: "codex",
          status: "pending",
          expires_at: "2099-01-01T00:00:00Z",
        };
      }
      if (path.startsWith("/v1/oauth/status")) {
        return {
          state: "state-2",
          provider: "codex",
          status: "pending",
          expires_at: "2099-01-01T00:00:00Z",
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const { result, unmount } = renderHook(() =>
      useOAuthFlow({
        apiRequest: apiRequest as ApiRequest,
        refreshAll: vi.fn(async () => {}),
        runQuotaSync: vi.fn(async () => true),
        onError: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.loginWithBrowser();
    });

    expect(statusCallCount(apiRequest)).toBe(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    expect(statusCallCount(apiRequest)).toBe(1);
  });
});

function statusCallCount(mockFn: ReturnType<typeof vi.fn>) {
  return mockFn.mock.calls.filter(([path]) => typeof path === "string" && path.startsWith("/v1/oauth/status")).length;
}
