import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionBar } from "./action-bar";

function renderActionBar() {
  const onQuotaRefreshCadenceChange = vi.fn();
  const onSyncQuotaAll = vi.fn();

  const view = render(
    <ActionBar
      quotaRefreshCadence="manual"
      quotaSyncAllBusy={false}
      syncNotice={null}
      error=""
      onQuotaRefreshCadenceChange={onQuotaRefreshCadenceChange}
      onSyncQuotaAll={onSyncQuotaAll}
    />,
  );

  return { view, onQuotaRefreshCadenceChange, onSyncQuotaAll };
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

  it("renders only sync-all action and emits click", () => {
    const { onSyncQuotaAll } = renderActionBar();

    fireEvent.click(screen.getByRole("button", { name: /Sync All Quotas/i }));
    expect(onSyncQuotaAll).toHaveBeenCalledTimes(1);
  });
});
