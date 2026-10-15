import { describe, it, expect } from "vitest";
import { visibleBounds } from "./window-bounds";
describe("窗口在显示器变化后可访问", () => {
  const main = { x: 0, y: 0, width: 1920, height: 1040 };
  it("正常位置保持不变", () => {
    const s = { x: 200, y: 150, width: 980, height: 680 };
    expect(visibleBounds(s, [main])).toEqual(s);
  });
  it("被移除的显示器位置回到主工作区", () => {
    const b = visibleBounds({ x: 2500, y: 200, width: 980, height: 680 }, [
      main,
    ]);
    expect(b).toEqual({ x: 470, y: 180, width: 980, height: 680 });
  });
  it("保留负坐标显示器上的合法位置", () => {
    const s = { x: -1400, y: 100, width: 980, height: 680 };
    expect(visibleBounds(s, [main, { ...main, x: -1920 }])).toEqual(s);
  });
  it("DPI/分辨率下降时限制尺寸", () => {
    expect(
      visibleBounds({ x: 0, y: 0, width: 4000, height: 2000 }, [main]),
    ).toEqual(main);
  });
  it("靠边窗口完整移入工作区", () => {
    const b = visibleBounds({ x: 1800, y: 900, width: 980, height: 680 }, [
      main,
    ]);
    expect(b.x + b.width).toBe(1920);
    expect(b.y + b.height).toBe(1040);
  });
  it("没有显示器信息时不猜测坐标", () => {
    const s = { x: 0, y: 0, width: 980, height: 680 };
    expect(visibleBounds(s, [])).toEqual(s);
  });
});
