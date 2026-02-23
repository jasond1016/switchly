import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useErrorState } from "./use-error-state";

describe("useErrorState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores errors and auto clears by default", async () => {
    const { result } = renderHook(() => useErrorState());

    act(() => {
      result.current.setError("boom");
    });

    expect(result.current.errorMessage).toBe("boom");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(result.current.errorMessage).toBe("");
  });

  it("dedupes same message within dedupe window", () => {
    const { result } = renderHook(() => useErrorState());

    act(() => {
      result.current.setError("same", { dedupeWindowMs: 1_000, autoClearMs: 0 });
    });
    const firstUpdatedAt = result.current.errorUpdatedAt;

    act(() => {
      result.current.setError("same", { dedupeWindowMs: 1_000, autoClearMs: 0 });
    });

    expect(result.current.errorUpdatedAt).toBe(firstUpdatedAt);
  });

  it("allows same message again after dedupe window", async () => {
    const { result } = renderHook(() => useErrorState());

    act(() => {
      result.current.setError("repeat", { dedupeWindowMs: 300, autoClearMs: 0 });
    });
    const firstUpdatedAt = result.current.errorUpdatedAt;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });

    act(() => {
      result.current.setError("repeat", { dedupeWindowMs: 300, autoClearMs: 0 });
    });

    expect(result.current.errorUpdatedAt).toBeGreaterThan(firstUpdatedAt);
  });
});
