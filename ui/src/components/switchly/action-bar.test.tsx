import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionBar } from "./action-bar";

function renderActionBar() {
  const onStrategyChange = vi.fn();
  const onQuotaRefreshCadenceChange = vi.fn();
  const onSyncQuota = vi.fn();
  const onSyncQuotaAll = vi.fn();
  const onSimulateLimit = vi.fn();

  const view = render(
    <ActionBar
      strategy="round-robin"
      quotaRefreshCadence="manual"
      quotaSyncBusy={false}
      quotaSyncAllBusy={false}
      simBusy={false}
      syncNotice={null}
      error=""
      onStrategyChange={onStrategyChange}
      onQuotaRefreshCadenceChange={onQuotaRefreshCadenceChange}
      onSyncQuota={onSyncQuota}
      onSyncQuotaAll={onSyncQuotaAll}
      onSimulateLimit={onSimulateLimit}
    />,
  );

  return { view, onQuotaRefreshCadenceChange };
}

describe("ActionBar", () => {
  it("uses app-styled cadence dropdown and emits selected value", () => {
    const { onQuotaRefreshCadenceChange } = renderActionBar();
    const cadenceSelect = screen.getByRole("combobox");
    const classes = cadenceSelect.getAttribute("class") ?? "";

    expect(classes.includes("appearance-none")).toBe(true);

    fireEvent.change(cadenceSelect, { target: { value: "5min" } });
    expect(onQuotaRefreshCadenceChange).toHaveBeenCalledWith("5min");
  });

  it("renders a custom chevron indicator next to cadence dropdown", () => {
    const { view } = renderActionBar();
    const icon = view.container.querySelector("svg.lucide-chevron-down");

    expect(icon).not.toBeNull();
  });
});
