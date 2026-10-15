// Real Windows WebView2 -> Tauri IPC -> Rust SQLite smoke test.
// Requires a debug native build and a Vite server on :1420.
// Debug-only STARRY_LIST_TEST_DATA_DIR isolates database and window state.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const testDir = resolve(".cache/desktop-smoke-" + Date.now());
const screenshots = resolve("docs/screenshots");
await mkdir(testDir, { recursive: true });
await mkdir(screenshots, { recursive: true });
const executable = resolve("src-tauri/target/debug/starry-list.exe");
let child, browser, page;
async function launch() {
  child = spawn(executable, [], {
    windowsHide: true,
    env: {
      ...process.env,
      STARRY_LIST_TEST_DATA_DIR: testDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222",
    },
  });
  let error;
  for (let i = 0; i < 120; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      break;
    } catch (e) {
      error = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!browser) throw error;
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent("page"));
  page.on("pageerror", (e) => console.log("WebView2 error:", e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("WebView2 console:", msg.text());
  });
  await page.waitForLoadState("domcontentloaded");
  await page.locator("main.overview, main.focus").waitFor();
  await page.waitForFunction(
    async () =>
      await window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", {
        label: "main",
      }),
  );
  await page.waitForTimeout(150);
  const header = await readFile(resolve(testDir, "starry-list.db"));
  assert.equal(
    header.subarray(0, 16).toString(),
    "SQLite format 3\0",
    "An isolated test database must exist before any task mutation",
  );
}
async function invoke(command, args = {}) {
  return page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
}
async function click(button) {
  await page.getByRole("button", { name: button, exact: true }).click();
}
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
}).format(new Date());
const title = "讨论新版本方案";
const longText =
  "调研范围：\n1. 产品 A 的功能设计\n2. 产品 B 的主要交互\n3. 用户反馈和优缺点\n\n下一步：整理对比表，形成初稿。\n".repeat(
    80,
  );
const results = [];
try {
  await launch();
  await page.getByRole("textbox", { name: `${today} 新任务标题` }).fill(title);
  await page
    .getByRole("textbox", { name: `${today} 新任务标题` })
    .press("Enter");
  await page
    .getByRole("region", { name: "七天日程" })
    .getByRole("button", { name: title, exact: true })
    .waitFor();
  const nextDate = await page
    .getByRole("region", { name: "七天日程" })
    .locator("input")
    .nth(1)
    .getAttribute("aria-label");
  await page
    .getByRole("textbox", { name: nextDate, exact: true })
    .fill("整理调研大纲");
  await page
    .getByRole("textbox", { name: nextDate, exact: true })
    .press("Enter");
  const snap = await invoke("load_snapshot");
  assert.equal(snap.tasks.length, 2);
  assert.notEqual(snap.tasks[0].date, snap.tasks[1].date);
  results.push(
    "7-day quick add binds group date; real SQLite contains both tasks",
  );
  await page
    .getByRole("region", { name: "月历" })
    .getByRole("button", { name: new RegExp(title) })
    .click();
  await page.getByLabel("详细计划").fill(longText);
  await click("非常重要");
  await click("工作");
  await click("统筹总览");
  assert.equal(
    (await invoke("load_snapshot")).tasks.find((t) => t.title === title)
      .description,
    longText,
  );
  results.push(
    "Long Chinese multiline description, category, crown persist when switching view",
  );
  await page
    .getByRole("region", { name: "七天日程" })
    .getByRole("button", { name: `完成 ${title}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: `取消完成 ${title}`, exact: true })
    .waitFor();
  assert.equal(
    (await invoke("load_snapshot")).tasks.find((t) => t.title === title)
      .priority,
    2,
  );
  await page
    .getByRole("button", { name: `取消完成 ${title}`, exact: true })
    .click();
  results.push(
    "Completion/uncompletion updates both views and preserves priority",
  );
  // Fill a real test database with ordinary release screenshot examples, never production data.
  const now = new Date().toISOString();
  const sampleTasks = [
    ["完成日历交互开发", 2, "development", 2],
    ["散步和读书", 0, "life", 3],
    ["准备项目周会", 1, "meeting", 5],
    ["整理昨天的会议纪要", 0, "work", 0],
  ];
  for (const [sampleTitle, priority, category_id, delta] of sampleTasks) {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() + delta);
    const date = new Intl.DateTimeFormat("sv-SE").format(d);
    await invoke("save_task", {
      task: {
        id: crypto.randomUUID(),
        date,
        title: sampleTitle,
        short_label: null,
        description: null,
        completed: sampleTitle.startsWith("整理昨天"),
        priority,
        category_id,
        sort_order: 10,
        created_at: now,
        updated_at: now,
      },
    });
  }
  await page.reload();
  await page.getByRole("region", { name: "月历" }).waitFor();
  await page.screenshot({ path: resolve(screenshots, "overview.png") });
  await page
    .getByRole("region", { name: "月历" })
    .getByRole("button", { name: new RegExp(title) })
    .click();
  await page.getByLabel("详细计划").waitFor();
  await page.screenshot({ path: resolve(screenshots, "focus.png") });
  await click("设置");
  await page.getByRole("checkbox", { name: /^始终置顶/ }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="取消置顶"]') !== null,
  );
  assert.equal(
    await invoke("plugin:window|is_always_on_top", { label: "main" }),
    true,
  );
  await page.getByRole("checkbox", { name: /^始终置顶/ }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.window-buttons [aria-label="始终置顶"]') !==
      null,
  );
  const slider = page.getByRole("slider", { name: /背景不透明度/ });
  await slider.focus();
  await slider.press("Home");
  await page.waitForTimeout(100);
  assert.equal(
    (await invoke("load_snapshot")).settings.background_opacity,
    0.4,
  );
  const textOpacity = await page
    .locator(".setting-opacity>label")
    .evaluate((el) => getComputedStyle(el).opacity);
  assert.equal(textOpacity, "1");
  await page.locator(".dialog").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: resolve(screenshots, "settings.png") });
  results.push(
    "Always-on-top API and persistence; alpha slider leaves text opacity at 1",
  );
  await click("关闭对话框");
  await click("统筹总览");
  for (const width of [980, 760, 500, 380]) {
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width, height: 680 } },
    });
    await page.waitForTimeout(200);
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      doc: document.documentElement.scrollWidth,
    }));
    assert.ok(metrics.doc <= metrics.width, `Horizontal overflow at ${width}`);
    assert.equal(
      await page.getByRole("region", { name: "七天日程" }).isVisible(),
      true,
    );
    if (width === 380)
      await page.screenshot({ path: resolve(screenshots, "compact.png") });
  }
  results.push(
    "980/760/500/380px layouts have no document horizontal overflow; agenda remains accessible",
  );
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: 680 } },
  });
  const backupPath = resolve(testDir, "backup.json");
  await invoke("export_backup", { path: backupPath });
  const exported = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(exported.format, "starry-list");
  const validated = await page.evaluate(async (path) => {
    const domain = await import("/src/domain.ts");
    return domain.backupSchema.parse(
      await window.__TAURI_INTERNALS__.invoke("read_backup", { path }),
    );
  }, backupPath);
  assert.deepEqual(validated, exported);
  await invoke("import_backup", { backup: exported, replace: false });
  let merged = await invoke("load_snapshot");
  assert.equal(merged.tasks.length, exported.tasks.length * 2);
  assert.equal(
    new Set(merged.tasks.map((t) => t.id)).size,
    merged.tasks.length,
  );
  await writeFile(
    resolve(testDir, "bad.json"),
    JSON.stringify({ ...exported, version: 999 }),
  );
  await assert.rejects(() =>
    invoke("read_backup", { path: resolve(testDir, "bad.json") }),
  );
  assert.equal(
    (await invoke("load_snapshot")).tasks.length,
    merged.tasks.length,
  );
  results.push(
    "Real Rust JSON export passes frontend backup validation; transactional merge, ID remapping and malformed-version rejection",
  );
  await invoke("import_backup", { backup: exported, replace: true });
  await page.reload();
  await page.getByRole("region", { name: "月历" }).waitFor();
  await page
    .getByRole("region", { name: "月历" })
    .getByRole("button", { name: new RegExp(title) })
    .click();
  await page.getByLabel("详细计划").fill(longText + "关闭前保存");
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 760, height: 600 } },
  });
  await invoke("plugin:window|set_position", {
    label: "main",
    value: { Physical: { x: 170, y: 190 } },
  });
  const geometryBefore = await Promise.all([
    invoke("plugin:window|outer_position", { label: "main" }),
    invoke("plugin:window|outer_size", { label: "main" }),
  ]);
  console.log(
    "Before close window metrics:",
    geometryBefore,
    await invoke("plugin:window|inner_size", { label: "main" }),
    await invoke("plugin:window|is_decorated", { label: "main" }),
  );
  const exitPromise = new Promise((r) => child.once("exit", r));
  await click("关闭应用");
  await Promise.race([
    exitPromise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(new Error("Native close did not finish within 15 seconds")),
        15000,
      ),
    ),
  ]);
  await browser.close();
  browser = null;
  await launch();
  const restarted = await invoke("load_snapshot");
  const geometryAfter = await Promise.all([
    invoke("plugin:window|outer_position", { label: "main" }),
    invoke("plugin:window|outer_size", { label: "main" }),
  ]);
  console.log(
    "After restore window metrics:",
    geometryAfter,
    await invoke("plugin:window|inner_size", { label: "main" }),
    await invoke("plugin:window|is_decorated", { label: "main" }),
  );
  assert.deepEqual(geometryAfter, geometryBefore);
  assert.equal(
    restarted.tasks.find((t) => t.title === title).description,
    longText + "关闭前保存",
  );
  assert.equal(restarted.settings.active_view, "focus");
  assert.equal(
    restarted.tasks.find((t) => t.title === title).category_id,
    "work",
  );
  results.push(
    "Native close saves draft; process restart retains tasks, category, view, opacity and window geometry",
  );
  await click("最小化");
  await page.waitForFunction(
    async () =>
      await window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", {
        label: "main",
      }),
  );
  results.push(
    "Titlebar minimize button invokes actual native OS minimization",
  );
  await writeFile(
    resolve(testDir, "results.json"),
    JSON.stringify(
      { date: new Date().toISOString(), testDir, results },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: results.length, testDir, results }, null, 2),
  );
} catch (error) {
  if (page) {
    console.log(
      "Native page:",
      page.url(),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
    await page
      .screenshot({ path: resolve(testDir, "failure.png") })
      .catch(() => {});
  }
  throw error;
} finally {
  if (browser) {
    try {
      await invoke("plugin:window|close", { label: "main" });
    } catch {
      /* The window may have already closed. */
    }
    await browser.close().catch(() => {});
  }
  if (child && !child.killed) child.kill();
}
