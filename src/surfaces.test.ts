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
  it.each(["reading", "glass", "frosted"] as const)(
    "%s 仍随滑块增强，实色完全不透视",
    (mode) => {
      for (const frost of [false, true]) {
        let previous = surfaceAlphas(0.4, false, mode, frost);
        for (let i = 40; i <= 100; i++) {
          const current = surfaceAlphas(i / 100, false, mode, frost);
          expect(current["--background-alpha"]).toBe(i / 100);
          for (const key of Object.keys(current) as (keyof typeof current)[]) {
            expect(current[key]).toBeGreaterThanOrEqual(previous[key]);
            expect(current[key]).toBeLessThanOrEqual(1);
          }
          previous = current;
        }
        expect(
          Object.values(surfaceAlphas(0.4, true, mode, frost)).every(
            (x) => x === 1,
          ),
        ).toBe(true);
      }
    },
  );
  it("材质差异真实，失去原生模糊时提高整面保护，不依赖任务底贴", () => {
    const reading = surfaceAlphas(0.4, false),
      light = surfaceAlphas(0.4, false, "glass"),
      dream = surfaceAlphas(0.4, false, "frosted", true),
      fallback = surfaceAlphas(0.4, false, "frosted", false);
    expect(reading["--panel-alpha"]).toBeGreaterThan(light["--panel-alpha"]);
    expect(light["--panel-alpha"]).toBeGreaterThan(dream["--panel-alpha"]);
    expect(fallback["--panel-alpha"]).toBeGreaterThan(dream["--panel-alpha"]);
    for (const a of [light, dream, fallback])
      expect(
        over(a["--panel-alpha"], a["--background-alpha"]),
      ).toBeGreaterThanOrEqual(0.76);
  });
});
