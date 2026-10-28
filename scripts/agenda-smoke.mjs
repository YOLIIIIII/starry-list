// SL-007 real Windows WebView2/Tauri/SQLite checks. Debug isolated app only.
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { defaults, dayKey, shiftDay, agendaDays } from "../src/domain.ts";
import { makeTask } from "../src/test-fixtures.ts";

const root = resolve(`.cache/sl007-desktop-${Date.now()}`);
await mkdir(root, { recursive: true });
const database = resolve(root, "starry-list.db");
const records = [];
const layouts = [];
let child, browser, page;
const pause = (ms = 100) => new Promise((r) => setTimeout(r, ms));
async function launch() {
  child = spawn(resolve("src-tauri/target/debug/starry-list.exe"), [], {
    windowsHide: true,
    env: {
      ...process.env,
      STARRY_LIST_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: resolve(root, "webview-profile"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=9337 --remote-debugging-address=127.0.0.1",
    },
  });
  browser = undefined;
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9337");
      break;
    } catch {
      await pause(200);
    }
  }
  assert.ok(browser, "isolated debug app must start");
  page = browser.contexts()[0].pages()[0];
  await page.locator("main.overview").waitFor();
  assert.equal(
    await invoke("plugin:app|identifier"),
    "app.starrylist.desktop.sl007-test",
    "never test against the production identifier",
  );
  const header = await readFile(database);
  assert.equal(header.subarray(0, 16).toString(), "SQLite format 3\0");
}
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const click = (name) => page.getByRole("button", { name, exact: true }).click();
const range = () =>
  page.getByRole("combobox", { name: "日程范围", exact: true });
function sql(action) {
  const db = new DatabaseSync(database);
  try {
    return action(db);
  } finally {
    db.close();
  }
}
const taskRows = () =>
  sql((db) => db.prepare("SELECT * FROM tasks ORDER BY id").all());
const contentRows = () =>
  sql((db) => ({
    tasks: db.prepare("SELECT * FROM tasks ORDER BY id").all(),
    categories: db.prepare("SELECT * FROM categories ORDER BY id").all(),
    marks: db.prepare("SELECT * FROM day_marks ORDER BY date").all(),
    schemaVersion: db.prepare("PRAGMA user_version").get().user_version,
  }));
async function choose(value) {
  await range().selectOption(value);
  await page.waitForFunction(
    (value) =>
      document.querySelector('[aria-label="日程范围"]').value === value &&
      !document.querySelector('[aria-label="日程范围"]').disabled,
    value,
  );
  assert.equal((await invoke("load_snapshot")).settings.agenda_range, value);
}
async function rows() {
  return page
    .locator(".agenda-day-add")
    .evaluateAll((buttons) =>
      buttons.map(
        (button) =>
          button.getAttribute("aria-label").match(/\d{4}-\d{2}-\d{2}/)[0],
      ),
    );
}
async function setDate(date) {
  const title = await page.locator(".calendar-panel h1").textContent();
  const [, year, month] = title.match(/(\d{4}) 年 (\d+) 月/);
  const delta =
    Number(date.slice(0, 4)) * 12 +
    Number(date.slice(5, 7)) -
    Number(year) * 12 -
    Number(month);
  for (let i = 0; i < Math.abs(delta); i++)
    await click(delta > 0 ? "下个月" : "上个月");
  await click(`选择 ${date}`);
  await pause();
}
async function focusNative() {
  await invoke("plugin:window|set_focus", { label: "main" });
  await page.waitForFunction(async () =>
    window.__TAURI_INTERNALS__.invoke("plugin:window|is_focused", {
      label: "main",
    }),
  );
}
async function stop() {
  await click("关闭应用");
  for (let i = 0; i < 60 && child.exitCode === null; i++) await pause(100);
  assert.equal(child.exitCode, 0);
  await browser.close();
  browser = undefined;
}
async function record(text) {
  records.push(text);
  console.log(text);
}
try {
  await launch();
  const today = dayKey(new Date());
  const cases = [
    ["2026-10-18", "2026-10-12", "2026-10-18"],
    ["2026-10-19", "2026-10-19", "2026-10-25"],
    ["2027-01-01", "2026-12-28", "2027-01-03"],
    ["2024-02-29", "2024-02-26", "2024-03-03"],
    ["2026-04-01", "2026-03-30", "2026-04-05"],
  ];
  for (const [date] of cases)
    await invoke("save_task", {
      task: makeTask({ id: `sl007-${date}`, date, title: `范围样例 ${date}` }),
    });
  await page.reload();
  await range().waitFor();
  const original = contentRows();
  for (const [date, first, last] of cases) {
    await setDate(date);
    await choose("week");
    const actual = await rows();
    assert.equal(actual[0], first);
    assert.equal(actual[6], last);
    assert.equal(actual.length, 7);
    const label = await page.locator(".agenda-range-description").textContent();
    assert.ok(
      label.includes(String(Number(first.slice(0, 4)))) &&
        label.includes(String(Number(last.slice(0, 4)))),
    );
    await click("下一周");
    assert.equal((await rows())[0], shiftDay(first, 7));
    await click("上一周");
    assert.deepEqual(await rows(), actual);
    await choose("rolling");
    assert.equal((await rows())[0], date);
    assert.equal((await rows())[6], shiftDay(date, 6));
  }
  assert.deepEqual(contentRows(), original);
  assert.equal(original.schemaVersion, 1);
  await record(
    "5 real calendar boundary cases: Sunday/Monday, cross-year/month, leap February; navigation/switching preserves every task column",
  );

  await setDate(today);
  await choose("rolling");
  await click(`为 ${today} 添加任务`);
  await page
    .getByRole("textbox", { name: `${today} 新任务标题`, exact: true })
    .fill("SL007 只打开范围选择");
  await range().click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: `${today} 新任务标题`, exact: true })
    .waitFor({ state: "detached" });
  assert.deepEqual(
    taskRows()
      .filter((t) => t.title === "SL007 只打开范围选择")
      .map((t) => t.date),
    [today],
  );
  assert.equal(await range().inputValue(), "rolling");
  await record(
    "opening the range selector without changing selection still autosaves through existing outside-blur logic",
  );
  const draftDate = shiftDay(today, 6);
  await click(`为 ${draftDate} 添加任务`);
  const draft = () =>
    page.getByRole("textbox", { name: `${draftDate} 新任务标题`, exact: true });
  await draft().fill("SL007 原日期草稿");
  sql((db) =>
    db.exec(
      "CREATE TRIGGER sl007_insert_fail BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'SL007 insert failure'); END;",
    ),
  );
  await range().selectOption("week");
  await page
    .getByText(/SL007 insert failure/)
    .first()
    .waitFor();
  assert.equal(await range().inputValue(), "rolling");
  assert.equal(await draft().inputValue(), "SL007 原日期草稿");
  assert.equal(
    taskRows().filter((t) => t.title === "SL007 原日期草稿").length,
    0,
  );
  sql((db) => db.exec("DROP TRIGGER sl007_insert_fail;"));
  await choose("week");
  assert.deepEqual(
    taskRows()
      .filter((t) => t.title === "SL007 原日期草稿")
      .map((t) => t.date),
    [draftDate],
  );
  await record(
    "actual SQLite INSERT rejection prevents range switch; retry saves exactly once to original date before switching",
  );

  await choose("rolling");
  sql((db) =>
    db.exec(
      "CREATE TRIGGER sl007_settings_fail BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(ABORT,'SL007 settings failure'); END;",
    ),
  );
  const beforeSettings = taskRows();
  await range().selectOption("week");
  await page
    .getByText(/SL007 settings failure/)
    .first()
    .waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="日程范围"]').value === "rolling",
  );
  assert.deepEqual(taskRows(), beforeSettings);
  sql((db) => db.exec("DROP TRIGGER sl007_settings_fail;"));
  await choose("week");
  await record(
    "actual SQLite settings UPDATE rejection rolls back range and preserves tasks; retry persists week",
  );

  const monday = agendaDays(today, "week")[0];
  for (let i = 0; i < 3; i++) {
    await click(`为 ${monday} 添加任务`);
    const input = page.getByRole("textbox", {
      name: `${monday} 新任务标题`,
      exact: true,
    });
    await input.fill(`SL007 连续新增 ${i}`);
    // CDP focus after native activation can disturb the OS foreground state.
    // fill already focused the input; verify both states immediately before Enter.
    await focusNative();
    assert.equal(
      await input.evaluate((el) => document.activeElement === el),
      true,
    );
    assert.equal(
      await invoke("plugin:window|is_focused", { label: "main" }),
      true,
    );
    await page.keyboard.press("Enter");
    await input.waitFor({ state: "detached" });
    await page.waitForFunction(
      (date) =>
        document.activeElement?.getAttribute("aria-label") ===
        `为 ${date} 添加任务`,
      monday,
    );
  }
  assert.equal(
    taskRows().filter((t) => t.title.startsWith("SL007 连续新增")).length,
    3,
  );
  await click("快速修改 SL007 连续新增 2");
  await page
    .getByRole("textbox", { name: "快速修改任务标题" })
    .fill("SL007 修改后");
  await page.keyboard.press("Enter");
  await click("任务操作 SL007 修改后");
  await page.getByRole("menuitem", { name: "删除任务" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "删除任务", exact: true })
    .click();
  await page
    .getByRole("status", { name: "已删除 SL007 修改后", exact: true })
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  assert.equal(taskRows().find((t) => t.title === "SL007 修改后").date, monday);
  await record(
    "week-mode Enter x3, native focus return, inline edit and delete/undo keep original date",
  );

  // Real focus transfer uses only a new browser profile; never the user's browser.
  await click(`为 ${monday} 添加任务`);
  const blurInput = page.getByRole("textbox", {
    name: `${monday} 新任务标题`,
    exact: true,
  });
  await blurInput.fill("SL007 Windows 失焦");
  await focusNative();
  const edgeProfile = resolve(root, "edge-focus-profile");
  const otherBrowser = await chromium.launchPersistentContext(edgeProfile, {
    channel: "msedge",
    headless: false,
    args: ["--no-first-run"],
  });
  try {
    const other = await otherBrowser.newPage();
    await other.setContent(
      "<title>Starry List SL007 isolated focus</title><button>独立测试窗口</button>",
    );
    await other.bringToFront();
    await other.getByRole("button").click();
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        resolve("scripts/focus-test-browser.ps1"),
        "-Profile",
        edgeProfile,
        "-EnsureVisible",
      ],
      { windowsHide: true },
    );
    for (
      let i = 0;
      i < 100 && !taskRows().some((t) => t.title === "SL007 Windows 失焦");
      i++
    )
      await pause(50);
    assert.deepEqual(
      taskRows()
        .filter((t) => t.title === "SL007 Windows 失焦")
        .map((t) => t.date),
      [monday],
    );
    assert.equal(
      await invoke("plugin:window|is_focused", { label: "main" }),
      false,
    );
    await focusNative();
    await blurInput.waitFor({ state: "detached" });
    await page
      .getByRole("status", { name: "已添加 SL007 Windows 失焦", exact: true })
      .getByRole("button", { name: "撤销", exact: true })
      .click();
  } finally {
    await otherBrowser.close();
  }
  await record(
    "week-mode real Windows foreground transfer to isolated Edge saves once without reactivation; add undo persists",
  );

  const matrixTasks = taskRows();
  const matrixContent = contentRows();
  for (const appearance_mode of ["reading", "glass", "frosted"])
    for (const text_size of ["small", "standard", "large"])
      for (const header_layout of ["classic", "compact"])
        for (const agenda_range of ["rolling", "week"]) {
          await invoke("save_settings", {
            settings: {
              ...defaults,
              appearance_mode,
              text_size,
              header_layout,
              agenda_range,
              background_opacity: 0.7,
            },
          });
          await page.reload();
          await range().waitFor();
          assert.equal(await range().inputValue(), agenda_range);
          for (const [width, height] of [
            [980, 680],
            [980, 480],
            [760, 620],
            [500, 480],
            [380, 480],
          ]) {
            await invoke("plugin:window|set_size", {
              label: "main",
              value: { Logical: { width, height } },
            });
            await pause(100);
            await page.locator(".agenda-heading").scrollIntoViewIfNeeded();
            const metrics = await page.evaluate(() => {
              const heading = document.querySelector(".agenda-heading"),
                select = document.querySelector(".agenda-range-select");
              const bounds = heading.getBoundingClientRect(),
                control = select.getBoundingClientRect();
              const buttons = [...heading.querySelectorAll("button")].map(
                (el) => el.getBoundingClientRect(),
              );
              const dates = document
                .querySelector(".agenda-range-description")
                .getBoundingClientRect();
              return {
                viewport: innerWidth,
                doc: document.documentElement.scrollWidth,
                headingHeight: bounds.height,
                selectFits:
                  control.left >= bounds.left && control.right <= bounds.right,
                buttonsFit: buttons.every(
                  (r) => r.left >= bounds.left && r.right <= bounds.right,
                ),
                dateFits:
                  dates.right <= bounds.right && dates.left >= bounds.left,
                overlap: buttons.some(
                  (r) =>
                    control.right > r.left &&
                    control.left < r.right &&
                    control.bottom > r.top &&
                    control.top < r.bottom,
                ),
              };
            });
            assert.ok(
              metrics.doc <= metrics.viewport,
              JSON.stringify({ width, ...metrics }),
            );
            assert.ok(
              metrics.selectFits &&
                metrics.buttonsFit &&
                metrics.dateFits &&
                !metrics.overlap,
              JSON.stringify(metrics),
            );
            assert.deepEqual(await rows(), agendaDays(today, agenda_range));
            layouts.push({
              appearance_mode,
              text_size,
              header_layout,
              agenda_range,
              width,
              height,
              ...metrics,
            });
            if (
              appearance_mode === "reading" &&
              text_size === "large" &&
              header_layout === "compact" &&
              agenda_range === "week" &&
              width === 380
            )
              await page.screenshot({
                path: resolve(root, "week-380-large-compact.png"),
              });
          }
        }
  assert.deepEqual(taskRows(), matrixTasks);
  assert.deepEqual(contentRows(), matrixContent);
  await record(
    `${layouts.length} native layout states: 3 materials x 3 font sizes x 2 headers x 2 ranges x 5 sizes; task rows unchanged`,
  );

  const settings = (await invoke("load_snapshot")).settings;
  delete settings.agenda_range;
  sql((db) =>
    db
      .prepare("UPDATE app_settings SET value=? WHERE id=1")
      .run(JSON.stringify(settings)),
  );
  await page.reload();
  await range().waitFor();
  assert.equal(await range().inputValue(), "rolling");
  assert.ok(
    !sql((db) =>
      db.prepare("SELECT value FROM app_settings").get(),
    ).value.includes("agenda_range"),
  );
  await choose("week");
  await range().focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="日程范围"]').value === "rolling",
  );
  await range().focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => {
    const select = document.querySelector('[aria-label="日程范围"]');
    return select.value === "week" && !select.disabled;
  });
  await stop();
  await launch();
  assert.equal(await range().inputValue(), "week");
  assert.deepEqual(taskRows(), matrixTasks);
  await record(
    "legacy missing-field load does not rewrite JSON; native select CDP keyboard changes mode; real process restart retains week and all task columns",
  );
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify({ records, layouts }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: records.length,
      layoutStates: layouts.length,
      evidence: root,
    }),
  );
} catch (error) {
  if (page) {
    console.log(
      "Focus diagnostics:",
      await page
        .evaluate(() => ({
          active: document.activeElement?.getAttribute("aria-label"),
          documentFocused: document.hasFocus(),
        }))
        .catch(() => null),
    );
    console.log(
      "Native focused:",
      await invoke("plugin:window|is_focused", { label: "main" }).catch(
        () => null,
      ),
    );
    await page
      .screenshot({ path: resolve(root, "failure.png") })
      .catch(() => {});
  }
  throw error;
} finally {
  if (browser) {
    try {
      await invoke("plugin:window|close", { label: "main" });
    } catch {
      /* already closed */
    }
    await browser.close().catch(() => {});
  }
  if (child && child.exitCode === null) child.kill();
}
