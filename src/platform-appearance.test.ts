import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  supported: true,
  set: vi.fn(),
  clear: vi.fn(),
  capability: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: native.capability,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    clearEffects: native.clear,
  }),
}));
let applyFrost: typeof import("./platform").applyFrost;
beforeEach(async () => {
  vi.resetModules();
  ({ applyFrost } = await import("./platform"));
  native.supported = true;
  native.set.mockReset().mockResolvedValue(true);
  native.clear.mockReset().mockResolvedValue(undefined);
  native.capability
    .mockReset()
    .mockImplementation(
      async (command: string, args?: { enabled: boolean }) => {
        if (command === "native_frost_supported") return native.supported;
        return args?.enabled ? native.set() : false;
      },
    );
});
describe("原生毛玻璃边界", () => {
  it("系统策略拒绝材质时返回降级，不把能力支持误认作应用成功", async () => {
    native.set.mockResolvedValueOnce(false);
    expect(await applyFrost(true)).toBe(false);
    expect(native.set).toHaveBeenCalledOnce();
    expect(await applyFrost(true)).toBe(true);
    expect(native.set).toHaveBeenCalledTimes(2);
  });
  it("支持时建立合成材质，关闭后清除", async () => {
    expect(await applyFrost(true)).toBe(true);
    expect(native.capability).toHaveBeenCalledWith("native_frost", {
      enabled: true,
    });
    expect(native.clear.mock.invocationCallOrder[0]).toBeLessThan(
      native.set.mock.invocationCallOrder[0],
    );
    expect(await applyFrost(false)).toBe(false);
    expect(native.clear).toHaveBeenCalledTimes(2);
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
        new Promise<boolean>((r) => {
          release = () => r(true);
        }),
    );
    const first = applyFrost(true);
    await vi.waitFor(() => expect(native.set).toHaveBeenCalledOnce());
    const last = applyFrost(false);
    expect(native.clear).toHaveBeenCalledOnce();
    release();
    await first;
    await last;
    expect(native.clear).toHaveBeenCalledTimes(2);
    native.set.mockRejectedValueOnce(new Error("GPU"));
    await expect(applyFrost(true)).rejects.toThrow("GPU");
    await expect(applyFrost(false)).resolves.toBe(false);
  });
  it("相同已完成请求不重复叠加原生效果", async () => {
    await applyFrost(true);
    for (let i = 0; i < 30; i++) expect(await applyFrost(true)).toBe(true);
    expect(native.set).toHaveBeenCalledOnce();
    expect(native.clear).toHaveBeenCalledOnce();
    await applyFrost(false);
    await applyFrost(false);
    expect(native.clear).toHaveBeenCalledTimes(2);
  });
  it("尚未执行的旧请求跳过，只执行最新材质", async () => {
    await Promise.all([applyFrost(true), applyFrost(false), applyFrost(true)]);
    expect(native.set).toHaveBeenCalledOnce();
    expect(native.clear).toHaveBeenCalledOnce();
  });
  it("能力查询迟到时不覆盖已改为关闭的选择", async () => {
    let release!: (value: boolean) => void;
    native.capability.mockImplementationOnce(
      () =>
        new Promise<boolean>((r) => {
          release = r;
        }),
    );
    const old = applyFrost(true);
    await vi.waitFor(() => expect(native.capability).toHaveBeenCalledOnce());
    const latest = applyFrost(false);
    release(true);
    await Promise.all([old, latest]);
    expect(native.set).not.toHaveBeenCalled();
    expect(native.clear).toHaveBeenCalledOnce();
  });
  it("原生应用部分失败也清除，再允许重试", async () => {
    let material = false;
    native.clear.mockImplementation(async () => {
      material = false;
    });
    native.set.mockImplementationOnce(async () => {
      material = true;
      throw Error("partial apply");
    });
    await expect(applyFrost(true)).rejects.toThrow("partial apply");
    expect(material).toBe(false);
    expect(native.clear).toHaveBeenCalledTimes(2);
    await expect(applyFrost(true)).resolves.toBe(true);
    expect(native.set).toHaveBeenCalledTimes(2);
  });
  it("清理失败不记录成功缓存，下一次请求可恢复", async () => {
    native.clear.mockRejectedValueOnce(Error("clear failed"));
    await expect(applyFrost(true)).rejects.toThrow("clear failed");
    expect(native.set).not.toHaveBeenCalled();
    await expect(applyFrost(true)).resolves.toBe(true);
  });
});
