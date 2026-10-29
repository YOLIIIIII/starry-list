import { describe, it, expect } from "vitest";
import { dropOrder, validOrder } from "./task-order";
import { makeTask } from "./test-fixtures";
const tasks = ["a", "b", "c", "d"].map((id, i) =>
  makeTask({ id, sort_order: i, completed: i === 3 }),
);
describe("SL-020 order validation", () => {
  it("large same-day lists retain every member", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      makeTask({ id: String(i), sort_order: i }),
    );
    const ids = dropOrder(many, "0", "99", true)!;
    expect(ids.at(-1)).toBe("0");
    expect(validOrder(many, ids)).toBe(true);
  });
  it("first/last/middle insertions preserve grouped membership", () => {
    expect(dropOrder(tasks, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(dropOrder(tasks, "c", "a", false)).toEqual(["c", "a", "b", "d"]);
    expect(dropOrder(tasks, "b", "a", false)).toEqual(["b", "a", "c", "d"]);
    expect(dropOrder(tasks, "a", "d", true)).toBeNull();
    expect(dropOrder([], "a", "b", false)).toBeNull();
    expect(dropOrder(tasks.slice(0, 1), "a", "a", false)).toBeNull();
    expect(
      dropOrder(
        [...tasks, makeTask({ id: "e", completed: true, sort_order: 4 })],
        "e",
        "d",
        false,
      ),
    ).toEqual(["a", "b", "c", "e", "d"]);
  });
  it("rejects missing/duplicate/cross-group IDs", () => {
    expect(validOrder(tasks, ["a", "b", "c", "d"])).toBe(true);
    for (const ids of [
      ["a"],
      ["a", "b", "b", "d"],
      ["d", "a", "b", "c"],
      ["a", "b", "c", "other"],
    ])
      expect(validOrder(tasks, ids)).toBe(false);
    expect(
      dropOrder(
        [tasks[0], { ...tasks[1], date: "2026-10-15" }],
        "a",
        "b",
        true,
      ),
    ).toBeNull();
  });
});
