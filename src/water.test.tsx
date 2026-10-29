import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  defaults,
  dayKey,
  shiftDay,
  settingsSchema,
  type Snapshot,
  type WaterEntry,
} from "./domain";
const backend = vi.hoisted(() => ({
  data: null as Snapshot | null,
  fail: false,
}));
vi.mock("./platform", () => ({
  repository: {
    load: async () => structuredClone(backend.data),
    saveSettings: async (settings: Snapshot["settings"]) => {
      backend.data!.settings = settings;
    },
    saveWater: async (entry: WaterEntry) => {
      if (backend.fail) throw Error("disk");
      backend.data!.water_entries!.push(entry);
    },
    deleteWater: async (id: string) => {
      if (backend.fail) throw Error("disk");
      backend.data!.water_entries = backend.data!.water_entries!.filter(
        (e) => e.id !== id,
      );
    },
  },
}));
import { store } from "./store";
import { WaterCard, WaterSettings, cupLevels } from "./water";
const today = dayKey(new Date());
beforeEach(async () => {
  backend.fail = false;
  backend.data = {
    tasks: [],
    categories: [],
    day_marks: [],
    water_entries: [],
    settings: { ...defaults, water_enabled: true },
  };
  await store.load();
});
afterEach(cleanup);
it("old settings default; arbitrary target and excess have bounded cups", () => {
  const old = { ...defaults, water_goal: undefined, water_enabled: undefined };
  expect(settingsSchema.parse(old).water_goal).toBe(2000);
  expect(cupLevels(1250, 1750).map((c) => c.fill)).toEqual([1, 1, 0.5, 0]);
  expect(cupLevels(2300, 1750).at(-1)).toEqual({ fill: 1, target: 250 });
  expect(cupLevels(1000000, 20000)).toHaveLength(40);
});
it("quick amounts, custom, timestamps, reaching goal, delete and restore", async () => {
  const u = userEvent.setup();
  render(<WaterCard date={today} />);
  for (const value of [150, 250, 500])
    await u.click(screen.getByRole("button", { name: `+${value} mL` }));
  expect(backend.data!.water_entries!.map((e) => e.amount)).toEqual([
    150, 250, 500,
  ]);
  expect(backend.data!.water_entries![0].recorded_at).toMatch(/[+-]\d\d:\d\d$/);
  await u.click(screen.getByRole("button", { name: "自定义" }));
  await u.type(screen.getByLabelText("自定义饮水容量"), "1400");
  await u.click(screen.getByRole("button", { name: "记录" }));
  expect(screen.getByText("好好照顾了自己")).toBeTruthy();
  expect(screen.getByText("多记录了 300 mL")).toBeTruthy();
  await u.click(screen.getByText("时间记录 · 4 次"));
  await u.click(screen.getByRole("button", { name: /删除 .* 的 1400/ }));
  expect(screen.queryByText("好好照顾了自己")).toBeNull();
  await u.click(screen.getByRole("button", { name: "恢复刚删除的 1400 mL" }));
  expect(screen.getByText("好好照顾了自己")).toBeTruthy();
});
it("historical date belongs to viewed day; future writes disabled; failure keeps data", async () => {
  const u = userEvent.setup(),
    past = shiftDay(today, -1);
  const view = render(<WaterCard date={past} />);
  await u.click(screen.getByRole("button", { name: "+500 mL" }));
  expect(backend.data!.water_entries![0].date).toBe(past);
  backend.fail = true;
  await u.click(screen.getByRole("button", { name: "+250 mL" }));
  expect(screen.getByRole("alert").textContent).toContain("请重试");
  expect(backend.data!.water_entries).toHaveLength(1);
  view.rerender(<WaterCard date={shiftDay(today, 1)} />);
  expect(
    (
      screen
        .getByRole("button", { name: "+500 mL" })
        .closest("fieldset") as HTMLFieldSetElement
    ).disabled,
  ).toBe(true);
});
it("settings persist visibility and shared goal without removing entries", async () => {
  const u = userEvent.setup();
  render(<WaterSettings />);
  await u.click(screen.getByRole("checkbox"));
  expect(backend.data!.settings.water_enabled).toBe(false);
  const input = screen.getByLabelText("每日饮水目标");
  await u.clear(input);
  await u.type(input, "1750");
  await u.click(screen.getByRole("button", { name: "保存目标" }));
  await waitFor(() => expect(backend.data!.settings.water_goal).toBe(1750));
  await store.load();
  expect(store.getSnapshot().data.settings.water_goal).toBe(1750);
});
