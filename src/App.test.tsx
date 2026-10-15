import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaults, type Snapshot, type Task } from "./domain";
import { makeTask } from "./test-fixtures";
const backend = vi.hoisted(() => ({
  data: null as Snapshot | null,
  fail: false,
}));
vi.mock("./platform", () => ({
  prepareWindow: vi.fn(async () => {}),
  setTop: vi.fn(async () => {}),
  windowAction: vi.fn(async () => {}),
  repository: {
    load: vi.fn(async () => structuredClone(backend.data)),
    saveTask: vi.fn(async (task: Task) => {
      if (backend.fail) throw new Error("磁盘错误");
      backend.data!.tasks = [
        ...backend.data!.tasks.filter((t) => t.id !== task.id),
        task,
      ];
    }),
    saveSettings: vi.fn(async (settings: Snapshot["settings"]) => {
      backend.data!.settings = settings;
    }),
    deleteTask: vi.fn(async (id: string) => {
      backend.data!.tasks = backend.data!.tasks.filter((t) => t.id !== id);
    }),
    saveMark: vi.fn(async () => {}),
    reorder: vi.fn(async () => {}),
    exportBackup: vi.fn(),
    readBackup: vi.fn(),
    importBackup: vi.fn(),
  },
}));
import App from "./App";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 14, 12));
  backend.fail = false;
  backend.data = {
    tasks: [
      makeTask({ title: "调研计划" }),
      makeTask({ id: "b", title: "第二件小事", sort_order: 1 }),
    ],
    categories: [
      {
        id: "work",
        name: "工作",
        color: "#8565B8",
        is_builtin: true,
        sort_order: 0,
      },
    ],
    day_marks: [],
    settings: { ...defaults },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function startFocus() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "专注编辑" });
  await waitFor(() =>
    expect(screen.queryByText("正在展开你的星轨…")).toBeNull(),
  );
  await user.click(screen.getByRole("button", { name: "专注编辑" }));
  await waitFor(() => expect(screen.getByText("当日清单")).toBeDefined());
  await user.click(screen.getByRole("button", { name: "今天" }));
  return user;
}
describe("双视图实际交互", () => {
  it("中文输入法组合期间 Escape 不清空详情草稿", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    const description = screen.getByLabelText("详细计划");
    await user.type(description, "中文输入中的草稿");
    fireEvent.keyDown(description, { key: "Escape", isComposing: true });
    expect(description).toHaveProperty("value", "中文输入中的草稿");
    fireEvent.keyDown(description, { key: "Escape", isComposing: false });
    expect(description).toHaveProperty("value", "");
  });
  it("七天分组新增绑定日期，月历实时同步", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: "月历" });
    await user.click(screen.getByRole("button", { name: "选择 2026-10-14" }));
    const input = screen.getByRole("textbox", {
      name: "2026-10-16 新任务标题",
    });
    await user.type(input, "日历交互开发{Enter}");
    await waitFor(() =>
      expect(
        backend.data!.tasks.some(
          (t) => t.title === "日历交互开发" && t.date === "2026-10-16",
        ),
      ).toBe(true),
    );
    expect(
      within(screen.getByRole("region", { name: "月历" })).getByRole("button", {
        name: "日历交互开发",
      }),
    ).toBeDefined();
  });
  it("编辑几千字多行详情，切换任务自动保存", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    const text =
      "中文计划\n1. 功能设计\n2. 用户反馈\n\n下一步：形成初稿。".repeat(100);
    await user.click(screen.getByLabelText("详细计划"));
    await user.paste(text);
    await user.click(screen.getByRole("button", { name: "第二件小事" }));
    await waitFor(() =>
      expect(backend.data!.tasks.find((t) => t.id === "a")?.description).toBe(
        text,
      ),
    );
    expect(screen.getByLabelText("任务标题")).toHaveProperty(
      "value",
      "第二件小事",
    );
  });
  it("保存失败保留文字并阻止切换", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.type(screen.getByLabelText("详细计划"), "尚未保存的内容");
    backend.fail = true;
    await user.click(screen.getByRole("button", { name: "第二件小事" }));
    await screen.findByText("保存失败，你的输入仍保留在这里。");
    expect(screen.getByLabelText("详细计划")).toHaveProperty(
      "value",
      "尚未保存的内容",
    );
    expect(screen.getByLabelText("任务标题")).toHaveProperty(
      "value",
      "调研计划",
    );
  });
  it("完成与取消完成保留优先级，删除后可撤销", async () => {
    backend.data!.tasks[0].priority = 2;
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "完成 调研计划" }));
    await user.click(
      await screen.findByRole("button", { name: "取消完成 调研计划" }),
    );
    expect(backend.data!.tasks.find((t) => t.id === "a")).toMatchObject({
      completed: false,
      priority: 2,
    });
    await user.click(screen.getByRole("button", { name: "调研计划 非常重要" }));
    await user.click(screen.getByRole("button", { name: "删除任务" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "删除任务",
      }),
    );
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(2));
  });
  it("Escape 取消草稿，不写入数据库", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    const title = screen.getByLabelText("任务标题");
    await user.clear(title);
    await user.type(title, "未保存标题{Escape}");
    expect(title).toHaveProperty("value", "调研计划");
    expect(backend.data!.tasks[0].title).toBe("调研计划");
  });
});
