import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { makeTask } from "../src/test-fixtures.ts";
import { dayKey } from "../src/domain.ts";
const baseline = process.argv.includes("--baseline"),
  root = resolve(`.cache/water-space-${Date.now()}`),
  shots = resolve(process.env.STARRY_LIST_SCREENSHOT_DIR ?? root);
await mkdir(root, { recursive: true });
await mkdir(shots, { recursive: true });
let child, browser, page;
const records = [];
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
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
  const settings = (await invoke("load_snapshot")).settings,
    date = dayKey(new Date());
  for (let i = 0; i < 8; i++)
    await invoke("save_task", {
      task: makeTask({
        id: `space-${i}`,
        date,
        title: `合成阅读任务 ${i + 1}`,
        description: i === 0 ? "合成长计划。\n".repeat(150) : null,
        sort_order: i,
      }),
    });
  await invoke("save_water", {
    entry: {
      id: "space-water",
      date,
      amount: 750,
      recorded_at: new Date().toISOString(),
    },
  });
  for (const [width, height, text_size] of [
    [760, 680, "large"],
    [760, 900, "large"],
    [760, 1200, "large"],
    [380, 900, "large"],
    [380, 1200, "large"],
    [500, 620, "large"],
    [380, 480, "large"],
    [980, 480, "large"],
    [980, 680, "small"],
    [980, 680, "standard"],
    [980, 680, "large"],
  ]) {
    await invoke("save_settings", {
      settings: {
        ...settings,
        active_view: "focus",
        text_size,
        water_enabled: true,
        water_goal: 2500,
      },
    });
    await page.reload();
    await page.locator(".water-card").waitFor();
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width, height } },
    });
    await wait(350);
    const measure = () =>
      page.evaluate(() => {
        const box = (s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            height: r.height,
            width: r.width,
          };
        };
        return {
          viewport: [innerWidth, innerHeight],
          summary: document.querySelector(".water-card").dataset.waterSummary,
          water: box(".water-card"),
          tasks: box(".focus-scroll"),
          week: box(".focus-week"),
          composer: box(".focus-composer"),
          main: box(".focus"),
        };
      });
    const metrics = await measure();
    if (!baseline && width === 380 && height > 800) {
      await page
        .locator(".water-card")
        .evaluate((el) => (el.dataset.waterSummary = "false"));
      const reference = await measure();
      records.push({
        width,
        height,
        text_size,
        fullLayoutReference: true,
        ...reference,
      });
      await page.screenshot({
        path: resolve(
          shots,
          `full-reference-${width}x${height}-${text_size}.png`,
        ),
      });
      await page
        .locator(".water-card")
        .evaluate(
          (el, value) => (el.dataset.waterSummary = value),
          metrics.summary,
        );
      await wait(100);
    }

    records.push({ width, height, text_size, ...metrics });
    await page.screenshot({
      path: resolve(
        shots,
        `${baseline ? "before" : "after"}-${width}x${height}-${text_size}.png`,
      ),
    });
    if (height > 800) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 0,
        mobile: false,
      });
      await wait(300);
      const emulated = await measure();
      records.push({ width, height, text_size, emulated: true, ...emulated });
      await page.screenshot({
        path: resolve(
          shots,
          `${baseline ? "before" : "after"}-emulated-${width}x${height}-${text_size}.png`,
        ),
      });
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await cdp.detach();
      await wait(200);
    }
    if (!baseline) {
      assert.ok(metrics.tasks.height >= 60);
      assert.ok(metrics.composer.bottom <= metrics.main.bottom + 1);
      if (width === 980 && height === 680 && text_size === "standard")
        assert.equal(metrics.summary, "false");
      if (width <= 500) assert.equal(metrics.summary, "true");
      const states = [];
      for (let i = 0; i < 8; i++) {
        await wait(50);
        states.push((await measure()).summary);
      }
      assert.equal(new Set(states).size, 1);
    }
  }
  if (!baseline) {
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width: 500, height: 620 } },
    });
    await wait(200);
    await page.getByRole("button", { name: "展开补水", exact: true }).click();
    await page
      .getByRole("button", { name: "记录 500 mL", exact: true })
      .click();
    await page
      .getByText("1,250 / 2,500 mL", { exact: false })
      .first()
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".water-card").getAttribute("data-water-summary"),
      "true",
    );
  }
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify({ records }, null, 2),
  );
  console.log(JSON.stringify({ root, records }));
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
