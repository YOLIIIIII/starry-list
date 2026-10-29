import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { defaults, dayKey } from "../src/domain.ts";
import { makeTask } from "../src/test-fixtures.ts";
const root = resolve(`.cache/sl020-${Date.now()}`);
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
async function launch() {
  child = spawn(resolve("src-tauri/target/debug/starry-list.exe"), [], {
    windowsHide: true,
    env: {
      ...process.env,
      STARRY_LIST_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: resolve(root, "profile"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9339",
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9339");
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
const click = (name) => page.getByRole("button", { name, exact: true }).click();
async function order() {
  return (await invoke("load_snapshot")).tasks
    .filter((t) => t.date === dayKey(new Date()))
    .sort(
      (a, b) =>
        Number(a.completed) - Number(b.completed) ||
        a.sort_order - b.sort_order,
    )
    .map((t) => t.id);
}
async function drag(from, to, after = false, cancel = false, edge = false) {
  await invoke("plugin:window|set_focus", { label: "main" });
  await wait();
  const a = await page.locator(`#task-${from} .task-drag-handle`).boundingBox(),
    b = await page.locator(`#task-${to} .task-row`).boundingBox();
  const pos = await invoke("plugin:window|outer_position", { label: "main" }),
    scale = await page.evaluate(() => devicePixelRatio);
  const handles = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${child.pid}).MainWindowHandle.ToInt64()`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const x = pos.x + (a.x + a.width / 2) * scale,
    y = pos.y + (a.y + a.height / 2) * scale;
  const edgeY = await page
    .locator(".focus-scroll")
    .evaluate((el) => el.getBoundingClientRect().bottom - 6);
  const endX = pos.x + (b.x + 30) * scale,
    endY =
      pos.y + (edge ? edgeY : b.y + b.height * (after ? 0.85 : 0.15)) * scale;
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      resolve("scripts/drag-input.ps1"),
      "-OwnerPid",
      String(child.pid),
      "-Window",
      handles,
      "-X",
      String(Math.round(x)),
      "-Y",
      String(Math.round(y)),
      "-DeltaX",
      String(Math.round(endX - x)),
      "-DeltaY",
      String(Math.round(endY - y)),
      ...(cancel ? ["-Cancel"] : []),
      ...(edge ? ["-HoldMs", "1500"] : []),
    ],
    { windowsHide: true },
  );
  await wait(300);
}
try {
  await launch();
  await invoke("save_settings", {
    settings: { ...defaults, active_view: "focus" },
  });
  for (let i = 0; i < 5; i++)
    await invoke("save_task", {
      task: makeTask({
        id: `t${i}`,
        title: `排序样例 ${i}`,
        date: dayKey(new Date()),
        completed: i >= 3,
        sort_order: i,
      }),
    });
  await page.reload();
  await page.locator(".focus-scroll").waitFor();
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: 860 } },
  });
  await wait(200);
  await drag("t2", "t0");
  assert.deepEqual(await order(), ["t2", "t0", "t1", "t3", "t4"]);
  records.push("OS mouse: last unfinished to first");
  await drag("t2", "t1", true);
  assert.deepEqual(await order(), ["t0", "t1", "t2", "t3", "t4"]);
  records.push("OS mouse: first unfinished to last");
  await drag("t4", "t3");
  assert.deepEqual(await order(), ["t0", "t1", "t2", "t4", "t3"]);
  records.push("OS mouse: completed group reorder");
  const before = await order();
  await drag("t0", "t4", true);
  assert.deepEqual(await order(), before);
  records.push("OS mouse: cross-group rejected");
  const db = new DatabaseSync(resolve(root, "starry-list.db"));
  db.exec(
    "CREATE TRIGGER sl020_fail BEFORE UPDATE OF sort_order ON tasks BEGIN SELECT RAISE(ABORT,'SL020 failure'); END;",
  );
  await drag("t2", "t0");
  assert.deepEqual(await order(), before);
  await page
    .getByText(/SL020 failure/)
    .first()
    .waitFor();
  db.exec("DROP TRIGGER sl020_fail;");
  db.close();
  await drag("t2", "t0");
  assert.equal((await order())[0], "t2");
  records.push("actual SQLite failure rollback and OS retry");
  await click("下移 排序样例 2");
  assert.equal((await order())[1], "t2");
  records.push("arrows after drag");
  const cancelled = await order();
  await drag("t2", "t0", false, true);
  assert.deepEqual(await order(), cancelled);
  records.push("OS Escape cancels native drag");
  const long = (await invoke("load_snapshot")).tasks.find((t) => t.id === "t2");
  await invoke("save_task", {
    task: { ...long, description: "长计划\n".repeat(150) },
  });
  await page.reload();
  await page.locator(".focus-scroll").waitFor();
  await click("排序样例 2");
  await page.evaluate(() =>
    document.addEventListener("dragstart", () =>
      setTimeout(() => {
        window.__dragPreviewHeight = document
          .querySelector(".task-drag-preview")
          ?.getBoundingClientRect().height;
      }, 0),
    ),
  );
  await drag("t2", "t0");
  assert.equal((await order())[0], "t2");
  assert.ok(
    await page.evaluate(
      () => window.__dragPreviewHeight > 0 && window.__dragPreviewHeight < 80,
    ),
  );
  await click("排序样例 2");
  records.push("expanded long plan uses compact native preview and sorts");
  for (let i = 5; i < 45; i++)
    await invoke("save_task", {
      task: makeTask({
        id: `t${i}`,
        title: `长清单样例 ${i}`,
        date: dayKey(new Date()),
        sort_order: i,
      }),
    });
  await page.reload();
  await page.locator(".focus-scroll").waitFor();
  const largeOrder = await order();
  await drag("t2", "t0", false, true, true);
  assert.ok(
    (await page.locator(".focus-scroll").evaluate((el) => el.scrollTop)) > 0,
  );
  assert.deepEqual(await order(), largeOrder);
  records.push("45-task native edge autoscroll and cancellation");
  for (const appearance_mode of ["reading", "glass", "frosted"])
    for (const text_size of ["small", "standard", "large"])
      for (const header_layout of ["classic", "compact"]) {
        await invoke("save_settings", {
          settings: {
            ...defaults,
            active_view: "focus",
            appearance_mode,
            text_size,
            header_layout,
          },
        });
        await page.reload();
        await page.locator(".focus-scroll").waitFor();
        for (const width of [380, 500, 760, 980]) {
          await invoke("plugin:window|set_size", {
            label: "main",
            value: { Logical: { width, height: 480 } },
          });
          await wait();
          const metrics = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth,
            handles: [...document.querySelectorAll(".task-drag-handle")].every(
              (el) => {
                const r = el.getBoundingClientRect();
                return r.width >= 14 && r.left >= 0 && r.right <= innerWidth;
              },
            ),
          }));
          assert.equal(metrics.overflow, false);
          assert.equal(metrics.handles, true);
          layouts.push({ appearance_mode, text_size, header_layout, width });
        }
      }
  await page.screenshot({ path: resolve(root, "focus.png") });
  const saved = await order();
  await click("关闭应用");
  for (let i = 0; i < 50 && child.exitCode === null; i++) await wait();
  await browser.close();
  browser = null;
  await launch();
  assert.deepEqual(await order(), saved);
  records.push("real process restart persistence");
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify({ records, layouts }, null, 2),
  );
  console.log(JSON.stringify({ records, states: layouts.length, root }));
} catch (error) {
  console.log(
    await page
      .locator(".focus-scroll")
      .evaluate((el) => ({
        height: el.clientHeight,
        scroll: el.scrollTop,
        alerts: [...document.querySelectorAll('[role="alert"]')].map(
          (a) => a.textContent,
        ),
      }))
      .catch(() => null),
  );
  await page.screenshot({ path: resolve(root, "failure.png") }).catch(() => {});
  throw error;
} finally {
  if (browser) {
    try {
      await invoke("plugin:window|close", { label: "main" });
    } catch {
      /* closed */
    }
    await browser.close();
  }
  if (child && child.exitCode === null) child.kill();
}
