import { describe, it, expect } from "vitest";
import { focusWaterSummary } from "./water-layout";
describe("focus water layout budget", () => {
  it("keeps a normal standard card and protects large text reading space", () => {
    expect(focusWaterSummary(280, 103, 744, false, false)).toBe(false);
    expect(focusWaterSummary(260, 168, 744, true, false)).toBe(true);
  });
  it("accounts for narrow wrapping even in a tall window, without always collapsing", () => {
    expect(focusWaterSummary(330, 176, 688, true, false)).toBe(true);
    expect(focusWaterSummary(700, 176, 688, true, false)).toBe(false);
    expect(focusWaterSummary(280, 250, 440, true, false)).toBe(true);
  });
  it("uses a 20px exit margin to avoid repeated threshold changes", () => {
    expect(focusWaterSummary(330, 168, 744, true, false)).toBe(false);
    expect(focusWaterSummary(330, 168, 744, true, true)).toBe(true);
    expect(focusWaterSummary(360, 168, 744, true, true)).toBe(false);
  });
});
