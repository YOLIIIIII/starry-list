import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { dayKey, shiftDay } from "../src/domain.ts";
import { makeTask } from "../src/test-fixtures.ts";
const root = resolve(`.cache/sl024-${Date.now()}`);
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
  assert.equal(await page.locator(".water-card").count(), 0);
  await click("设置");
  await page.getByLabel("显示喝水卡片").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".water-settings input[type=checkbox]").checked,
  );
  const goal = page.getByLabel("每日饮水目标");
  await goal.fill("1750");
  await click("保存目标");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭对话框", exact: true })
    .click();
  await page.locator(".water-card").waitFor();
  for (const n of [150, 250, 500]) await click(`+${n} mL`);
  await click("自定义");
  await page.getByLabel("自定义饮水容量").fill("1400");
  await click("记录");
  await page.getByText("好好照顾了自己", { exact: true }).waitFor();
  assert.equal(
    (await invoke("load_snapshot")).water_entries.reduce(
      (s, e) => s + e.amount,
      0,
    ),
    2300,
  );
  await page.locator(".water-history summary").click();
  await page.getByRole("button", { name: /删除 .* 的 1400/ }).click();
  assert.equal(
    await page.getByText("好好照顾了自己", { exact: true }).count(),
    0,
  );
  await click("恢复刚删除的 1400 mL");
  records.push(
    "UI toggle, target 1750, +150/+250/+500/custom, timestamp IPC persistence, achieved/excess, delete/restore",
  );
  await invoke("save_settings", {
    settings: {
      ...(await invoke("load_snapshot")).settings,
      active_view: "focus",
    },
  });
  await page.reload();
  await click("前一天");
  await click("+500 mL");
  const past = shiftDay(dayKey(new Date()), -1);
  assert.equal(
    (await invoke("load_snapshot")).water_entries.filter((e) => e.date === past)
      .length,
    1,
  );
  await click("今天");
  await click("后一天");
  assert.equal(
    await page
      .getByRole("button", { name: "+500 mL", exact: true })
      .isDisabled(),
    true,
  );
  await click("今天");
  await invoke("save_task", {
    task: makeTask({
      id: "long",
      date: dayKey(new Date()),
      title: "喝水回归长计划",
      description: "很长的任务内容。\n".repeat(180),
    }),
  });
  records.push(
    "selected past-date supplementary entry, future read-only, current-date isolation",
  );
  const settings = (await invoke("load_snapshot")).settings;
  for (const active_view of ["overview", "focus"])
    for (const appearance_mode of ["reading", "glass", "frosted"])
      for (const text_size of ["small", "standard", "large"])
        for (const header_layout of ["classic", "compact"]) {
          await invoke("save_settings", {
            settings: {
              ...settings,
              active_view,
              appearance_mode,
              text_size,
              header_layout,
            },
          });
          await page.reload();
          await page.locator(".water-card").waitFor();
          for (const width of [380, 980]) {
            await invoke("plugin:window|set_size", {
              label: "main",
              value: { Logical: { width, height: 480 } },
            });
            await wait();
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
              ),
              false,
            );
            const card = page.locator(".water-card");
            await card.scrollIntoViewIfNeeded();
            assert.equal(
              await card.evaluate((el) => el.scrollWidth > el.clientWidth),
              false,
            );
            if (active_view === "focus") {
              const input = page.getByPlaceholder("添加一件小事…");
              const box = await input.boundingBox();
              assert.ok(
                box &&
                  box.y >= 0 &&
                  box.y + box.height <=
                    (await page.evaluate(() => innerHeight)),
              );
            }
            layouts.push({
              active_view,
              appearance_mode,
              text_size,
              header_layout,
              width,
            });
          }
        }
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 380, height: 680 } },
  });
  await wait(200);
  await page.locator(".water-card").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(root, "focus-380.png") });
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: 860 } },
  });
  await page.locator(".focus-scroll").evaluate((el) => (el.scrollTop = 0));
  await click("喝水回归长计划");
  const before = await page.getByPlaceholder("添加一件小事…").boundingBox();
  await page
    .locator(".focus-scroll")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  const after = await page.getByPlaceholder("添加一件小事…").boundingBox();
  assert.equal(before.y, after.y);
  records.push(
    "72 layout states; long expanded task scroll preserves fixed quick-add",
  );
  const snapshot = await invoke("load_snapshot");
  await invoke("save_settings", {
    settings: { ...snapshot.settings, water_enabled: false },
  });
  await page.reload();
  assert.equal(await page.locator(".water-card").count(), 0);
  assert.equal((await invoke("load_snapshot")).water_entries.length, 5);
  await invoke("save_settings", {
    settings: { ...snapshot.settings, water_enabled: true },
  });
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
  assert.equal((await invoke("load_snapshot")).settings.water_goal, 1750);
  records.push(
    "hide retains records; real process exit/restart retains entries and settings",
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
