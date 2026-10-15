import type { Task } from "./domain";
export const makeTask = (patch: Partial<Task> = {}): Task => ({
  id: "a",
  date: "2026-10-14",
  title: "完整的任务标题没有被修改",
  short_label: null,
  description: null,
  completed: false,
  priority: 0,
  category_id: null,
  sort_order: 0,
  created_at: "2026-10-14T01:00:00.000Z",
  updated_at: "2026-10-14T01:00:00.000Z",
  ...patch,
});
