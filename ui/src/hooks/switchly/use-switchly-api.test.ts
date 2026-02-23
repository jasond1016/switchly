import { renderHook } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSwitchlyApi } from "./use-switchly-api";

describe("useSwitchlyApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("adds json content-type when body is present", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderHook(() => useSwitchlyApi("http://127.0.0.1:7777"));

    const out = await result.current<{ ok: boolean }>("/v1/test", { method: "POST", body: JSON.stringify({ a: 1 }) });

    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:7777/v1/test", expect.any(Object));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("keeps existing content-type", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderHook(() => useSwitchlyApi("http://127.0.0.1:7777"));

    await result.current<{ ok: boolean }>("/v1/test", {
      method: "POST",
      body: "a=1",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
  });

  it("returns undefined for 204 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const { result } = renderHook(() => useSwitchlyApi("http://127.0.0.1:7777"));

    const out = await result.current<void>("/v1/no-content");

    expect(out).toBeUndefined();
  });

  it("throws detailed error for non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad request", { status: 400, statusText: "Bad Request" }));
    const { result } = renderHook(() => useSwitchlyApi("http://127.0.0.1:7777"));

    await expect(result.current("/v1/fail")).rejects.toThrow("HTTP 400: bad request");
  });

  it("aborts request when timeout is reached", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_, init) => {
      return new Promise((_, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }) as Promise<Response>;
    });

    const { result } = renderHook(() => useSwitchlyApi("http://127.0.0.1:7777"));
    const reqPromise = result.current("/v1/slow", { timeoutMs: 10 });
    const assertPromise = expect(reqPromise).rejects.toThrow("Request timeout after 10ms");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11);
    });

    await assertPromise;
  });

  it("supports upstream signal cancellation", async () => {
    const abortController = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation((_, init) => {
      return new Promise((_, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }) as Promise<Response>;
    });
    const { result } = renderHook(() => useSwitchlyApi("http://127.0.0.1:7777"));

    const reqPromise = result.current("/v1/cancel", { signal: abortController.signal, timeoutMs: 0 });
    abortController.abort();

    await expect(reqPromise).rejects.toThrow("Request aborted");
  });
});
