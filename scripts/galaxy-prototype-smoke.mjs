import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(`.cache/galaxy-prototype-${Date.now()}`),
  shots = resolve("docs/screenshots/sl023a");
await mkdir(root, { recursive: true });
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  page = await browser.newPage({ viewport: { width: 980, height: 680 } });
const errors = [],
  requests = [],
  records = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => requests.push(r.url()));
try {
  await page.goto("http://127.0.0.1:4178");
  await page.screenshot({ path: resolve(shots, "entry.png") });
  await page.locator('[data-enter="A"]').click();
  for (const scheme of ["A", "B", "C"]) {
    await page.locator(`#scheme-${scheme}`).click();
    await page.locator("#monthly").click();
    await page.getByRole("button", { name: /^2026-10-14，/ }).click();
    for (const [width, height, size] of [
      [980, 680, "standard"],
      [760, 620, "large"],
      [500, 620, "large"],
    ]) {
      await page.setViewportSize({ width, height });
      await page
        .locator(".preview-settings")
        .evaluate((el) => (el.open = true));
      await page.locator("#size").selectOption(size);
      await page
        .locator(".preview-settings")
        .evaluate((el) => (el.open = false));
      for (const view of ["monthly", "yearly"]) {
        await page.locator("#" + view).click();
        await page.screenshot({
          path: resolve(
            shots,
            `${scheme}-${view}-${width}x${height}-${size}.png`,
          ),
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        const overlaps = await page.evaluate(() => {
          const boxes = [
            ...document.querySelectorAll(
              "#chart .date-button,#chart .month-card",
            ),
          ]
            .map((el) => ({
              name: el.getAttribute("aria-label"),
              r: el.getBoundingClientRect(),
            }))
            .filter((b) => b.r.width > 0);
          return boxes.flatMap((a, i) =>
            boxes
              .slice(i + 1)
              .filter(
                (b) =>
                  Math.min(a.r.right, b.r.right) >
                    Math.max(a.r.left, b.r.left) + 0.5 &&
                  Math.min(a.r.bottom, b.r.bottom) >
                    Math.max(a.r.top, b.r.top) + 0.5,
              )
              .map((b) => [a.name, b.name]),
          );
        });
        assert.deepEqual(overlaps, [], `${scheme} ${view} ${width} overlap`);
        records.push({ scheme, view, width, height, size });
      }
    }
    await page.setViewportSize({ width: 980, height: 680 });
    await page.locator("#monthly").click();
    await page.locator(".preview-settings").evaluate((el) => (el.open = true));
    await page.locator("#size").selectOption("standard");
    await page.locator(".preview-settings").evaluate((el) => (el.open = false));
    for (const day of [1, 2, 3]) {
      await page
        .getByRole("button", { name: new RegExp(`^2026-10-0${day}，`) })
        .click();
      assert.match(
        await page.locator("#details").innerText(),
        day === 1 ? /没有任务/ : day === 2 ? /1 \/ 2/ : /2 \/ 2/,
      );
    }
    await page.locator("#toggle-demo").click();
    assert.match(await page.locator("#details").innerText(), /1 \/ 2/);
    await page.locator("#toggle-demo").click();
    await page.getByRole("button", { name: /^2026-10-03，/ }).focus();
    await page.keyboard.press("ArrowRight");
    assert.match(await page.locator("#details").innerText(), /2026-10-04/);
  }
  await page.locator(".preview-settings").evaluate((el) => (el.open = true));
  await page.locator("#sample").selectOption("empty");
  await page.locator(".preview-settings").evaluate((el) => (el.open = false));
  assert.equal(await page.locator("#chart .star").count(), 0);
  await page.locator(".preview-settings").evaluate((el) => (el.open = true));
  await page.locator("#sample").selectOption("normal");
  await page.locator(".preview-settings").evaluate((el) => (el.open = false));
  for (const scheme of ["A", "B", "C"])
    for (const size of ["small", "standard", "large"])
      for (const skin of ["reading", "glass", "frosted"])
        for (const header of ["classic", "compact"]) {
          await page.locator(`#scheme-${scheme}`).click();
          await page.setViewportSize({ width: 500, height: 620 });
          await page
            .locator(".preview-settings")
            .evaluate((el) => (el.open = true));
          await page.locator("#size").selectOption(size);
          await page.locator("#skin").selectOption(skin);
          await page.locator("#header").selectOption(header);
          await page
            .locator(".preview-settings")
            .evaluate((el) => (el.open = false));
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          records.push({ scheme, size, skin, header });
        }
  await page.locator("#year").selectOption("2027");
  await page.locator("#month").selectOption("1");
  await page.locator("#previous").click();
  assert.equal(await page.locator("#year").inputValue(), "2026");
  assert.equal(await page.locator("#month").inputValue(), "12");
  await page.locator("#yearly").click();
  await page.locator("#next").click();
  assert.equal(await page.locator("#year").inputValue(), "2027");
  await page.locator("#monthly").click();
  await page.locator("#year").selectOption("2025");
  await page.locator("#month").selectOption("1");
  await page.locator("#previous").click();
  assert.equal(await page.locator("#month").inputValue(), "1");
  await page.getByRole("button", { name: /^2025-01-01，/ }).click();
  await page.keyboard.press("ArrowLeft");
  assert.match(await page.locator("#details").innerText(), /2025-01-01/);
  await page.locator("#year").selectOption("2027");
  await page.locator("#month").selectOption("12");
  await page.locator("#next").click();
  assert.equal(await page.locator("#month").inputValue(), "12");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  assert.deepEqual(errors, []);
  assert.ok(requests.every((url) => url.startsWith("http://127.0.0.1:4178/")));
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.equal(
    (await page.request.get("http://127.0.0.1:4178/src/store.ts")).status(),
    404,
  );
  const density = await page.evaluate(() => ({
    elements: document.querySelectorAll("*").length,
    animations: document.getAnimations().length,
  }));
  const hidpi = await browser.newContext({
    viewport: { width: 760, height: 620 },
    deviceScaleFactor: 2,
  });
  const highPage = await hidpi.newPage();
  await highPage.goto("http://127.0.0.1:4178");
  await highPage.locator("[data-enter=B]").click();
  assert.equal(
    await highPage.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await hidpi.close();
  console.log(
    JSON.stringify({ density, hidpi: "2x browser emulation passed" }),
  );
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify({ records, errors, requests }, null, 2),
  );
  console.log(JSON.stringify({ root, states: records.length, errors }));
} catch (e) {
  await page.screenshot({ path: resolve(root, "failure.png"), fullPage: true });
  throw e;
} finally {
  await browser.close();
}
