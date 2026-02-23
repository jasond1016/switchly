import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMountedTimeout } from "./use-mounted-timeout";

describe("useMountedTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps only the latest scheduled callback", async () => {
    const first = vi.fn();
    const second = vi.fn();

    const { result } = renderHook(() => useMountedTimeout());

    act(() => {
      result.current.schedule(first, 1_000);
      result.current.schedule(second, 1_000);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("clears pending timeout on unmount", async () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useMountedTimeout());

    act(() => {
      result.current.schedule(callback, 1_000);
    });
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(callback).not.toHaveBeenCalled();
  });
});
