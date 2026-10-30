import { describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { dailyStarState, DailyStar } from "./daily-star";
import { makeTask } from "./test-fixtures";

describe("SL-022-A daily star", () => {
  it.each([
    [[], "none"],
    [[false], "planned"],
    [[true], "completed"],
    [[false, false, false], "planned"],
    [[true, false, false], "planned"],
    [[true, true, false], "planned"],
    [[true, true, true], "completed"],
  ] as const)("%j → %s", (values, expected) => {
    expect(dailyStarState(values.map((completed) => ({ completed })))).toBe(
      expected,
    );
  });
  it("does not depend on priority, category, long plan, dates or timestamps", () => {
    for (const date of [
      "2020-01-01",
      "2026-12-31",
      "2027-01-01",
      "2030-02-03",
    ]) {
      expect(
        dailyStarState([
          makeTask({
            date,
            completed: true,
            priority: 2,
            description: "长计划",
            updated_at: "2000-01-01T00:00:00Z",
          }),
        ]),
      ).toBe("completed");
    }
  });
  it("uses a decorative nonfocusable icon only for planned days", () => {
    for (const state of ["none", "planned", "completed"] as const) {
      const { container } = render(<DailyStar state={state} />);
      expect(container.querySelectorAll(".daily-star").length).toBe(
        state === "none" ? 0 : 1,
      );
      expect(container.querySelector("button,[tabindex]")).toBeNull();
      cleanup();
    }
  });
});
