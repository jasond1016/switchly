import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiRequest } from "../../lib/switchly";
import { useDashboardActions } from "./use-dashboard-actions";

describe("useDashboardActions", () => {
  it("activates account and reports success", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/accounts/acc-9/activate") {
        return { status: "ok" };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const reloadDashboard = vi.fn(async () => {});
    const runQuotaSync = vi.fn(async () => true);
    const onError = vi.fn();
    const onNotice = vi.fn();

    const { result } = renderHook(() =>
      useDashboardActions({
        apiRequest: apiRequest as ApiRequest,
        loadStatus: vi.fn(async () => {}),
        reloadDashboard,
        runQuotaSync,
        onError,
        onNotice,
      }),
    );

    await act(async () => {
      await result.current.onUseAccount("acc-9");
    });

    expect(apiRequest).toHaveBeenCalledWith("/v1/accounts/acc-9/activate", expect.any(Object));
    expect(reloadDashboard).toHaveBeenCalledTimes(1);
    expect(runQuotaSync).toHaveBeenCalledWith({ accountID: "acc-9", silent: true });
    expect(onNotice).toHaveBeenLastCalledWith({ tone: "success", message: "已切换到账号 acc-9" });
  });

  it("reports account activation failures", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/accounts/acc-9/activate") {
        throw new Error("activate failed");
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const reloadDashboard = vi.fn(async () => {});
    const runQuotaSync = vi.fn(async () => true);
    const onError = vi.fn();
    const onNotice = vi.fn();

    const { result } = renderHook(() =>
      useDashboardActions({
        apiRequest: apiRequest as ApiRequest,
        loadStatus: vi.fn(async () => {}),
        reloadDashboard,
        runQuotaSync,
        onError,
        onNotice,
      }),
    );

    await act(async () => {
      await result.current.onUseAccount("acc-9");
    });

    expect(reloadDashboard).not.toHaveBeenCalled();
    expect(runQuotaSync).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith("activate failed");
  });

  it("ignores duplicated account switch while previous request is in flight", async () => {
    let releaseActivate = () => {};
    const apiRequest = vi.fn((path: string) => {
      if (path === "/v1/accounts/acc-9/activate") {
        return new Promise((resolve) => {
          releaseActivate = () => resolve({ status: "ok" });
        });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const { result } = renderHook(() =>
      useDashboardActions({
        apiRequest: apiRequest as ApiRequest,
        loadStatus: vi.fn(async () => {}),
        reloadDashboard: vi.fn(async () => {}),
        runQuotaSync: vi.fn(async () => true),
        onError: vi.fn(),
        onNotice: vi.fn(),
      }),
    );

    let firstPromise!: Promise<void>;
    await act(async () => {
      firstPromise = result.current.onUseAccount("acc-9");
      await Promise.resolve();
      void result.current.onUseAccount("acc-9");
    });

    expect(apiRequest).toHaveBeenCalledTimes(1);

    releaseActivate();
    await firstPromise;
  });

  it("discovers candidate and stops discovering after dismiss", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/accounts/import/codex/candidate") {
        return {
          found: true,
          candidate: {
            id: "local-1",
            provider: "codex",
            account_id_present: true,
          },
          already_exists: false,
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const { result } = renderHook(() =>
      useDashboardActions({
        apiRequest: apiRequest as ApiRequest,
        loadStatus: vi.fn(async () => {}),
        runQuotaSync: vi.fn(async () => true),
        onError: vi.fn(),
        onNotice: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.discoverCodexImportCandidate();
    });

    expect(result.current.codexImportCandidate?.candidate?.id).toBe("local-1");

    act(() => {
      result.current.onDismissLocalCodexImport();
    });

    await act(async () => {
      await result.current.discoverCodexImportCandidate();
    });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(result.current.codexImportCandidate).toBeNull();
  });

  it("imports local codex account and triggers quota sync", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/accounts/import/codex") {
        return {
          status: "ok",
          action: "created",
          account: {
            id: "imported-acc",
            provider: "codex",
            status: "ready",
            quota: {
              session: { used_percent: 0 },
              weekly: { used_percent: 0 },
              limit_reached: false,
            },
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const reloadDashboard = vi.fn(async () => {});
    const runQuotaSync = vi.fn(async () => true);
    const onNotice = vi.fn();

    const { result } = renderHook(() =>
      useDashboardActions({
        apiRequest: apiRequest as ApiRequest,
        loadStatus: vi.fn(async () => {}),
        reloadDashboard,
        runQuotaSync,
        onError: vi.fn(),
        onNotice,
      }),
    );

    await act(async () => {
      await result.current.onImportLocalCodexAccount();
    });

    expect(apiRequest).toHaveBeenCalledWith("/v1/accounts/import/codex", expect.any(Object));
    expect(result.current.codexImportBusy).toBe(false);
    expect(reloadDashboard).toHaveBeenCalledTimes(1);
    expect(runQuotaSync).toHaveBeenCalledWith({ accountID: "imported-acc", silent: true });
    expect(onNotice).toHaveBeenLastCalledWith({ tone: "success", message: "已导入本地账号 imported-acc" });
  });

  it("reports import failures and resets busy state", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/accounts/import/codex") {
        throw new Error("import failed");
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const reloadDashboard = vi.fn(async () => {});
    const runQuotaSync = vi.fn(async () => true);
    const onError = vi.fn();
    const onNotice = vi.fn();

    const { result } = renderHook(() =>
      useDashboardActions({
        apiRequest: apiRequest as ApiRequest,
        loadStatus: vi.fn(async () => {}),
        reloadDashboard,
        runQuotaSync,
        onError,
        onNotice,
      }),
    );

    await act(async () => {
      await result.current.onImportLocalCodexAccount();
    });

    expect(result.current.codexImportBusy).toBe(false);
    expect(reloadDashboard).not.toHaveBeenCalled();
    expect(runQuotaSync).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith("import failed");
  });

  it("reports simulate-limit failures and resets busy state", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/v1/switch/on-error") {
        throw new Error("simulate failed");
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const onError = vi.fn();
    const onNotice = vi.fn();

    const { result } = renderHook(() =>
      useDashboardActions({
        apiRequest: apiRequest as ApiRequest,
        loadStatus: vi.fn(async () => {}),
        runQuotaSync: vi.fn(async () => true),
        onError,
        onNotice,
      }),
    );

    await act(async () => {
      await result.current.onSimulateLimit();
    });

    expect(result.current.simBusy).toBe(false);
    expect(onNotice).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith("simulate failed");
  });
});
