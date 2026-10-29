import { validOrder, orderSignature } from "./task-order";
import { useSyncExternalStore } from "react";
import {
  defaults,
  type Snapshot,
  type Task,
  type Settings,
  type DayMark,
  type Backup,
  type WaterEntry,
} from "./domain";
import { repository, type Repository } from "./platform";
export interface State {
  data: Snapshot;
  loading: boolean;
  initialized: boolean;
  pending: number;
  error: string | null;
}
export class AppStore {
  private state: State = {
    data: { tasks: [], categories: [], day_marks: [], settings: defaults },
    loading: true,
    initialized: false,
    pending: 0,
    error: null,
  };
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private loadPromise: Promise<void> | null = null;
  constructor(private repo: Repository) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  dismissError = () => this.update({ error: null });
  reportError = (e: unknown) =>
    this.update({ error: e instanceof Error ? e.message : String(e) });
  load() {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.performLoad().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }
  private async performLoad() {
    this.update({ loading: true, error: null });
    try {
      this.update({ data: await this.repo.load(), initialized: true });
    } catch (e) {
      this.reportError(e);
    } finally {
      this.update({ loading: false });
    }
  }
  private write(operation: () => Promise<void>, local: () => Snapshot) {
    this.update({ pending: this.state.pending + 1 });
    const result = this.queue.then(async () => {
      await operation();
      this.update({ data: local(), error: null });
    });
    this.queue = result.catch(() => undefined);
    return result
      .catch((e) => {
        this.reportError(e);
        throw e;
      })
      .finally(() => this.update({ pending: this.state.pending - 1 }));
  }
  add = (task: Task) =>
    this.write(
      () => this.repo.saveTask(task),
      () => ({
        ...this.state.data,
        tasks: [...this.state.data.tasks.filter((t) => t.id !== task.id), task],
      }),
    );
  patchTask(id: string, patch: Partial<Task> | ((t: Task) => Partial<Task>)) {
    let next: Task;
    return this.write(
      async () => {
        const current = this.state.data.tasks.find((t) => t.id === id);
        if (!current) throw new Error("任务已不存在");
        next = {
          ...current,
          ...(typeof patch === "function" ? patch(current) : patch),
          id,
          updated_at: new Date().toISOString(),
        };
        await this.repo.saveTask(next);
      },
      () => ({
        ...this.state.data,
        tasks: this.state.data.tasks.map((t) => (t.id === id ? next : t)),
      }),
    );
  }
  remove = (id: string) =>
    this.write(
      () => this.repo.deleteTask(id),
      () => ({
        ...this.state.data,
        tasks: this.state.data.tasks.filter((t) => t.id !== id),
      }),
    );
  addWater = (entry: WaterEntry) =>
    this.write(
      () => this.repo.saveWater(entry),
      () => ({
        ...this.state.data,
        water_entries: [
          ...(this.state.data.water_entries ?? []).filter(
            (e) => e.id !== entry.id,
          ),
          entry,
        ],
      }),
    );
  deleteWater = (id: string) =>
    this.write(
      () => this.repo.deleteWater(id),
      () => ({
        ...this.state.data,
        water_entries: (this.state.data.water_entries ?? []).filter(
          (e) => e.id !== id,
        ),
      }),
    );
  restore = (task: Task) => this.add(task);
  saveSettings(patch: Partial<Settings>) {
    let next: Settings;
    return this.write(
      async () => {
        next = { ...this.state.data.settings, ...patch };
        await this.repo.saveSettings(next);
      },
      () => ({ ...this.state.data, settings: next }),
    );
  }
  mark = (date: string, mark: DayMark | null) =>
    this.write(
      () => this.repo.saveMark(date, mark),
      () => ({
        ...this.state.data,
        day_marks: [
          ...this.state.data.day_marks.filter((m) => m.date !== date),
          ...(mark ? [mark] : []),
        ],
      }),
    );
  reorder(date: string, ids: string[], expected?: string) {
    return this.write(
      () => {
        const tasks = this.state.data.tasks.filter((t) => t.date === date);
        if (
          !validOrder(tasks, ids) ||
          (expected !== undefined && orderSignature(tasks) !== expected)
        )
          throw new Error("排序列表已变更，请重试");
        return this.repo.reorder(date, ids);
      },
      () => ({
        ...this.state.data,
        tasks: this.state.data.tasks.map((t) =>
          t.date === date ? { ...t, sort_order: ids.indexOf(t.id) } : t,
        ),
      }),
    );
  }
  importBackup(backup: Backup, replace: boolean) {
    let data: Snapshot;
    return this.write(
      async () => {
        await this.repo.importBackup(backup, replace);
        data = await this.repo.load();
      },
      () => data,
    );
  }
}
export const store = new AppStore(repository);
export function useStore() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
