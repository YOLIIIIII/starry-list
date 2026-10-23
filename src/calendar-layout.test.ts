import { describe, expect, it, vi } from "vitest";
import { observeCalendar, previewCapacity } from "./calendar-layout";

describe("月历实际剩余空间", () => {
  it.each([
    [80, 3, 0],
    [80, 22, 0],
    [80, 23, 1],
    [80, 42, 1],
    [80, 43, 2],
    [64, 43, 1],
    [49, 100, 0],
  ])("宽 %s / 剩余 %s 不裁切任务行", (width, remaining, result) => {
    expect(previewCapacity(width, remaining, 17, 3, 5)).toBe(result);
  });
  it("大字号月历按实际行高计算，并保留一像素安全空间", () => {
    expect(previewCapacity(80, 50, 20, 5, 5)).toBe(1);
    expect(previewCapacity(80, 51, 20, 5, 5)).toBe(2);
  });
  it("角标换行时只降级，避免 +N 隐藏后反复升级", () => {
    expect(previewCapacity(80, 100, 17, 3, 5, 1)).toBe(1);
    expect(previewCapacity(80, 100, 17, 3, 5, 0)).toBe(0);
  });
  it("观察实际日期栏；同尺寸不振荡，真正缩放可恢复密度，卸载清理", () => {
    let resize!: () => void, frame!: FrameRequestCallback;
    const disconnect = vi.fn(),
      cancel = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const grid = document.createElement("div");
    grid.innerHTML =
      '<div class="day-cell"><button class="date-select"></button></div>';
    const cell = grid.firstElementChild as HTMLElement,
      header = cell.firstElementChild as HTMLElement;
    for (const [key, value] of Object.entries({
      "--calendar-preview-height": "17px",
      "--preview-gap": "3px",
      "--calendar-preview-inset": "5px",
      "--calendar-preview-capacity": "2",
    }))
      grid.style.setProperty(key, value);
    cell.style.cssText = "padding:5px 4px;border:1px solid";
    let height = 80,
      headerHeight = 25;
    vi.spyOn(cell, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, 80, height),
    );
    vi.spyOn(header, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, 80, headerHeight),
    );
    const limit = vi.fn();
    try {
      const cleanup = observeCalendar(grid, limit);
      expect(limit).toHaveBeenLastCalledWith(2);
      expect(grid.style.getPropertyValue("--calendar-row-min")).toBe("41px");
      headerHeight = 40;
      resize();
      frame(0);
      expect(limit).toHaveBeenLastCalledWith(1);
      headerHeight = 25;
      resize();
      frame(0);
      expect(limit).toHaveBeenLastCalledWith(1);
      height = 81;
      resize();
      frame(0);
      expect(limit).toHaveBeenLastCalledWith(2);
      cleanup();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
