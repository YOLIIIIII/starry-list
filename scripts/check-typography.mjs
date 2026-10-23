// Native WebView2 checks on synthetic tasks only; called by visual-smoke.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";

export async function checkTypography({
  page,
  invoke,
  config,
  click,
  root,
  images,
  opaque,
}) {
  await mkdir(images, { recursive: true });
  const records = [];
  const size = async (width, height) => {
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width, height } },
    });
    await page.waitForTimeout(150);
  };
  const inspect = () =>
    page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          bottom: b.bottom,
        };
      };
      const font = (selector) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el).fontSize : null;
      };
      const clipped = [
        ...document.querySelectorAll(
          ".window-buttons button,.view-switch button,.editor-footer button",
        ),
      ].filter(
        (el) =>
          el.scrollHeight > el.clientHeight + 1 ||
          el.scrollWidth > el.clientWidth + 1,
      ).length;
      return {
        viewport: [innerWidth, innerHeight],
        header: rect(".app-header"),
        main: rect("main"),
        task: font(".task-open"),
        input: font(".quick-add input"),
        reader: font(".reader-description"),
        plan: font(".editor textarea"),
        help: font(".setting-row small"),
        clipped,
        overflow: document.documentElement.scrollWidth > innerWidth,
        dragWidth: rect(".drag-space")?.width,
      };
    });
  // Compile the actual UX3.0.4 CSS; no checkout or mutation of the main branch.
  const baselineRoot = resolve(root, "baseline");
  await mkdir(baselineRoot, { recursive: true });
  const input = resolve(baselineRoot, "ux304.css");
  await writeFile(
    input,
    execFileSync("git", ["show", "2523591:src/styles.css"]),
  );
  const output = resolve(baselineRoot, "compiled");
  await build({
    configFile: false,
    plugins: [tailwindcss()],
    logLevel: "error",
    build: {
      outDir: output,
      rollupOptions: { input, output: { assetFileNames: "[name][extname]" } },
    },
  });
  const css = await readFile(
    resolve(
      output,
      (await readdir(output)).find((file) => file.endsWith(".css")),
    ),
    "utf8",
  );
  for (const [width, height] of [
    [980, 680],
    [980, 480],
    [760, 620],
    [500, 620],
    [380, 620],
  ]) {
    await size(width, height);
    await config("overview", 0.7, "glass");
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('link[rel="stylesheet"]'))
        link.disabled = true;
    });
    const baseline = await page.addStyleTag({ content: css });
    await page.waitForTimeout(180);
    records.push({
      baseline: "UX3.0.4 actual standard (no legacy size setting)",
      width,
      height,
      ...(await inspect()),
    });
    if (width === 980 && height === 680 && !opaque)
      await page.screenshot({ path: resolve(images, "ux304-top.png") });
    // UX3.0.4 had no large setting. This is a controlled header-only comparison
    // with the same 14px mode labels used by UX3.1 large, never a shipped baseline.
    const large = await page.addStyleTag({
      content: ".view-switch button { font-size: 14px; }",
    });
    records.push({
      baseline: "UX3.0.4 header with UX3.1 large mode-label size (controlled)",
      width,
      height,
      ...(await inspect()),
    });
    await large.evaluate((el) => el.remove());
    await baseline.evaluate((el) => el.remove());
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('link[rel="stylesheet"]'))
        link.disabled = false;
    });
    await page.waitForTimeout(150);
    records.push({
      baseline: false,
      value: "standard",
      width,
      height,
      ...(await inspect()),
    });
    if (!opaque)
      await page.screenshot({
        path: resolve(images, `ux31-${width}x${height}.png`),
      });
    await config("overview", 0.7, "glass", "large");
    records.push({
      baseline: false,
      value: "large",
      width,
      height,
      ...(await inspect()),
    });
    if (!opaque && width === 980)
      await page.screenshot({
        path: resolve(images, `ux31-large-${width}x${height}.png`),
      });
  }
  for (const [label, value, px] of [
    ["小", "small", 13],
    ["标准（默认）", "standard", 14],
    ["大", "large", 16],
  ]) {
    for (const mode of ["reading", "glass", "frosted"]) {
      await size(980, 680);
      await config("overview", 0.7, mode);
      if (opaque) assert.equal(await invoke("native_frost_active"), false);
      await click("设置");
      assert.equal(
        await page.getByRole("slider", { name: /背景不透明度/ }).isDisabled(),
        opaque,
      );
      await page.getByRole("radio", { name: label, exact: true }).click();
      await page.waitForFunction(
        (value) =>
          document.querySelector(".app-shell").dataset.textSize === value &&
          !document.querySelector(".text-size-setting").disabled,
        value,
      );
      assert.equal((await invoke("load_snapshot")).settings.text_size, value);
      if (!opaque && mode === "glass")
        await page.screenshot({
          path: resolve(images, `settings-${value}.png`),
        });
      await click("关闭对话框");
      await page
        .getByRole("button", { name: "为 2026-10-19 添加任务", exact: true })
        .click();
      let metrics = await inspect();
      assert.equal(metrics.task, `${px}px`);
      assert.equal(metrics.input, `${px}px`);
      assert.equal(metrics.overflow, false);
      assert.equal(metrics.clipped, 0);
      records.push({ value, mode, stage: "overview-input", ...metrics });
      if (!opaque && (mode === "glass" || value === "standard"))
        await page.screenshot({
          path: resolve(images, `overview-${mode}-${value}.png`),
        });
      const noticeTitle = `字号通知 ${value} ${mode}`;
      await page.locator(".quick-add input").fill(noticeTitle);
      await page.keyboard.press("Enter");
      const notice = page.getByRole("status", {
        name: `已添加 ${noticeTitle}`,
        exact: true,
      });
      await notice.hover();
      for (const view of ["统筹总览", "专注编辑"]) {
        await click(view);
        for (const width of [980, 860, 760, 500, 380]) {
          await size(width, 680);
          await notice.hover();
          const issues = await page.evaluate(() => {
            const r = document
              .querySelector(".notification-region")
              .getBoundingClientRect();
            return [
              ...document.querySelectorAll(
                ".brand,.window-buttons,.view-switch,.nav-buttons,.quick-add,.section-heading h1,.focus-heading h1",
              ),
            ]
              .filter((el) => {
                const b = el.getBoundingClientRect();
                return (
                  b.width &&
                  b.height &&
                  r.left < b.right &&
                  r.right > b.left &&
                  r.top < b.bottom &&
                  r.bottom > b.top
                );
              })
              .map((el) => el.className);
          });
          assert.deepEqual(
            issues,
            [],
            `${value}/${mode}/${view}/${width}: notification overlap`,
          );
        }
      }
      await notice.getByRole("button", { name: "撤销", exact: true }).click();
      assert.equal(
        (await invoke("load_snapshot")).tasks.some(
          (task) => task.title === noticeTitle,
        ),
        false,
      );
      await size(980, 680);
      await click("专注编辑");
      await page.locator(".focus-scroll .task-open").first().click();
      metrics = await inspect();
      assert.equal(metrics.reader, `${px}px`);
      records.push({ value, mode, stage: "reader", ...metrics });
      await click("编辑");
      for (const [width, height] of [
        [980, 680],
        [980, 480],
        [760, 620],
        [500, 620],
        [380, 480],
      ]) {
        await size(width, height);
        const plan = page.getByRole("textbox", { name: /详细计划/ });
        await plan.fill(
          "这是合成长计划。检查多行滚动、标签及固定保存栏。\n".repeat(100),
        );
        const footer = await page.locator(".editor-footer").boundingBox();
        const dialog = await page.locator(".drawer-dialog").boundingBox();
        assert.ok(footer.y + footer.height <= dialog.y + dialog.height + 1);
        assert.ok(footer.y > dialog.y);
        metrics = await inspect();
        assert.equal(metrics.plan, `${px}px`);
        assert.equal(metrics.clipped, 0);
        assert.equal(metrics.overflow, false);
        const scroll = await page.locator(".editor-scroll").evaluate((el) => {
          el.scrollTop = 100000;
          return {
            top: el.scrollTop,
            height: el.scrollHeight,
            client: el.clientHeight,
          };
        });
        assert.ok(scroll.top > 0);
        records.push({
          value,
          mode,
          stage: "drawer",
          width,
          height,
          scroll,
          ...metrics,
        });
        if (
          !opaque &&
          mode === "glass" &&
          value === "large" &&
          [380, 980].includes(width)
        )
          await page.screenshot({
            path: resolve(images, `drawer-large-${width}x${height}.png`),
          });
      }
      await click("取消");
      await click("放弃修改");
      await click("统筹总览");
    }
  }
  // A 40-character imported category must leave room for the task title;
  // the complete category remains readable in narrow-window details.
  const categoryName =
    "用于检查长分类在大字号下仍能阅读并且不会与标题按钮重叠的合成分类文字".padEnd(
      40,
      "字",
    );
  const snapshot = await invoke("load_snapshot");
  await invoke("import_backup", {
    backup: {
      ...snapshot,
      format: "starry-list",
      version: 1,
      exported_at: new Date().toISOString(),
      categories: snapshot.categories.map((category) =>
        category.id === "work" ? { ...category, name: categoryName } : category,
      ),
    },
    replace: true,
  });
  await page.reload();
  await page.locator("main.overview").waitFor();
  await size(980, 680);
  const categoryLayout = await page
    .locator(".task-open:has(.category-label)")
    .first()
    .evaluate((el) => {
      const title = el.querySelector(".task-title").getBoundingClientRect();
      const meta = el.querySelector(".task-meta").getBoundingClientRect();
      return {
        titleWidth: title.width,
        gap: meta.left - title.right,
        overflow: el.scrollWidth > el.clientWidth + 1,
      };
    });
  assert.ok(categoryLayout.titleWidth > 40);
  assert.ok(categoryLayout.gap >= 0);
  assert.equal(categoryLayout.overflow, false);
  await click("专注编辑");
  await page.locator(".focus-scroll .task-open").first().click();
  await size(380, 480);
  const readerCategory = page.locator(".reader-meta .category-label");
  await readerCategory.waitFor({ state: "visible" });
  assert.equal(await readerCategory.textContent(), categoryName);
  await click("统筹总览");
  // Real SQLite failure, retaining saved preference and all task rows.
  await click("设置");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(resolve(root, "starry-list.db"));
  const before = (await invoke("load_snapshot")).settings.text_size;
  try {
    db.exec(
      "CREATE TRIGGER reject_text_size BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(ABORT,'UX31 settings write failure'); END",
    );
    await page
      .getByRole("radio", {
        name: before === "small" ? "大" : "小",
        exact: true,
      })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "UX31 settings write failure" })
      .waitFor();
    await page.waitForFunction(
      (before) =>
        document.querySelector(".app-shell").dataset.textSize === before,
      before,
    );
    assert.equal((await invoke("load_snapshot")).settings.text_size, before);
  } finally {
    db.exec("DROP TRIGGER reject_text_size");
    db.close();
  }
  await page.getByRole("radio", { name: "大", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell").dataset.textSize === "large" &&
      !document.querySelector(".text-size-setting").disabled,
  );
  await page.reload();
  await page.locator("main.overview").waitFor();
  assert.equal((await invoke("load_snapshot")).settings.text_size, "large");
  await writeFile(
    resolve(root, "typography-results.json"),
    JSON.stringify(
      {
        opaque,
        baselineCommit: "2523591",
        records,
        sqliteFailureAndRetry: true,
        reloadPersistence: true,
        notificationStates: 90,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ typography: true, opaque, states: records.length, root }),
  );
}
