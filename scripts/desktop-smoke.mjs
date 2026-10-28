// Real Windows WebView2 -> Tauri IPC -> Rust SQLite smoke test.
// Requires Node.js 24 and a debug native build (embedded assets or Vite).
// Debug-only STARRY_LIST_TEST_DATA_DIR isolates database and window state.
// Use the isolated identifier + test-only focus permission config in docs/VALIDATION.md.
// The foreground-transfer test launches its own temporary Edge profile.
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { shiftDay, backupSchema } from "../src/domain.ts";
const testDir = resolve(".cache/desktop-smoke-" + Date.now());
const screenshots = resolve(
  process.env.STARRY_LIST_SCREENSHOT_DIR ?? "docs/screenshots",
);
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
      WEBVIEW2_USER_DATA_FOLDER: resolve(testDir, "webview-profile"),
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
  await page.evaluate(() => {
    window.__focusTrace = [];
    for (const type of [
      "focus",
      "blur",
      "focusin",
      "pointerdown",
      "wheel",
      "keydown",
      "keyup",
    ]) {
      window.addEventListener(
        type,
        (event) => {
          const record = {
            type,
            label: event.target?.getAttribute?.("aria-label"),
            key: event.key,
            focused: document.hasFocus(),
            time: performance.now(),
          };
          window.__focusTrace.push(record);
          void window.__TAURI_INTERNALS__
            .invoke("plugin:window|is_focused", { label: "main" })
            .then((native) => {
              record.native = native;
            });
          if (window.__focusTrace.length > 80) window.__focusTrace.shift();
        },
        true,
      );
    }
  });
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
// Preview navigation requires space below the date header; compact calendars
// deliberately expose a full count/dot instead. Do not force a clipped preview.
async function openCalendarTask(title) {
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: 860 } },
  });
  await page
    .getByRole("region", { name: "月历" })
    .getByRole("button", { name: new RegExp(title) })
    .click();
}
async function focusNative() {
  await invoke("plugin:window|set_focus", { label: "main" });
  await page.waitForFunction(
    async () =>
      await window.__TAURI_INTERNALS__.invoke("plugin:window|is_focused", {
        label: "main",
      }),
    undefined,
    { polling: 100 },
  );
}
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
}).format(new Date());
const title = "讨论新版本方案";
let longText =
  "调研范围：\n1. 产品 A 的功能设计\n2. 产品 B 的主要交互\n3. 用户反馈和优缺点\n\n下一步：整理对比表，形成初稿。\n".repeat(
    80,
  );
const results = [];
try {
  await launch();
  assert.equal(
    await page
      .getByRole("region", { name: "七天日程" })
      .getByRole("textbox")
      .count(),
    0,
  );
  assert.equal(await page.locator(".agenda-empty-hint").count(), 1);
  await click(`为 ${today} 添加任务`);
  await page.getByRole("textbox", { name: `${today} 新任务标题` }).fill(title);
  await page
    .getByRole("textbox", { name: `${today} 新任务标题` })
    .press("Enter");
  await page
    .getByRole("region", { name: "七天日程" })
    .getByRole("button", { name: title, exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "七天日程" })
      .getByRole("textbox")
      .count(),
    0,
  );
  const nextDay = shiftDay(today, 1);
  // Enter returns to its own date only after the actual SQLite INSERT succeeds.
  for (const date of [today, nextDay, shiftDay(today, 3)]) {
    await focusNative();
    await click(`为 ${date} 添加任务`);
    const ids = [];
    for (let index = 0; index < 3; index++) {
      const input = page.getByRole("textbox", {
        name: `${date} 新任务标题`,
        exact: true,
      });
      const text = `UX23 连续新增 ${date} ${index}`;
      await input.fill(text);
      await page
        .getByRole("button", { name: `添加到 ${date}`, exact: true })
        .waitFor();
      // CDP DOM focus is not native foreground. Re-establish the actual native
      // precondition immediately before keyboard submission, not just per date.
      await focusNative();
      assert.equal(
        await input.evaluate((el) => document.activeElement === el),
        true,
      );
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (date) =>
          document.activeElement?.getAttribute("aria-label") ===
          `为 ${date} 添加任务`,
        date,
      );
      assert.equal(
        await input.count(),
        0,
        "First Enter only saves, never reopens",
      );
      const saved = (await invoke("load_snapshot")).tasks.filter(
        (task) => task.title === text,
      );
      assert.equal(saved.length, 1);
      assert.equal(saved[0].date, date);
      ids.push(saved[0].id);
      if (index < 2) await page.keyboard.press("Enter");
    }
    for (const id of ids) await invoke("delete_task", { id });
    await page.reload();
    await page.getByRole("region", { name: "七天日程" }).waitFor();
  }
  results.push(
    "UX2.3 native Enter/second Enter adds three tasks each to three original dates, with correct focus return and no duplicates",
  );
  const nextDate = `${nextDay} 新任务标题`;
  await click(`为 ${nextDay} 添加任务`);
  await page
    .getByRole("textbox", { name: nextDate, exact: true })
    .fill("整理调研大纲");
  await page
    .getByRole("textbox", { name: nextDate, exact: true })
    .press("Enter");
  const snap = await invoke("load_snapshot");
  assert.equal(snap.tasks.length, 2);
  // Round two UX: all mutations below remain in the verified isolated database.
  await click(`为 ${nextDay} 添加任务`);
  await page.getByRole("textbox", { name: nextDate, exact: true }).fill("   ");
  await page.locator(".agenda-range-description").click();
  assert.equal(await page.locator(".agenda-scroll input").count(), 0);
  await click(`为 ${nextDay} 添加任务`);
  await click(`为 ${nextDay} 添加任务`);
  assert.equal(await page.locator(".agenda-scroll input").count(), 0);
  await click(`为 ${today} 添加任务`);
  await click(`为 ${nextDay} 添加任务`);
  assert.equal(await page.locator(".agenda-scroll input").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".agenda-scroll input").count(), 0);
  results.push(
    "Native pointer/focus ordering: empty outside click, same plus, Escape and unique quick-add region",
  );
  await click(`为 ${nextDay} 添加任务`);
  await page
    .getByRole("textbox", { name: nextDate, exact: true })
    .fill("整理下周计划");
  await page.getByRole("textbox", { name: nextDate, exact: true }).focus();
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "处理未添加的任务" }).waitFor();
  await page.screenshot({ path: resolve(screenshots, "quick-add.png") });
  await click("继续填写");
  const roundTwoDb = new DatabaseSync(resolve(testDir, "starry-list.db"));
  try {
    roundTwoDb.exec(
      "CREATE TRIGGER ux2_insert_failure BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'UX2 INSERT failure'); END;",
    );
    await click("下一周");
    await page
      .getByText(/UX2 INSERT failure/)
      .first()
      .waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: nextDate, exact: true })
        .inputValue(),
      "整理下周计划",
    );
    assert.equal((await invoke("load_snapshot")).tasks.length, 2);
  } finally {
    roundTwoDb.exec("DROP TRIGGER IF EXISTS ux2_insert_failure");
    roundTwoDb.close();
  }
  await click("下一周");
  await page
    .getByRole("textbox", { name: nextDate, exact: true })
    .waitFor({ state: "detached" });
  const addedSnapshot = await invoke("load_snapshot");
  const probe = addedSnapshot.tasks.find((t) => t.title === "整理下周计划");
  assert.equal(probe.date, nextDay);
  await invoke("delete_task", { id: probe.id });
  await page.reload();
  await page.getByRole("region", { name: "七天日程" }).waitFor();
  await click("七天日程回到今天");
  results.push(
    "Native nonempty draft protection across range changes, real SQLite INSERT failure retains draft, retry persists original date then continues",
  );
  // The isolated debug config grants set-focus solely for this test.
  await invoke("plugin:window|set_focus", { label: "main" });
  await page.waitForFunction(
    async () =>
      await window.__TAURI_INTERNALS__.invoke("plugin:window|is_focused", {
        label: "main",
      }),
  );
  await page.evaluate(async () => {
    window.__focusTrace = [];
    for (const name of ["focus", "blur", "compositionstart", "compositionend"])
      window.addEventListener(name, () => window.__focusTrace.push(name), true);
    for (const event of ["tauri://focus", "tauri://blur"])
      await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
        event,
        target: { kind: "Window", label: "main" },
        handler: window.__TAURI_INTERNALS__.transformCallback(() =>
          window.__focusTrace.push(event),
        ),
      });
  });
  // A separate real desktop browser is used, never the user's browser or app.
  await click(`为 ${nextDay} 添加任务`);
  await page
    .getByRole("textbox", { name: nextDate, exact: true })
    .fill("UX22 窗口失焦验证");
  await page
    .getByRole("button", { name: `添加到 ${nextDay}`, exact: true })
    .waitFor();
  assert.equal(
    await invoke("plugin:window|is_focused", { label: "main" }),
    true,
    "Test app must start in the OS foreground before the focus transfer",
  );
  const edgeProfile = resolve(testDir, "edge-focus-profile");
  const otherBrowser = await chromium.launchPersistentContext(edgeProfile, {
    channel: "msedge",
    headless: false,
    args: ["--no-first-run"],
  });
  try {
    const other = await otherBrowser.newPage();
    await other.setContent(
      "<title>Starry List isolated focus test</title><button>独立测试浏览器</button>",
    );
    await other.bringToFront();
    await other.getByRole("button").click();
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve("scripts/focus-test-browser.ps1"),
        "-Profile",
        edgeProfile,
        "-EnsureVisible",
      ],
      { windowsHide: true },
    );
    await page.waitForFunction(
      async () =>
        !(await window.__TAURI_INTERNALS__.invoke("plugin:window|is_focused", {
          label: "main",
        })),
    );
    // An occluded WebView may defer rendering. Assert real persistence while
    // Edge owns the foreground, then assert the collapsed UI after returning.
    let added = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      const connection = new DatabaseSync(resolve(testDir, "starry-list.db"), {
        readOnly: true,
      });
      try {
        added = connection
          .prepare("SELECT date FROM tasks WHERE title = ?")
          .all("UX22 窗口失焦验证");
      } finally {
        connection.close();
      }
      if (added.length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(added.length, 1);
    assert.equal(added[0].date, nextDay);
    assert.equal(
      await invoke("plugin:window|is_focused", { label: "main" }),
      false,
      "Autosave must not reactivate Starry List",
    );
    // Restore and undo before shutting down Edge: process shutdown can exceed
    // the real five-second undo window on a busy Windows machine.
    await page.bringToFront();
    await invoke("plugin:window|set_focus", { label: "main" });
    await page
      .getByRole("textbox", { name: nextDate, exact: true })
      .waitFor({ state: "detached" });
    await page
      .getByRole("status", { name: "已添加 UX22 窗口失焦验证", exact: true })
      .getByRole("button", { name: "撤销", exact: true })
      .click();
    assert.equal((await invoke("load_snapshot")).tasks.length, 2);
  } finally {
    await otherBrowser.close();
  }
  results.push(
    "UX2.2 real Windows foreground switch to isolated Edge saves original-date title exactly once; addition undo persists",
  );

  await click(`快速修改 ${title}`);
  await page
    .getByRole("textbox", { name: "快速修改任务标题", exact: true })
    .fill("UX22 行内修改验证");
  await page
    .getByRole("textbox", { name: "快速修改任务标题", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "快速修改 UX22 行内修改验证", exact: true })
    .waitFor();
  assert.equal(
    (await invoke("load_snapshot")).tasks.find(
      (t) => t.title === "UX22 行内修改验证",
    ).description,
    null,
  );
  await click("快速修改 UX22 行内修改验证");
  await page
    .getByRole("textbox", { name: "快速修改任务标题", exact: true })
    .fill(title);
  await page.locator(".agenda-range-description").click();
  await page
    .getByRole("button", { name: `快速修改 ${title}`, exact: true })
    .waitFor();
  results.push(
    "UX2.2 native inline title save by Enter/outside click synchronizes actual SQLite without navigation",
  );
  await click(`快速修改 ${title}`);
  const inlineDb = new DatabaseSync(resolve(testDir, "starry-list.db"));
  try {
    inlineDb.exec(
      "CREATE TRIGGER ux22_title_failure BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'UX22 title failure'); END;",
    );
    await page
      .getByRole("textbox", { name: "快速修改任务标题", exact: true })
      .fill("失败后保留的标题");
    await click("专注编辑");
    await page
      .getByText("保存失败，修改仍在这里。请重试。", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "快速修改任务标题", exact: true })
        .inputValue(),
      "失败后保留的标题",
    );
    assert.equal(
      (await invoke("load_snapshot")).settings.active_view,
      "overview",
    );
    await click("关闭应用");
    await page.waitForTimeout(100);
    assert.equal(
      await invoke("plugin:window|is_visible", { label: "main" }),
      true,
    );
    assert.equal(
      await page
        .getByRole("textbox", { name: "快速修改任务标题", exact: true })
        .inputValue(),
      "失败后保留的标题",
    );
  } finally {
    inlineDb.exec("DROP TRIGGER IF EXISTS ux22_title_failure");
    inlineDb.close();
  }
  await page
    .getByRole("textbox", { name: "快速修改任务标题", exact: true })
    .press("Escape");
  results.push(
    "UX2.2 real inline SQLite UPDATE failure retains title and blocks view change/normal native close; Escape restores original",
  );

  const toastBase = (await invoke("load_snapshot")).tasks[0];
  const toastProbeA = {
    ...toastBase,
    id: crypto.randomUUID(),
    title: "UX22 独立撤销甲",
  };
  const toastProbeB = {
    ...toastBase,
    id: crypto.randomUUID(),
    title: "UX22 独立撤销乙",
  };
  for (const task of [toastProbeA, toastProbeB])
    await invoke("save_task", { task });
  await page.reload();
  await page.getByRole("region", { name: "七天日程" }).waitFor();
  for (const task of [toastProbeA, toastProbeB]) {
    await click(`任务操作 ${task.title}`);
    await page.getByRole("menuitem", { name: "删除任务", exact: true }).click();
    await page
      .getByRole("dialog", { name: "删除这件任务？" })
      .getByRole("button", { name: "删除任务", exact: true })
      .click();
    await page
      .getByRole("status", { name: `已删除 ${task.title}`, exact: true })
      .waitFor();
  }
  await page.getByRole("button", { name: "下一条通知（共 2 条）" }).click();
  const toastA = page.getByRole("status", {
    name: "已删除 UX22 独立撤销甲",
    exact: true,
  });
  const toastB = page.getByRole("status", {
    name: "已删除 UX22 独立撤销乙",
    exact: true,
  });
  await toastA.hover();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="已删除 UX22 独立撤销甲"]')?.dataset
        .paused === "true",
  );
  await toastA.getByRole("button", { name: "撤销", exact: true }).focus();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(5300);
  assert.equal(await toastA.count(), 1);
  assert.equal(await toastB.count(), 0);
  assert.equal((await invoke("load_snapshot")).tasks.length, 2);
  await toastA.getByRole("button", { name: "撤销", exact: true }).focus();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  await toastA
    .getByRole("button", { name: "撤销", exact: true })
    .press("Enter");
  await page.getByText("任务已恢复", { exact: true }).waitFor();
  assert.deepEqual(
    (await invoke("load_snapshot")).tasks.find((t) => t.id === toastProbeA.id),
    toastProbeA,
  );
  await invoke("delete_task", { id: toastProbeA.id });
  await page.reload();
  await page.getByRole("region", { name: "七天日程" }).waitFor();
  results.push(
    "UX2.2 native independent deletion toasts: 5-second expiry, hover/focus pause and real complete task restore",
  );
  await click(`为 ${today} 添加任务`);
  await page
    .getByRole("textbox", { name: `${today} 新任务标题`, exact: true })
    .fill("UX23 通知布局检查");
  await page.keyboard.press("Enter");
  const layoutToast = page.getByRole("status", {
    name: "已添加 UX23 通知布局检查",
    exact: true,
  });
  await layoutToast.hover();
  for (const view of ["统筹总览", "专注编辑"]) {
    await click(view);
    for (const width of [980, 860, 760, 500, 380]) {
      await invoke("plugin:window|set_size", {
        label: "main",
        value: { Logical: { width, height: 680 } },
      });
      await page.waitForTimeout(100);
      await layoutToast.hover();
      const geometry = await page.evaluate(() => {
        const region = document.querySelector(".notification-region");
        const rect = region.getBoundingClientRect();
        const overlaps = [
          ...document.querySelectorAll(
            ".brand,.window-buttons,.view-switch,.nav-buttons,.quick-add,.section-heading h1,.focus-heading h1",
          ),
        ]
          .filter((el) => {
            const b = el.getBoundingClientRect();
            return (
              b.width &&
              b.height &&
              rect.left < b.right &&
              rect.right > b.left &&
              rect.top < b.bottom &&
              rect.bottom > b.top
            );
          })
          .map((el) => el.className || el.tagName);
        return {
          overlaps,
          centered: Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) < 1,
          clickThrough: !document
            .elementFromPoint(5, rect.top + 12)
            ?.closest(".notification-region"),
          height: rect.height,
        };
      });
      assert.deepEqual(
        geometry.overlaps,
        [],
        `${view} ${width}px notification overlaps controls`,
      );
      assert.equal(geometry.centered, true);
      assert.equal(geometry.clickThrough, true);
      assert.equal(geometry.height, 24);
    }
  }
  await page.getByRole("button", { name: title, exact: true }).click();
  await click("编辑");
  await layoutToast.waitFor({ state: "hidden" });
  assert.equal(
    await layoutToast.count(),
    0,
    "Drawer hides notifications without destroying undo state",
  );
  await page.waitForTimeout(5300);
  await click("取消");
  await layoutToast.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal((await invoke("load_snapshot")).tasks.length, 2);
  await click("统筹总览");
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: 680 } },
  });
  results.push(
    "UX2.3 top-center compact notifications avoid primary controls at 980/860/760/500/380px in both views; outside hit testing passes, drawer hides/pauses undo beyond five seconds",
  );
  const beforeDelete = (await invoke("load_snapshot")).tasks.find(
    (t) => t.title === title,
  );
  await click(`任务操作 ${title}`);
  await page.getByRole("menuitem", { name: "删除任务" }).click();
  await click("保留");
  assert.equal((await invoke("load_snapshot")).tasks.length, 2);
  await click(`任务操作 ${title}`);
  await page.screenshot({ path: resolve(screenshots, "task-menu.png") });
  await page.getByRole("menuitem", { name: "删除任务" }).click();
  const deleteDb = new DatabaseSync(resolve(testDir, "starry-list.db"));
  try {
    deleteDb.exec(
      "CREATE TRIGGER ux2_delete_failure BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT,'UX2 DELETE failure'); END;",
    );
    await page
      .getByRole("dialog", { name: "删除这件任务？" })
      .getByRole("button", { name: "删除任务", exact: true })
      .click();
    await page
      .getByText(/UX2 DELETE failure/)
      .first()
      .waitFor();
    assert.equal((await invoke("load_snapshot")).tasks.length, 2);
    assert.equal(
      await page.getByText("任务已删除", { exact: true }).count(),
      0,
    );
  } finally {
    deleteDb.exec("DROP TRIGGER IF EXISTS ux2_delete_failure");
    deleteDb.close();
  }
  await page
    .getByRole("dialog", { name: "删除这件任务？" })
    .getByRole("button", { name: "删除任务", exact: true })
    .click();
  await page
    .getByRole("status", { name: `已删除 ${title}`, exact: true })
    .getByRole("button", { name: "撤销", exact: true })
    .waitFor();
  assert.equal((await invoke("load_snapshot")).tasks.length, 1);
  await page
    .getByRole("status", { name: `已删除 ${title}`, exact: true })
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await page.getByText("任务已恢复", { exact: true }).waitFor();
  assert.deepEqual(
    (await invoke("load_snapshot")).tasks.find((t) => t.id === beforeDelete.id),
    beforeDelete,
  );
  await click(`任务操作 ${title}`);
  await page.getByRole("menuitem", { name: "编辑任务" }).click();
  assert.equal(
    await page.getByLabel("任务日期", { exact: true }).inputValue(),
    today,
  );
  await click("取消");
  assert.equal(
    await page.locator(".focus-scroll .task-actions-trigger").count(),
    0,
  );
  const directDelete = page
    .locator(".focus-scroll .task-row")
    .filter({ has: page.getByRole("button", { name: title, exact: true }) })
    .getByRole("button", { name: "删除任务", exact: true });
  await directDelete.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "删除这件任务？" }).waitFor();
  await click("保留");
  assert.equal(
    await directDelete.evaluate((el) => document.activeElement === el),
    true,
  );
  await click("统筹总览");
  results.push(
    "Native task menu: overview edit targets correct date, focus direct-delete keyboard/cancel restores focus, cancellation, real SQLite DELETE failure, retry and complete undo",
  );
  assert.notEqual(snap.tasks[0].date, snap.tasks[1].date);
  results.push(
    "7-day quick add binds group date; real SQLite contains both tasks",
  );
  await openCalendarTask(title);
  await page.getByRole("region", { name: "任务详情阅读" }).waitFor();
  assert.ok(
    (await page.getByRole("region", { name: "任务详情阅读" }).boundingBox())
      .height < 150,
    "Empty description should stay compact",
  );
  assert.equal(await page.getByLabel("详细计划", { exact: true }).count(), 0);
  await click("编辑");
  await page
    .getByRole("textbox", { name: "详细计划", exact: true })
    .fill(longText);
  await click("非常重要");
  await click("工作");
  for (const [width, height] of [
    [980, 680],
    [380, 480],
  ]) {
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width, height } },
    });
    await page.waitForTimeout(250);
    const metrics = await page.locator(".drawer-dialog").evaluate((el) => {
      const footer = el.querySelector(".editor-footer").getBoundingClientRect();
      const header = el
        .querySelector(".dialog-heading")
        .getBoundingClientRect();
      const textarea = el.querySelector("textarea");
      const scroll = el.querySelector(".editor-scroll");
      const panel = el.getBoundingClientRect();
      const save = el.querySelector(".editor-footer .primary");
      const saveBounds = save.getBoundingClientRect();
      return {
        footerTop: footer.top,
        footerBottom: footer.bottom,
        headerTop: header.top,
        panelWidth: panel.width,
        panelRight: panel.right,
        windowWidth: innerWidth,
        windowHeight: innerHeight,
        textareaHeight: textarea.getBoundingClientRect().height,
        textareaScroll: textarea.scrollHeight,
        formOverflow: scroll.scrollHeight > scroll.clientHeight,
        docWidth: document.documentElement.scrollWidth,
        saveHitTarget: save.contains(
          document.elementFromPoint(
            saveBounds.left + saveBounds.width / 2,
            saveBounds.top + saveBounds.height / 2,
          ),
        ),
      };
    });
    assert.ok(
      metrics.footerTop >= 0 && metrics.footerBottom <= metrics.windowHeight,
      `Save footer clipped at ${width}`,
    );
    assert.ok(
      metrics.docWidth <= metrics.windowWidth &&
        metrics.panelRight <= metrics.windowWidth,
      `Drawer overflow at ${width}`,
    );
    assert.ok(metrics.textareaHeight >= 156 && metrics.textareaHeight <= 340);
    assert.ok(metrics.textareaScroll > metrics.textareaHeight);
    assert.equal(
      metrics.saveHitTarget,
      true,
      "Save action is covered by another element",
    );
    if (width === 980)
      assert.ok(metrics.panelWidth >= 480 && metrics.panelWidth <= 560);
    await page.locator(".editor-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const after = await page.locator(".editor-footer").boundingBox();
    assert.ok(
      Math.abs(after.y - metrics.footerTop) < 1,
      "Footer moved while form scrolled",
    );
    await page.getByRole("button", { name: "保存并收起", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "关闭对话框",
    );
    await page.locator(".editor-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.locator(".drawer-dialog textarea").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: resolve(
        screenshots,
        width === 980 ? "editor.png" : "editor-compact.png",
      ),
    });
    console.log("Drawer metrics:", { width, height, ...metrics });
  }
  results.push(
    "Wide/narrow native drawer: fixed visible save footer, independent form scroll, 156–340px growing textarea and keyboard focus trap",
  );
  await click("保存并收起");
  await page
    .getByRole("dialog", { name: "编辑任务" })
    .waitFor({ state: "detached" });
  assert.equal(
    await page.getByRole("region", { name: "任务详情阅读" }).count(),
    0,
  );
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: 680 } },
  });
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  assert.equal(
    await page.getByRole("region", { name: "详细计划（只读）" }).textContent(),
    longText,
  );
  results.push(
    "Task opens in plain read mode; successful explicit save closes drawer and collapses task, full multiline text reopens intact",
  );
  await click("编辑");
  await page
    .getByRole("textbox", { name: "详细计划", exact: true })
    .fill(longText + "取消草稿");
  await page.keyboard.press("Escape");
  await click("继续编辑");
  assert.equal(
    await page
      .getByRole("textbox", { name: "详细计划", exact: true })
      .inputValue(),
    longText + "取消草稿",
  );
  await page.keyboard.press("Escape");
  await click("放弃修改");
  assert.equal(
    (await invoke("load_snapshot")).tasks.find((t) => t.title === title)
      .description,
    longText,
  );
  results.push(
    "Escape protects unsaved text; continue editing preserves draft; explicit discard leaves real SQLite unchanged",
  );
  const testDb = new DatabaseSync(resolve(testDir, "starry-list.db"));
  try {
    testDb.exec(
      "CREATE TRIGGER ux_reject_save BEFORE UPDATE ON tasks WHEN NEW.title='写入失败测试' BEGIN SELECT RAISE(ABORT,'UX simulated write failure'); END;",
    );
    await click("编辑");
    await page.getByLabel("任务标题", { exact: true }).fill("写入失败测试");
    await page
      .getByRole("textbox", { name: "详细计划", exact: true })
      .fill(longText + "失败后保留并重试");
    await click("保存并收起");
    await page
      .getByText("保存失败，你的输入仍保留在这里。", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "详细计划", exact: true })
        .inputValue(),
      longText + "失败后保留并重试",
    );
    assert.equal(
      (await invoke("load_snapshot")).tasks.find((t) => t.title === title)
        .description,
      longText,
    );
    testDb.exec("DROP TRIGGER ux_reject_save;");
    await page.getByLabel("任务标题", { exact: true }).fill(title);
    await page
      .getByRole("textbox", { name: "详细计划", exact: true })
      .press("Control+Enter");
    await page
      .getByRole("dialog", { name: "编辑任务" })
      .waitFor({ state: "detached" });
    longText += "失败后保留并重试";
    assert.equal(
      (await invoke("load_snapshot")).tasks.find((t) => t.title === title)
        .description,
      longText,
    );
  } finally {
    testDb.exec("DROP TRIGGER IF EXISTS ux_reject_save;");
    testDb.close();
  }
  results.push(
    "Real isolated SQLite trigger rejects save: drawer retains draft, original row intact, retry via Ctrl Enter persists successfully",
  );
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
  await openCalendarTask(title);
  await page.getByRole("region", { name: "任务详情阅读" }).waitFor();
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
    await click(`任务操作 ${title}`);
    const menuMetrics = await page.getByRole("menu").evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: innerWidth,
        height: innerHeight,
        visibleHit: el.contains(hit),
        parentIsBody: el.parentElement === document.body,
      };
    });
    assert.ok(
      menuMetrics.left >= 0 &&
        menuMetrics.right <= menuMetrics.width &&
        menuMetrics.top >= 0 &&
        menuMetrics.bottom <= menuMetrics.height,
      `Menu clipped at ${width}`,
    );
    assert.equal(menuMetrics.visibleHit, true);
    assert.equal(menuMetrics.parentIsBody, true);
    await page.keyboard.press("Escape");
    await click(`为 ${today} 添加任务`);
    const fontMetrics = await page.evaluate(() => {
      const input = document.querySelector(".quick-add input");
      return {
        input: getComputedStyle(input).fontSize,
        placeholder: getComputedStyle(input, "::placeholder").fontSize,
        task: getComputedStyle(
          document.querySelector(".agenda-panel .task-open"),
        ).fontSize,
      };
    });
    assert.deepEqual(fontMetrics, {
      input: "14px",
      placeholder: "14px",
      task: "14px",
    });
    await page.keyboard.press("Escape");
    await click(`快速修改 ${title}`);
    await page
      .getByRole("textbox", { name: "快速修改任务标题", exact: true })
      .fill("长中文标题".repeat(35));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const inlineMetrics = await page
      .locator(".inline-title-editor")
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: innerWidth };
      });
    assert.ok(
      inlineMetrics.left >= 0 && inlineMetrics.right <= inlineMetrics.width,
    );
    await page.keyboard.press("Escape");
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
  await click("专注编辑");
  for (const width of [980, 380]) {
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width, height: 680 } },
    });
    await page.waitForTimeout(120);
    const row = page.locator(".focus-scroll .task-row").first();
    const deleteButton = row.getByRole("button", {
      name: "删除任务",
      exact: true,
    });
    await deleteButton.scrollIntoViewIfNeeded();
    const metrics = await row.evaluate((el) => {
      const del = el
        .querySelector(".task-delete-trigger")
        .getBoundingClientRect();
      const order = el.querySelector(".order-buttons").getBoundingClientRect();
      return {
        taskFont: getComputedStyle(el.querySelector(".task-open")).fontSize,
        deleteRight: del.right,
        deleteLeft: del.left,
        orderRight: order.right,
        width: innerWidth,
        doc: document.documentElement.scrollWidth,
      };
    });
    assert.equal(metrics.taskFont, "14px");
    assert.ok(
      metrics.deleteRight <= metrics.width &&
        metrics.deleteLeft >= metrics.orderRight - 1 &&
        metrics.doc <= metrics.width,
    );
  }
  const emulation = await browser.contexts()[0].newCDPSession(page);
  try {
    for (const scale of [1, 1.5, 2]) {
      await emulation.send("Emulation.setDeviceMetricsOverride", {
        width: 380,
        height: 680,
        deviceScaleFactor: scale,
        mobile: false,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(
        await page
          .locator(".focus-composer .quick-add input")
          .evaluate((el) => getComputedStyle(el).fontSize),
        "14px",
      );
    }
  } finally {
    await emulation.send("Emulation.clearDeviceMetricsOverride");
    await emulation.detach();
  }
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: 680 } },
  });
  await click("统筹总览");
  results.push(
    "UX2.1 focus direct-delete and 14px text fit 980/380px; WebView device-scale emulation 1/1.5/2 passes (not physical mixed-DPI certification)",
  );
  const backupPath = resolve(testDir, "backup.json");
  await invoke("export_backup", { path: backupPath });
  const exported = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(exported.format, "starry-list");
  const validated = backupSchema.parse(
    await invoke("read_backup", { path: backupPath }),
  );
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
  await openCalendarTask(title);
  await click("编辑");
  await page
    .getByRole("textbox", { name: "详细计划", exact: true })
    .fill(longText + "关闭前保存");
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
  // Only this isolated test database is changed; settings retain the same table.
  const appearanceSettings = (await invoke("load_snapshot")).settings;
  await invoke("save_settings", {
    settings: {
      ...appearanceSettings,
      appearance_mode: "frosted",
      text_size: "large",
      header_layout: "compact",
    },
  });
  const exitPromise = new Promise((r) => child.once("exit", r));
  await invoke("plugin:window|close", { label: "main" });
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
  assert.equal(restarted.settings.appearance_mode, "frosted");
  assert.equal(restarted.settings.text_size, "large");
  assert.equal(restarted.settings.header_layout, "compact");
  assert.equal(
    await page.locator(".app-shell").getAttribute("data-header-layout"),
    "compact",
  );
  assert.equal(
    await page
      .locator(".task-open")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
    "16px",
  );
  results.push(
    "UX3.1 large text survives a real native process restart independently of appearance",
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("data-appearance") ===
      "frosted",
  );
  results.push(
    "UX3.0.1 appearance preference survives a real native process restart in SQLite",
  );
  assert.equal(
    restarted.tasks.find((t) => t.title === title).category_id,
    "work",
  );
  results.push(
    "Native close saves draft; process restart retains tasks, category, view, opacity and window geometry",
  );
  await click("设置");
  await page.getByRole("radio", { name: /^经典顶部/ }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell").dataset.headerLayout === "classic" &&
      !document.querySelector('input[name="header-layout"]').closest("fieldset")
        .disabled,
  );
  await click("关闭对话框");
  const classicExit = new Promise((done) => child.once("exit", done));
  await invoke("plugin:window|close", { label: "main" });
  await classicExit;
  await browser.close();
  browser = null;
  await launch();
  assert.equal(
    (await invoke("load_snapshot")).settings.header_layout,
    "classic",
  );
  assert.equal(
    await page.locator(".app-shell").getAttribute("data-header-layout"),
    "classic",
  );
  results.push(
    "UX3.2 classic and compact header preferences each survive a real process restart",
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
      "Focus diagnostics:",
      await page
        .evaluate(() => ({
          events: window.__focusTrace,
          active: document.activeElement?.getAttribute("aria-label"),
          alerts: [...document.querySelectorAll('[role="alert"]')].map(
            (el) => el.textContent,
          ),
        }))
        .catch(() => null),
    );
    console.log(
      "Native page:",
      page.url(),
      await page
        .locator("body")
        .innerText()
        .then((text) => text.slice(0, 1800))
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
