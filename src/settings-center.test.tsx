import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsCenter } from "./settings-center";
afterEach(cleanup);
it("category navigation preserves hidden drafts and moves roving keyboard focus", async () => {
  const u = userEvent.setup();
  render(
    <SettingsCenter
      sections={{
        appearance: <input aria-label="appearance draft" />,
        usage: <button>使用设置</button>,
        water: <input aria-label="goal draft" />,
        data: <button>导出 JSON</button>,
      }}
    />,
  );
  await u.click(screen.getByRole("tab", { name: "喝水小组件" }));
  await u.type(screen.getByLabelText("goal draft"), "1750");
  await u.click(screen.getByRole("tab", { name: "数据与关于" }));
  expect(screen.getByRole("button", { name: "导出 JSON" })).toBeTruthy();
  await u.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "喝水小组件" }),
  );
  expect((screen.getByLabelText("goal draft") as HTMLInputElement).value).toBe(
    "1750",
  );
  await u.keyboard("{Home}");
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "外观与布局" }),
  );
  await u.keyboard("{End}");
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "数据与关于" }),
  );
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
});
