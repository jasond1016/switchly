import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuotaCell } from "./quota-cell";

describe("QuotaCell", () => {
  it("renders relative reset hint and exposes exact reset time via title", () => {
    render(
      <QuotaCell
        label="Session"
        window={{ used_percent: 12, reset_at: "2099-01-03T00:00:00Z" }}
        nowMs={new Date("2099-01-01T00:00:00Z").getTime()}
        limitReached={false}
      />,
    );

    const resetHintNode = screen.getByText("2天后");
    expect(resetHintNode.getAttribute("title")).toBe("重置时间 2099-01-03 00:00:00 UTC");
  });
});
