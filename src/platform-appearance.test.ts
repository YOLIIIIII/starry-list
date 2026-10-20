import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  supported: true,
  set: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async () => native.supported),
}));
vi.mock("@tauri-apps/api/window", () => ({
  Effect: { Acrylic: "acrylic" },
  getCurrentWindow: () => ({
    setEffects: native.set,
    clearEffects: native.clear,
  }),
}));
import { applyFrost } from "./platform";
beforeEach(() => {
  native.supported = true;
  native.set.mockReset().mockResolvedValue(undefined);
  native.clear.mockReset().mockResolvedValue(undefined);
});
describe("原生毛玻璃边界", () => {
  it("支持时请求 Acrylic，关闭后清除", async () => {
    expect(await applyFrost(true)).toBe(true);
    expect(native.set).toHaveBeenCalledWith({ effects: ["acrylic"] });
    expect(await applyFrost(false)).toBe(false);
    expect(native.clear).toHaveBeenCalledOnce();
  });
  it("不支持时只清除，不走旧系统的低性能效果", async () => {
    native.supported = false;
    expect(await applyFrost(true)).toBe(false);
    expect(native.set).not.toHaveBeenCalled();
    expect(native.clear).toHaveBeenCalledOnce();
  });
  it("异步旧请求按序完成，最终清除；失败后可以重试", async () => {
    let release!: () => void;
    native.set.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const first = applyFrost(true),
      last = applyFrost(false);
    await vi.waitFor(() => expect(native.set).toHaveBeenCalledOnce());
    expect(native.clear).not.toHaveBeenCalled();
    release();
    await first;
    await last;
    expect(native.clear).toHaveBeenCalledOnce();
    native.set.mockRejectedValueOnce(new Error("GPU"));
    await expect(applyFrost(true)).rejects.toThrow("GPU");
    await expect(applyFrost(false)).resolves.toBe(false);
  });
});
