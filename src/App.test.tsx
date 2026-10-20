import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaults, type Snapshot, type Task } from "./domain";
import { makeTask } from "./test-fixtures";
const backend = vi.hoisted(() => ({
  data: null as Snapshot | null,
  fail: false,
  saveWait: null as Promise<void> | null,
  deleteFail: false,
  deleteWait: null as Promise<void> | null,
}));
vi.mock("./platform", () => ({
  prepareWindow: vi.fn(async () => {}),
  setTop: vi.fn(async () => {}),
  windowAction: vi.fn(async () => {}),
  applyFrost: vi.fn(async () => false),
  repository: {
    load: vi.fn(async () => structuredClone(backend.data)),
    saveTask: vi.fn(async (task: Task) => {
      if (backend.saveWait) await backend.saveWait;
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
      if (backend.deleteWait) await backend.deleteWait;
      if (backend.deleteFail) throw new Error("删除失败：磁盘错误");
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
describe("SL-003 背景设置", () => {
  it("外观模式保存并重新加载，失败保留原模式和错误反馈", async () => {
    const user = userEvent.setup();
    const ui = render(<App />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    for (const [name, mode] of [
      ["轻玻璃", "glass"],
      ["梦幻毛玻璃", "frosted"],
      ["阅读优先", "reading"],
    ]) {
      await user.click(
        screen.getByRole("radio", { name: new RegExp("^" + name) }),
      );
      await waitFor(() =>
        expect(backend.data!.settings.appearance_mode).toBe(mode),
      );
      expect(
        document.querySelector(".app-shell")?.getAttribute("data-appearance"),
      ).toBe(mode);
    }
    await user.click(screen.getByRole("radio", { name: /^轻玻璃/ }));
    await waitFor(() =>
      expect(backend.data!.settings.appearance_mode).toBe("glass"),
    );
    ui.unmount();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    expect(screen.getByRole("radio", { name: /^轻玻璃/ })).toHaveProperty(
      "checked",
      true,
    );
    const { repository } = await import("./platform");
    vi.mocked(repository.saveSettings).mockRejectedValueOnce(
      new Error("设置保存失败"),
    );
    await user.click(screen.getByRole("radio", { name: /^阅读优先/ }));
    await screen.findByText("设置保存失败");
    expect(backend.data!.settings.appearance_mode).toBe("glass");
    expect(screen.getByRole("radio", { name: /^轻玻璃/ })).toHaveProperty(
      "checked",
      true,
    );
  });
  it.each([40, 70, 100])(
    "%s%% 实时改变外壳并可靠保存原滑块数值",
    async (value) => {
      const user = userEvent.setup();
      render(<App />);
      await user.click(await screen.findByRole("button", { name: "设置" }));
      const slider = screen.getByRole("slider", { name: /背景不透明度/ });
      fireEvent.change(slider, { target: { value: String(value) } });
      const shell = document.querySelector<HTMLElement>(".app-shell")!;
      expect(Number(shell.style.getPropertyValue("--background-alpha"))).toBe(
        value / 100,
      );
      expect(
        Number(shell.style.getPropertyValue("--panel-alpha")),
      ).toBeGreaterThanOrEqual(0.964);
      fireEvent.pointerUp(slider);
      await waitFor(() =>
        expect(backend.data!.settings.background_opacity).toBe(value / 100),
      );
    },
  );
  it("实色回退不覆盖原透明度，关闭回退恢复已保存偏好", async () => {
    backend.data!.settings.background_opacity = 0.4;
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "设置" }));
    const toggle = screen.getByRole("checkbox", { name: /实色背景回退/ });
    await user.click(toggle);
    await waitFor(() =>
      expect(backend.data!.settings.opaque_fallback).toBe(true),
    );
    expect(screen.getByRole("slider", { name: /背景不透明度/ })).toHaveProperty(
      "disabled",
      true,
    );
    const shell = document.querySelector<HTMLElement>(".app-shell")!;
    expect(Number(shell.style.getPropertyValue("--background-alpha"))).toBe(1);
    expect(Number(shell.style.getPropertyValue("--panel-alpha"))).toBe(1);
    await user.click(toggle);
    await waitFor(() =>
      expect(Number(shell.style.getPropertyValue("--background-alpha"))).toBe(
        0.4,
      ),
    );
    expect(backend.data!.settings.background_opacity).toBe(0.4);
  });
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 14, 12));
  backend.fail = false;
  backend.saveWait = null;
  backend.deleteFail = false;
  backend.deleteWait = null;
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
describe("UX2.3 连续新增焦点", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });
  afterEach(() => {
    vi.mocked(document.hasFocus).mockRestore();
  });
  async function setup(date = "2026-10-16") {
    const user = userEvent.setup();
    render(<App />);
    const plus = await screen.findByRole("button", {
      name: `为 ${date} 添加任务`,
    });
    await user.click(plus);
    return {
      user,
      plus,
      input: screen.getByRole("textbox", { name: `${date} 新任务标题` }),
    };
  }
  it.each(["2026-10-14", "2026-10-16", "2026-10-19"])(
    "%s Enter 成功才返回原加号，第二次 Enter 可连续新增三条",
    async (date) => {
      const { user, plus } = await setup(date);
      for (let index = 0; index < 3; index++) {
        const input = screen.getByRole("textbox", {
          name: `${date} 新任务标题`,
        });
        await user.type(input, `连续新增${index}`);
        await user.keyboard("{Enter}");
        await waitFor(() => expect(document.activeElement).toBe(plus));
        expect(
          screen.queryByRole("textbox", { name: `${date} 新任务标题` }),
        ).toBeNull();
        if (index < 2) await user.keyboard("{Enter}");
      }
      expect(
        backend
          .data!.tasks.filter((t) => t.title.startsWith("连续新增"))
          .map((t) => t.date),
      ).toEqual([date, date, date]);
    },
  );
  it.each(["pointer", "blur", "navigation", "tab"])(
    "异步保存中的 %s 取消迟到的焦点恢复",
    async (intent) => {
      const { user, plus, input } = await setup();
      await user.type(input, "慢速保存");
      let finish!: () => void;
      backend.saveWait = new Promise<void>((r) => {
        finish = r;
      });
      try {
        await user.keyboard("{Enter}");
        expect(document.activeElement).not.toBe(plus);
        if (intent === "pointer")
          await user.click(screen.getByRole("heading", { name: /接下来七天/ }));
        if (intent === "blur") fireEvent(window, new Event("blur"));
        if (intent === "navigation")
          await user.click(screen.getByRole("button", { name: "专注编辑" }));
        if (intent === "tab") await user.tab();
      } finally {
        await act(async () => {
          finish();
        });
      }
      await waitFor(() =>
        expect(backend.data!.tasks.some((t) => t.title === "慢速保存")).toBe(
          true,
        ),
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(document.activeElement).not.toBe(plus);
      expect(
        backend.data!.tasks.filter((t) => t.title === "慢速保存"),
      ).toHaveLength(1);
    },
  );
  it("输入 Enter 失败保留草稿，重试成功才恢复焦点", async () => {
    const { user, plus, input } = await setup();
    await user.type(input, "失败重试");
    backend.fail = true;
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: "添加到 2026-10-16" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "添加到 2026-10-16" }).textContent,
      ).toBe("重试添加"),
    );
    expect(input).toHaveProperty("value", "失败重试");
    expect(document.activeElement).not.toBe(plus);
    backend.fail = false;
    await user.click(input);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(plus));
  });
  it("按住第一次 Enter 不提前返回加号或重复添加，释放后才返回", async () => {
    const { user, plus, input } = await setup();
    await user.type(input, "长按 Enter");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    await waitFor(() =>
      expect(backend.data!.tasks.some((t) => t.title === "长按 Enter")).toBe(
        true,
      ),
    );
    expect(document.activeElement).not.toBe(plus);
    fireEvent.keyUp(document, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(plus));
    expect(
      backend.data!.tasks.filter((t) => t.title === "长按 Enter"),
    ).toHaveLength(1);
  });
  it.each(["button", "outside"])("%s 新增成功不返回旧加号", async (source) => {
    const { user, plus, input } = await setup();
    await user.type(input, "非键盘主动保存");
    if (source === "button")
      await user.click(
        screen.getByRole("button", { name: "添加到 2026-10-16" }),
      );
    else await user.click(screen.getByRole("heading", { name: /接下来七天/ }));
    await waitFor(() =>
      expect(
        backend.data!.tasks.some((t) => t.title === "非键盘主动保存"),
      ).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).not.toBe(plus);
    expect(
      screen.queryByRole("textbox", { name: "2026-10-16 新任务标题" }),
    ).toBeNull();
  });
});
describe("双视图实际交互", () => {
  it("中文输入法组合期间 Escape 不清空详情草稿", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const description = screen.getByLabelText("详细计划");
    await user.type(description, "中文输入中的草稿");
    fireEvent.keyDown(description, { key: "Escape", isComposing: true });
    expect(description).toHaveProperty("value", "中文输入中的草稿");
    fireEvent.keyDown(description, { key: "Escape", isComposing: false });
    expect(
      screen.getByRole("dialog", { name: "保留这次修改？" }),
    ).toBeDefined();
    expect(description).toHaveProperty("value", "中文输入中的草稿");
  });
  it("七天分组新增绑定日期，月历实时同步", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: "月历" });
    await user.click(screen.getByRole("button", { name: "选择 2026-10-14" }));
    await user.click(
      screen.getByRole("button", { name: "为 2026-10-16 添加任务" }),
    );
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
    await user.click(screen.getByRole("button", { name: "编辑" }));
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
    expect(
      within(screen.getByRole("region", { name: "任务详情阅读" })).getByRole(
        "heading",
        { name: "第二件小事" },
      ),
    ).toBeDefined();
    expect(screen.queryByRole("dialog", { name: "编辑任务" })).toBeNull();
  });
  it("保存失败保留文字并阻止切换", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
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
    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "编辑任务" })).getByRole(
        "button",
        { name: "删除任务" },
      ),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "删除这件任务？" })).getByRole(
        "button",
        {
          name: "删除任务",
        },
      ),
    );
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(2));
  });
  it("Escape 取消草稿，不写入数据库", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const title = screen.getByLabelText("任务标题");
    await user.clear(title);
    await user.type(title, "未保存标题{Escape}");
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.queryByRole("dialog", { name: "编辑任务" })).toBeNull();
    expect(backend.data!.tasks[0].title).toBe("调研计划");
  });
  it("默认紧凑，点击只展示保留换行的阅读详情，不展示输入表单", async () => {
    backend.data!.tasks[0].description = "第一行\n第二行\n".repeat(220);
    const user = await startFocus();
    expect(screen.queryByRole("region", { name: "任务详情阅读" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    expect(
      screen.getByRole("region", { name: "详细计划（只读）" }).textContent,
    ).toBe(backend.data!.tasks[0].description);
    expect(screen.queryByLabelText("任务标题")).toBeNull();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("dialog", { name: "编辑任务" })).toBeDefined();
    expect(screen.getByLabelText("任务标题")).toHaveProperty(
      "value",
      "调研计划",
    );
  });
  it("保存等待持久化完成，成功后关闭面板和阅读卡片，长文本完整保留", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const text = "2000 字的详细计划\n下一步：持续改进。\n".repeat(140);
    fireEvent.change(screen.getByLabelText("详细计划"), {
      target: { value: text },
    });
    let complete!: () => void;
    backend.saveWait = new Promise<void>((resolve) => {
      complete = resolve;
    });
    await user.click(screen.getByRole("button", { name: "保存并收起" }));
    expect(screen.getByRole("dialog", { name: "编辑任务" })).toBeDefined();
    expect(backend.data!.tasks[0].description).toBeNull();
    complete();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "编辑任务" })).toBeNull(),
    );
    expect(screen.queryByRole("region", { name: "任务详情阅读" })).toBeNull();
    expect(screen.getByText("修改已保存")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    expect(
      screen.getByRole("region", { name: "详细计划（只读）" }).textContent,
    ).toBe(text);
  });
  it("Ctrl Enter 保存并收起，优先级、分类、日期和简称一并保存", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.click(screen.getByRole("button", { name: "非常重要" }));
    await user.click(screen.getByRole("button", { name: "工作" }));
    fireEvent.change(screen.getByLabelText("任务日期"), {
      target: { value: "2026-10-15" },
    });
    await user.click(screen.getByText("更多选项"));
    fireEvent.change(screen.getByLabelText(/日历简称/), {
      target: { value: "调研" },
    });
    fireEvent.keyDown(screen.getByLabelText("详细计划"), {
      key: "Enter",
      ctrlKey: true,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "编辑任务" })).toBeNull(),
    );
    expect(backend.data!.tasks.find((t) => t.id === "a")).toMatchObject({
      date: "2026-10-15",
      priority: 2,
      category_id: "work",
      short_label: "调研",
    });
  });
  it("取消或关闭时保护草稿，可继续编辑或明确放弃", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("详细计划"), {
      target: { value: "草稿" },
    });
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("详细计划")).toHaveProperty("value", "草稿");
    await user.click(
      within(screen.getByRole("dialog", { name: "编辑任务" })).getByRole(
        "button",
        { name: "关闭对话框" },
      ),
    );
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(backend.data!.tasks[0].description).toBeNull();
    expect(screen.queryByRole("dialog", { name: "编辑任务" })).toBeNull();
  });
  it("主动保存失败保留输入，不显示成功；可重试保存", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("详细计划"), {
      target: { value: "不能丢失的输入" },
    });
    backend.fail = true;
    await user.click(screen.getByRole("button", { name: "保存并收起" }));
    expect(
      await screen.findByText("保存失败，你的输入仍保留在这里。"),
    ).toBeDefined();
    expect(screen.getByLabelText("详细计划")).toHaveProperty(
      "value",
      "不能丢失的输入",
    );
    expect(screen.queryByText("修改已保存")).toBeNull();
    backend.fail = false;
    await user.click(screen.getByRole("button", { name: "保存并收起" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "编辑任务" })).toBeNull(),
    );
    expect(backend.data!.tasks.find((t) => t.id === "a")?.description).toBe(
      "不能丢失的输入",
    );
  });
  it.each(["后一天", "统筹总览"])(
    "%s 前自动保存草稿并退出面板",
    async (target) => {
      const user = await startFocus();
      await user.click(screen.getByRole("button", { name: "调研计划" }));
      await user.click(screen.getByRole("button", { name: "编辑" }));
      fireEvent.change(screen.getByLabelText("详细计划"), {
        target: { value: "切换前的草稿" },
      });
      await user.click(screen.getByRole("button", { name: target }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "编辑任务" })).toBeNull(),
      );
      expect(backend.data!.tasks.find((t) => t.id === "a")?.description).toBe(
        "切换前的草稿",
      );
    },
  );
  it("从七天日程点击任务进入对应日期的只读详情，勾选独立", async () => {
    backend.data!.tasks[0].date = "2026-10-16";
    const user = userEvent.setup();
    render(<App />);
    const agenda = await screen.findByRole("region", { name: "七天日程" });
    await user.click(
      within(agenda).getByRole("button", { name: "完成 调研计划" }),
    );
    expect(screen.queryByRole("region", { name: "任务详情阅读" })).toBeNull();
    await user.click(within(agenda).getByRole("button", { name: "调研计划" }));
    const reader = await screen.findByRole("region", { name: "任务详情阅读" });
    expect(within(reader).getByText("2026-10-16")).toBeDefined();
    expect(screen.queryByRole("dialog", { name: "编辑任务" })).toBeNull();
  });
  it("全空七天仅提示一次，所有日期默认不渲染输入框，新增后自动收起", async () => {
    backend.data!.tasks = [];
    const user = userEvent.setup();
    render(<App />);
    const agenda = await screen.findByRole("region", { name: "七天日程" });
    expect(within(agenda).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(agenda).getAllByText(/这七天还没有任务/)).toHaveLength(1);
    expect(
      within(agenda).getAllByRole("button", { name: /^为 .* 添加任务$/ }),
    ).toHaveLength(7);
    await user.click(within(agenda).getByRole("button", { name: "新增任务" }));
    expect(screen.getByRole("textbox", { name: "2026-10-14 新任务标题" })).toBe(
      document.activeElement,
    );
    await user.keyboard("{Escape}");
    expect(within(agenda).queryAllByRole("textbox")).toHaveLength(0);
    await user.click(
      within(agenda).getByRole("button", { name: "为 2026-10-16 添加任务" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "2026-10-16 新任务标题" }),
      "新的任务{Enter}",
    );
    await waitFor(() =>
      expect(within(agenda).queryAllByRole("textbox")).toHaveLength(0),
    );
    expect(backend.data!.tasks[0]).toMatchObject({
      title: "新的任务",
      date: "2026-10-16",
    });
  });
  it("标题校验失败时保留面板和原任务", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("任务标题"), {
      target: { value: "   " },
    });
    await user.click(screen.getByRole("button", { name: "保存并收起" }));
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByRole("dialog", { name: "编辑任务" })).toBeDefined();
    expect(backend.data!.tasks.find((t) => t.id === "a")?.title).toBe(
      "调研计划",
    );
  });
  it("新增失败仍保留行内输入和标题", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: "七天日程" });
    await user.click(
      screen.getByRole("button", { name: "为 2026-10-16 添加任务" }),
    );
    backend.fail = true;
    await user.type(
      screen.getByRole("textbox", { name: "2026-10-16 新任务标题" }),
      "待重试任务{Enter}",
    );
    expect(await screen.findByText("磁盘错误")).toBeDefined();
    expect(
      screen.getByRole("textbox", { name: "2026-10-16 新任务标题" }),
    ).toHaveProperty("value", "待重试任务");
  });
});

describe("第二轮基础任务交互", () => {
  async function overview() {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: "七天日程" });
    return user;
  }
  const plus = (date = "2026-10-16") =>
    screen.getByRole("button", { name: `为 ${date} 添加任务` });
  const input = (date = "2026-10-16") =>
    screen.getByRole("textbox", { name: `${date} 新任务标题` });
  it("空白失焦、再次加号、Esc 收起，多个日期只留一个新增区", async () => {
    const user = await overview();
    await user.click(plus());
    expect(document.activeElement).toBe(input());
    await user.type(input(), "   ");
    await user.click(screen.getByRole("heading", { name: /接下来七天/ }));
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    await user.click(plus());
    await user.click(plus());
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    await user.click(plus());
    await user.click(plus("2026-10-17"));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(document.activeElement).toBe(input("2026-10-17"));
    await user.keyboard("{Escape}");
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(backend.data!.tasks).toHaveLength(2);
  });
  it("非空草稿外部点击自动保存原日期，Esc 仍确认取消", async () => {
    const user = await overview();
    await user.click(plus());
    await user.type(input(), "喝水");
    await user.click(screen.getByRole("heading", { name: /接下来七天/ }));
    await waitFor(() =>
      expect(screen.queryAllByRole("textbox")).toHaveLength(0),
    );
    expect(backend.data!.tasks).toHaveLength(3);
    await user.click(plus("2026-10-17"));
    await waitFor(() =>
      expect(input("2026-10-17")).toHaveProperty("value", ""),
    );
    expect(backend.data!.tasks.find((t) => t.title === "喝水")?.date).toBe(
      "2026-10-16",
    );
    await user.type(input("2026-10-17"), "取消前保留");
    await user.keyboard("{Escape}");
    expect(input("2026-10-17")).toHaveProperty("value", "取消前保留");
    await user.click(screen.getByRole("button", { name: "继续填写" }));
    await user.click(screen.getByRole("button", { name: "取消快速新增" }));
    await user.click(screen.getByRole("button", { name: "放弃草稿" }));
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(backend.data!.tasks).toHaveLength(3);
  });
  it.each(["下一周", "专注编辑", "选择 2026-10-18"])(
    "%s 切换前添加草稿并继续，数据归属原日期",
    async (target) => {
      const user = await overview();
      await user.click(plus());
      await user.type(input(), "保留这个日期");
      await user.click(screen.getByRole("button", { name: target }));

      await waitFor(() =>
        expect(
          backend.data!.tasks.some(
            (t) => t.date === "2026-10-16" && t.title === "保留这个日期",
          ),
        ).toBe(true),
      );
      expect(
        screen.queryByRole("group", { name: "处理未添加的任务" }),
      ).toBeNull();
      if (target === "专注编辑")
        expect(screen.getByText("当日清单")).toBeDefined();
      else
        expect(
          screen.queryByRole("textbox", { name: "2026-10-16 新任务标题" }),
        ).toBeNull();
    },
  );
  it("自动新增失败保留草稿且不导航，重试导航后不复活空输入", async () => {
    const user = await overview();
    await user.click(plus());
    await user.type(input(), "失败后重试");
    backend.fail = true;
    await user.click(screen.getByRole("button", { name: "专注编辑" }));
    expect(await screen.findByText("磁盘错误")).toBeDefined();
    expect(input()).toHaveProperty("value", "失败后重试");
    expect(screen.queryByText("当日清单")).toBeNull();
    expect(
      screen.queryByRole("group", { name: "处理未添加的任务" }),
    ).toBeNull();
    backend.fail = false;
    await user.click(screen.getByRole("button", { name: "专注编辑" }));
    await screen.findByText("当日清单");
    await user.click(screen.getByRole("button", { name: "统筹总览" }));
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
  it("IME 组合中的 Enter/Esc 不提交或取消，提交按钮仍能可靠保存", async () => {
    const user = await overview();
    await user.click(plus());
    fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: "中文输入法" } });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    fireEvent.submit(input().closest("form")!);
    fireEvent.keyDown(input(), { key: "Escape", isComposing: true });
    expect(backend.data!.tasks).toHaveLength(2);
    expect(input()).toHaveProperty("value", "中文输入法");
    fireEvent.click(plus("2026-10-17"));
    fireEvent.click(screen.getByRole("button", { name: "专注编辑" }));
    expect(input()).toHaveProperty("value", "中文输入法");
    expect(screen.queryByText("当日清单")).toBeNull();
    fireEvent.compositionEnd(input());
    await user.click(screen.getByRole("button", { name: "添加到 2026-10-16" }));
    await waitFor(() =>
      expect(screen.queryAllByRole("textbox")).toHaveLength(0),
    );
    expect(backend.data!.tasks).toHaveLength(3);
  });
  it("专注新增跨日期自动保存，显式取消仍保护草稿", async () => {
    const user = await startFocus();
    await user.type(input("2026-10-14"), "专注草稿");
    await user.click(screen.getByRole("button", { name: "后一天" }));
    await waitFor(() =>
      expect(input("2026-10-15")).toHaveProperty("value", ""),
    );
    expect(backend.data!.tasks.find((t) => t.title === "专注草稿")?.date).toBe(
      "2026-10-14",
    );
    await user.type(input("2026-10-15"), "明确取消");
    await user.keyboard("{Escape}");
    expect(input("2026-10-15")).toHaveProperty("value", "明确取消");
    await user.click(screen.getByRole("button", { name: "放弃草稿" }));
    expect(input("2026-10-15")).toHaveProperty("value", "");
    expect(backend.data!.tasks).toHaveLength(3);
  });
  it.each(["overview"])(
    "%s 菜单支持键盘、定位编辑，打开菜单不勾选或展开",
    async (mode) => {
      const user = mode === "focus" ? await startFocus() : await overview();
      const trigger = screen.getByRole("button", { name: "任务操作 调研计划" });
      trigger.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("menu")).toBeDefined();
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "编辑任务" }),
      );
      expect(screen.queryByRole("region", { name: "任务详情阅读" })).toBeNull();
      expect(backend.data!.tasks[0].completed).toBe(false);
      await user.keyboard("{ArrowDown}{Escape}");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      await user.keyboard(" ");
      await user.click(screen.getByRole("menuitem", { name: "编辑任务" }));
      expect(
        await screen.findByRole("dialog", { name: "编辑任务" }),
      ).toBeDefined();
      expect(screen.getByLabelText("任务日期")).toHaveProperty(
        "value",
        "2026-10-14",
      );
      expect(screen.getByLabelText("任务标题")).toHaveProperty(
        "value",
        "调研计划",
      );
    },
  );
  it.each(["overview", "focus"])(
    "%s 删除指定已完成任务，可取消和撤销并保留完整字段",
    async (mode) => {
      backend.data!.tasks[0] = {
        ...backend.data!.tasks[0],
        completed: true,
        priority: 2,
        description: "完整说明\n第二行",
        short_label: "简称",
        category_id: "work",
      };
      const original = structuredClone(backend.data!.tasks[0]);
      const other = structuredClone(backend.data!.tasks[1]);
      const user = mode === "focus" ? await startFocus() : await overview();
      async function askDelete() {
        if (mode === "focus") {
          const row = screen
            .getByRole("button", { name: /^调研计划/ })
            .closest(".task-row") as HTMLElement;
          await user.click(
            within(row).getByRole("button", { name: "删除任务" }),
          );
        } else {
          await user.click(
            screen.getByRole("button", { name: "任务操作 调研计划" }),
          );
          await user.click(screen.getByRole("menuitem", { name: "删除任务" }));
        }
      }
      await askDelete();
      await user.click(screen.getByRole("button", { name: "保留" }));
      expect(backend.data!.tasks).toHaveLength(2);
      await askDelete();
      await user.click(
        within(
          screen.getByRole("dialog", { name: "删除这件任务？" }),
        ).getByRole("button", { name: "删除任务" }),
      );
      await waitFor(() => expect(backend.data!.tasks).toEqual([other]));
      expect(
        screen.queryByRole("button", { name: "任务操作 调研计划" }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: "撤销" }));
      await waitFor(() =>
        expect(backend.data!.tasks.find((t) => t.id === original.id)).toEqual(
          original,
        ),
      );
      expect(backend.data!.tasks.find((t) => t.id === other.id)).toEqual(other);
    },
  );
  it("显式取消确认后清空草稿，不残留操作或创建空任务", async () => {
    const user = await overview();
    await user.click(plus());
    await user.type(input(), "待处理");
    await user.keyboard("{Escape}");
    await user.clear(input());
    await user.click(screen.getByRole("heading", { name: /接下来七天/ }));
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(backend.data!.tasks).toHaveLength(2);
    await user.click(plus("2026-10-17"));
    await user.type(input("2026-10-17"), "新的草稿{Enter}");
    await waitFor(() =>
      expect(backend.data!.tasks.some((t) => t.title === "新的草稿")).toBe(
        true,
      ),
    );
    expect(plus("2026-10-14")).toBeDefined();
    expect(backend.data!.tasks).toHaveLength(3);
  });
  it("快速新增等待写入成功，连续提交不重复创建", async () => {
    const user = await overview();
    await user.click(plus());
    await user.type(input(), "等待真实保存");
    let complete!: () => void;
    backend.saveWait = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const form = input().closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(backend.data!.tasks).toHaveLength(2);
    expect(input()).toHaveProperty("value", "等待真实保存");
    complete();
    await waitFor(() =>
      expect(screen.queryAllByRole("textbox")).toHaveLength(0),
    );
    expect(
      backend.data!.tasks.filter((t) => t.title === "等待真实保存"),
    ).toHaveLength(1);
  });
  it("异步删除失败保留任务和确认框，无成功通知，重试正常", async () => {
    const user = await overview();
    await user.click(
      screen.getByRole("button", { name: "任务操作 第二件小事" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "删除任务" }));
    backend.deleteFail = true;
    let finish!: () => void;
    backend.deleteWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "删除任务",
      }),
    );
    expect(backend.data!.tasks).toHaveLength(2);
    expect(screen.queryByText("任务已删除")).toBeNull();
    finish();
    await screen.findAllByText("删除失败：磁盘错误");
    expect(backend.data!.tasks).toHaveLength(2);
    expect(
      screen.getByRole("dialog", { name: "删除这件任务？" }),
    ).toBeDefined();
    backend.deleteFail = false;
    backend.deleteWait = null;
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "删除任务",
      }),
    );
    await waitFor(() =>
      expect(backend.data!.tasks.map((t) => t.id)).toEqual(["a"]),
    );
  });
  it("自动添加等待持久化后才导航，期间多次点击和 Enter 只创建一次", async () => {
    const user = await overview();
    await user.click(plus());
    await user.type(input(), "等待切换");
    let complete!: () => void;
    backend.saveWait = new Promise<void>((resolve) => {
      complete = resolve;
    });
    await user.click(screen.getByRole("button", { name: "下一周" }));
    expect(input()).toHaveProperty("value", "等待切换");
    expect(backend.data!.tasks).toHaveLength(2);
    fireEvent.submit(input().closest("form")!);
    await user.click(screen.getByRole("button", { name: "专注编辑" }));
    expect(screen.queryByText("当日清单")).toBeNull();
    complete();
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "2026-10-16 新任务标题" }),
      ).toBeNull(),
    );
    expect(
      backend.data!.tasks.filter((t) => t.title === "等待切换"),
    ).toHaveLength(1);
    expect(backend.data!.tasks.find((t) => t.title === "等待切换")?.date).toBe(
      "2026-10-16",
    );
    expect(screen.queryByText("当日清单")).toBeNull();
  });
  it("专注行只有直接删除入口，标题只读详情保留编辑，点击删除不改变完成状态", async () => {
    const user = await startFocus();
    const row = screen
      .getByRole("button", { name: "调研计划" })
      .closest(".task-row") as HTMLElement;
    expect(
      within(row).queryByRole("button", { name: "任务操作 调研计划" }),
    ).toBeNull();
    const deletion = within(row).getByRole("button", {
      name: "删除任务",
    });
    deletion.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("dialog", { name: "删除这件任务？" }),
    ).toBeDefined();
    expect(backend.data!.tasks[0].completed).toBe(false);
    expect(screen.queryByRole("region", { name: "任务详情阅读" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "保留" }));
    expect(document.activeElement).toBe(deletion);
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "保留这次修改？" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "编辑任务" })).toBeNull();
  });
  it("已有任务编辑后恢复原值，Escape 不出现无谓确认", async () => {
    const user = await startFocus();
    await user.click(screen.getByRole("button", { name: "调研计划" }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("任务标题"), {
      target: { value: "临时改动" },
    });
    fireEvent.change(screen.getByLabelText("任务标题"), {
      target: { value: "调研计划" },
    });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(backend.data!.tasks[0].title).toBe("调研计划");
  });
  it("专注删除失败保留任务和确认框，可重试并撤销", async () => {
    const user = await startFocus();
    const row = screen
      .getByRole("button", { name: "第二件小事" })
      .closest(".task-row") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "删除任务" }));
    backend.deleteFail = true;
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "删除任务",
      }),
    );
    await screen.findAllByText("删除失败：磁盘错误");
    expect(backend.data!.tasks).toHaveLength(2);
    expect(screen.queryByText("任务已删除")).toBeNull();
    backend.deleteFail = false;
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "删除任务",
      }),
    );
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(2));
  });
});

describe("UX2.2 快速操作", () => {
  async function setup() {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: "七天日程" });
    return user;
  }
  const input = () =>
    screen.getByRole("textbox", { name: "2026-10-16 新任务标题" });
  const plus = () =>
    screen.getByRole("button", { name: "为 2026-10-16 添加任务" });
  it("window blur 和外部点击共用持久化，保存成功才清稿并可撤销新增", async () => {
    const user = await setup();
    await user.click(plus());
    await user.type(input(), "跨窗口喝水");
    let complete!: () => void;
    backend.saveWait = new Promise<void>((resolve) => {
      complete = resolve;
    });
    fireEvent(window, new Event("blur"));
    fireEvent.pointerDown(screen.getByRole("heading", { name: /接下来七天/ }));
    fireEvent.submit(input().closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "专注编辑" }));
    expect(input()).toHaveProperty("value", "跨窗口喝水");
    expect(backend.data!.tasks).toHaveLength(2);
    expect(screen.queryByText("当日清单")).toBeNull();
    complete();
    await screen.findByText("当日清单");
    expect(
      backend.data!.tasks.filter((t) => t.title === "跨窗口喝水"),
    ).toHaveLength(1);
    expect(
      backend.data!.tasks.find((t) => t.title === "跨窗口喝水")!.date,
    ).toBe("2026-10-16");
    await user.click(
      within(
        screen.getByRole("status", { name: "已添加 跨窗口喝水" }),
      ).getByRole("button", { name: "撤销" }),
    );
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(2));
  });
  it("失焦失败保留原日期、可重试；取消按钮不被 blur 抢先提交", async () => {
    const user = await setup();
    await user.click(plus());
    await user.type(input(), "仍在这里");
    await user.click(screen.getByRole("button", { name: "取消快速新增" }));
    fireEvent(window, new Event("blur"));
    expect(backend.data!.tasks).toHaveLength(2);
    expect(
      screen.getByRole("group", { name: "处理未添加的任务" }),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "继续填写" }));
    expect(backend.data!.tasks).toHaveLength(2);
    expect(input()).toHaveProperty("value", "仍在这里");
    backend.fail = true;
    fireEvent(window, new Event("blur"));
    await screen.findByText("重试添加");
    expect(input()).toHaveProperty("value", "仍在这里");
    expect(backend.data!.tasks).toHaveLength(2);
    backend.fail = false;
    await user.click(screen.getByRole("button", { name: "添加到 2026-10-16" }));
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(3));
  });
  it("IME 失焦延后至 compositionend，使用最终中文且不重复新增", async () => {
    const user = await setup();
    await user.click(plus());
    fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: "喝" } });
    fireEvent(window, new Event("blur"));
    expect(backend.data!.tasks).toHaveLength(2);
    fireEvent.compositionEnd(input());
    fireEvent.change(input(), { target: { value: "喝水" } });
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(3));
    expect(backend.data!.tasks[2].title).toBe("喝水");
  });
  it("行内编辑只改标题，保存同步、Esc 取消、无变化无写入", async () => {
    const { repository } = await import("./platform");
    const user = await setup();
    await user.click(screen.getByRole("button", { name: "快速修改 调研计划" }));
    expect(screen.queryByRole("region", { name: "任务详情阅读" })).toBeNull();
    expect(backend.data!.tasks[0].completed).toBe(false);
    const title = screen.getByRole("textbox", { name: "快速修改任务标题" });
    await user.clear(title);
    await user.type(title, "新的中文标题{Enter}");
    await screen.findByRole("button", { name: "快速修改 新的中文标题" });
    expect(
      backend.data!.tasks.find((t) => t.title === "新的中文标题")?.title,
    ).toBe("新的中文标题");
    const count = vi.mocked(repository.saveTask).mock.calls.length;
    await user.click(
      screen.getByRole("button", { name: "快速修改 新的中文标题" }),
    );
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "快速修改任务标题" }),
      ).toBeNull(),
    );
    expect(vi.mocked(repository.saveTask).mock.calls.length).toBe(count);
    await user.click(
      screen.getByRole("button", { name: "快速修改 新的中文标题" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "快速修改任务标题" }),
      "取消内容",
    );
    await user.keyboard("{Escape}");
    expect(
      backend.data!.tasks.find((t) => t.title === "新的中文标题")?.title,
    ).toBe("新的中文标题");
    await user.click(
      within(screen.getByRole("region", { name: "七天日程" })).getByRole(
        "button",
        { name: "新的中文标题" },
      ),
    );
    expect(
      await screen.findByRole("region", { name: "任务详情阅读" }),
    ).toHaveProperty("textContent", expect.stringContaining("新的中文标题"));
  });
  it("行内失败和空白阻止切换并保留输入，重试后导航", async () => {
    const user = await setup();
    await user.click(screen.getByRole("button", { name: "快速修改 调研计划" }));
    const title = screen.getByRole("textbox", { name: "快速修改任务标题" });
    await user.clear(title);
    await user.click(screen.getByRole("button", { name: "专注编辑" }));
    expect(screen.queryByText("当日清单")).toBeNull();
    expect(await screen.findByText(/任务标题不能为空/)).toBeDefined();
    await user.type(title, "保留修改");
    backend.fail = true;
    await user.click(screen.getByRole("button", { name: "专注编辑" }));
    expect(await screen.findByText(/保存失败，修改仍在这里/)).toBeDefined();
    expect(title).toHaveProperty("value", "保留修改");
    expect(screen.queryByText("当日清单")).toBeNull();
    backend.fail = false;
    await user.click(screen.getByRole("button", { name: "专注编辑" }));
    await screen.findByText("当日清单");
    expect(backend.data!.tasks.some((t) => t.title === "保留修改")).toBe(true);
  });
  it("连续删除保留各自撤销状态", async () => {
    const user = await startFocus();
    for (const title of ["调研计划", "第二件小事"]) {
      const row = screen
        .getByRole("button", { name: title })
        .closest(".task-row") as HTMLElement;
      await user.click(within(row).getByRole("button", { name: "删除任务" }));
      await user.click(
        within(
          screen.getByRole("dialog", { name: "删除这件任务？" }),
        ).getByRole("button", { name: "删除任务" }),
      );
    }
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(0));
    for (const title of ["调研计划", "第二件小事"]) {
      await user.click(
        within(
          screen.getByRole("status", { name: `已删除 ${title}` }),
        ).getByRole("button", { name: "撤销" }),
      );
    }
    await waitFor(() => expect(backend.data!.tasks).toHaveLength(2));
  });
});

describe("UX2.2 行内修改与删除竞态", () => {
  it("删除等待标题保存，确认与撤销使用最新已保存的任务", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: "七天日程" });
    await user.click(screen.getByRole("button", { name: "快速修改 调研计划" }));
    const input = screen.getByRole("textbox", { name: "快速修改任务标题" });
    await user.clear(input);
    await user.type(input, "最新保存的计划");
    let complete!: () => void;
    backend.saveWait = new Promise<void>((resolve) => {
      complete = resolve;
    });
    await user.click(screen.getByRole("button", { name: "任务操作 调研计划" }));
    await user.click(screen.getByRole("menuitem", { name: "删除任务" }));
    expect(screen.queryByRole("dialog", { name: "删除这件任务？" })).toBeNull();
    complete();
    const dialog = await screen.findByRole("dialog", {
      name: "删除这件任务？",
    });
    expect(dialog.textContent).toContain("最新保存的计划");
    await user.click(within(dialog).getByRole("button", { name: "删除任务" }));
    const toast = await screen.findByRole("status", {
      name: "已删除 最新保存的计划",
    });
    await user.click(within(toast).getByRole("button", { name: "撤销" }));
    await waitFor(() =>
      expect(backend.data!.tasks.find((t) => t.id === "a")?.title).toBe(
        "最新保存的计划",
      ),
    );
  });
});
