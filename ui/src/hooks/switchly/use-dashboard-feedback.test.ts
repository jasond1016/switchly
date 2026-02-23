import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDashboardFeedback } from "./use-dashboard-feedback";

describe("useDashboardFeedback", () => {
  it("stores error and sync notice", () => {
    const { result } = renderHook(() => useDashboardFeedback());

    act(() => {
      result.current.setError("boom");
      result.current.setSyncNotice({ tone: "success", message: "ok" });
    });

    expect(result.current.error).toBe("boom");
    expect(result.current.syncNotice).toEqual({ tone: "success", message: "ok" });
  });

  it("can clear sync notice", () => {
    const { result } = renderHook(() => useDashboardFeedback());

    act(() => {
      result.current.setSyncNotice({ tone: "warning", message: "warn" });
    });

    act(() => {
      result.current.setSyncNotice(null);
    });

    expect(result.current.syncNotice).toBeNull();
  });
});
