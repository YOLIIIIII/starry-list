import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { makeTask } from "../src/test-fixtures.ts";
const root = resolve(`.cache/sl022a-${Date.now()}`);
await mkdir(root, { recursive: true });
let child, browser, page;
const layouts = [],
  checks = [];
const wait = (ms = 100) => new Promise((r) => setTimeout(r, ms));
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const click = (name) => page.getByRole("button", { name, exact: true }).click();
async function month(target) {
  for (let i = 0; i < 90; i++) {
    const current = await page.locator("h1").innerText();
    const match = current.match(/(\d{4}) 年 (\d+) 月/);
    const [year, m] = target.split("-").map(Number);
    const delta = (year - Number(match[1])) * 12 + m - Number(match[2]);
    if (!delta) return;
    await click(delta > 0 ? "下个月" : "上个月");
  }
  throw Error("month navigation limit");
}
try {
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
  const settings = (await invoke("load_snapshot")).settings;
  const dates = process.argv.includes("--nearby")
    ? ["2027-02-10", "2026-10-01", "2026-08-10"]
    : ["2021-02-10", "2026-10-01", "2026-08-10"];
  for (const date of dates) {
    for (let i = 0; i < 3; i++)
      await invoke("save_task", {
        task: makeTask({
          id: `${date}-${i}`,
          date,
          title: `合成星星计划 ${i}`,
          completed: i !== 0,
          priority: i,
        }),
      });
    const next =
      date.slice(0, 8) + String(Number(date.slice(8)) + 1).padStart(2, "0");
    await invoke("save_task", {
      task: makeTask({
        id: next,
        date: next,
        title: "合成全部完成",
        completed: true,
        priority: 1,
      }),
    });
    await invoke("save_mark", {
      date,
      mark: { date, kind: "overtime", note: null },
    });
  }
  for (const text_size of ["small", "standard", "large"])
    for (const appearance_mode of ["reading", "glass", "frosted"])
      for (const header_layout of ["classic", "compact"])
        for (const water_enabled of [false, true]) {
          await invoke("save_settings", {
            settings: {
              ...settings,
              active_view: "overview",
              text_size,
              appearance_mode,
              header_layout,
              water_enabled,
              animations_enabled: false,
            },
          });
          await page.reload();
          await page.locator("main").waitFor();
          for (let mi = 0; mi < dates.length; mi++) {
            await month(dates[mi]);
            for (const [width, height] of [
              [980, 680],
              [980, 480],
              [760, 620],
              [500, 620],
              [380, 480],
            ]) {
              await invoke("plugin:window|set_size", {
                label: "main",
                value: { Logical: { width, height } },
              });
              await wait(70);
              const result = await page.evaluate(() => {
                const issues = [];
                const contains = (a, b) =>
                  b.left >= a.left - 0.6 &&
                  b.right <= a.right + 0.6 &&
                  b.top >= a.top - 0.6 &&
                  b.bottom <= a.bottom + 0.6;
                const overlaps = (a, b) =>
                  a.left < b.right - 0.6 &&
                  a.right > b.left + 0.6 &&
                  a.top < b.bottom - 0.6 &&
                  a.bottom > b.top + 0.6;
                for (const cell of document.querySelectorAll(".day-cell")) {
                  const bounds = cell.getBoundingClientRect(),
                    star = cell.querySelector(".daily-star");
                  const number = cell
                    .querySelector(".date-number")
                    .getBoundingClientRect();
                  for (const el of cell.querySelectorAll(
                    ".date-number,.day-badge,.daily-star",
                  ))
                    if (!contains(bounds, el.getBoundingClientRect()))
                      issues.push("clipped " + el.className);
                  if (star) {
                    const b = star.getBoundingClientRect();
                    if (overlaps(b, number)) issues.push("date overlap");
                    for (const el of cell.querySelectorAll(
                      ".day-badge,.calendar-task",
                    ))
                      if (
                        getComputedStyle(el).display !== "none" &&
                        overlaps(b, el.getBoundingClientRect())
                      )
                        issues.push("badge/preview overlap");
                  }
                }
                return {
                  issues,
                  weeks: document.querySelectorAll(".day-cell").length / 7,
                  overflow: document.documentElement.scrollWidth > innerWidth,
                };
              });
              assert.deepEqual(
                result.issues,
                [],
                JSON.stringify({ text_size, width, height, ...result }),
              );
              assert.equal(result.weeks, [4, 5, 6][mi]);
              assert.equal(result.overflow, false);
              const dateButton = page.getByRole("button", {
                name: `选择 ${dates[mi]}`,
                exact: true,
              });
              assert.ok(
                await dateButton.locator(".daily-star.planned").count(),
              );
              layouts.push({
                text_size,
                appearance_mode,
                header_layout,
                water_enabled,
                width,
                height,
                ...result,
              });
              if (
                text_size === "standard" &&
                appearance_mode === "reading" &&
                header_layout === "classic" &&
                !water_enabled &&
                mi === 1
              )
                await page.screenshot({
                  path: resolve(root, `calendar-${width}x${height}.png`),
                });
            }
          }
        }
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: 680 } },
  });
  await month("2026-10-01");
  const day = page.getByRole("button", {
    name: "选择 2026-10-01",
    exact: true,
  });
  await day.click();
  await click("完成 合成星星计划 0");
  await day.locator(".completed").waitFor();
  await click("取消完成 合成星星计划 0");
  await day.locator(".planned").waitFor();
  await day.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-label") === "选择 2026-10-02",
  );
  checks.push(
    "real WebView2/Tauri/SQLite completion and uncompletion update without reload; star hit target selects date; arrow navigation",
  );
  await page.screenshot({ path: resolve(root, "final.png") });
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify({ layouts, checks }, null, 2),
  );
  console.log(JSON.stringify({ root, states: layouts.length, checks }));
} catch (e) {
  await page
    ?.screenshot({ path: resolve(root, "failure.png") })
    .catch(() => {});
  throw e;
} finally {
  if (browser) {
    await invoke("plugin:window|close", { label: "main" }).catch(() => {});
    await browser.close();
  }
  if (child && child.exitCode === null) child.kill();
}
