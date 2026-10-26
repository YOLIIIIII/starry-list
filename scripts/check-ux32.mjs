// UX3.2 real Windows WebView2 checks. Only the caller's isolated synthetic DB.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";

export async function checkUx32({
  page,
  invoke,
  config,
  click,
  root,
  images,
  opaque,
  measureOnly = false,
  draftOnly = false,
}) {
  await mkdir(images, { recursive: true });
  const records = [],
    drafts = [],
    heights = [];
  const size = async (width, height) => {
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width, height } },
    });
    await page.waitForTimeout(120);
  };
  const geometry = () =>
    page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const { x, y, width, height, bottom, right } =
          el.getBoundingClientRect();
        return { x, y, width, height, bottom, right };
      };
      const buttons = [
        ...document.querySelectorAll(
          ".window-buttons button,.view-switch button",
        ),
      ].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label"),
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          clipped:
            el.scrollWidth > el.clientWidth + 1 ||
            el.scrollHeight > el.clientHeight + 1,
        };
      });
      return {
        header: rect(".app-header"),
        brand: rect(".brand"),
        switch: rect(".view-switch"),
        controls: rect(".window-buttons"),
        drag: rect(".drag-space"),
        main: rect("main"),
        composer: rect(".focus-composer"),
        input: rect(".focus-composer input"),
        list: rect(".focus-scroll"),
        footer: rect(".app-footer"),
        buttons,
        viewport: [innerWidth, innerHeight],
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  if (!draftOnly) {
    // Compile pinned UX3.1 CSS for actual before/after top measurements.
    const baselineDir = resolve(root, "ux31-baseline");
    await mkdir(baselineDir, { recursive: true });
    const input = resolve(baselineDir, "ux31.css");
    await writeFile(
      input,
      execFileSync("git", ["show", "63451ff:src/styles.css"]),
    );
    const outDir = resolve(baselineDir, "compiled");
    await build({
      configFile: false,
      plugins: [tailwindcss()],
      logLevel: "error",
      build: {
        outDir,
        rollupOptions: { input, output: { assetFileNames: "[name][extname]" } },
      },
    });
    const css = await readFile(
      resolve(
        outDir,
        (await readdir(outDir)).find((f) => f.endsWith(".css")),
      ),
      "utf8",
    );
    for (const font of ["standard", "large"])
      for (const [width, height] of [
        [980, 680],
        [980, 480],
        [760, 620],
        [500, 620],
        [380, 480],
      ]) {
        await size(width, height);
        await config("overview", 0.7, "glass", font, "classic");
        await page.evaluate(() =>
          document
            .querySelectorAll('link[rel="stylesheet"]')
            .forEach((el) => (el.disabled = true)),
        );
        const old = await page.addStyleTag({ content: css });
        const before = await geometry();
        await old.evaluate((el) => el.remove());
        await page.evaluate(() =>
          document
            .querySelectorAll('link[rel="stylesheet"]')
            .forEach((el) => (el.disabled = false)),
        );
        await page.waitForTimeout(180);
        const classic = await geometry();
        await config("overview", 0.7, "glass", font, "compact");
        const compact = await geometry();
        heights.push({
          font,
          width,
          height,
          before: before.header.height,
          classic: classic.header.height,
          compact: compact.header.height,
          mainBefore: before.main.height,
          mainClassic: classic.main.height,
          mainCompact: compact.main.height,
        });
      }
    if (measureOnly) {
      await writeFile(
        resolve(root, "ux32-heights.json"),
        JSON.stringify(heights, null, 2),
      );
      console.log(JSON.stringify({ heights }));
      return;
    }
    // All 18 independent preferences, five desktop sizes and both views.
    for (const header of ["classic", "compact"])
      for (const font of ["small", "standard", "large"])
        for (const material of ["reading", "glass", "frosted"]) {
          await config("overview", 0.7, material, font, header);
          if (opaque) assert.equal(await invoke("native_frost_active"), false);
          for (const [width, height] of [
            [980, 680],
            [980, 480],
            [760, 620],
            [500, 480],
            [380, 480],
          ]) {
            await size(width, height);
            for (const view of ["overview", "focus"]) {
              await click(view === "overview" ? "统筹总览" : "专注编辑");
              await page.locator(`main.${view}`).waitFor();
              if (view === "focus")
                await page.locator("#task-visual-main .task-open").click();
              const before = await geometry();
              assert.equal(
                before.overflow,
                false,
                JSON.stringify({
                  header,
                  font,
                  material,
                  width,
                  height,
                  before,
                }),
              );
              assert.ok(
                before.drag.width >= 8,
                "Explicit drag region survives narrow layout",
              );
              for (const b of before.buttons) {
                assert.ok(
                  b.width >= 30 && b.height >= 30,
                  "Comfortable button hit area",
                );
                assert.equal(b.clipped, false, JSON.stringify(b));
                assert.ok(
                  b.x >= 0 && b.x + b.width <= before.viewport[0] + 1,
                  "Button inside window",
                );
              }
              if (header === "compact") {
                assert.ok(
                  before.brand.right <= before.switch.x &&
                    before.switch.right <= before.controls.x,
                  "One row without overlap",
                );
                assert.ok(
                  Math.abs(
                    before.brand.y +
                      before.brand.height / 2 -
                      before.controls.y -
                      before.controls.height / 2,
                  ) < 1,
                  "Controls centered",
                );
                assert.equal(
                  await page.locator(".view-label").first().isVisible(),
                  false,
                );
                assert.equal(
                  await page.locator(".brand small").isVisible(),
                  true,
                );
              } else
                assert.equal(
                  await page.locator(".view-label").first().isVisible(),
                  true,
                );
              let scroll = null;
              if (view === "focus") {
                assert.ok(
                  before.list.height >= 45,
                  "Short window retains a usable task viewport: " +
                    JSON.stringify({
                      header,
                      font,
                      material,
                      width,
                      height,
                      before,
                    }),
                );
                assert.ok(
                  before.composer.bottom <= before.footer.y + 1,
                  "Composer above footer",
                );
                assert.ok(
                  before.list.bottom <= before.composer.y + 1,
                  "List does not cover composer",
                );
                assert.equal(await page.locator(".quick-add input").count(), 1);
                scroll = await page.locator(".focus-scroll").evaluate((el) => {
                  el.scrollTop = el.scrollHeight;
                  const detail = el.querySelector(".reader-description");
                  return {
                    top: el.scrollTop,
                    height: el.clientHeight,
                    detailOverflow: getComputedStyle(detail).overflowY,
                    detailVisible:
                      detail.scrollHeight <= detail.clientHeight + 1,
                  };
                });
                assert.ok(scroll.top > 0, "Long plan actually scrolls");
                assert.equal(
                  scroll.detailOverflow,
                  "visible",
                  "No nested detail scrollbar",
                );
                const after = await geometry();
                assert.deepEqual(
                  after.composer,
                  before.composer,
                  "Input does not move with list",
                );
                assert.deepEqual(after.input, before.input);
                assert.equal(
                  scroll.detailVisible,
                  true,
                  "Complete detail is in scrollable list",
                );
              }
              // Exercise actual add/undo notification collision with the current header.
              if (view === "focus") {
                const input = page.locator(".focus-composer input");
                await input.fill("合成固定新增验证");
                await invoke("plugin:window|set_focus", { label: "main" });
                await page.waitForFunction(
                  async () =>
                    await window.__TAURI_INTERNALS__.invoke(
                      "plugin:window|is_focused",
                      { label: "main" },
                    ),
                );
                await page.keyboard.press("Enter");
                await page.waitForFunction(
                  () =>
                    document.querySelector(".focus-composer input").value ===
                    "",
                );
                const notice = page.locator(".undo-toast").last();
                await notice.hover();
                const collisions = await page.evaluate(() => {
                  const n = document
                    .querySelector(".notification-region")
                    .getBoundingClientRect();
                  return [
                    ...document.querySelectorAll(
                      ".brand,.window-buttons,.view-switch,.nav-buttons,.focus-heading h1,.quick-add",
                    ),
                  ]
                    .filter((el) => {
                      const b = el.getBoundingClientRect();
                      return (
                        b.width > 0 &&
                        n.left < b.right &&
                        n.right > b.left &&
                        n.top < b.bottom &&
                        n.bottom > b.top
                      );
                    })
                    .map((el) => el.className);
                });
                assert.deepEqual(
                  collisions,
                  [],
                  JSON.stringify({ header, font, material, width, collisions }),
                );
                await notice
                  .getByRole("button", { name: "撤销", exact: true })
                  .click();
                await page.waitForFunction(
                  () =>
                    ![...document.querySelectorAll(".task-title")].some(
                      (el) => el.textContent === "合成固定新增验证",
                    ),
                );
                await page
                  .locator(".focus-scroll")
                  .evaluate((el) => (el.scrollTop = 0));
                if (
                  !opaque &&
                  material === "glass" &&
                  (font === "standard" || (font === "large" && width === 380))
                )
                  await page.screenshot({
                    path: resolve(
                      images,
                      `${header}-${font}-${width}x${height}-focus.png`,
                    ),
                  });
                await click("收起任务详情");
              } else if (
                !opaque &&
                material === "glass" &&
                font === "standard" &&
                width === 980 &&
                height === 680
              )
                await page.screenshot({
                  path: resolve(images, `${header}-overview.png`),
                });
              records.push({
                header,
                font,
                material,
                width,
                height,
                view,
                geometry: before,
                scroll,
              });
              await writeFile(
                resolve(root, "ux32-progress.json"),
                JSON.stringify({
                  states: records.length,
                  last: { header, font, material, width, height, view },
                }),
              );
            }
          }
        }
    // Exact material geometry must match for every header/font/size/view.
    for (const row of records.filter((x) => x.material === "reading"))
      for (const material of ["glass", "frosted"]) {
        const other = records.find(
          (x) =>
            x.header === row.header &&
            x.font === row.font &&
            x.width === row.width &&
            x.height === row.height &&
            x.view === row.view &&
            x.material === material,
        );
        assert.deepEqual(
          other.geometry,
          row.geometry,
          "Material must not change layout geometry",
        );
      }
  }
  // Draft confirmation must remain reachable above the footer in short windows.
  for (const header of ["classic", "compact"])
    for (const font of ["small", "standard", "large"]) {
      await config("focus", 0.7, "reading", font, header);
      await size(380, 480);
      await page.locator(".focus-composer input").fill("保留这条合成草稿");
      await click("取消快速新增");
      await page.getByRole("group", { name: "处理未添加的任务" }).waitFor();
      const bounds = await geometry();
      assert.ok(
        bounds.composer.bottom <= bounds.footer.y + 1,
        "Draft prompt must not push input/footer out of view: " +
          JSON.stringify({ header, font, bounds }),
      );
      drafts.push({ header, font, geometry: bounds });
      await click("继续填写");
      assert.equal(
        await page.locator(".focus-composer input").inputValue(),
        "保留这条合成草稿",
      );
      await click("取消快速新增");
      await click("放弃草稿");
    }
  await config("focus", 0.7, "frosted", "large", "compact");
  // Settings UI, actual SQLite failure and reload, then retry both modes.
  await click("设置");
  assert.equal(
    await page.getByRole("slider", { name: /背景不透明度/ }).isDisabled(),
    opaque,
  );
  const db = new DatabaseSync(resolve(root, "starry-list.db"));
  const before = (await invoke("load_snapshot")).settings.header_layout;
  try {
    db.exec(
      "CREATE TRIGGER reject_header BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(ABORT,'UX32 header save failure'); END",
    );
    await page.getByRole("radio", { name: /^经典顶部/ }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "UX32 header save failure" })
      .waitFor();
    await page.waitForFunction(
      (before) =>
        document.querySelector(".app-shell").dataset.headerLayout === before,
      before,
    );
    assert.equal(
      (await invoke("load_snapshot")).settings.header_layout,
      before,
    );
  } finally {
    db.exec("DROP TRIGGER reject_header");
    db.close();
  }
  for (const [name, layout] of [
    [/^经典顶部/, "classic"],
    [/^紧凑顶部/, "compact"],
  ]) {
    await page.getByRole("radio", { name }).click();
    await page.waitForFunction(
      (layout) =>
        document.querySelector(".app-shell").dataset.headerLayout === layout &&
        !document
          .querySelector('input[name="header-layout"]')
          .closest("fieldset").disabled,
      layout,
    );
    assert.equal(
      (await invoke("load_snapshot")).settings.header_layout,
      layout,
    );
    await page.reload();
    await page.locator("main.focus").waitFor();
    assert.equal(
      await page.locator(".app-shell").getAttribute("data-header-layout"),
      layout,
    );
    await click("设置");
  }
  await click("关闭对话框");
  await writeFile(
    resolve(root, "ux32-results.json"),
    JSON.stringify(
      {
        opaque,
        states: records.length,
        heights,
        records,
        drafts,
        sqliteFailure: true,
        reloadBothModes: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ux32Passed: true,
      opaque,
      states: records.length,
      draftStates: drafts.length,
      heights,
      root,
    }),
  );
}
