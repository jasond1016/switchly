import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => "ok"),
}));

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders dashboard data and refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/v1/status")) {
        return new Response(
          JSON.stringify({
            active_account_id: "acc-main",
            strategy: "round-robin",
            accounts: [
              {
                id: "acc-main",
                provider: "codex",
                status: "ready",
                quota: {
                  session: { used_percent: 12, reset_at: "2099-01-02T00:00:00Z" },
                  weekly: { used_percent: 20, reset_at: "2099-01-07T00:00:00Z" },
                  limit_reached: false,
                  last_updated: "2099-01-01T00:00:00Z",
                },
                created_at: "2099-01-01T00:00:00Z",
                updated_at: "2099-01-01T00:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v1/daemon/info")) {
        return new Response(
          JSON.stringify({
            pid: 321,
            addr: "127.0.0.1:7777",
            public_base_url: "http://localhost:7777",
            restart_supported: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v1/accounts/import/codex/candidate")) {
        return new Response(JSON.stringify({ found: false }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      throw new Error(`unexpected request: ${url}`);
    });

    render(<App />);

    const accountNodes = await screen.findAllByText("acc-main");
    expect(accountNodes.length).toBeGreaterThan(0);

    const refreshButton = screen.getByRole("button", { name: /Refresh/i });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(statusCallCount(fetchMock)).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows status request errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/v1/status")) {
        return new Response("service unavailable", { status: 503, statusText: "Service Unavailable" });
      }

      if (url.endsWith("/v1/daemon/info")) {
        return new Response(
          JSON.stringify({
            pid: 321,
            addr: "127.0.0.1:7777",
            public_base_url: "http://localhost:7777",
            restart_supported: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v1/accounts/import/codex/candidate")) {
        return new Response(JSON.stringify({ found: false }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      throw new Error(`unexpected request: ${url}`);
    });

    render(<App />);

    await screen.findByText("HTTP 503: service unavailable");
  });

  it("shows account switch errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/v1/status")) {
        return new Response(
          JSON.stringify({
            active_account_id: "acc-main",
            strategy: "round-robin",
            accounts: [
              {
                id: "acc-main",
                provider: "codex",
                status: "ready",
                quota: {
                  session: { used_percent: 12, reset_at: "2099-01-02T00:00:00Z" },
                  weekly: { used_percent: 20, reset_at: "2099-01-07T00:00:00Z" },
                  limit_reached: false,
                  last_updated: "2099-01-01T00:00:00Z",
                },
                created_at: "2099-01-01T00:00:00Z",
                updated_at: "2099-01-01T00:00:00Z",
              },
              {
                id: "acc-alt",
                provider: "codex",
                status: "ready",
                quota: {
                  session: { used_percent: 30, reset_at: "2099-01-02T00:00:00Z" },
                  weekly: { used_percent: 35, reset_at: "2099-01-07T00:00:00Z" },
                  limit_reached: false,
                  last_updated: "2099-01-01T00:00:00Z",
                },
                created_at: "2099-01-01T00:00:00Z",
                updated_at: "2099-01-01T00:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v1/daemon/info")) {
        return new Response(
          JSON.stringify({
            pid: 321,
            addr: "127.0.0.1:7777",
            public_base_url: "http://localhost:7777",
            restart_supported: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v1/accounts/import/codex/candidate")) {
        return new Response(JSON.stringify({ found: false }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.endsWith("/v1/accounts/acc-alt/activate")) {
        return new Response("activate failed", { status: 500, statusText: "Internal Server Error" });
      }

      throw new Error(`unexpected request: ${url}`);
    });

    render(<App />);

    const useButton = await screen.findByRole("button", { name: "使用" });
    fireEvent.click(useButton);

    await screen.findByText("HTTP 500: activate failed");
  });

  it("hides codex candidate after dismiss and keeps it dismissed on refresh", async () => {
    let candidateCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/v1/status")) {
        return new Response(
          JSON.stringify({
            active_account_id: "acc-main",
            strategy: "round-robin",
            accounts: [
              {
                id: "acc-main",
                provider: "codex",
                status: "ready",
                quota: {
                  session: { used_percent: 12, reset_at: "2099-01-02T00:00:00Z" },
                  weekly: { used_percent: 20, reset_at: "2099-01-07T00:00:00Z" },
                  limit_reached: false,
                  last_updated: "2099-01-01T00:00:00Z",
                },
                created_at: "2099-01-01T00:00:00Z",
                updated_at: "2099-01-01T00:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v1/daemon/info")) {
        return new Response(
          JSON.stringify({
            pid: 321,
            addr: "127.0.0.1:7777",
            public_base_url: "http://localhost:7777",
            restart_supported: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v1/accounts/import/codex/candidate")) {
        candidateCalls += 1;
        return new Response(
          JSON.stringify({
            found: true,
            candidate: {
              id: "local-1",
              provider: "codex",
              account_id_present: true,
            },
            already_exists: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`unexpected request: ${url}`);
    });

    render(<App />);

    await screen.findByText("检测到本地 Codex 登录，可导入 Switchly 账号列表");
    fireEvent.click(screen.getByRole("button", { name: "暂不导入" }));

    expect(screen.queryByText("检测到本地 Codex 登录，可导入 Switchly 账号列表")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => {
      expect(statusCallCount(fetchMock)).toBeGreaterThanOrEqual(2);
    });

    expect(screen.queryByText("检测到本地 Codex 登录，可导入 Switchly 账号列表")).toBeNull();
    expect(candidateCalls).toBe(1);
  });
});

function statusCallCount(mockFn: { mock: { calls: unknown[][] } }) {
  return mockFn.mock.calls.filter(([url]) => String(url).endsWith("/v1/status")).length;
}
