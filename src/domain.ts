import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parse,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { z } from "zod";
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "请选择有效日期")
  .refine((v) => {
    const d = parse(v, "yyyy-MM-dd", new Date());
    return (
      isValid(d) &&
      format(d, "yyyy-MM-dd") === v &&
      +v.slice(0, 4) >= 1900 &&
      +v.slice(0, 4) <= 9999
    );
  }, "日期无效");
export const taskSchema = z.object({
  id: z.string().min(1).max(128),
  date: dateSchema,
  title: z.string().trim().min(1, "请输入任务标题").max(500, "标题最多 500 字"),
  short_label: z.string().max(100, "日历简称最多 100 字").nullable(),
  description: z.string().max(100000, "详情最多 100000 字").nullable(),
  completed: z.boolean(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  category_id: z.string().nullable(),
  sort_order: z.number().int().nonnegative().max(2147483647),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Task = z.infer<typeof taskSchema>;
export const categorySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  is_builtin: z.boolean(),
  sort_order: z.number().int().nonnegative(),
});
export type Category = z.infer<typeof categorySchema>;
export const markSchema = z.object({
  date: dateSchema,
  kind: z.enum(["rest", "overtime"]),
  note: z.string().max(500).nullable(),
});
export type DayMark = z.infer<typeof markSchema>;
export const appearanceSchema = z.enum(["reading", "glass", "frosted"]);
export type Appearance = z.infer<typeof appearanceSchema>;
export const textSizeSchema = z.enum(["small", "standard", "large"]);
export type TextSize = z.infer<typeof textSizeSchema>;
export const headerLayoutSchema = z.enum(["classic", "compact"]);
export type HeaderLayout = z.infer<typeof headerLayoutSchema>;
export const settingsSchema = z.object({
  active_view: z.enum(["overview", "focus"]),
  background_opacity: z.number().min(0.4).max(1),
  always_on_top: z.boolean(),
  animations_enabled: z.boolean(),
  show_holidays: z.boolean(),
  show_weekends: z.boolean(),
  opaque_fallback: z.boolean(),
  appearance_mode: appearanceSchema.default("reading"),
  text_size: textSizeSchema.default("standard"),
  header_layout: headerLayoutSchema.default("classic"),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  active_view: "overview",
  background_opacity: 0.85,
  always_on_top: false,
  animations_enabled: true,
  show_holidays: true,
  show_weekends: true,
  opaque_fallback: false,
  appearance_mode: "reading",
  text_size: "standard",
  header_layout: "classic",
};
export const backupSchema = z
  .object({
    format: z.literal("starry-list"),
    version: z.literal(1),
    exported_at: z.string().datetime({ offset: true }),
    tasks: z.array(taskSchema).max(50000),
    categories: z.array(categorySchema).max(1000),
    day_marks: z.array(markSchema).max(50000),
    settings: settingsSchema,
  })
  .superRefine((data, ctx) => {
    for (const [key, values] of [
      ["tasks", data.tasks.map((t) => t.id)],
      ["categories", data.categories.map((c) => c.id)],
      ["day_marks", data.day_marks.map((m) => m.date)],
    ] as const)
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: "custom", message: `${key} 存在重复记录` });
    const ids = new Set(data.categories.map((c) => c.id));
    if (data.tasks.some((t) => t.category_id && !ids.has(t.category_id)))
      ctx.addIssue({ code: "custom", message: "任务引用了不存在的分类" });
  });
export type Backup = z.infer<typeof backupSchema>;
export interface Snapshot {
  tasks: Task[];
  categories: Category[];
  day_marks: DayMark[];
  settings: Settings;
}
export const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
export const localDay = (s: string) => parse(s, "yyyy-MM-dd", new Date());
export const shiftDay = (s: string, n: number) =>
  dayKey(addDays(localDay(s), n));
export const shiftMonth = (s: string, n: number) =>
  dayKey(startOfMonth(addMonths(localDay(s), n)));
export const weekDays = (s: string) =>
  Array.from({ length: 7 }, (_, i) => shiftDay(s, i));
export function monthDays(s: string) {
  const first = startOfWeek(startOfMonth(localDay(s)), { weekStartsOn: 1 });
  const last = endOfWeek(endOfMonth(localDay(s)), { weekStartsOn: 1 });
  return Array.from(
    {
      length:
        Math.round(
          (Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) -
            Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) /
            86400000,
        ) + 1,
    },
    (_, i) => dayKey(addDays(first, i)),
  );
}
export const displayTasks = (tasks: Task[]) =>
  [...tasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
export function previewTasks(tasks: Task[], limit = 2) {
  const sorted = [...tasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      b.priority - a.priority ||
      a.sort_order - b.sort_order,
  );
  return {
    visible: sorted.slice(0, limit),
    more: Math.max(0, tasks.length - limit),
  };
}
export const taskLabel = (t: Task) => t.short_label?.trim() || t.title;
export const dayProgress = (tasks: Task[]) => ({
  done: tasks.filter((t) => t.completed).length,
  total: tasks.length,
});
