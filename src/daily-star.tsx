import { Star } from "lucide-react";
import type { Task } from "./domain";

export type DailyStarState = "none" | "planned" | "completed";

// Input is already grouped by task.date; no clock or persisted reward state.
export function dailyStarState(
  tasks: readonly Pick<Task, "completed">[],
): DailyStarState {
  if (tasks.length === 0) return "none";
  return tasks.every((task) => task.completed) ? "completed" : "planned";
}

export const dailyStarDescription = {
  none: "",
  planned: "当天有计划，尚未全部完成",
  completed: "当天计划已全部完成",
} satisfies Record<DailyStarState, string>;

export function DailyStar({ state }: { state: DailyStarState }) {
  if (state === "none") return null;
  return (
    <span
      className={`daily-star ${state}`}
      title={dailyStarDescription[state]}
      aria-hidden="true"
    >
      <Star size={13} strokeWidth={1.8} />
    </span>
  );
}
