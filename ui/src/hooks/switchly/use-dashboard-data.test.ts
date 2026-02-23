import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest } from "../../lib/switchly";
import { useDashboardData } from "./use-dashboard-data";

describe("useDashboardData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads status and daemon info on refresh", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/status") {
        return {
          active_account_id: "acc-1",
          strategy: "round-robin",
          accounts: [],
        };
      }
      if (path === "/v1/daemon/info") {
        return {
          pid: 100,
          addr: "127.0.0.1:7777",
          public_base_url: "http://localhost:7777",
          restart_supported: true,
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const onError = vi.fn();

    const { result } = renderHook(() =>
      useDashboardData({
        apiRequest: apiRequest as ApiRequest,
        onError,
      }),
    );

    await act(async () => {
      await result.current.refreshAllBase();
    });

    expect(result.current.status?.active_account_id).toBe("acc-1");
    expect(result.current.daemonInfo?.pid).toBe(100);
    expect(result.current.loading).toBe(false);
    expect(onError).toHaveBeenCalledWith("");
  });

  it("keeps dashboard usable when daemon info endpoint fails", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/status") {
        return {
          active_account_id: "acc-2",
          strategy: "fill-first",
          accounts: [],
        };
      }
      if (path === "/v1/daemon/info") {
        throw new Error("daemon down");
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const { result } = renderHook(() =>
      useDashboardData({
        apiRequest: apiRequest as ApiRequest,
        onError: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.refreshAllBase();
    });

    expect(result.current.status?.active_account_id).toBe("acc-2");
    expect(result.current.daemonInfo).toBeNull();
  });

  it("reports status errors through onError", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/status") {
        throw new Error("status unavailable");
      }
      if (path === "/v1/daemon/info") {
        return {
          pid: 200,
          addr: "127.0.0.1:7777",
          public_base_url: "http://localhost:7777",
          restart_supported: true,
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const onError = vi.fn();

    const { result } = renderHook(() =>
      useDashboardData({
        apiRequest: apiRequest as ApiRequest,
        onError,
      }),
    );

    await act(async () => {
      await result.current.refreshAllBase();
    });

    expect(onError).toHaveBeenLastCalledWith("status unavailable");
    expect(result.current.loading).toBe(false);
  });

  it("updates nowMs every minute", async () => {
    const apiRequest = vi.fn(async () => {
      return { ok: true };
    });

    const { result } = renderHook(() =>
      useDashboardData({
        apiRequest: apiRequest as ApiRequest,
        onError: vi.fn(),
      }),
    );

    const initial = result.current.nowMs;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(result.current.nowMs).toBeGreaterThan(initial);
  });
});
