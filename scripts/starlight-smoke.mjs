import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { makeTask } from "../src/test-fixtures.ts";
import { dayKey, shiftDay } from "../src/domain.ts";
const root = resolve(`.cache/starlight-${Date.now()}`),
  shots = resolve(process.env.STARRY_LIST_SCREENSHOT_DIR ?? root);
await mkdir(root, { recursive: true });
await mkdir(shots, { recursive: true });
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
const baseline = process.argv.includes("--baseline");
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
  const today = dayKey(new Date()),
    settings = (await invoke("load_snapshot")).settings;
  for (const [offset, completed] of [
    [-1, false],
    [0, false],
    [1, true],
  ])
    await invoke("save_task", {
      task: makeTask({
        id: `star${offset}`,
        date: shiftDay(today, offset),
        completed,
        title: `合成星光 ${offset}`,
        priority: 1,
      }),
    });
  for (const [date, completed] of [
    ["2026-12-31", false],
    ["2027-01-01", true],
  ])
    await invoke("save_task", {
      task: makeTask({ id: date, date, completed, title: "合成跨年计划" }),
    });
  await invoke("save_water", {
    entry: {
      id: "water",
      date: today,
      amount: 750,
      recorded_at: new Date().toISOString(),
    },
  });
  async function config(view, patch = {}) {
    await invoke("save_settings", {
      settings: {
        ...settings,
        water_enabled: true,
        active_view: view,
        ...patch,
      },
    });
    await page.reload();
    await page.locator("main").waitFor();
  }
  await config("overview");
  await page.screenshot({
    path: resolve(
      shots,
      baseline ? "before-calendar.png" : "after-calendar.png",
    ),
  });
  await config("focus");
  await page.screenshot({
    path: resolve(shots, baseline ? "before-focus.png" : "after-focus.png"),
  });
  if (!baseline) {
    for (const text_size of ["small", "standard", "large"])
      for (const appearance_mode of ["reading", "glass", "frosted"])
        for (const header_layout of ["classic", "compact"])
          for (const water_enabled of [false, true]) {
            await config("focus", {
              text_size,
              appearance_mode,
              header_layout,
              water_enabled,
            });
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
              await wait(90);
              const result = await page.evaluate(() => {
                const buttons = [
                    ...document.querySelectorAll(".focus-week button"),
                  ],
                  issues = [];
                const boxes = buttons.map((b) => b.getBoundingClientRect());
                const contains = (a, b) =>
                  b.left >= a.left - 0.6 &&
                  b.right <= a.right + 0.6 &&
                  b.top >= a.top - 0.6 &&
                  b.bottom <= a.bottom + 0.6;
                for (const b of buttons) {
                  const box = b.getBoundingClientRect(),
                    number = b.querySelector("strong").getBoundingClientRect(),
                    star = b.querySelector(".daily-star");
                  if (star) {
                    const sb = star.getBoundingClientRect(),
                      css = getComputedStyle(star);
                    if (
                      !contains(box, sb) ||
                      sb.top < number.bottom - 0.5 ||
                      Math.abs(
                        (sb.left + sb.right - number.left - number.right) / 2,
                      ) > 0.6
                    )
                      issues.push("star clipped/not centered/overlap");
                    if (
                      css.backgroundColor !== "rgba(0, 0, 0, 0)" ||
                      parseFloat(css.borderTopWidth) !== 0
                    )
                      issues.push("star badge");
                  }
                  if (b.querySelector("i")) issues.push("old dot");
                }
                if (
                  Math.max(...boxes.map((b) => b.width)) -
                    Math.min(...boxes.map((b) => b.width)) >
                  1
                )
                  issues.push("unequal columns");
                const scroll = document
                    .querySelector(".focus-scroll")
                    .getBoundingClientRect(),
                  composer = document
                    .querySelector(".focus-composer")
                    .getBoundingClientRect();
                if (
                  scroll.height < 60 ||
                  composer.bottom >
                    document.querySelector(".focus").getBoundingClientRect()
                      .bottom +
                      0.6
                )
                  issues.push("task space/composer");
                return {
                  issues,
                  viewport: [innerWidth, innerHeight],
                  scrollHeight: scroll.height,
                  weekHeight: document
                    .querySelector(".focus-week")
                    .getBoundingClientRect().height,
                  cups: [...document.querySelectorAll(".water-cup")]
                    .filter((c) => c.getBoundingClientRect().width > 0)
                    .map((c) => c.getBoundingClientRect().width),
                  overflow: document.documentElement.scrollWidth > innerWidth,
                };
              });
              assert.deepEqual(
                result.issues,
                [],
                JSON.stringify({ text_size, width, height, ...result }),
              );
              assert.equal(result.overflow, false);
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
                header_layout === "classic" &&
                water_enabled &&
                ((width === 980 && height === 680) || width === 380)
              )
                await page.screenshot({
                  path: resolve(
                    shots,
                    `focus-${text_size}-${appearance_mode}-${width}x${height}.png`,
                  ),
                });
            }
          }
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width: 980, height: 680 } },
    });
    await config("focus");
    const date = page.getByRole("button", {
      name: `专注 ${today}`,
      exact: true,
    });
    await date.locator(".planned").waitFor();
    await click("完成 合成星光 0");
    await date.locator(".completed").waitFor();
    await page.screenshot({ path: resolve(shots, "selected-gold.png") });
    await click("取消完成 合成星光 0");
    await date.locator(".planned").waitFor();
    checks.push(
      "native completion/uncompletion updates focus star without reload",
    );
    await date.focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.tagName),
      "BUTTON",
    );
    await config("focus", {
      appearance_mode: "frosted",
      opaque_fallback: true,
    });
    assert.equal(await invoke("native_frost_active"), false);
    checks.push(
      "native transparent binary opaque-fallback preference clears frost; Tab stays on dates",
    );
    for (const target of ["2026-11-01", "2026-12-31", "2027-01-01"]) {
      for (let i = 0; i < 40; i++) {
        const current = await page
          .locator(".focus-week [aria-current=date]")
          .getAttribute("aria-label");
        const key = current.slice(3);
        const diff = Math.round(
          (new Date(target + "T12:00:00") - new Date(key + "T12:00:00")) /
            86400000,
        );
        if (!diff) break;
        await click(`专注 ${shiftDay(key, Math.max(-3, Math.min(3, diff)))}`);
      }
      await page.screenshot({ path: resolve(shots, `focus-${target}.png`) });
      assert.equal(
        await page
          .locator(".focus-week [aria-current=date]")
          .getAttribute("aria-label"),
        `专注 ${target}`,
      );
    }
    checks.push("cross-month and cross-year navigation");
  }
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify({ layouts, checks }, null, 2),
  );
  console.log(JSON.stringify({ root, shots, states: layouts.length, checks }));
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
