import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { makeTask } from "../src/test-fixtures.ts";

export async function checkLayout({
  page,
  invoke,
  config,
  click,
  setDate,
  root,
  images,
  baseline,
}) {
  await mkdir(images, { recursive: true });
  const dates = ["2021-02-10", "2026-10-19", "2026-08-10"];
  for (const date of [...dates, "2026-10-01"])
    for (let i = 0; i < 4; i++)
      await invoke("save_task", {
        task: makeTask({
          id: `layout-${date}-${i}`,
          date,
          title:
            i === 1
              ? "很长的中文任务用于检查两行标题与按钮位置是否稳定而且没有横向溢出"
              : `布局验证任务 ${i + 1}`,
          completed: i === 3,
          priority: i % 3,
          category_id: "work",
          sort_order: i + 10,
          description: "合成测试计划\n检查阅读详情与任务排列。\n".repeat(20),
        }),
      });
  await invoke("save_mark", {
    date: "2026-10-01",
    mark: { date: "2026-10-01", kind: "overtime", note: null },
  });
  const expected = (await invoke("load_snapshot")).tasks.reduce((map, task) => {
    map[task.date] = (map[task.date] ?? 0) + 1;
    return map;
  }, {});
  const sizes = [
    [980, 480],
    [980, 540],
    [980, 620],
    [980, 680],
    [980, 860],
    [760, 480],
    [760, 620],
    [760, 680],
    [500, 480],
    [500, 860],
    [380, 480],
    [380, 860],
  ];
  const modes = ["reading", "glass", "frosted"],
    calendar = [],
    lists = [];
  async function size(width, height) {
    await invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width, height } },
    });
  }
  async function settle() {
    await page.waitForTimeout(140);
    await page.mouse.move(2, 2);
  }
  async function inspectCalendar() {
    return page.evaluate((expected) => {
      const contains = (a, b) =>
        b.top >= a.top - 0.51 &&
        b.bottom <= a.bottom + 0.51 &&
        b.left >= a.left - 0.51 &&
        b.right <= a.right + 0.51;
      let count = 0,
        dots = 0;
      const issues = [];
      const cells = [...document.querySelectorAll(".day-cell")];
      for (const cell of cells) {
        const bounds = cell.getBoundingClientRect(),
          date = cell.querySelector(".date-select");
        const key = date.getAttribute("aria-label").slice(3);
        const dateNumber = date
          .querySelector(".date-number")
          .getBoundingClientRect();
        for (const badge of date.querySelectorAll(".day-badge")) {
          const b = badge.getBoundingClientRect();
          if (
            b.left < dateNumber.right - 0.51 &&
            b.right > dateNumber.left + 0.51 &&
            b.top < dateNumber.bottom - 0.51 &&
            b.bottom > dateNumber.top + 0.51
          )
            issues.push(key + ": date/badge overlap");
        }
        if (
          !contains(
            bounds,
            date.querySelector(".date-number").getBoundingClientRect(),
          )
        )
          issues.push(key + ": date clipped");
        for (const badge of date.querySelectorAll(".day-badge"))
          if (!contains(bounds, badge.getBoundingClientRect()))
            issues.push(key + ": badge clipped");
        if (
          date.getAttribute("aria-description") !==
          `${expected[key] ?? 0} 项任务`
        )
          issues.push(key + ": accessible count");
        const marker = cell.querySelector(".compact-tasks");
        if (!marker || getComputedStyle(marker).display === "none") continue;
        if (
          marker.getAttribute("aria-label") !== `${key} ${expected[key]} 项任务`
        )
          issues.push(key + ": marker count");
        const dot = marker.querySelector(".task-dot,.important-dot");
        if (!contains(bounds, dot.getBoundingClientRect()))
          issues.push(key + ": dot clipped");
        const total =
          marker.querySelector(".task-total") ?? marker.lastElementChild;
        if (getComputedStyle(total).display !== "none") {
          count++;
          if (
            !contains(bounds, total.getBoundingClientRect()) ||
            !contains(
              marker.getBoundingClientRect(),
              total.getBoundingClientRect(),
            )
          )
            issues.push(key + ": count clipped");
        } else dots++;
      }
      return {
        weeks: cells.length / 7,
        viewport: [innerWidth, innerHeight],
        count,
        dots,
        issues,
        density: document.querySelector(".month-grid").className,
        minimum: getComputedStyle(
          document.querySelector(".month-grid"),
        ).getPropertyValue("--calendar-row-min"),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    }, expected);
  }
  for (let month = 0; month < dates.length; month++) {
    await setDate(dates[month]);
    for (const [width, height] of sizes) {
      await size(width, height);
      for (const mode of modes) {
        await config("overview", 0.7, mode);
        await settle();
        const result = await inspectCalendar();
        const states = [];
        for (let i = 0; i < 4; i++) {
          await page.waitForTimeout(30);
          states.push((await inspectCalendar()).density);
        }
        const record = {
          date: dates[month],
          width,
          height,
          mode,
          ...result,
          stable: new Set(states).size === 1,
        };
        calendar.push(record);
        if (!baseline) {
          assert.equal(result.weeks, [4, 5, 6][month]);
          const [outer, inner, factor, monitor] = await Promise.all([
            invoke("plugin:window|outer_size", { label: "main" }),
            invoke("plugin:window|inner_size", { label: "main" }),
            invoke("plugin:window|scale_factor", { label: "main" }),
            invoke("plugin:window|current_monitor"),
          ]);
          assert.ok(monitor, "Native monitor must be known");
          const expectedClient = [
            Math.min(
              width,
              (monitor.workArea.size.width - (outer.width - inner.width)) /
                factor,
            ),
            Math.min(
              height,
              (monitor.workArea.size.height - (outer.height - inner.height)) /
                factor,
            ),
          ];
          record.expectedClient = expectedClient;
          for (let dimension = 0; dimension < 2; dimension++)
            assert.ok(
              Math.abs(
                result.viewport[dimension] - expectedClient[dimension],
              ) <= 0.51,
              "Client size must match request or the existing work-area/frame clamp: " +
                JSON.stringify(record),
            );
          assert.deepEqual(result.issues, [], JSON.stringify(record));
          assert.equal(result.overflow, false);
          assert.ok(record.stable);
        }
        if (month === 2 && width === 980 && height === 540 && mode === "glass")
          await page.screenshot({
            path: resolve(
              images,
              `${baseline ? "ux303" : "ux304"}-short-calendar.png`,
            ),
          });
      }
    }
  }
  // Compare every task/action position against reading, including long titles,
  // completed items, a reader, an empty date and an open quick-add region.
  await setDate("2026-10-19");
  async function geometry(view) {
    return page.evaluate((view) => {
      const region = document.querySelector(
        view === "overview" ? ".agenda-scroll" : ".focus-scroll",
      );
      const origin = region.getBoundingClientRect();
      const selectors = [
        ".task-row",
        ".task-open",
        ".check-button",
        ".task-meta",
        ".order-buttons",
        ".task-delete-trigger",
        ".agenda-date",
        ".agenda-day",
        ".quick-add-area",
        ".task-reader",
      ];
      return Object.fromEntries(
        selectors.map((selector) => [
          selector,
          [...region.querySelectorAll(selector)].map((el) => {
            const b = el.getBoundingClientRect(),
              s = getComputedStyle(el);
            return [
              b.x - origin.x,
              b.y - origin.y,
              b.width,
              b.height,
              parseFloat(s.paddingLeft),
              parseFloat(s.paddingRight),
            ].map((n) => Math.round(n * 100) / 100);
          }),
        ]),
      );
    }, view);
  }
  for (const width of [980, 760, 500, 380]) {
    await size(width, 680);
    for (const view of ["overview", "focus"]) {
      const reference = {};
      for (const mode of modes) {
        await config(view, 0.7, mode);
        await settle();
        const stages =
          view === "overview"
            ? ["collapsed", "adding"]
            : ["collapsed", "reader", "closed", "empty"];
        for (const stage of stages) {
          if (stage === "adding") await click("为 2026-10-19 添加任务");
          if (stage === "reader")
            await page.locator(".focus-scroll .task-open").first().click();
          if (stage === "closed") await click("收起任务详情");
          if (stage === "empty") await click("专注 2026-10-22");
          await settle();
          const measured = await geometry(view);
          if (mode === "reading") reference[stage] = measured;
          const equal =
            JSON.stringify(measured) === JSON.stringify(reference[stage]);
          lists.push({
            width,
            view,
            mode,
            stage,
            equal,
            rowHeights: measured[".task-row"].map((row) => row[3]),
          });
          if (!baseline)
            assert.ok(
              equal,
              `${width}/${view}/${mode}/${stage}: layout differs from reading`,
            );
          if (
            width === 980 &&
            view === "focus" &&
            stage === "reader" &&
            mode === "glass"
          )
            await page.screenshot({
              path: resolve(
                images,
                `${baseline ? "ux303" : "ux304"}-focus-reader.png`,
              ),
            });
        }
      }
    }
  }
  // Real native size requests in rapid succession; CSS marker containment must
  // not depend on waiting for the next React density update.
  await config("overview", 0.4, "frosted");
  const rapid = [];
  for (let i = 0; i < 18; i++) {
    await size([980, 760, 500, 380, 1200, 980][i % 6], 480 + (i % 6) * 35);
    await page.waitForTimeout(25);
    const result = await inspectCalendar();
    rapid.push(result);
    if (!baseline) assert.deepEqual(result.issues, []);
  }
  if (!baseline) {
    assert.ok(calendar.some((r) => r.dots > 0));
    assert.ok(calendar.some((r) => r.count > 0));
  }
  const result = { baseline, calendar, lists, rapid };
  await writeFile(
    resolve(root, "layout-results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      layout: !baseline,
      baseline,
      cases: calendar.length,
      listStates: lists.length,
      rapid: rapid.length,
      clippingCases: calendar.filter((r) =>
        r.issues.some((issue) => issue.includes("clipped")),
      ).length,
      differentListStates: lists.filter((r) => !r.equal).length,
      root,
    }),
  );
}
