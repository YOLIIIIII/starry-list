// Native Windows compositor checks over a programmatically painted desktop.
// No user desktop screenshots: the capture helper rejects unrelated windows.
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { defaults } from "../src/domain.ts";
import { makeTask } from "../src/test-fixtures.ts";
import "./prepare-visual-baseline.mjs";

const opaque = process.argv.includes("--opaque");
const materials = process.argv.includes("--materials");
const foregroundOnly = process.argv.includes("--foreground-only");
const viewportOnly = process.argv.includes("--viewport-only");
const matrixOnly = process.argv.includes("--matrix-only");
assert.ok(
  !(matrixOnly && foregroundOnly),
  "Choose matrix or foreground checks, not both flags",
);
assert.ok(
  !viewportOnly || foregroundOnly,
  "Viewport capture is only for foreground checks, never compositor matrices",
);
const variants = materials
  ? ["reading", "glass", "frosted"]
  : opaque
    ? ["ux30"]
    : ["ux23", "ux30"];
const publicImages = materials
  ? "docs/screenshots/ux301"
  : "docs/screenshots/ux30";
const root = resolve(
  `.cache/visual-${materials ? "materials-" : ""}${opaque ? "opaque-" : ""}${Date.now()}`,
);
await mkdir(root, { recursive: true });
const control = resolve(root, "control.json");
const baseline = await readFile(
  resolve(".cache/ux30/ux23-baseline.css"),
  "utf8",
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let app, backdrop, browser, page;
const errors = [],
  records = [];
async function json(path) {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
}
async function until(action) {
  let error;
  for (let i = 0; i < 100; i++) {
    try {
      return await action();
    } catch (e) {
      error = e;
      await delay(100);
    }
  }
  throw error;
}
async function command(data) {
  const id = crypto.randomUUID();
  await writeFile(control, JSON.stringify({ ...data, id }));
  const reply = await until(async () => {
    const reply = await json(control + "." + id + ".reply");
    assert.equal(reply.id, id);
    return reply;
  });
  if (!reply.ok) throw Error(reply.error);
  return reply;
}
async function invoke(command, args = {}) {
  return page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
}
async function click(name) {
  await page.getByRole("button", { name, exact: true }).click();
}
async function config(view, alpha, appearance = "reading") {
  await invoke("save_settings", {
    settings: {
      ...defaults,
      active_view: view,
      background_opacity: alpha,
      animations_enabled: false,
      appearance_mode: appearance,
    },
  });
  await page.reload();
  await page.locator(`main.${view}`).waitFor();
  if (view === "overview")
    await page
      .getByRole("button", { name: "选择 2026-10-19", exact: true })
      .click();
  else await click("专注 2026-10-19");
  await page.waitForFunction(
    ({ appearance, alpha, opaque }) => {
      const el = document.querySelector(".app-shell");
      return (
        el?.getAttribute("data-appearance") === appearance &&
        (appearance !== "frosted" ||
          alpha === 1 ||
          opaque ||
          ["applied", "fallback"].includes(el.getAttribute("data-frost")))
      );
    },
    { appearance, alpha, opaque },
  );
}
async function capture(name) {
  const path = resolve(root, name + ".png");
  if (viewportOnly) {
    await page.screenshot({ path });
    return path;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    await command({ action: "front" });
    await invoke("plugin:window|set_focus", { label: "main" });
    await delay(200);
    try {
      await command({
        action: "capture",
        path,
        appProcess: app.pid,
        appWindow: windowHandle,
        blurMargin: materials ? 64 : 0,
      });
      break;
    } catch (error) {
      if (attempt === 2 || !String(error).includes("Capture refused"))
        throw error;
      await delay(300);
    }
  }
  return path;
}
async function samplePixels(path, view) {
  const b64 = (await readFile(path)).toString("base64");
  return page.evaluate(
    async ({ b64, view }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + b64;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixel = (x, y) =>
        Array.from(
          context.getImageData(
            Math.floor((x * image.width) / innerWidth),
            Math.floor((y * image.height) / innerHeight),
            1,
            1,
          ).data,
        ).slice(0, 3);
      const rect = document
        .querySelector(
          view === "overview"
            ? ".day-cell:not(.outside):not(.selected):not(.is-holiday):not(.weekend)"
            : ".focus-scroll",
        )
        .getBoundingClientRect();
      return {
        shell: pixel(innerWidth / 2, innerHeight - 12),
        reading: pixel(rect.x + rect.width / 2, rect.bottom - 20),
        ink: getComputedStyle(document.querySelector(".task-open"))
          .color.match(/\d+/g)
          .map(Number)
          .slice(0, 3),
      };
    },
    { b64, view },
  );
}
function contrast(a, b) {
  const luminance = (rgb) =>
    rgb
      .map((c) => c / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [x, y] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (x + 0.05) / (y + 0.05);
}
let windowHandle;
try {
  backdrop = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolve("scripts/visual-backdrop.ps1"),
      "-Control",
      control,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  backdrop.stderr.on("data", (data) =>
    console.log("Backdrop:", data.toString()),
  );
  const ready = await until(() => json(control + ".ready"));
  app = spawn(resolve("src-tauri/target/debug/starry-list.exe"), [], {
    windowsHide: true,
    env: {
      ...process.env,
      STARRY_LIST_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: resolve(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9224",
    },
  });
  browser = await until(() => chromium.connectOverCDP("http://127.0.0.1:9224"));
  page = browser.contexts()[0].pages()[0];
  await page.addInitScript(() => {
    const OriginalDate = Date;
    window.Date = class extends OriginalDate {
      constructor(...args) {
        super(...(args.length ? args : ["2026-10-19T12:00:00+08:00"]));
      }
      static now() {
        return new OriginalDate("2026-10-19T12:00:00+08:00").getTime();
      }
    };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("main.overview").waitFor();
  assert.equal(
    (await readFile(resolve(root, "starry-list.db")))
      .subarray(0, 16)
      .toString(),
    "SQLite format 3\0",
  );
  assert.equal(await invoke("native_transparency"), !opaque);
  windowHandle = execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `(Get-Process -Id ${app.pid}).MainWindowHandle.ToInt64()`,
  ])
    .toString()
    .trim();
  assert.match(windowHandle, /^[1-9]\d*$/);
  const tasks = [
    makeTask({
      id: "visual-main",
      date: "2026-10-19",
      title: "认真安排今天，也为明天留一点余地",
      priority: 2,
      category_id: "work",
      description:
        "这是自制的非私人测试计划。\n1. 检查中文与换行。\n2. 阅读长文本，保持清晰。\n".repeat(
          60,
        ),
    }),
    makeTask({
      id: "visual-done",
      date: "2026-10-19",
      title: "整理已经完成的会议纪要",
      completed: true,
    }),
    makeTask({
      id: "visual-next",
      date: "2026-10-20",
      title: "准备新的调研方案与设计讨论",
      priority: 1,
    }),
  ];
  for (const task of tasks) await invoke("save_task", { task });
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: materials ? 620 : 680 } },
  });
  const size = await invoke("plugin:window|outer_size", { label: "main" });
  await invoke("plugin:window|set_position", {
    label: "main",
    value: {
      Physical: {
        x: Math.round(ready.bounds.x + (ready.bounds.width - size.width) / 2),
        y: Math.round(ready.bounds.y + (ready.bounds.height - size.height) / 2),
      },
    },
  });
  await config("overview", 0.7);
  for (const scene of foregroundOnly
    ? []
    : ["light", "dark", "colorful", "text"]) {
    console.log("Synthetic background:", scene);
    await command({ action: "scene", scene });
    for (const alpha of [0.4, 0.7, 1])
      for (const view of ["overview", "focus"]) {
        await config(view, alpha);
        for (const variant of variants) {
          if (materials) await config(view, alpha, variant);
          if (variant === "ux23")
            await page.evaluate(
              ({ css, alpha }) => {
                for (const sheet of document.querySelectorAll(
                  'link[rel="stylesheet"]',
                ))
                  sheet.disabled = true;
                const style = document.createElement("style");
                style.id = "visual-baseline";
                style.textContent = css;
                document.head.append(style);
                const shell = document.querySelector(".app-shell");
                shell.style.setProperty(
                  "--panel-alpha",
                  Math.min(1, 0.78 + alpha * 0.2),
                );
                shell.style.setProperty(
                  "--readability-alpha",
                  Math.max(0, (0.85 - alpha) * 1.6),
                );
              },
              { css: baseline, alpha },
            );
          else if (!opaque && !materials) {
            // Reload restores the actual shipped stylesheet and computed variables.
            await config(view, alpha);
          }
          const computed = await page.evaluate(() => {
            const shell = document.querySelector(".app-shell"),
              style = getComputedStyle(shell);
            return {
              shell: Number(style.getPropertyValue("--background-alpha")),
              panel: Number(style.getPropertyValue("--panel-alpha")),
              header: style.opacity,
              overflow: document.documentElement.scrollWidth > innerWidth,
              font: getComputedStyle(document.querySelector(".task-open"))
                .fontSize,
              filters: [
                ...document.querySelectorAll(
                  ".app-shell,.app-header,.agenda-panel,.focus,.modal-backdrop",
                ),
              ].map((el) => getComputedStyle(el).backdropFilter),
              material: shell.getAttribute("data-appearance"),
              frost: shell.getAttribute("data-frost"),
            };
          });
          if (materials) {
            const native = await until(async () => {
              const result = await command({
                action: "backdrop-type",
                appWindow: windowHandle,
              });
              if (
                computed.frost === "applied" &&
                variant === "frosted" &&
                alpha < 1
              )
                assert.equal(
                  result.backdropType,
                  3,
                  "Modern Windows Acrylic must be active at DWM level",
                );
              else
                assert.notEqual(
                  result.backdropType,
                  3,
                  "Other materials/100% must clear Acrylic",
                );
              return result;
            });
            computed.systemBackdrop = native.backdropType;
          }
          assert.equal(computed.shell, opaque ? 1 : alpha);
          assert.equal(computed.header, "1");
          assert.equal(computed.overflow, false);
          assert.equal(computed.font, "14px");
          if (variant !== "ux23")
            assert.ok(computed.filters.every((value) => value === "none"));
          const path = await capture(
            `${variant}-${scene}-${Math.round(alpha * 100)}-${view}`,
          );
          records.push({
            variant,
            scene,
            alpha,
            view,
            file: path.split(/[\\/]/).at(-1),
            computed,
            pixels: await samplePixels(path, view),
          });
          const selected =
            (scene === "colorful" && alpha === 0.7 && view === "overview") ||
            (scene === "text" && alpha === 0.4 && view === "focus") ||
            (materials &&
              scene === "dark" &&
              alpha === 0.4 &&
              view === "overview");
          if (selected && !opaque) {
            await mkdir(publicImages, { recursive: true });
            await copyFile(
              path,
              resolve(
                publicImages,
                `${variant}-${scene}-${Math.round(alpha * 100)}-${view}.png`,
              ),
            );
          }
        }
      }
  }
  const metrics = [];
  if (materials && !foregroundOnly) {
    for (const view of ["overview", "focus"]) {
      const solid = records.filter(
        (r) => r.scene === "light" && r.alpha === 1 && r.view === view,
      );
      assert.equal(
        new Set(solid.map((r) => JSON.stringify(r.pixels.shell))).size,
        3,
        "100% materials must retain distinct palette pixels",
      );
    }
  }
  for (const variant of foregroundOnly ? [] : variants)
    for (const alpha of [0.4, 0.7, 1])
      for (const view of ["overview", "focus"]) {
        const group = records.filter(
          (r) => r.variant === variant && r.alpha === alpha && r.view === view,
        );
        const spread = (key) =>
          Math.max(
            ...[0, 1, 2].map(
              (i) =>
                Math.max(...group.map((r) => r.pixels[key][i])) -
                Math.min(...group.map((r) => r.pixels[key][i])),
            ),
          );
        const metric = {
          variant,
          alpha,
          view,
          readingSpread: spread("reading"),
          shellSpread: spread("shell"),
          minimumPrimaryContrast: Math.min(
            ...group.map((r) => contrast(r.pixels.reading, r.pixels.ink)),
          ),
        };
        if (variant === "ux30") {
          assert.ok(metric.readingSpread <= 4, JSON.stringify(metric));
          assert.ok(metric.minimumPrimaryContrast >= 7, JSON.stringify(metric));
        }
        if (materials) {
          assert.ok(metric.minimumPrimaryContrast >= 7, JSON.stringify(metric));
          if (variant === "reading")
            assert.ok(metric.readingSpread <= 4, JSON.stringify(metric));
        }
        if (opaque || alpha === 1) {
          assert.equal(metric.shellSpread, 0);
          assert.equal(metric.readingSpread, 0);
        } else if (variant !== "frosted")
          assert.ok(
            metric.shellSpread >= 20,
            "Transparent shell must visibly react to different backgrounds",
          );
        metrics.push(metric);
      }
  // Full foreground layers, clipped menus and keyboard focus at every target width.
  console.log(JSON.stringify({ matrixMetrics: metrics }));
  await writeFile(
    resolve(root, "matrix-results.json"),
    JSON.stringify({ records, metrics }, null, 2),
  );
  let foregroundCaptures = 0;
  for (const mode of matrixOnly ? [] : materials ? variants : ["reading"]) {
    for (const width of [980, 760, 500, 380]) {
      await invoke("plugin:window|set_size", {
        label: "main",
        value: { Logical: { width, height: materials ? 620 : 680 } },
      });
      await config("overview", 0.4, mode);
      await click("任务操作 认真安排今天，也为明天留一点余地");
      const menu = page.getByRole("menu");
      await menu.waitFor();
      assert.equal(
        await menu
          .getByRole("menuitem", { name: "编辑任务" })
          .evaluate((el) => {
            const b = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2),
            );
          }),
        true,
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("region", { name: "七天日程" })
        .getByRole("button", { name: new RegExp("^" + tasks[0].title) })
        .click();
      await page.getByRole("region", { name: "详细计划（只读）" }).waitFor();
      await capture(`${mode}-reader-${width}`);
      await click("编辑");
      const footer = await page
        .getByRole("button", { name: "保存并收起", exact: true })
        .boundingBox();
      assert.ok(footer.y + footer.height <= 680);
      assert.equal(
        await page
          .getByRole("textbox", { name: "详细计划", exact: true })
          .evaluate((el) => getComputedStyle(el).opacity),
        "1",
      );
      const drawerImage = await capture(`${mode}-drawer-${width}`);
      if (width === 380 && !opaque)
        await copyFile(
          drawerImage,
          resolve(publicImages, `${materials ? mode + "-" : ""}drawer-380.png`),
        );
      await click("取消");
      await click("设置");
      await page.getByRole("dialog").waitFor();
      assert.equal(
        await page.getByRole("slider", { name: /背景不透明度/ }).isDisabled(),
        opaque,
      );
      if (opaque)
        await page
          .getByText("此版本使用原生不透明窗口，背景不会透视桌面。", {
            exact: true,
          })
          .waitFor();
      await capture(`${mode}-dialog-${width}`);
      await click("关闭对话框");
      await click("统筹总览");
      await click("为 2026-10-19 添加任务");
      await page
        .getByRole("textbox", { name: "2026-10-19 新任务标题", exact: true })
        .fill("视觉验收临时任务");
      await page.keyboard.press("Enter");
      const notification = page.getByRole("status", {
        name: "已添加 视觉验收临时任务",
        exact: true,
      });
      await notification.waitFor();
      const close = notification.getByRole("button", {
        name: "关闭通知",
        exact: true,
      });
      const noticeBox = await notification.boundingBox(),
        closeBox = await close.boundingBox();
      assert.ok(
        noticeBox.x + noticeBox.width - closeBox.x - closeBox.width <= 12,
        "Notification close must align to the right edge",
      );
      const noticeImage = await capture(`${mode}-notification-${width}`);
      if (width === 380 && !opaque)
        await copyFile(
          noticeImage,
          resolve(
            publicImages,
            `${materials ? mode + "-" : ""}notification-380.png`,
          ),
        );
      await notification
        .getByRole("button", { name: "撤销", exact: true })
        .click();
      assert.equal((await invoke("load_snapshot")).tasks.length, 3);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      // Undo success uses the ordinary status toast, which previously put X left.
      const restored = page
        .getByRole("status")
        .filter({ hasText: "已撤销新增" });
      const restoredBox = await restored.boundingBox();
      const restoredClose = await restored
        .getByRole("button", { name: "关闭通知" })
        .boundingBox();
      assert.ok(
        restoredBox.x +
          restoredBox.width -
          restoredClose.x -
          restoredClose.width <=
          12,
      );
      foregroundCaptures += 4;
    }
  }
  assert.deepEqual(errors, []);
  await invoke("plugin:window|set_size", {
    label: "main",
    value: { Logical: { width: 980, height: 680 } },
  });
  await config("overview", 0.7, materials ? "frosted" : "reading");
  await invoke("plugin:window|set_focus", { label: "main" });
  const positionBefore = await invoke("plugin:window|outer_position", {
    label: "main",
  });
  const nativeSize = await invoke("plugin:window|outer_size", {
    label: "main",
  });
  const scale = nativeSize.width / (await page.evaluate(() => innerWidth));
  async function drag(selector, dx, dy) {
    const box = await page.locator(selector).boundingBox();
    const position = await invoke("plugin:window|outer_position", {
      label: "main",
    });
    const fromX = Math.round(position.x + (box.x + box.width / 2) * scale),
      fromY = Math.round(position.y + (box.y + box.height / 2) * scale);
    await command({
      action: "drag",
      appProcess: app.pid,
      appWindow: windowHandle,
      fromX,
      fromY,
      toX: fromX + dx,
      toY: fromY + dy,
    });
  }
  if (!viewportOnly && !matrixOnly) {
    await drag(".drag-space", 40, 30);
    const positionAfter = await invoke("plugin:window|outer_position", {
      label: "main",
    });
    assert.ok(
      positionAfter.x - positionBefore.x >= 30 &&
        positionAfter.y - positionBefore.y >= 20,
      "Real titlebar mouse drag must move the window",
    );
    await drag(".resize-East", 64, 0);
    const resized = await invoke("plugin:window|outer_size", { label: "main" });
    assert.ok(
      resized.width - nativeSize.width >= 50,
      "Real edge mouse drag must resize the window",
    );
  }
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify(
      {
        opaque,
        materials,
        foregroundOnly,
        viewportOnly,
        matrixOnly,
        captures: records.length,
        source: viewportOnly
          ? "WebView2 viewport only; excludes native compositor"
          : "Own programmatically painted WinForms backdrop; guarded native screen capture",
        baselineCommit: "d50af114c655a91d2bc52481008c5ec201d84197",
        baselineCssSha256: createHash("sha256").update(baseline).digest("hex"),
        records,
        metrics,
        nativePointerDragAndResize: !viewportOnly && !matrixOnly,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      opaque,
      matrixCaptures: records.length,
      foregroundCaptures,
      root,
    }),
  );
} finally {
  if (page)
    await invoke("plugin:window|close", { label: "main" }).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (app && !app.killed) app.kill();
  if (backdrop && !backdrop.killed) {
    await writeFile(
      control,
      JSON.stringify({ action: "close", id: crypto.randomUUID() }),
    ).catch(() => {});
    await delay(200);
    backdrop.kill();
  }
}
