import { describe, it, expect, vi } from "vitest";
import { AppStore } from "./store";
import type { Repository } from "./platform";
import { defaults, type Snapshot } from "./domain";
import { makeTask } from "./test-fixtures";
import { orderSignature } from "./task-order";
function fixture() {
  let persisted: Snapshot = {
    tasks: [makeTask()],
    categories: [],
    day_marks: [],
    settings: defaults,
  };
  const repo: Repository = {
    saveWater: vi.fn(async () => {}),
    deleteWater: vi.fn(async () => {}),
    load: vi.fn(async () => structuredClone(persisted)),
    saveTask: vi.fn(async (t) => {
      await new Promise((r) => setTimeout(r, 5));
      persisted = {
        ...persisted,
        tasks: [...persisted.tasks.filter((v) => v.id !== t.id), t],
      };
    }),
    deleteTask: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    saveMark: vi.fn(async () => {}),
    reorder: vi.fn(async () => {}),
    exportBackup: vi.fn(async () => true),
    readBackup: vi.fn(async () => null),
    importBackup: vi.fn(async () => {}),
  };
  return { repo, store: new AppStore(repo), persisted: () => persisted };
}
describe("可靠持久化和并发", () => {
  it("排序拒绝遗漏、重复、陌生及跨组 ID，不调用持久化", async () => {
    const { store, repo } = fixture();
    await store.load();
    await store.add(makeTask({ id: "b", completed: true }));
    for (const ids of [["a"], ["a", "a"], ["a", "other"], ["b", "a"]])
      await expect(store.reorder(makeTask().date, ids)).rejects.toThrow(
        "排序列表已变更",
      );
    expect(repo.reorder).not.toHaveBeenCalled();
  });
  it("排序失败保留全部字段，重试成功只改变排序", async () => {
    const { store, repo } = fixture();
    await store.load();
    await store.add(makeTask({ id: "b", sort_order: 1 }));
    const before = structuredClone(store.getSnapshot().data.tasks);
    vi.mocked(repo.reorder).mockRejectedValueOnce(new Error("排序写入失败"));
    await expect(store.reorder(makeTask().date, ["b", "a"])).rejects.toThrow(
      "排序写入失败",
    );
    expect(store.getSnapshot().data.tasks).toEqual(before);
    await store.reorder(makeTask().date, ["b", "a"]);
    expect(store.getSnapshot().data.tasks).toEqual(
      before.map((t) => ({ ...t, sort_order: t.id === "b" ? 0 : 1 })),
    );
  });
  it("队列中的任务变化使旧排序签名失效，后续排序可重试", async () => {
    const { store, repo } = fixture();
    await store.load();
    await store.add(makeTask({ id: "b", sort_order: 1 }));
    const signature = orderSignature(store.getSnapshot().data.tasks);
    const update = store.patchTask("a", { title: "新标题" });
    const reorder = store.reorder(makeTask().date, ["b", "a"], signature);
    await expect(reorder).rejects.toThrow("排序列表已变更");
    await update;
    expect(repo.reorder).not.toHaveBeenCalled();
    await store.reorder(
      makeTask().date,
      ["b", "a"],
      orderSignature(store.getSnapshot().data.tasks),
    );
    expect(repo.reorder).toHaveBeenCalledTimes(1);
  });
  it("重复恢复同一 ID 时，界面与数据库均保持唯一任务", async () => {
    const { store, persisted } = fixture();
    await store.load();
    const task = makeTask({ id: "restored" });
    await Promise.all([store.restore(task), store.restore(task)]);
    expect(store.getSnapshot().data.tasks).toHaveLength(2);
    expect(persisted().tasks).toHaveLength(2);
    expect(store.getSnapshot().data.tasks).toEqual(persisted().tasks);
  });
  it("快速修改串行执行，不覆盖已有字段", async () => {
    const { store, persisted } = fixture();
    await store.load();
    await Promise.all([
      store.patchTask("a", { description: "中文\n多行文本" }),
      store.patchTask("a", { priority: 2 }),
      store.patchTask("a", (t) => ({ completed: !t.completed })),
    ]);
    expect(persisted().tasks[0]).toMatchObject({
      description: "中文\n多行文本",
      priority: 2,
      completed: true,
    });
    expect(store.getSnapshot().pending).toBe(0);
  });
  it("写入失败保留旧数据，后续操作仍可继续", async () => {
    const { store, repo } = fixture();
    await store.load();
    vi.mocked(repo.saveTask).mockRejectedValueOnce(new Error("磁盘已满"));
    await expect(store.patchTask("a", { title: "新标题" })).rejects.toThrow(
      "磁盘已满",
    );
    expect(store.getSnapshot().data.tasks[0].title).toBe(makeTask().title);
    expect(store.getSnapshot().error).toBe("磁盘已满");
    await store.patchTask("a", { priority: 1 });
    expect(store.getSnapshot().data.tasks[0].priority).toBe(1);
  });
  it("失败新增不会产生幽灵任务", async () => {
    const { store, repo } = fixture();
    await store.load();
    vi.mocked(repo.saveTask).mockRejectedValueOnce(new Error("无法写入"));
    await expect(store.add(makeTask({ id: "new" }))).rejects.toThrow();
    expect(store.getSnapshot().data.tasks).toHaveLength(1);
  });
  it("两次快速完成保持独立优先级", async () => {
    const { store } = fixture();
    await store.load();
    await store.patchTask("a", { priority: 2 });
    await Promise.all([
      store.patchTask("a", (t) => ({ completed: !t.completed })),
      store.patchTask("a", (t) => ({ completed: !t.completed })),
    ]);
    expect(store.getSnapshot().data.tasks[0]).toMatchObject({
      completed: false,
      priority: 2,
    });
  });
});
