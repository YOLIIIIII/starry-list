import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  backupSchema,
  dayKey,
  type Backup,
  type DayMark,
  type Settings,
  type Snapshot,
  type Task,
} from "./domain";
import { visibleBounds } from "./window-bounds";
export interface Repository {
  load(): Promise<Snapshot>;
  saveTask(task: Task): Promise<void>;
  deleteTask(id: string): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  saveMark(date: string, mark: DayMark | null): Promise<void>;
  reorder(date: string, ids: string[]): Promise<void>;
  exportBackup(): Promise<boolean>;
  readBackup(): Promise<Backup | null>;
  importBackup(backup: Backup, replace: boolean): Promise<void>;
}
export const repository: Repository = {
  load: () => {
    if (!isTauri())
      return Promise.reject(
        new Error(
          "请通过桌面应用或 npm run tauri dev 启动。浏览器预览不连接本地 SQLite。",
        ),
      );
    return invoke("load_snapshot");
  },
  saveTask: (task) => invoke("save_task", { task }),
  deleteTask: (id) => invoke("delete_task", { id }),
  saveSettings: (settings) => invoke("save_settings", { settings }),
  saveMark: (date, mark) => invoke("save_mark", { date, mark }),
  reorder: (date, ids) => invoke("reorder_tasks", { date, ids }),
  async exportBackup() {
    const path = await save({
      defaultPath: `Starry-List-${dayKey(new Date())}.json`,
      filters: [{ name: "Starry List JSON", extensions: ["json"] }],
    });
    if (!path) return false;
    await invoke("export_backup", { path });
    return true;
  },
  async readBackup() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Starry List JSON", extensions: ["json"] }],
    });
    if (!path) return null;
    return backupSchema.parse(await invoke("read_backup", { path }));
  },
  importBackup: (backup, replace) =>
    invoke("import_backup", { backup, replace }),
};
export async function prepareWindow(alwaysOnTop: boolean) {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  try {
    await invoke("plugin:window-state|restore_state", {
      label: "main",
      flags: 7,
    });
    if (await win.isMaximized()) {
      await win.setAlwaysOnTop(alwaysOnTop);
      return;
    }
    const [monitors, pos, size, inner] = await Promise.all([
      availableMonitors(),
      win.outerPosition(),
      win.outerSize(),
      win.innerSize(),
    ]);
    const bounds = visibleBounds(
      { x: pos.x, y: pos.y, width: size.width, height: size.height },
      monitors.map((m) => ({
        x: m.workArea.position.x,
        y: m.workArea.position.y,
        width: m.workArea.size.width,
        height: m.workArea.size.height,
      })),
    );
    if (bounds.width !== size.width || bounds.height !== size.height)
      await win.setSize(
        new PhysicalSize(
          Math.max(1, bounds.width - (size.width - inner.width)),
          Math.max(1, bounds.height - (size.height - inner.height)),
        ),
      );
    if (bounds.x !== pos.x || bounds.y !== pos.y)
      await win.setPosition(new PhysicalPosition(bounds.x, bounds.y));
    await win.setAlwaysOnTop(alwaysOnTop);
  } finally {
    await win.show();
  }
}
export const nativeTransparency = () =>
  isTauri() ? invoke<boolean>("native_transparency") : Promise.resolve(false);
// One composition material per native window; views never reapply it.
let effectQueue: Promise<unknown> = Promise.resolve();
let effectRevision = 0;
let appliedFrost: boolean | undefined;
export function applyFrost(enabled: boolean): Promise<boolean> {
  const revision = ++effectRevision;
  const result = effectQueue
    .catch(() => {})
    .then(async () => {
      if (!isTauri() || revision !== effectRevision) return false;
      if (appliedFrost === enabled) return enabled;
      const win = getCurrentWindow();
      try {
        const supported =
          enabled && (await invoke<boolean>("native_frost_supported"));
        if (revision !== effectRevision) return false;
        // Replace, never stack. Reset an unknown/previous native effect before
        // applying a new one; keep the stronger CSS fallback until completion.
        appliedFrost = undefined;
        await invoke("native_frost", { enabled: false });
        await win.clearEffects();
        if (supported && revision === effectRevision) {
          appliedFrost = await invoke<boolean>("native_frost", {
            enabled: true,
          });
          return appliedFrost;
        }
        appliedFrost = false;
        return false;
      } catch (error) {
        appliedFrost = undefined;
        // A failed application may already have changed the native window.
        // Clear it before the UI enables its stronger fallback surface.
        await invoke("native_frost", { enabled: false });
        await win.clearEffects();
        throw error;
      }
    });
  effectQueue = result;
  return result;
}
export async function windowAction(action: "minimize" | "close" | "resize") {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  if (action === "resize") await win.startResizeDragging("SouthEast");
  else await win[action]();
}
export async function setTop(value: boolean) {
  if (isTauri()) await getCurrentWindow().setAlwaysOnTop(value);
}
export type ResizeDirection =
  | "North"
  | "NorthEast"
  | "East"
  | "SouthEast"
  | "South"
  | "SouthWest"
  | "West"
  | "NorthWest";
export async function resizeWindow(direction: ResizeDirection) {
  if (isTauri()) await getCurrentWindow().startResizeDragging(direction);
}
