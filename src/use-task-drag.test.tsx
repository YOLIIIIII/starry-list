import { render, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { useTaskDrag } from "./use-task-drag";
import { makeTask } from "./test-fixtures";
import type { Task } from "./domain";
afterEach(cleanup);
it.each(["delete", "complete", "date", "view", "reload", "busy"])(
  "cancels active drag on %s without saving",
  (kind) => {
    const save = vi.fn(async () => {}),
      message = vi.fn();
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    function Harness({
      items,
      date = "2026-10-14",
      view = "focus",
      busy = false,
    }: {
      items: Task[];
      date?: string;
      view?: string;
      busy?: boolean;
    }) {
      const drag = useTaskDrag(items, date, view, busy, save, message);
      return (
        <>
          <button onDragStart={(e) => drag.start(e, items[0])}>handle</button>
          <div onDrop={(e) => drag.drop(e, items.at(-1)!)}>
            <div className="task-row" />
          </div>
          <output>{drag.source ?? "none"}</output>
        </>
      );
    }
    const ui = render(<Harness items={tasks} />);
    fireEvent.dragStart(ui.getByRole("button"), {
      dataTransfer: { setData: vi.fn(), setDragImage: vi.fn() },
    });
    expect(ui.getByText("a")).toBeTruthy();
    ui.rerender(
      <Harness
        items={
          kind === "delete"
            ? tasks.slice(1)
            : kind === "complete"
              ? [{ ...tasks[0], completed: true }, tasks[1]]
              : kind === "reload"
                ? [{ ...tasks[0], title: "reloaded" }, tasks[1]]
                : tasks
        }
        date={kind === "date" ? "2026-10-15" : "2026-10-14"}
        view={kind === "view" ? "overview" : "focus"}
        busy={kind === "busy"}
      />,
    );
    expect(ui.getByText("none")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector(".task-drag-preview")).toBeNull();
  },
);
