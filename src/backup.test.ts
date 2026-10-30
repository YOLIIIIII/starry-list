import { describe, it, expect } from "vitest";
import { backupSchema, defaults, MAX_WATER_ENTRIES } from "./domain";
const base = {
  format: "starry-list",
  exported_at: "2026-10-30T09:00:00+08:00",
  tasks: [],
  categories: [],
  day_marks: [],
  settings: defaults,
};
const entry = {
  id: "water",
  date: "2026-10-29",
  amount: 500,
  recorded_at: "2026-10-30T09:49:00+08:00",
};
describe("SL-024-D backup protocol", () => {
  it("requires V2 explicit array, supports V1 missing historical settings, rejects future/version ambiguity", () => {
    expect(
      backupSchema.parse({ ...base, version: 2, water_entries: [] }).version,
    ).toBe(2);
    for (const b of [
      { ...base, version: 2 },
      { ...base, version: 2, water_entries: null },
      { ...base, version: 1, water_entries: [] },
      { ...base, version: 3, water_entries: [] },
    ])
      expect(backupSchema.safeParse(b).success).toBe(false);
    const b = backupSchema.parse({
      ...base,
      version: 1,
      settings: {
        active_view: "focus",
        background_opacity: 1,
        always_on_top: false,
        animations_enabled: true,
        show_holidays: true,
        show_weekends: true,
        opaque_fallback: false,
      },
    });
    expect(b.settings.water_goal).toBe(2000);
    expect(b.settings.water_enabled).toBe(false);
    expect(b.settings.appearance_mode).toBe("reading");
    expect(b.settings.text_size).toBe("standard");
    expect(b.settings.header_layout).toBe("classic");
    expect(b.settings.agenda_range).toBe("rolling");
  });
  it("retains raw date, ID and offset, detects duplicates rather than deduping distinct IDs", () => {
    const b = backupSchema.parse({
      ...base,
      version: 2,
      water_entries: [entry, { ...entry, id: "other", date: "2030-01-01" }],
    });
    expect(b.version === 2 && b.water_entries[0]).toEqual(entry);
    expect(
      backupSchema.safeParse({
        ...base,
        version: 2,
        water_entries: [entry, entry],
      }).success,
    ).toBe(false);
  });
  it.each([
    { date: "2026-02-30" },
    { id: "" },
    { id: "水".repeat(64) },
    { amount: 0 },
    { amount: 10001 },
    { amount: 1.5 },
    { amount: "500" },
    { recorded_at: "2026-10-30T09:00:00" },
    { recorded_at: "2026-10-30T09:00+08:00" },
    { recorded_at: "2026-10-30 09:00:00+08:00" },
    { recorded_at: "2026-10-30T09:00:00+99:99" },
  ])("rejects invalid water payload %j", (patch) =>
    expect(
      backupSchema.safeParse({
        ...base,
        version: 2,
        water_entries: [{ ...entry, ...patch }],
      }).success,
    ).toBe(false),
  );
  it("accepts exact count limit and rejects excess without truncation", () => {
    const water_entries = Array.from({ length: MAX_WATER_ENTRIES }, (_, i) => ({
      ...entry,
      id: `w${i}`,
    }));
    expect(
      backupSchema.safeParse({ ...base, version: 2, water_entries }).success,
    ).toBe(true);
    water_entries.push({ ...entry, id: "excess" });
    expect(
      backupSchema.safeParse({ ...base, version: 2, water_entries }).success,
    ).toBe(false);
  });
});
