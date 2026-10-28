import { describe, it, expect } from "vitest";
import {
  monthDays,
  shiftMonth,
  shiftDay,
  weekDays,
  agendaDays,
  previewTasks,
  taskLabel,
  displayTasks,
  dayProgress,
  backupSchema,
  defaults,
  settingsSchema,
  dateSchema,
  type Task,
} from "./domain";
import { dayInfo } from "./holidays";
import holidays from "./holidays/2026.json";
import { makeTask } from "./test-fixtures";
describe("SL-007 日程日期范围", () => {
  it.each([
    ["2026-10-18", "2026-10-12", "2026-10-18"],
    ["2026-10-19", "2026-10-19", "2026-10-25"],
    ["2027-01-01", "2026-12-28", "2027-01-03"],
    ["2024-02-29", "2024-02-26", "2024-03-03"],
    ["2026-04-01", "2026-03-30", "2026-04-05"],
    ["2021-02-14", "2021-02-08", "2021-02-14"],
  ])("%s 按选中日期所在自然周，不锚定今天", (selected, first, last) => {
    const week = agendaDays(selected, "week");
    expect(week).toHaveLength(7);
    expect(week[0]).toBe(first);
    expect(week[6]).toBe(last);
    expect(agendaDays(selected, "rolling")).toEqual(weekDays(selected));
    expect(agendaDays(shiftDay(selected, 7), "week")[0]).toBe(
      shiftDay(first, 7),
    );
    expect(agendaDays(shiftDay(selected, -7), "week")[0]).toBe(
      shiftDay(first, -7),
    );
  });
  it("旧设置/备份默认连续七天，拒绝非法值且不回写输入", () => {
    const legacy: Record<string, unknown> = { ...defaults };
    delete legacy.agenda_range;
    expect(settingsSchema.parse(legacy).agenda_range).toBe("rolling");
    expect(legacy).not.toHaveProperty("agenda_range");
    const backup = backupSchema.parse({
      format: "starry-list",
      version: 1,
      exported_at: new Date().toISOString(),
      tasks: [makeTask({ category_id: null })],
      categories: [],
      day_marks: [],
      settings: legacy,
    });
    expect(backup.settings.agenda_range).toBe("rolling");
    expect(
      settingsSchema.safeParse({ ...defaults, agenda_range: "month" }).success,
    ).toBe(false);
  });
});
describe("UX3.1 兼容设置", () => {
  it("旧设置及旧备份缺失字号时默认标准，无效字号拒绝", () => {
    const legacy: Record<string, unknown> = { ...defaults };
    delete legacy.text_size;
    delete legacy.header_layout;
    expect(settingsSchema.parse(legacy).text_size).toBe("standard");
    expect(settingsSchema.parse(legacy).header_layout).toBe("classic");
    const backup = {
      format: "starry-list",
      version: 1,
      exported_at: new Date().toISOString(),
      tasks: [makeTask()],
      categories: [],
      day_marks: [],
      settings: legacy,
    };
    expect(backupSchema.parse(backup).settings.text_size).toBe("standard");
    expect(backupSchema.parse(backup).settings.header_layout).toBe("classic");
    expect(
      settingsSchema.safeParse({ ...defaults, header_layout: "tiny" }).success,
    ).toBe(false);
    expect(
      settingsSchema.parse({ ...defaults, header_layout: "compact" })
        .header_layout,
    ).toBe("compact");
    expect(
      settingsSchema.safeParse({ ...defaults, text_size: "huge" }).success,
    ).toBe(false);
    for (const size of ["small", "standard", "large"])
      expect(
        settingsSchema.parse({ ...defaults, text_size: size }).text_size,
      ).toBe(size);
  });
});
describe("本地日历日期", () => {
  it("月份与跨年切换", () => {
    expect(shiftMonth("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
  });
  it("周一开始，完整显示月末", () => {
    const days = monthDays("2026-10-14");
    expect(days[0]).toBe("2026-09-28");
    expect(days.at(-1)).toBe("2026-11-01");
    expect(days.length % 7).toBe(0);
  });
  it("闰年二月", () => {
    expect(monthDays("2024-02-01")).toContain("2024-02-29");
    expect(monthDays("2026-02-01")).not.toContain("2026-02-29");
  });
  it("七天连续跨月跨年", () => {
    expect(weekDays("2026-12-29")).toEqual([
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-04",
    ]);
    expect(shiftDay("2024-02-28", 1)).toBe("2024-02-29");
  });
  it("严格校验日期，拒绝无效日期和 UTC 时间戳", () => {
    for (const d of [
      "2026-02-29",
      "2026-10-14T00:00:00Z",
      "2026-1-04",
      "2026-04-31",
    ])
      expect(dateSchema.safeParse(d).success).toBe(false);
    expect(dateSchema.safeParse("2024-02-29").success).toBe(true);
  });
});
describe("任务信息一致性", () => {
  it("未完成与重要任务优先预览，并正确计算更多", () => {
    const ts = [
      makeTask({ id: "done", completed: true, priority: 2 }),
      makeTask({ id: "normal" }),
      makeTask({ id: "star", priority: 1 }),
      makeTask({ id: "crown", priority: 2 }),
    ];
    const p = previewTasks(ts);
    expect(p.visible.map((t) => t.id)).toEqual(["crown", "star"]);
    expect(p.more).toBe(2);
    expect(previewTasks(ts, 1).more).toBe(3);
  });
  it("日历简称回退保持完整标题", () => {
    const t = makeTask();
    expect(taskLabel(t)).toBe(t.title);
    expect(taskLabel({ ...t, short_label: "   " })).toBe(t.title);
    expect(taskLabel({ ...t, short_label: "调研" })).toBe("调研");
  });
  it("日清单保持手动顺序，完成任务最后", () => {
    const ts = [
      makeTask({ id: "done", completed: true, sort_order: 0 }),
      makeTask({ id: "last", sort_order: 5, priority: 2 }),
      makeTask({ id: "first", sort_order: 1 }),
    ];
    expect(displayTasks(ts).map((t) => t.id)).toEqual([
      "first",
      "last",
      "done",
    ]);
    expect(dayProgress(ts)).toEqual({ done: 1, total: 3 });
    expect(ts[1].priority).toBe(2);
  });
});
describe("2026 官方节假日", () => {
  it.each([
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
  ])("%s 为国庆假期", (date) => expect(dayInfo(date).holiday).toBe("国庆"));
  it.each([
    "2026-10-10",
    "2026-01-04",
    "2026-02-14",
    "2026-02-28",
    "2026-05-09",
    "2026-09-20",
  ])("%s 补班覆盖周末", (date) => {
    expect(dayInfo(date).workday).toBe(true);
    expect(dayInfo(date).weekend).toBe(false);
  });
  it("普通周末与未知年份", () => {
    expect(dayInfo("2026-10-17").weekend).toBe(true);
    expect(dayInfo("2027-10-01")).toEqual({
      holiday: undefined,
      workday: false,
      weekend: false,
      known: false,
    });
  });
  it("所有官方日期互不冲突，完整 33 天假期", () => {
    expect(Object.keys(holidays.holidays)).toHaveLength(33);
    for (const d of holidays.workdays) {
      expect(d in holidays.holidays).toBe(false);
      expect(dateSchema.safeParse(d).success).toBe(true);
    }
  });
  it("个人标记可与官方信息并存", () => {
    const mark = { date: "2026-10-01", kind: "overtime" };
    expect(dayInfo(mark.date).holiday).toBe("国庆");
    expect(mark.kind).toBe("overtime");
  });
});
describe("备份校验", () => {
  const base = {
    format: "starry-list",
    version: 1,
    exported_at: "2026-10-14T01:00:00.000Z",
    tasks: [makeTask()],
    categories: [],
    day_marks: [],
    settings: defaults,
  };
  it("旧备份缺少外观字段时采用阅读优先，无需改变版本或任务", () => {
    const legacy = { ...defaults } as Partial<typeof defaults>;
    delete legacy.appearance_mode;
    const restored = backupSchema.parse({ ...base, settings: legacy });
    expect(restored.settings.appearance_mode).toBe("reading");
    expect(restored.tasks).toEqual(base.tasks);
    expect(
      backupSchema.safeParse({
        ...base,
        settings: { ...defaults, appearance_mode: "unknown" },
      }).success,
    ).toBe(false);
  });
  it("接受长中文多行详情", () => {
    const description =
      "调研范围：\n1. 产品 A\n2. 用户反馈\n\n下一步：形成初稿。".repeat(500);
    expect(
      backupSchema.parse({ ...base, tasks: [makeTask({ description })] })
        .tasks[0].description,
    ).toBe(description);
  });
  it("接受 Rust 导出和排序后的 RFC3339 UTC 偏移时间", () => {
    const b = {
      ...base,
      exported_at: "2026-10-14T10:15:30.123456+00:00",
      tasks: [
        makeTask({
          created_at: "2026-10-14T18:15:30+08:00",
          updated_at: "2026-10-14T10:15:30.123456+00:00",
        }),
      ],
    };
    expect(backupSchema.parse(b).tasks[0].updated_at).toBe(
      b.tasks[0].updated_at,
    );
  });
  it.each([
    { ...base, version: 2 },
    { ...base, tasks: [makeTask({ priority: 3 as Task["priority"] })] },
    { ...base, tasks: [makeTask(), makeTask()] },
    { ...base, tasks: [makeTask({ category_id: "absent" })] },
    { ...base, settings: { ...defaults, background_opacity: 0.1 } },
  ])("拒绝结构、版本、ID、引用或设置错误", (b) =>
    expect(backupSchema.safeParse(b).success).toBe(false),
  );
});
