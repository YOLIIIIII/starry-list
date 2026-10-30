import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dayKey, shiftDay } from "../src/domain.ts";
import { makeTask } from "../src/test-fixtures.ts";
const root = resolve(`.cache/sl024d-${Date.now()}`);
await mkdir(root, { recursive: true });
let child, browser, page;
let dataDir = resolve(root, "a");
const records = [];
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
      STARRY_LIST_TEST_DATA_DIR: dataDir,
      WEBVIEW2_USER_DATA_FOLDER: resolve(dataDir, "profile"),
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
  const shots = resolve(
    process.env.STARRY_LIST_SCREENSHOT_DIR ?? "docs/screenshots/sl024d",
  );
  await mkdir(shots, { recursive: true });
  const size = async (width, height) => {
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width, height } },
    });
    await wait(150);
  };
  async function settings() {
    if (!(await page.getByRole("dialog", { name: "星轨 · 设置中心" }).count()))
      await click("设置");
    await page.getByRole("tab", { name: "数据与关于" }).click();
  }
  function picker(path, cancel = false) {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        resolve("scripts/backup-dialog-input.ps1"),
        "-OwnerPid",
        String(child.pid),
        "-TestRoot",
        root,
        ...(cancel ? ["-Cancel"] : ["-FilePath", path]),
      ],
      { windowsHide: true, encoding: "utf8", timeout: 20000 },
    );
  }
  async function readViaPicker(path, cancel = false) {
    await settings();
    await invoke("plugin:window|set_focus", { label: "main" });
    await click("导入 JSON");
    picker(path, cancel);
    if (!cancel)
      await page.getByRole("dialog", { name: "确认导入备份" }).waitFor();
    else
      await page.waitForFunction(
        () => !document.querySelector(".backup-buttons button").disabled,
      );
  }
  async function confirm(replace = false) {
    const dialog = page.getByRole("dialog", { name: "确认导入备份" });
    if (replace) {
      await dialog.getByRole("checkbox").check();
      assert.equal(
        await dialog.getByRole("button", { name: "确认覆盖" }).isDisabled(),
        true,
      );
      await dialog.getByLabel("输入“覆盖”确认").fill("覆盖");
      await dialog.getByRole("button", { name: "确认覆盖" }).click();
    } else await dialog.getByRole("button", { name: "合并导入" }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  async function closeProcess() {
    await invoke("plugin:window|close", { label: "main" });
    for (let i = 0; i < 60 && child.exitCode === null; i++) await wait();
    assert.notEqual(child.exitCode, null);
    await browser.close();
    browser = null;
  }
  const current = dayKey(new Date()),
    previous = shiftDay(current, -1);
  await invoke("save_task", {
    task: makeTask({
      id: "d-task",
      date: current,
      title: "合成任务：完整备份验证",
    }),
  });
  await invoke("save_mark", {
    date: current,
    mark: { date: current, kind: "rest", note: "合成日期标记" },
  });
  const originalSettings = (await invoke("load_snapshot")).settings;
  await invoke("save_settings", {
    settings: {
      ...originalSettings,
      water_enabled: true,
      water_goal: 1750,
      active_view: "focus",
    },
  });
  for (const entry of [
    {
      id: "water-today",
      date: current,
      amount: 500,
      recorded_at: "2026-10-30T09:49:00+08:00",
    },
    {
      id: "water-past",
      date: previous,
      amount: 250,
      recorded_at: "2026-10-30T10:00:00.123+08:00",
    },
    {
      id: "water-future",
      date: "2030-01-01",
      amount: 150,
      recorded_at: "2026-10-30T03:01:02-05:00",
    },
  ])
    await invoke("save_water", { entry });
  await page.reload();
  await page.locator(".water-card").waitFor();
  const original = await invoke("load_snapshot");
  await settings();
  await invoke("plugin:window|set_focus", { label: "main" });
  await click("导出 JSON");
  const file = resolve(root, "complete-v2.json");
  picker(file);
  await page
    .getByText("备份已导出", { exact: true })
    .waitFor({ state: "attached" });
  const exported = JSON.parse(await readFile(file, "utf8"));
  assert.equal(exported.version, 2);
  assert.deepEqual(exported.water_entries, original.water_entries);
  await page.screenshot({ path: resolve(shots, "backup-settings.png") });
  const beforeCancel = await invoke("load_snapshot");
  await click("导出 JSON");
  picker(null, true);
  await page.waitForFunction(
    () => !document.querySelector(".backup-buttons button").disabled,
  );
  await readViaPicker(null, true);
  assert.deepEqual(await invoke("load_snapshot"), beforeCancel);
  records.push(
    "owned Windows Save/Open cancellation and actual V2 file export; raw IDs/date/offset preserved",
  );
  await closeProcess();
  dataDir = resolve(root, "b");
  await launch();
  await size(980, 680);
  await readViaPicker(file);
  assert.ok(
    (
      await page.getByRole("dialog", { name: "确认导入备份" }).textContent()
    ).includes("3 条饮水记录"),
  );
  await confirm(true);
  assert.deepEqual(await invoke("load_snapshot"), original);
  await click("关闭对话框");
  assert.equal(
    await page
      .getByRole("img", { name: "饮水 500 / 1750 mL，每杯 500 mL" })
      .count(),
    1,
  );
  await click("统筹总览");
  assert.equal(
    await page
      .getByRole("img", { name: "饮水 500 / 1750 mL，每杯 500 mL" })
      .count(),
    1,
  );
  await click("专注编辑");
  await closeProcess();
  await launch();
  assert.deepEqual(await invoke("load_snapshot"), original);
  for (let i = 0; i < 2; i++) {
    await readViaPicker(file);
    await confirm(false);
  }
  assert.deepEqual(
    (await invoke("load_snapshot")).water_entries,
    original.water_entries,
  );
  records.push(
    "actual picker cross-database full replace equality and immediate two-view refresh; repeated merge water idempotency",
  );
  const conflict = structuredClone(exported);
  conflict.water_entries[0].amount = 333;
  const conflictFile = resolve(root, "conflict.json");
  await writeFile(conflictFile, JSON.stringify(conflict));
  const beforeConflict = await invoke("load_snapshot");
  await readViaPicker(conflictFile);
  await click("合并导入");
  await page.getByRole("alert").filter({ hasText: "冲突" }).waitFor();
  assert.deepEqual(await invoke("load_snapshot"), beforeConflict);
  await click("取消");
  const db = new DatabaseSync(resolve(dataDir, "starry-list.db"));
  db.exec(
    "CREATE TRIGGER d_fail BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(ABORT,'synthetic final-step failure'); END;",
  );
  await readViaPicker(file);
  const confirmDialog = page.getByRole("dialog", { name: "确认导入备份" });
  await confirmDialog.getByRole("checkbox").check();
  await confirmDialog.getByLabel("输入“覆盖”确认").fill("覆盖");
  await click("确认覆盖");
  await page.getByText(/synthetic final-step failure/).waitFor();
  assert.deepEqual(await invoke("load_snapshot"), beforeConflict);
  db.exec("DROP TRIGGER d_fail");
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
  db.close();
  await click("取消");
  const legacy = structuredClone(exported);
  legacy.version = 1;
  delete legacy.water_entries;
  for (const k of [
    "appearance_mode",
    "text_size",
    "header_layout",
    "agenda_range",
    "water_enabled",
    "water_goal",
  ])
    delete legacy.settings[k];
  const legacyFile = resolve(root, "legacy-v1.json");
  await writeFile(legacyFile, JSON.stringify(legacy));
  for (const replace of [false, true]) {
    await readViaPicker(legacyFile);
    assert.ok(
      (await page.getByRole("note").textContent()).includes(
        "不会删除本机饮水记录",
      ),
    );
    await confirm(replace);
    assert.deepEqual(
      (await invoke("load_snapshot")).water_entries,
      original.water_entries,
    );
  }
  records.push(
    "conflicting IDs and final-step SQLite failure preserve all domains; V1 native merge/replace preserves water",
  );
  const empty = { ...exported, water_entries: [] };
  const emptyFile = resolve(root, "empty-v2.json");
  await writeFile(emptyFile, JSON.stringify(empty));
  await readViaPicker(emptyFile);
  await page
    .getByRole("dialog", { name: "确认导入备份" })
    .getByRole("checkbox")
    .check();
  assert.ok(
    (await page.getByRole("note").textContent()).includes("清空本机饮水明细"),
  );
  await page.screenshot({ path: resolve(shots, "empty-replace-warning.png") });
  await page.getByLabel("输入“覆盖”确认").fill("覆盖");
  await click("确认覆盖");
  await page
    .getByRole("dialog", { name: "确认导入备份" })
    .waitFor({ state: "hidden" });
  assert.deepEqual((await invoke("load_snapshot")).water_entries, []);
  const broken = resolve(root, "broken.json");
  await writeFile(broken, "{broken");
  await settings();
  await click("导入 JSON");
  picker(broken);
  await page.getByRole("alert").waitFor();
  assert.deepEqual((await invoke("load_snapshot")).water_entries, []);
  await click("关闭对话框");
  for (const [width, height] of [
    [380, 480],
    [500, 620],
    [980, 680],
  ])
    for (const text_size of ["small", "standard", "large"])
      for (const appearance_mode of ["reading", "glass"]) {
        await invoke("save_settings", {
          settings: { ...original.settings, text_size, appearance_mode },
        });
        await page.reload();
        await page.locator(".water-card").waitFor();
        await size(width, height);
        const expand = page.getByRole("button", {
          name: "展开补水",
          exact: true,
        });
        if (await expand.isVisible()) await expand.click();
        else await page.locator(".water-details-button").click();
        for (const restore of [false, true]) {
          if (restore) {
            await click("记录 150 mL");
            await page.getByRole("button", { name: /删除 .* 的 150/ }).click();
            await page.locator(".water-history-empty").waitFor();
            assert.equal(
              await page
                .getByRole("button", { name: "恢复刚删除的 150 mL" })
                .count(),
              1,
            );
          }
          const metrics = await page
            .locator(".water-history-empty")
            .evaluate((el) => {
              const range = document.createRange();
              range.selectNodeContents(el);
              return {
                lines: range.getClientRects().length,
                overflow: el.scrollWidth > el.clientWidth,
              };
            });
          assert.equal(metrics.lines, 1);
          assert.equal(metrics.overflow, false);
          if (text_size === "large" && appearance_mode === "reading")
            await page.screenshot({
              path: resolve(shots, `empty-${width}-restore-${restore}.png`),
            });
        }
        await page.keyboard.press("Escape");
      }
  records.push(
    "36 empty-state layouts: three sizes/fonts, two materials, with/without restore; single line, no overflow",
  );
  const beforeRestart = await invoke("load_snapshot");
  await closeProcess();
  await launch();
  assert.deepEqual(await invoke("load_snapshot"), beforeRestart);
  records.push("real process restart persists complete restored state");
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify({ records }, null, 2),
  );
  console.log(JSON.stringify({ root, records }));
} catch (e) {
  console.log(
    await page
      ?.evaluate(() => ({
        alerts: [...document.querySelectorAll("[role=alert]")].map(
          (e) => e.textContent,
        ),
      }))
      .catch(() => null),
  );
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
