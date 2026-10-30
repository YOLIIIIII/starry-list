import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dayKey } from "../src/domain.ts";
import { makeTask } from "../src/test-fixtures.ts";
const root = resolve(`.cache/sl024b-${Date.now()}`);
await mkdir(root, { recursive: true });
let child, browser, page;
const records = [],
  layouts = [];
const wait = (ms = 100) => new Promise((r) => setTimeout(r, ms));
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const click = (name) => page.getByRole("button", { name, exact: true }).click();
async function launch() {
  child = spawn(resolve("src-tauri/target/debug/starry-list.exe"), [], {
    windowsHide: true,
    env: {
      ...process.env,
      STARRY_LIST_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: resolve(root, "profile"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9341",
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9341");
      break;
    } catch {
      await wait(200);
    }
  }
  page = browser.contexts()[0].pages()[0];
  await page.locator("main").waitFor();
  assert.equal(
    await invoke("plugin:app|identifier"),
    "app.starrylist.desktop.sl020-test",
  );
}
try {
  await launch();
  const shots = resolve("docs/screenshots/sl024b");
  await mkdir(shots, { recursive: true });
  const size = async (width, height) => {
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width, height } },
    });
    await wait(90);
  };
  await size(980, 680);
  await click("设置");
  for (const name of ["外观与布局", "日历与使用", "喝水小组件", "数据与关于"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    assert.equal(await page.getByRole("tabpanel").count(), 1);
    await page.screenshot({ path: resolve(shots, `settings-${name}.png`) });
  }
  await page.getByRole("tab", { name: "喝水小组件", exact: true }).click();
  await page.getByLabel("每日饮水目标").fill("1750");
  await page.getByRole("tab", { name: "数据与关于", exact: true }).click();
  await page.getByRole("tab", { name: "喝水小组件", exact: true }).click();
  assert.equal(await page.getByLabel("每日饮水目标").inputValue(), "1750");
  await click("保存目标");
  await page.getByLabel("显示喝水卡片").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".water-settings input[type=checkbox]").checked,
  );
  await click("关闭对话框");
  for (const value of [150, 250, 500]) await click(`+${value} mL`);
  await click("自定义");
  await page.getByLabel("自定义饮水容量").fill("abc");
  await click("记录这杯");
  await page.locator("#water-input-error").waitFor();
  await page.screenshot({ path: resolve(shots, "custom-error.png") });
  await page.getByLabel("自定义饮水容量").fill("1400");
  await page.screenshot({ path: resolve(shots, "custom.png") });
  await click("记录这杯");
  await page.getByText("补水达标", { exact: true }).waitFor();
  await click("时间记录 · 4 次");
  await page.getByRole("button", { name: /删除 .* 的 1400/ }).click();
  assert.equal(await page.getByText("补水达标", { exact: true }).count(), 0);
  await click("恢复刚删除的 1400 mL");
  await click("关闭对话框");
  records.push(
    "settings four categories, draft preservation, actual water IPC, validation and deletion restore",
  );
  await invoke("save_task", {
    task: makeTask({
      id: "long",
      date: dayKey(new Date()),
      title: "合成任务：整理星光笔记",
      description: "隔离测试长计划。\n".repeat(180),
    }),
  });
  const base = (await invoke("load_snapshot")).settings;
  for (const active_view of ["overview", "focus"])
    for (const water_enabled of [false, true])
      for (const appearance_mode of ["reading", "glass", "frosted"])
        for (const text_size of ["small", "standard", "large"])
          for (const header_layout of ["classic", "compact"]) {
            await invoke("save_settings", {
              settings: {
                ...base,
                active_view,
                water_enabled,
                appearance_mode,
                text_size,
                header_layout,
              },
            });
            await page.reload();
            await page.locator("main").waitFor();
            for (const [width, height] of [
              [980, 680],
              [980, 480],
              [760, 620],
              [500, 620],
              [380, 480],
            ]) {
              await size(width, height);
              assert.equal(
                await page.evaluate(
                  () => document.documentElement.scrollWidth > innerWidth,
                ),
                false,
              );
              assert.equal(
                await page
                  .locator(
                    ".agenda-scroll .water-card,.focus-scroll .water-card",
                  )
                  .count(),
                0,
              );
              if (active_view === "focus") {
                const box = await page
                  .getByPlaceholder("添加一件小事…")
                  .boundingBox();
                assert.ok(box && box.y + box.height <= height);
                assert.ok(
                  await page
                    .locator(".focus-scroll")
                    .evaluate((el) => el.clientHeight >= 60),
                  JSON.stringify({
                    active_view,
                    water_enabled,
                    appearance_mode,
                    text_size,
                    header_layout,
                    width,
                    height,
                  }),
                );
              }
              if (
                appearance_mode === "reading" &&
                text_size === "standard" &&
                header_layout === "classic"
              )
                await page.screenshot({
                  path: resolve(
                    shots,
                    `${active_view}-${water_enabled}-${width}x${height}.png`,
                  ),
                });
              layouts.push({
                active_view,
                water_enabled,
                appearance_mode,
                text_size,
                header_layout,
                width,
                height,
              });
            }
          }
  records.push(
    "360 view/toggle/material/type/header/size states, independent DOM, task viewport and fixed input",
  );
  await click("设置");
  for (const [width, height] of [
    [980, 680],
    [380, 480],
  ]) {
    await size(width, height);
    for (const name of [
      "外观与布局",
      "日历与使用",
      "喝水小组件",
      "数据与关于",
    ]) {
      await page.getByRole("tab", { name, exact: true }).click();
      const box = await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= height);
      assert.equal(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth > el.clientWidth),
        false,
      );
      await page.screenshot({
        path: resolve(shots, `settings-${width}-${name}.png`),
      });
    }
  }
  await page.getByRole("tab", { name: "数据与关于" }).press("Home");
  assert.equal(
    await page
      .getByRole("tab", { name: "外观与布局" })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await click("展开补水");
  await click("自定义容量");
  await page.getByLabel("自定义饮水容量").fill("1");
  await page.keyboard.press("Enter");
  await click("展开补水");
  await click("自定义容量");
  await page.getByLabel("自定义饮水容量").fill("10000");
  await click("记录这杯");
  await size(980, 680);
  await invoke("save_settings", {
    settings: { ...base, active_view: "focus", water_enabled: true },
  });
  await page.reload();
  await page.locator(".water-card").waitFor();
  for (const amount of [0, 150, 250, 500, 750, 1500, 2000, 2300]) {
    for (const entry of (await invoke("load_snapshot")).water_entries)
      await invoke("delete_water", { id: entry.id });
    if (amount)
      await invoke("save_water", {
        entry: {
          id: `cup-${amount}`,
          date: dayKey(new Date()),
          amount,
          recorded_at: new Date().toISOString(),
        },
      });
    await page.reload();
    await page.locator(".water-card").waitFor();
    await page.screenshot({ path: resolve(shots, `cups-${amount}.png`) });
  }
  for (const goal of [1, 20000]) {
    await invoke("save_settings", {
      settings: {
        ...base,
        active_view: "focus",
        water_enabled: true,
        water_goal: goal,
      },
    });
    await page.reload();
    await page.locator(".water-card").waitFor();
    assert.ok((await page.locator("svg.water-cup").count()) <= 6);
    await page.screenshot({ path: resolve(shots, `goal-${goal}.png`) });
  }
  await click("前一天");
  await click("自定义");
  await page.getByLabel("自定义饮水容量").fill("250");
  const db = new DatabaseSync(resolve(root, "starry-list.db"));
  db.exec(
    "CREATE TRIGGER water_b_fail BEFORE INSERT ON water_entries BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
  );
  await click("记录这杯");
  await page.locator("#water-input-error").waitFor();
  assert.equal(await page.getByLabel("自定义饮水容量").inputValue(), "250");
  await page.screenshot({ path: resolve(shots, "custom-failure.png") });
  db.exec("DROP TRIGGER water_b_fail");
  db.close();
  await click("记录这杯");
  await click("今天");
  await click("后一天");
  assert.equal(
    await page
      .getByRole("button", { name: "+500 mL", exact: true })
      .isDisabled(),
    true,
  );
  await click("今天");
  await click("合成任务：整理星光笔记");
  const before = await page.getByPlaceholder("添加一件小事…").boundingBox();
  await page
    .locator(".focus-scroll")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  const after = await page.getByPlaceholder("添加一件小事…").boundingBox();
  assert.equal(before.y, after.y);
  await page.screenshot({ path: resolve(shots, "long-task.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  records.push(
    "cup states 0/150/250/500/750/1500/2000/excess, goals 1/20000, past/future, real SQLite failure/retry, long-task fixed composer, reduced motion",
  );
  const snapshot = await invoke("load_snapshot");
  await click("关闭应用");
  for (let i = 0; i < 60 && child.exitCode === null; i++) await wait();
  assert.notEqual(child.exitCode, null);
  await browser.close();
  browser = null;
  await launch();
  assert.deepEqual(
    (await invoke("load_snapshot")).water_entries,
    snapshot.water_entries,
  );
  records.push(
    "narrow settings, keyboard focus/Escape, compact custom boundaries and actual process restart",
  );
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify({ records, layouts }, null, 2),
  );
  console.log(JSON.stringify({ root, records, states: layouts.length }));
} catch (e) {
  await page
    ?.screenshot({ path: resolve(root, "failure.png") })
    .catch(() => {});
  throw e;
} finally {
  if (browser) {
    try {
      await invoke("plugin:window|close", { label: "main" });
    } catch {
      /* test window already closed */
    }
    await browser.close();
  }
  if (child && child.exitCode === null) child.kill();
}
