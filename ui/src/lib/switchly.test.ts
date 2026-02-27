import { describe, expect, it } from "vitest";
import { fmtResetExactUTC, fmtResetHint } from "./switchly";

describe("switchly quota time formatting", () => {
  it("formats reset exact time in UTC", () => {
    expect(fmtResetExactUTC("2099-01-02T03:04:05Z")).toBe("重置时间 2099-01-02 03:04:05 UTC");
  });

  it("returns undefined exact time for invalid reset values", () => {
    expect(fmtResetExactUTC(undefined)).toBeUndefined();
    expect(fmtResetExactUTC("0001-01-01T00:00:00Z")).toBeUndefined();
    expect(fmtResetExactUTC("not-a-date")).toBeUndefined();
  });

  it("keeps relative reset hint behavior", () => {
    const nowMs = new Date("2099-01-01T00:00:00Z").getTime();
    expect(fmtResetHint("2099-01-03T00:00:00Z", nowMs)).toBe("2天后");
  });
});
