// Opt-in isolated research runner. Never launches starry-list.exe or accesses SQLite.
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";

const root = resolve(".cache/sl006-" + Date.now());
await mkdir(root, { recursive: true });
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const evidence = [];
let child,
  browser,
  edge,
  page,
  cover,
  recovery,
  desktopShown = false;
const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));
async function launch() {
  child = spawn(resolve("src-tauri/target/debug/sl006-desktop-probe.exe"), [], {
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: resolve(root, "profile"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    },
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await pause(250);
    }
  }
  assert.ok(browser, "isolated WebView2 CDP must start");
  for (let attempt = 0; attempt < 60; attempt++) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    page = pages.find(
      (p) => !p.url().includes("?") && p.url().includes("localhost"),
    );
    cover = pages.find((p) => p.url().includes("?cover"));
    recovery = pages.find((p) => p.url().includes("?recovery"));
    if (page && cover && recovery) break;
    await pause(250);
  }
  assert.ok(page && cover && recovery, "all three isolated windows must exist");
  await page.locator("#normal").waitFor();
}
const invoke = (command, args = {}, target = page) =>
  target.evaluate(
    ({ command, args }) => window.__TAURI__.core.invoke(command, args),
    { command, args },
  );
const snap = () => invoke("snapshot");
const windowApi = (method, value, target = page) =>
  target.evaluate(
    ({ method, value }) =>
      window.__TAURI__.window.getCurrentWindow()[method](value),
    { method, value },
  );
async function mode(value) {
  await invoke("mode", { value });
  await pause();
}
async function log(name, result, detail) {
  evidence.push({ name, result, detail });
  console.log(JSON.stringify({ name, result, detail }));
}
function input(action, state, x = 0, y = 0, dx = 0, dy = 0) {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      resolve("research/sl006-desktop-probe/native-input.ps1"),
      "-Action",
      action,
      "-OwnerPid",
      String(child.pid),
      "-Window",
      String(state.probe),
      "-X",
      String(Math.round(x)),
      "-Y",
      String(Math.round(y)),
      "-DeltaX",
      String(dx),
      "-DeltaY",
      String(dy),
      "-ProfileDir",
      resolve(root, "edge-profile"),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  );
}
async function pointer(selector, action = "click", dx = 0, dy = 0) {
  const s = await snap();
  const box = await page.locator(selector).boundingBox();
  assert.ok(box);
  const x = s.x + (box.x + box.width / 2) * s.scale;
  const y = s.y + (box.y + box.height / 2) * s.scale;
  const hit = JSON.parse(input("hit", s, x, y));
  if (!hit.targetAtPoint) {
    await log(`OS ${action} ${selector}`, "未验证", {
      reason: "native hit-test refused occluded point",
      ...hit,
    });
    return false;
  }
  input(
    action,
    s,
    s.x + (box.x + box.width / 2) * s.scale,
    s.y + (box.y + box.height / 2) * s.scale,
    dx,
    dy,
  );
  await pause();
  return true;
}
async function browserCoverTest() {
  // A real browser in an independent profile, only a synthetic data URL.
  edge = await chromium.launchPersistentContext(resolve(root, "edge-profile"), {
    channel: "msedge",
    headless: false,
    viewport: null,
    args: [
      "--no-first-run",
      "--window-position=40,60",
      "--window-size=900,700",
    ],
  });
  const edgePage = edge.pages()[0];
  await edgePage.goto(
    "data:text/html,<title>SL006 synthetic browser cover</title><body style='background:lightblue'>SL006 browser cover</body>",
  );
  await edgePage.bringToFront();
  await pause();
  try {
    input("browser", await snap());
    await pause();
  } catch {
    await log(
      "isolated Edge native activation",
      "未验证",
      "profile-verified native activation unavailable",
    );
  }
  const edgeState = await snap();
  const hit = JSON.parse(
    input("hit", edgeState, edgeState.x + 200, edgeState.y + 150),
  );
  await log(
    "real isolated Edge covers probe",
    hit.syntheticBrowserAtPoint ? "实际通过" : "未验证",
    { ...hit, foregroundProbe: edgeState.foregroundProbe },
  );
  await edge.close();
  edge = undefined;
}

try {
  await launch();
  if (process.argv.includes("--watchdog-only")) {
    await mode("bottom");
    input("raise", await snap());
    await pause();
    await windowApi("setFocus");
    await pause();
    const before = await snap();
    assert.ok(before.probeRank > before.coverRank);
    await browserCoverTest();
    for (let step = 0; step < 5; step++) {
      await pause(25000);
      console.log(`Watchdog elapsed: ${(step + 1) * 25}s`);
    }
    input("raise", await snap());
    await pause();
    const after = await snap();
    assert.ok(after.probeRank < after.coverRank);
    assert.equal(after.topmost, false);
    await log("120s native watchdog releases bottom constraint", "实际通过", {
      before,
      after,
    });
  } else {
    await mode("normal");
    await windowApi("setFocus");
    await pause();
    const initial = await snap();
    await log("environment", "实际通过", {
      ...initial,
      userAgent: await page.evaluate(() => navigator.userAgent),
    });
    await windowApi("setFocus", undefined, cover);
    await pause();
    const beforeBottom = await snap();
    await mode("bottom");
    const afterBottom = await snap();
    await windowApi("setFocus", undefined, cover);
    await pause();
    const rustBottom = await snap();
    assert.ok(rustBottom.probeRank > rustBottom.coverRank);
    assert.equal(rustBottom.topmost, false);
    await log(
      "Rust bottom + ordinary cover + no focus theft",
      beforeBottom.foregroundCover && afterBottom.foregroundCover
        ? "实际通过"
        : "部分满足",
      { beforeBottom, afterBottom, rustBottom },
    );

    // Refuse native input if another application or the Shell covers the point.
    const nativeClick = await pointer("#counter");
    if (!nativeClick) await page.locator("#counter").click();
    await windowApi("setFocus");
    await pause();
    assert.equal(await page.locator("#counter").textContent(), "点击 1");
    const afterClick = await snap();
    await log(
      "button + native activation / bottom ordering",
      afterClick.probeRank > afterClick.coverRank
        ? nativeClick
          ? "实际通过"
          : "部分满足"
        : "实际失败",
      afterClick,
    );

    // These CDP inputs exercise WebView keyboard delivery, not a physical Chinese IME.
    await page.locator("#input").focus();
    await page.keyboard.type("English");
    await page.keyboard.insertText(" 中文");
    assert.equal(await page.locator("#input").inputValue(), "English 中文");
    await log(
      "English + Unicode text in WebView",
      "部分满足",
      "CDP keyboard/insertText; real IME candidate window unverified",
    );

    await windowApi("setAlwaysOnBottom", false);
    await windowApi("setAlwaysOnTop", false);
    await windowApi("setAlwaysOnBottom", true);
    await pause();
    const jsBottom = await snap();
    assert.ok(jsBottom.probeRank > jsBottom.coverRank);
    await log("JavaScript setAlwaysOnBottom", "实际通过", jsBottom);

    // One-shot HWND_BOTTOM control: activate with genuine OS pointer input.
    await mode("once");
    await windowApi("setFocus", undefined, cover);
    await pause();
    const onceBefore = await snap();
    await windowApi("setFocus");
    await pause();
    await pointer("#counter");
    const onceAfter = await snap();
    await log(
      "HWND_BOTTOM once then native activation + OS click",
      onceAfter.probeRank < onceAfter.coverRank ? "实际失败" : "部分满足",
      { before: onceBefore, after: onceAfter },
    );

    await mode("bottom");
    const nativeDrag = await pointer("#drag", "drag", 45, 25);
    if (!nativeDrag)
      await windowApi("setPosition", {
        type: "Physical",
        x: initial.x + 45,
        y: initial.y + 25,
      });
    const moved = await snap();
    assert.ok(moved.x !== initial.x || moved.y !== initial.y);
    await windowApi("minimize", undefined, cover);
    await pause();
    const nativeResize = await pointer("#resize", "drag", 50, 30);
    if (!nativeResize)
      await windowApi("setSize", {
        type: "Physical",
        width: moved.width + 50,
        height: moved.height + 30,
      });
    const resized = await snap();
    assert.ok(resized.width !== moved.width || resized.height !== moved.height);
    await log(
      "move + resize in bottom",
      nativeDrag && nativeResize ? "实际通过" : "部分满足",
      {
        moved,
        resized,
        nativeDrag,
        nativeResize,
      },
    );

    await windowApi("minimize", undefined, cover);
    await pause();
    await log("minimize ordinary cover", "实际通过", await snap());
    await windowApi("unminimize", undefined, cover);
    await pause();
    await windowApi("setFullscreen", true, cover);
    await windowApi("setFocus", undefined, cover);
    await pause();
    const fullscreen = await snap();
    assert.ok(fullscreen.probeRank > fullscreen.coverRank);
    await log("own borderless fullscreen cover", "部分满足", fullscreen);
    await windowApi("setFullscreen", false, cover);
    await pause();

    const frostEnabled = await invoke("frost", { enabled: true });
    await windowApi("setFocus", undefined, cover);
    await pause();
    if (!(await pointer("#counter"))) await page.locator("#counter").click();
    await log("existing HostBackdropBrush in bottom", "部分满足", {
      enabled: frostEnabled,
      state: await snap(),
      note: "native setup + interaction; visual texture/focus stability not measured",
    });
    await invoke("frost", { enabled: false });

    await browserCoverTest();
    await windowApi("setFocus", undefined, cover);
    await pause();

    // Temporarily shows desktop, always paired with restore in finally.
    const beforeDesktop = await snap();
    input("win-d", beforeDesktop);
    desktopShown = true;
    await pause(700);
    const showDesktop = await snap();
    await log(
      "Win+D remains visible",
      showDesktop.minimized ? "实际失败" : "部分满足",
      showDesktop,
    );
    input("win-d-restore", beforeDesktop);
    desktopShown = false;
    await pause(700);
    const restoredDesktop = await snap();
    assert.equal(restoredDesktop.minimized, false);
    assert.equal(restoredDesktop.width, beforeDesktop.width);
    assert.equal(restoredDesktop.height, beforeDesktop.height);
    await log("second Win+D", "实际通过", restoredDesktop);

    await invoke("mode", { value: "normal" }, recovery);
    await pause();
    await windowApi("setFocus");
    await pause();
    const normal = await snap();
    assert.equal(normal.minimized, false);
    assert.equal(normal.topmost, false);
    assert.ok(normal.probeRank < normal.coverRank);
    await log("independent recovery to ordinary", "实际通过", normal);
    await pointer("#counter");
    await windowApi("setAlwaysOnTop", true);
    await windowApi("setAlwaysOnBottom", true);
    await pause();
    await log("unmediated top=true + bottom=true", "部分满足", {
      native: await snap(),
      tauriTopFlag: await windowApi("isAlwaysOnTop"),
    });
    await mode("top");
    const top = await snap();
    assert.equal(top.topmost, true);
    await mode("bottom");
    const bottom = await snap();
    assert.equal(bottom.topmost, false);
    assert.ok(bottom.probeRank > bottom.coverRank);
    await mode("normal");
    await log("three mutually exclusive modes", "实际通过", {
      top,
      bottom,
      normal: await snap(),
    });

    try {
      await invoke("exit_probe");
    } catch (error) {
      if (!String(error).includes("closed")) throw error;
    }
    for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt++)
      await pause(100);
    assert.equal(child.exitCode, 0, "research process must exit normally");
    await browser.close();
    browser = undefined;
    await pause(600);
    await launch();
    const restart = await snap();
    assert.equal(restart.topmost, false);
    assert.equal(restart.minimized, false);
    assert.equal(await page.locator("#input").inputValue(), "");
    await log(
      "normal process restart without persisted modes",
      "实际通过",
      restart,
    );
  }
} catch (error) {
  await log("runner error", "实际失败", String(error.stack));
  process.exitCode = 1;
} finally {
  if (desktopShown) {
    try {
      input("win-d-restore", await snap());
    } catch {
      /* report locally */
    }
  }
  if (edge) await edge.close();
  if (browser) {
    try {
      await invoke("mode", { value: "normal" });
      await invoke("exit_probe");
    } catch {
      /* native watchdog remains */
    }
    await browser.close();
  }
  // Only the exact child handle, never a name-based process kill.
  if (child && child.exitCode === null) child.kill();
  await writeFile(
    resolve(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(`Local evidence: ${root}`);
}
