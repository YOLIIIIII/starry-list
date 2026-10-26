/* global __TAURI__, document, location */
const invoke = __TAURI__.core.invoke;
const win = __TAURI__.window.getCurrentWindow();
let clicks = 0;
let frost = false;
async function mode(value) {
  try {
    await invoke("mode", { value });
    document.querySelector("#status").textContent = JSON.stringify(
      await invoke("snapshot"),
    );
  } catch (error) {
    document.querySelector("#status").textContent = String(error);
  }
}
for (const value of ["normal", "bottom", "top", "once"]) {
  document.getElementById(value).onclick = () => mode(value);
}
document.querySelector("#counter").onclick = () => {
  document.querySelector("#counter").textContent = `点击 ${++clicks}`;
};
document.querySelector("#exit").onclick = () => invoke("exit_probe");
document.querySelector("#frost").onclick = async () => {
  frost = await invoke("frost", { enabled: !frost });
  document.querySelector("#status").textContent = `native frost: ${frost}`;
};
document.querySelector("#drag").onmousedown = () => win.startDragging();
document.querySelector("#resize").onmousedown = () =>
  win.startResizeDragging("SouthEast");
if (location.search) {
  document.querySelector("#drag").textContent = location.search.includes(
    "recovery",
  )
    ? "独立恢复控制窗（Alt+Tab 可达）"
    : "普通遮挡窗口";
  document.querySelector("main").style.background = "#eee3b9";
}
