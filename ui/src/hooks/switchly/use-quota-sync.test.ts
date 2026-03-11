import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuotaSync } from "./use-quota-sync";

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

describe("useQuotaSync", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs active account quota successfully", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/quota/sync") {
        return undefined;
      }
      throw new Error(`unexpected path: ${path}`);
    });
    const loadStatus = vi.fn(async () => {});
    const onError = vi.fn();
    const onNotice = vi.fn();

    const { result } = renderHook(() =>
      useQuotaSync({
        apiRequest: apiRequest as ApiRequest,
        loadStatus,
        activeAccountID: "acc-1",
        onError,
        onNotice,
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.runQuotaSync({ showBusy: true, silent: false });
    });

    expect(ok).toBe(true);
    expect(apiRequest).toHaveBeenCalledWith("/v1/quota/sync", expect.any(Object));
    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenNthCalledWith(1, { tone: "info", message: "正在同步账号 acc-1 的 Quota..." });
    expect(onNotice).toHaveBeenNthCalledWith(2, { tone: "success", message: "✓ 账号 acc-1 Quota 同步成功" });
    expect(result.current.quotaSyncBusy).toBe(false);
  });

  it("reports sync-all failures", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/quota/sync-all") {
        throw new Error("sync-all failed");
      }
      throw new Error(`unexpected path: ${path}`);
    });
    const loadStatus = vi.fn(async () => {});
    const onError = vi.fn();
    const onNotice = vi.fn();

    const { result } = renderHook(() =>
      useQuotaSync({
        apiRequest: apiRequest as ApiRequest,
        loadStatus,
        activeAccountID: "acc-1",
        onError,
        onNotice,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.runQuotaSyncAll({ showBusy: true, silent: false });
    });

    expect(ok).toBe(false);
    expect(loadStatus).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith("sync-all failed");
    expect(onNotice).toHaveBeenLastCalledWith({ tone: "error", message: "Sync All 失败: sync-all failed" });
    expect(result.current.quotaSyncAllBusy).toBe(false);
  });

  it("reports failed account names on partial sync-all", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/quota/sync-all") {
        return {
          total: 3,
          succeeded: 1,
          failed: 2,
          results: [
            { account_id: "acc-ok", success: true },
            { account_id: "acc-bad-1", success: false, error: "401" },
            { account_id: "acc-bad-2", success: false, error: "401" },
          ],
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });
    const loadStatus = vi.fn(async () => {});
    const onError = vi.fn();
    const onNotice = vi.fn();

    const { result } = renderHook(() =>
      useQuotaSync({
        apiRequest: apiRequest as ApiRequest,
        loadStatus,
        activeAccountID: "acc-1",
        onError,
        onNotice,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.runQuotaSyncAll({ showBusy: true, silent: false });
    });

    expect(ok).toBe(false);
    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenLastCalledWith({
      tone: "warning",
      message: "⚠ 同步完成: 1 个成功, 2 个失败（acc-bad-1、acc-bad-2）",
    });
  });

  it("falls back to generic partial sync notice when failed results are missing", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/quota/sync-all") {
        return {
          total: 2,
          succeeded: 1,
          failed: 1,
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useQuotaSync({
        apiRequest: apiRequest as ApiRequest,
        loadStatus: vi.fn(async () => {}),
        activeAccountID: "acc-1",
        onError: vi.fn(),
        onNotice,
      }),
    );

    await act(async () => {
      await result.current.runQuotaSyncAll({ silent: false });
    });

    expect(result.current.quotaSyncAllBusy).toBe(false);
    expect(onNotice).toHaveBeenLastCalledWith({
      tone: "warning",
      message: "⚠ 同步完成: 1 个成功, 1 个失败",
    });
  });

  it("skips one auto sync interval when backoff exceeds cadence", async () => {
    vi.useFakeTimers();
    localStorage.setItem("switchly-ui-quota-refresh-cadence", "1min");

    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/quota/sync-all") {
        throw new Error("boom");
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const { result } = renderHook(() =>
      useQuotaSync({
        apiRequest: apiRequest as ApiRequest,
        loadStatus: vi.fn(async () => {}),
        activeAccountID: "acc-1",
        onError: vi.fn(),
        onNotice: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.runQuotaSyncAll({ silent: true });
    });
    expect(syncAllCallCount(apiRequest)).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(syncAllCallCount(apiRequest)).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(syncAllCallCount(apiRequest)).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(syncAllCallCount(apiRequest)).toBe(3);
  });
});

function syncAllCallCount(mockFn: ReturnType<typeof vi.fn>) {
  return mockFn.mock.calls.filter(([path]) => path === "/v1/quota/sync-all").length;
}
