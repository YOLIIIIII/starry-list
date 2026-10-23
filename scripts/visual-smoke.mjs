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
import { checkLayout } from "./check-layout.mjs";

const opaque = process.argv.includes("--opaque");
const materials = process.argv.includes("--materials");
const foregroundOnly = process.argv.includes("--foreground-only");
const viewportOnly = process.argv.includes("--viewport-only");
const matrixOnly = process.argv.includes("--matrix-only");
const pointerOnly = process.argv.includes("--pointer-only");
const calendarDetailOnly = process.argv.includes("--calendar-detail-only");
const faultOnly = process.argv.includes("--fault-only");
const layoutOnly = process.argv.includes("--layout-only");
const baselineLayout = process.argv.includes("--baseline-layout");
let testDate = "2026-10-19";
const focusOnly = process.argv.includes("--focus-only");
const baselineFocus = process.argv.includes("--baseline-focus");
const stabilityOnly =
  process.argv.includes("--stability-only") ||
  faultOnly ||
  focusOnly ||
  layoutOnly;
assert.ok(
  !(matrixOnly && foregroundOnly),
  "Choose matrix or foreground checks, not both flags",
);
assert.ok(
  !viewportOnly || foregroundOnly,
  "Viewport capture is only for foreground checks, never compositor matrices",
);
assert.ok(
  !calendarDetailOnly || viewportOnly,
  "Calendar detail uses a WebView viewport, not native capture",
);
const variants = materials
  ? ["reading", "glass", "frosted"]
  : opaque
    ? ["ux30"]
    : ["ux23", "ux30"];
const publicImages = materials
  ? "docs/screenshots/ux304"
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
async function chooseMaterial(name) {
  const radio = page.getByRole("radio", { name: new RegExp("^" + name) });
  await radio.click();
  await until(async () => assert.equal(await radio.isChecked(), true));
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
      .getByRole("button", { name: `选择 ${testDate}`, exact: true })
      .click();
  else await click(`专注 ${testDate}`);
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
async function capture(name, inactive = false) {
  const path = resolve(root, name + ".png");
  if (viewportOnly) {
    await page.screenshot({ path });
    return path;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!inactive) {
      await command({ action: "front" });
      await invoke("plugin:window|set_focus", { label: "main" });
      await command({
        action: "park-pointer",
        appProcess: app.pid,
        appWindow: windowHandle,
      });
      // Keep browser-native title tooltips outside captures of the resting UI.
      // The privacy guard still rejects every unrelated top-level window.
      await page.mouse.move(2, 2);
    }
    await command({
      action: "behind",
      appProcess: app.pid,
      appWindow: windowHandle,
    });
    await delay(200);
    try {
      await command({
        action: "capture",
        path,
        appProcess: app.pid,
        appWindow: windowHandle,
        blurMargin: materials ? 64 : 0,
        inactive,
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
        super(
          ...(args.length
            ? args
            : [
                (sessionStorage.getItem("visual-date") ?? "2026-10-19") +
                  "T12:00:00+08:00",
              ]),
        );
      }
      static now() {
        return new OriginalDate(
          (sessionStorage.getItem("visual-date") ?? "2026-10-19") +
            "T12:00:00+08:00",
        ).getTime();
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
  if (layoutOnly) {
    await checkLayout({
      page,
      invoke,
      config,
      click,
      root,
      images: opaque ? resolve(root, "layout-images") : publicImages,
      baseline: baselineLayout,
      setDate: async (date) => {
        testDate = date;
        await page.evaluate(
          (date) => sessionStorage.setItem("visual-date", date),
          date,
        );
      },
    });
  }
  if (focusOnly) {
    assert.ok(
      materials && !viewportOnly && !opaque,
      "Focus checks require a transparent native window",
    );
    const focusRecords = [];
    await command({ action: "scene", scene: "colorful" });
    for (const alpha of [0.4, 0.7])
      for (const view of ["overview", "focus"]) {
        await config(view, alpha, "frosted");
        for (let cycle = 0; cycle < 3; cycle++) {
          const active = await capture(
            `focus-${alpha}-${view}-${cycle}-active`,
          );
          await command({ action: "focus-away" });
          await page.waitForFunction(
            async () =>
              !(await window.__TAURI_INTERNALS__.invoke(
                "plugin:window|is_focused",
                { label: "main" },
              )),
            undefined,
            { polling: 100 },
          );
          await delay(650);
          const inactive = await capture(
            `focus-${alpha}-${view}-${cycle}-inactive`,
            true,
          );
          const a = await samplePixels(active, view),
            b = await samplePixels(inactive, view);
          const delta = Math.max(
            ...["shell", "reading"].flatMap((key) =>
              a[key].map((v, i) => Math.abs(v - b[key][i])),
            ),
          );
          const record = {
            alpha,
            view,
            cycle,
            active: a,
            inactive: b,
            maximumDelta: delta,
          };
          focusRecords.push(record);
          await writeFile(
            resolve(root, "focus-results.json"),
            JSON.stringify(focusRecords, null, 2),
          );
          console.log(JSON.stringify(record));
          if (!baselineFocus)
            assert.ok(
              delta <= 8,
              "Focus change must not replace material with a visibly different backing color",
            );
          if (cycle === 0) {
            await mkdir(publicImages, { recursive: true });
            const label = baselineFocus ? "ux302" : "ux304";
            await copyFile(
              active,
              resolve(publicImages, `${label}-${alpha}-${view}-active.png`),
            );
            await copyFile(
              inactive,
              resolve(publicImages, `${label}-${alpha}-${view}-inactive.png`),
            );
          }
        }
      }
    // Same CSS, same pixels: only the native brush changes. This distinguishes
    // actual backdrop blur from a merely translucent tint.
    await command({ action: "scene", scene: "text" });
    await config("overview", 0.4, "frosted");
    const blurred = await capture("texture-blurred");
    await invoke("native_frost", { enabled: false });
    const sharp = await capture("texture-sharp-control");
    await invoke("native_frost", { enabled: true });
    const images = await Promise.all(
      [blurred, sharp].map(async (path) =>
        (await readFile(path)).toString("base64"),
      ),
    );
    const energy = await page.evaluate(async (images) => {
      return Promise.all(
        images.map(async (data) => {
          const image = new Image();
          image.src = "data:image/png;base64," + data;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          const x = Math.floor(image.width * 0.35),
            y = Math.floor(image.height - (18 * image.height) / innerHeight),
            width = Math.floor(image.width * 0.3),
            height = Math.floor((12 * image.height) / innerHeight);
          const pixels = ctx.getImageData(x, y, width, height).data;
          let sum = 0,
            count = 0;
          for (let row = 0; row < height; row++)
            for (let col = 1; col < width; col++)
              for (let c = 0; c < 3; c++) {
                const i = (row * width + col) * 4 + c;
                sum += Math.abs(pixels[i] - pixels[i - 4]);
                count++;
              }
          return sum / count;
        }),
      );
    }, images);
    await writeFile(
      resolve(root, "blur-proof.json"),
      JSON.stringify({ energy }),
    );
    assert.ok(
      energy[1] > 0.2 && energy[0] < energy[1] * 0.75,
      "Native brush must reduce texture detail, not just tint it: " + energy,
    );
    console.log(JSON.stringify({ nativeBlurEnergy: energy }));
    console.log(
      JSON.stringify({ focusPassed: !baselineFocus, baselineFocus, root }),
    );
  }
  if (stabilityOnly && !focusOnly && !layoutOnly) {
    assert.ok(
      materials && !viewportOnly,
      "Stability requires native materials",
    );
    const stability = [];
    await command({ action: "scene", scene: "dark" });
    for (const alpha of faultOnly ? [] : [0.4, 0.7, 1]) {
      await config("overview", alpha, "frosted");
      for (let cycle = 0; cycle <= 30; cycle++) {
        for (const view of ["overview", "focus"]) {
          await click(view === "overview" ? "统筹总览" : "专注编辑");
          await page.locator(`main.${view}`).waitFor();
          if (cycle % 5 !== 0) continue;
          const path = await capture(`stability-${alpha}-${cycle}-${view}`);
          const dom = await page.evaluate(() => ({
            shells: document.querySelectorAll(".app-shell").length,
            mains: document.querySelectorAll("main").length,
            overlays: document.querySelectorAll(".modal-backdrop").length,
            frost: document.querySelector(".app-shell").dataset.frost,
            style: document.querySelector(".app-shell").getAttribute("style"),
            background: getComputedStyle(document.querySelector("main"))
              .background,
          }));
          const native = await command({
            action: "backdrop-type",
            appWindow: windowHandle,
          });
          const pixels = await samplePixels(path, view);
          stability.push({
            alpha,
            cycle,
            view,
            dom,
            backdrop: native.backdropType,
            hostBackdrop: await invoke("native_frost_active"),
            pixels,
          });
          assert.equal(dom.shells, 1);
          assert.equal(dom.mains, 1);
          assert.equal(dom.overlays, 0);
          await writeFile(
            resolve(root, "stability.json"),
            JSON.stringify(stability, null, 2),
          );
          const first = stability.find(
            (r) => r.alpha === alpha && r.view === view,
          );
          assert.deepEqual(
            dom,
            first.dom,
            "View switches must not accumulate DOM surfaces",
          );
          assert.equal(native.backdropType, first.backdrop);
          assert.equal(await invoke("native_frost_active"), first.hostBackdrop);
          for (const key of ["shell", "reading"])
            assert.ok(
              pixels[key].every(
                (c, i) => Math.abs(c - first.pixels[key][i]) <= 3,
              ),
              `Native background drift: ${alpha}/${cycle}/${view}/${key}`,
            );
        }
      }
      console.log(`PASS native view stability: ${alpha}, 30 cycles`);
    }
    // Exercise actual settings without page reload, including a native failure
    // after application. UI fallback must not coexist with leftover native material.
    await config("overview", 0.4, "reading");
    await click("设置");
    for (const mode of ["轻玻璃", "梦幻毛玻璃", "阅读优先", "梦幻毛玻璃"]) {
      await chooseMaterial(mode);
      for (const alpha of opaque ? [0.4] : [1, 0.7, 0.4]) {
        if (!opaque)
          await page.locator("#opacity").evaluate((el, value) => {
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set;
            setter.call(el, String(value * 100));
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
          }, alpha);
        await until(async () =>
          assert.equal(
            (await invoke("load_snapshot")).settings.background_opacity,
            alpha,
          ),
        );
        await page.waitForFunction(
          () =>
            !["pending"].includes(
              document.querySelector(".app-shell").dataset.frost,
            ),
        );
        const native = await until(async () => {
          const result = await command({
            action: "backdrop-type",
            appWindow: windowHandle,
          });
          const applied = await page
            .locator(".app-shell")
            .getAttribute("data-frost");
          assert.equal(
            await invoke("native_frost_active"),
            applied === "applied" && !opaque && alpha < 1,
          );
          return result;
        });
        stability.push({ mode, alpha, settingsBackdrop: native.backdropType });
      }
    }
    await click("关闭对话框");
    await click("设置");
    await chooseMaterial("阅读优先");
    await page.waitForFunction(
      () => document.querySelector(".app-shell").dataset.frost === "off",
    );
    await page.evaluate(() => {
      const original = window.fetch;
      let fail = true;
      window.fetch = async (input, init) => {
        const result = await original(input, init);
        if (
          fail &&
          String(input).includes(encodeURIComponent("native_frost")) &&
          JSON.parse(
            typeof init.body === "string"
              ? init.body
              : new TextDecoder().decode(init.body),
          )?.enabled === true
        ) {
          fail = false;
          const headers = new Headers(result.headers);
          headers.set("Tauri-Response", "error");
          headers.set("Content-Type", "text/plain");
          return new Response("Synthetic post-apply failure", { headers });
        }
        return result;
      };
    });
    await chooseMaterial("梦幻毛玻璃");
    if (!opaque && (await invoke("native_frost_supported"))) {
      await page.waitForFunction(
        () => document.querySelector(".app-shell").dataset.frost === "fallback",
      );
      const state = await command({
        action: "backdrop-type",
        appWindow: windowHandle,
      });
      await writeFile(
        resolve(root, "fault.json"),
        JSON.stringify({ afterPartialFailure: state }),
      );
      assert.equal(
        await invoke("native_frost_active"),
        false,
        "Fallback clears partially applied material",
      );
    }
    await click("关闭对话框");
    await capture("stability-after-settings");
    await writeFile(
      resolve(root, "stability.json"),
      JSON.stringify(stability, null, 2),
    );
    console.log(
      JSON.stringify({
        passed: true,
        stabilitySamples: stability.length,
        root,
      }),
    );
  }
  for (const scene of foregroundOnly || stabilityOnly || pointerOnly
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
                  await invoke("native_frost_active"),
                  true,
                  "Composition host backdrop must be enabled",
                );
              else
                assert.notEqual(
                  await invoke("native_frost_active"),
                  true,
                  "Other materials/100% must clear host backdrop",
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
  if (materials && !foregroundOnly && !stabilityOnly && !pointerOnly) {
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
  for (const variant of foregroundOnly || stabilityOnly || pointerOnly
    ? []
    : variants)
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
  for (const mode of matrixOnly ||
  stabilityOnly ||
  calendarDetailOnly ||
  pointerOnly
    ? []
    : materials
      ? variants
      : ["reading"]) {
    for (const width of [980, 760, 500, 380]) {
      await invoke("plugin:window|set_size", {
        label: "main",
        value: { Logical: { width, height: materials ? 620 : 680 } },
      });
      await config("overview", 0.4, mode);
      const alignment = await page.evaluate(() => {
        const labels = [...document.querySelectorAll(".week-labels > span")];
        const cells = [...document.querySelectorAll(".day-cell")].slice(0, 7);
        return {
          backdrop: getComputedStyle(document.querySelector(".week-labels"))
            .backgroundColor,
          offsets: labels.map((el, i) => {
            const a = el.getBoundingClientRect(),
              b = cells[i].getBoundingClientRect();
            return Math.abs(a.x + a.width / 2 - b.x - b.width / 2);
          }),
          dateBackground: getComputedStyle(
            document.querySelector(".day-cell:not(.today) .date-number"),
          ).backgroundColor,
          agendaBackground: getComputedStyle(
            document.querySelector(".agenda-date"),
          ).backgroundColor,
          rowBackground: getComputedStyle(
            document.querySelector(".agenda-day .task-row"),
          ).backgroundColor,
          previewGap: getComputedStyle(
            document.querySelector(".calendar-previews"),
          ).gap,
          previewBackground: document.querySelector(".calendar-task")
            ? getComputedStyle(document.querySelector(".calendar-task"))
                .backgroundColor
            : null,
        };
      });
      assert.equal(alignment.backdrop, "rgba(0, 0, 0, 0)");
      assert.ok(
        alignment.offsets.every((x) => x <= 0.51),
        "Weekdays align with the date columns",
      );
      if (mode !== "reading") {
        for (const background of [
          alignment.dateBackground,
          alignment.agendaBackground,
          alignment.rowBackground,
        ])
          assert.equal(background, "rgba(0, 0, 0, 0)");
        assert.equal(alignment.previewGap, "3px");
        if (alignment.previewBackground !== null)
          assert.equal(alignment.previewBackground, "rgba(0, 0, 0, 0)");
      }
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
      await page.mouse.move(2, 2);
      if (mode !== "reading") {
        const spacing = await page.evaluate(() => {
          const items = [
            ...document.querySelectorAll('.focus-scroll > [id^="task-"]'),
          ];
          const first = items[0].getBoundingClientRect(),
            second = items[1].getBoundingClientRect();
          const quick = document
            .querySelector(".focus-scroll .quick-add")
            .getBoundingClientRect();
          return {
            gap: second.top - first.bottom,
            addGap: quick.top - second.bottom,
            rowBackground: getComputedStyle(
              document.querySelector(".focus-scroll .task-row"),
            ).backgroundColor,
            addPadding: getComputedStyle(
              document.querySelector(".focus-scroll .quick-add"),
            ).paddingLeft,
            inputPadding: getComputedStyle(
              document.querySelector(".focus-scroll .quick-add input"),
            ).paddingLeft,
          };
        });
        assert.equal(spacing.rowBackground, "rgba(0, 0, 0, 0)");
        assert.equal(spacing.addPadding, "12px");
        assert.equal(spacing.inputPadding, "6px");
        assert.ok(
          spacing.gap >= 10,
          "Expanded reader keeps the shared bottom margin",
        );
        assert.ok(
          spacing.addGap >= 9,
          "Quick add stays separate from the last task",
        );
      }
      await capture(`${mode}-reader-${width}`);
      await click("编辑");
      const editorFont = await page
        .getByRole("textbox", { name: "详细计划", exact: true })
        .evaluate((el) => getComputedStyle(el).fontSize);
      assert.equal(editorFont, "14px");
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
  if (materials && !matrixOnly && !stabilityOnly && !pointerOnly) {
    // A taller viewport exercises the existing two-preview density threshold.
    // These are WebView-only images, not evidence of native desktop blur.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 980,
      height: 860,
      deviceScaleFactor: 1,
      mobile: false,
    });
    try {
      for (const mode of variants) {
        await config("overview", 0.4, mode);
        const previews = page.locator(".day-cell.selected .calendar-task");
        await until(async () => assert.equal(await previews.count(), 2));
        const first = await previews.nth(0).boundingBox(),
          second = await previews.nth(1).boundingBox();
        assert.ok(second.y - first.y - first.height >= 3);
        if (!opaque)
          await page.screenshot({
            path: resolve(publicImages, `${mode}-calendar-detail-viewport.png`),
          });
      }
    } finally {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await cdp.detach();
    }
  }
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
  if (!viewportOnly && !matrixOnly && !stabilityOnly) {
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
    const resized = await invoke("plugin:window|outer_size", {
      label: "main",
    });
    assert.ok(
      resized.width - nativeSize.width >= 50,
      "Real edge mouse drag must resize the window",
    );
    await drag(".resize-South", 0, -180);
    await page.waitForTimeout(180);
    const shortened = await invoke("plugin:window|outer_size", {
      label: "main",
    });
    assert.ok(
      resized.height - shortened.height >= 140,
      "Real lower-edge drag must shorten the native window",
    );
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll(".day-cell")].some((cell) => {
        const bounds = cell.getBoundingClientRect();
        return [
          ...cell.querySelectorAll(
            ".date-number,.day-badge,.compact-tasks > span",
          ),
        ].some((el) => {
          const b = el.getBoundingClientRect();
          return (
            b.height > 0 &&
            (b.top < bounds.top - 0.51 || b.bottom > bounds.bottom + 0.51)
          );
        });
      }),
    );
    assert.equal(
      clipped,
      false,
      "Native pointer resizing must not clip date/marker contents",
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
        nativePointerDragAndResize:
          !viewportOnly && !matrixOnly && !stabilityOnly,
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
