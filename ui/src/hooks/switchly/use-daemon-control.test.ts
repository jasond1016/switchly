import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useDaemonControl } from "./use-daemon-control";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("useDaemonControl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs start command and schedules refresh+quota sync", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue("started");

    const refreshAll = vi.fn(async () => {});
    const runQuotaSync = vi.fn(async () => true);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useDaemonControl({
        daemonParams: { addr: "127.0.0.1:7777", publicBaseURL: "http://localhost:7777" },
        refreshAll,
        runQuotaSync,
        onError,
      }),
    );

    await act(async () => {
      await result.current.onDaemonCommand("start");
    });

    expect(invokeMock).toHaveBeenCalledWith("daemon_start", { addr: "127.0.0.1:7777", publicBaseUrl: "http://localhost:7777" });
    expect(result.current.daemonOutput).toBe("started");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(runQuotaSync).toHaveBeenCalledWith({ silent: true });
  });

  it("does not sync quota after stop", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue("stopped");

    const refreshAll = vi.fn(async () => {});
    const runQuotaSync = vi.fn(async () => true);

    const { result } = renderHook(() =>
      useDaemonControl({
        daemonParams: { addr: "127.0.0.1:7777", publicBaseURL: "http://localhost:7777" },
        refreshAll,
        runQuotaSync,
        onError: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.onDaemonCommand("stop");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(runQuotaSync).not.toHaveBeenCalled();
  });

  it("cleans pending refresh timer on unmount", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue("started");

    const refreshAll = vi.fn(async () => {});

    const { result, unmount } = renderHook(() =>
      useDaemonControl({
        daemonParams: { addr: "127.0.0.1:7777", publicBaseURL: "http://localhost:7777" },
        refreshAll,
        runQuotaSync: vi.fn(async () => true),
        onError: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.onDaemonCommand("start");
    });

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(refreshAll).not.toHaveBeenCalled();
  });
});
