// Read-only smoke check of the embedded production frontend, with network blocked.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = resolve(".cache/release-smoke");
await mkdir(root, { recursive: true });
const child = spawn(resolve("src-tauri/target/release/starry-list.exe"), [], {
  windowsHide: true,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-port=9223 --disable-background-networking",
  },
});
let browser, page;
const errors = [];
try {
  for (let i = 0; i < 60; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert.ok(browser, "Production WebView2 did not start");
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent("page"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("main.overview,main.focus").waitFor();
  await page.waitForFunction(
    async () =>
      await window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", {
        label: "main",
      }),
  );
  assert.match(page.url(), /tauri\.localhost/);
  const original = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("load_snapshot"),
  );
  const nativeTransparent = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("native_transparency"),
  );
  if (!nativeTransparent) {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    assert.equal(
      await page.getByRole("slider", { name: /背景不透明度/ }).isDisabled(),
      true,
    );
    await page
      .getByText("此版本使用原生不透明窗口，背景不会透视桌面。", {
        exact: true,
      })
      .waitFor();
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  }
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["tauri.localhost", "ipc.localhost", "asset.localhost"].includes(
      url.hostname,
    )
      ? route.continue()
      : route.abort();
  });
  await page.reload();
  await page.locator("main.overview,main.focus").waitFor();
  const next = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("load_snapshot"),
  );
  assert.deepEqual(next, original);
  assert.equal(errors.length, 0);
  const result = {
    url: page.url(),
    webview: browser.version(),
    tasks: original.tasks.length,
    externalNetworkBlocked: true,
    nativeTransparent,
    errors,
  };
  await writeFile(
    resolve(root, nativeTransparent ? "transparent.json" : "opaque.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  const exited = new Promise((r) => child.once("exit", r));
  await page.getByRole("button", { name: "关闭应用", exact: true }).click();
  await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Production close timed out")), 15000),
    ),
  ]);
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
