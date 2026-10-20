import { describe, expect, it } from "vitest";
import { surfaceAlphas } from "./surfaces";
const over = (top: number, bottom: number) => top + bottom * (1 - top);
describe("透明外壳与阅读衬底", () => {
  it("外壳保持 40/70/100% 的真实差异，所有阅读层单调增强", () => {
    let previous = surfaceAlphas(0.4, false);
    for (let step = 40; step <= 100; step++) {
      const current = surfaceAlphas(step / 100, false);
      expect(current["--background-alpha"]).toBe(step / 100);
      for (const key of Object.keys(current) as (keyof typeof current)[]) {
        expect(current[key]).toBeGreaterThanOrEqual(previous[key]);
        expect(current[key]).toBeLessThanOrEqual(1);
      }
      previous = current;
    }
  });
  it.each([0.4, 0.7, 1])("%s 的关键阅读区至少隔绝 99% 底层背景", (value) => {
    const a = surfaceAlphas(value, false);
    const shell = a["--background-alpha"];
    expect(over(a["--panel-alpha"], shell)).toBeGreaterThanOrEqual(0.99);
    expect(
      over(a["--cell-alpha"], over(a["--readability-alpha"], shell)),
    ).toBeGreaterThanOrEqual(0.99);
    expect(over(a["--header-alpha"], shell)).toBeGreaterThanOrEqual(0.97);
  });
  it("实色/原生不透明回退所有背景完全不透明，100% 无残余透视", () => {
    expect(Object.values(surfaceAlphas(0.4, true))).toEqual([1, 1, 1, 1, 1]);
    expect(Object.values(surfaceAlphas(1, false))).toEqual([1, 1, 1, 1, 1]);
  });
});
