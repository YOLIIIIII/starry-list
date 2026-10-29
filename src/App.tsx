import { useTaskDrag } from "./use-task-drag";
import { orderSignature } from "./task-order";
import {
  InlineTitleEditor,
  NotificationRail,
  StatusToast,
  UndoToast,
  type InlineTitleHandle,
  type UndoEntry,
} from "./quick-actions";
import { useEnterReturn } from "./use-enter-return";
import { surfaceAlphas } from "./surfaces";
import { observeCalendar } from "./calendar-layout";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CalendarDays,
  ListTodo,
  Orbit,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  X,
  Pin,
  Grip,
  GripVertical,
  Download,
  Upload,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  dayKey,
  localDay,
  monthDays,
  shiftDay,
  shiftMonth,
  weekDays,
  agendaDays,
  displayTasks,
  previewTasks,
  taskLabel,
  type Task,
  type Backup,
  type Settings,
  type Appearance,
  type TextSize,
  type HeaderLayout,
  type AgendaRange,
} from "./domain";
import { dayInfo } from "./holidays";
import { store, useStore } from "./store";
import {
  prepareWindow,
  repository,
  setTop,
  windowAction,
  nativeTransparency,
  resizeWindow,
  applyFrost,
} from "./platform";
import {
  Dialog,
  Empty,
  Priority,
  Progress,
  QuickAdd,
  TaskEditor,
  TaskReader,
  TaskRow,
  type EditorHandle,
  type QuickAddHandle,
} from "./components";
const pretty = (date: string, pattern: string) =>
  format(localDay(date), pattern, { locale: zhCN });
export default function App() {
  const { data, loading, initialized, error, pending } = useStore();
  const { settings, tasks, categories, day_marks } = data;
  const {
    buttons: dayAddButtons,
    prepare: prepareEnterReturn,
    cancel: cancelEnterReturn,
  } = useEnterReturn(settings.active_view);
  const [today, setToday] = useState(() => dayKey(new Date()));
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [textPreview, setTextPreview] = useState<TextSize | null>(null);
  const [textSaving, setTextSaving] = useState(false);
  const textSave = useRef(false);
  const [headerPreview, setHeaderPreview] = useState<HeaderLayout | null>(null);
  const [headerSaving, setHeaderSaving] = useState(false);
  const headerSave = useRef(false);
  const [agendaPreview, setAgendaPreview] = useState<AgendaRange | null>(null);
  const [agendaSaving, setAgendaSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [undos, setUndos] = useState<UndoEntry[]>([]);
  const [inlineId, setInlineId] = useState<string | null>(null);
  const inline = useRef<InlineTitleHandle>(null);
  function addUndo(task: Task, kind: UndoEntry["kind"]) {
    setUndos((items) => [
      ...items.filter((item) => item.task.id !== task.id),
      { id: crypto.randomUUID(), task, kind },
    ]);
  }
  function closeUndo(id: string) {
    setUndos((items) => items.filter((item) => item.id !== id));
  }
  const [notice, setNotice] = useState("");
  const [backup, setBackup] = useState<Backup | null>(null);
  const [replace, setReplace] = useState(false);
  const [replaceWord, setReplaceWord] = useState("");
  const [importing, setImporting] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const transition = useRef(false);
  const closeAllowed = useRef(false);
  const [opacity, setOpacity] = useState<number | null>(null);
  const [nativeTransparent, setNativeTransparent] = useState(true);
  const [frostState, setFrostState] = useState<
    "off" | "pending" | "applied" | "fallback"
  >("off");
  const calendarGrid = useRef<HTMLDivElement>(null);
  const [previewLimit, setPreviewLimit] = useState(1);
  const [quickDraft, setQuickDraft] = useState<{
    date: string;
    title: string;
  } | null>(null);
  const [quickConfirm, setQuickConfirm] = useState(false);
  const quick = useRef<QuickAddHandle>(null);
  const safe = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (e) {
      store.reportError(e);
    }
  };
  async function guard(action: () => void | Promise<void>) {
    cancelEnterReturn();
    if (
      transition.current ||
      quick.current?.isComposing() ||
      inline.current?.isComposing()
    )
      return;
    transition.current = true;
    try {
      if (quick.current && !(await quick.current.save())) return;
      if (inline.current && !(await inline.current.save())) return;
      if (editor.current) {
        const hadChanges = editor.current.isDirty();
        if (!(await editor.current.save())) return;
        setEditing(null);
        if (hadChanges) setNotice("修改已保存");
      }
      setQuickDraft(null);
      setQuickConfirm(false);
      await action();
    } catch (e) {
      store.reportError(e);
    } finally {
      transition.current = false;
    }
  }
  const guardRef = useRef(guard);
  guardRef.current = guard;
  useEffect(() => {
    let alive = true;
    if (isTauri())
      void nativeTransparency()
        .then((value) => {
          if (alive) setNativeTransparent(value);
        })
        .catch(store.reportError);
    void store.load().then(() => {
      if (alive)
        void prepareWindow(
          store.getSnapshot().data.settings.always_on_top,
        ).catch(store.reportError);
    });
    const timer = setInterval(() => setToday(dayKey(new Date())), 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((e) => {
        if (closeAllowed.current) return;
        e.preventDefault();
        void guardRef.current(async () => {
          while (store.getSnapshot().pending)
            await new Promise((r) => setTimeout(r, 25));
          closeAllowed.current = true;
          await windowAction("close");
        });
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(store.reportError);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload }) => {
        if (!payload) {
          cancelEnterReturn();
          quick.current?.focusLost();
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(store.reportError);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [cancelEnterReturn]);
  const wantsFrost =
    settings.appearance_mode === "frosted" &&
    nativeTransparent &&
    !settings.opaque_fallback &&
    (opacity ?? settings.background_opacity) < 1;
  useEffect(() => {
    if (!initialized) return;
    let alive = true;
    if (wantsFrost) setFrostState("pending");
    // Reading/light modes clear the native material left by a previous selection.
    void applyFrost(wantsFrost)
      .then((applied) => {
        if (alive)
          setFrostState(
            wantsFrost ? (applied ? "applied" : "fallback") : "off",
          );
      })
      .catch(() => {
        if (alive) setFrostState(wantsFrost ? "fallback" : "off");
      });
    return () => {
      alive = false;
    };
  }, [initialized, wantsFrost]);
  const byDate = new Map<string, Task[]>();
  for (const t of tasks) {
    const day = byDate.get(t.date) ?? [];
    day.push(t);
    byDate.set(t.date, day);
  }
  function select(date: string) {
    void guard(() => {
      setSelected(date);
      setMonth(date);
      setExpanded(null);
    });
  }
  function openTask(task: Task) {
    void guard(async () => {
      await store.saveSettings({ active_view: "focus" });
      setSelected(task.date);
      setMonth(task.date);
      setExpanded(task.id);
    });
  }
  function editTask(task: Task) {
    void guard(async () => {
      await store.saveSettings({ active_view: "focus" });
      setSelected(task.date);
      setMonth(task.date);
      setExpanded(task.id);
      setEditing(task.id);
    });
  }
  function requestDelete(id: string) {
    void guard(() => {
      const current = store
        .getSnapshot()
        .data.tasks.find((task) => task.id === id);
      if (current) setDeleteTarget(current);
    });
  }
  function changeView(view: Settings["active_view"]) {
    void guard(async () => {
      await store.saveSettings({ active_view: view });
      setExpanded(null);
    });
  }
  function goToday() {
    select(today);
  }
  function changeAgendaRange(value: AgendaRange) {
    void guard(async () => {
      if (value === store.getSnapshot().data.settings.agenda_range) return;
      setAgendaPreview(value);
      setAgendaSaving(true);
      try {
        await store.saveSettings({ agenda_range: value });
      } finally {
        // The store changes only after persistence. On failure it retains the
        // previous range; guard reports the error. Drafts used the same guard.
        setAgendaPreview(null);
        setAgendaSaving(false);
      }
    });
  }
  function closeEditor(collapse = false) {
    const id = editing;
    setEditing(null);
    if (collapse) setExpanded(null);
    requestAnimationFrame(() => {
      if (id)
        document
          .getElementById(`task-${id}`)
          ?.querySelector<HTMLButtonElement>(".task-open")
          ?.focus();
    });
  }
  function startAdding(date: string) {
    if (quickDraft?.date === date) {
      cancelQuick(date);
      return;
    }
    void guard(() => setQuickDraft({ date, title: "" }));
  }
  function finishQuick(date: string, added: boolean, task?: Task) {
    setQuickDraft(null);
    setQuickConfirm(false);
    if (added && task) addUndo(task, "added");
    if (added) return;
    {
      const target =
        document.querySelector<HTMLElement>(
          `[aria-label="为 ${date} 添加任务"]`,
        ) ?? document.querySelector<HTMLInputElement>(".quick-add input");
      target?.focus();
    }
  }
  function cancelQuick(date: string) {
    if (
      transition.current ||
      quick.current?.isSaving() ||
      quick.current?.isComposing()
    )
      return;
    if (quickDraft?.title.trim()) setQuickConfirm(true);
    else finishQuick(date, false);
  }
  function quickInput(date: string, autoFocus = false) {
    return (
      <QuickAdd
        ref={quick}
        date={date}
        autoFocus={autoFocus}
        onEnterSubmit={() => prepareEnterReturn(date)}
        title={quickDraft?.date === date ? quickDraft.title : ""}
        onTitleChange={(title) => setQuickDraft({ date, title })}
        onAdded={(task) => finishQuick(date, true, task)}
        onCancel={() => cancelQuick(date)}
        onOutside={() => {
          setQuickDraft(null);
          setQuickConfirm(false);
        }}
        confirmCancel={quickConfirm}
        onContinue={() => {
          setQuickConfirm(false);
          document
            .querySelector<HTMLInputElement>(
              `[aria-label="${date} 新任务标题"]`,
            )
            ?.focus();
        }}
        onDiscard={() => finishQuick(date, false)}
      />
    );
  }
  useEffect(() => {
    if (!expanded) return;
    document
      .getElementById(`task-${expanded}`)
      ?.querySelector(".task-row")
      ?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [expanded, settings.active_view]);
  async function saveSetting(patch: Partial<Settings>) {
    if (patch.always_on_top !== undefined) {
      const old = store.getSnapshot().data.settings.always_on_top;
      await setTop(patch.always_on_top);
      try {
        await store.saveSettings(patch);
      } catch (e) {
        await setTop(old);
        throw e;
      }
    } else await store.saveSettings(patch);
  }
  const sorting = useRef(false);
  const [sortSaving, setSortSaving] = useState(false);
  async function persistOrder(ids: string[], signature: string) {
    if (sorting.current) return;
    sorting.current = true;
    setSortSaving(true);
    try {
      await store.reorder(selected, ids, signature);
    } catch (e) {
      store.reportError(e);
    } finally {
      sorting.current = false;
      setSortSaving(false);
    }
  }
  function moveTask(task: Task, delta: number) {
    void guard(async () => {
      const list = displayTasks(
        store.getSnapshot().data.tasks.filter((t) => t.date === selected),
      );
      const index = list.findIndex((t) => t.id === task.id),
        next = index + delta;
      if (
        index < 0 ||
        next < 0 ||
        next >= list.length ||
        list[next].completed !== task.completed
      )
        return;
      const signature = orderSignature(list);
      [list[index], list[next]] = [list[next], list[index]];
      await persistOrder(
        list.map((t) => t.id),
        signature,
      );
    });
  }
  const style = surfaceAlphas(
    opacity ?? settings.background_opacity,
    settings.opaque_fallback || !nativeTransparent,
    settings.appearance_mode,
    frostState === "applied",
  ) as CSSProperties;
  const focusTasks = displayTasks(byDate.get(selected) ?? []);
  const drag = useTaskDrag(
    focusTasks,
    selected,
    settings.active_view,
    Boolean(
      editing || quickDraft?.title.trim() || pending || loading || sortSaving,
    ),
    persistOrder,
    setNotice,
  );
  const agendaRange = agendaPreview ?? settings.agenda_range;
  const seven = agendaDays(selected, agendaRange);
  const monthGrid = monthDays(month);
  const monthKey = month.slice(0, 7);
  useEffect(() => {
    const grid = calendarGrid.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    return observeCalendar(grid, setPreviewLimit);
  }, [settings.active_view, monthKey, tasks, day_marks, loading, initialized]);
  const monthKnown = dayInfo(month).known;
  function dateBadges(date: string) {
    const info = dayInfo(date);
    const mark = day_marks.find((m) => m.date === date);
    return (
      <>
        {settings.show_holidays && info.holiday && (
          <span className="day-badge holiday" title={info.holiday}>
            休
          </span>
        )}
        {settings.show_holidays && info.workday && (
          <span className="day-badge workday" title="官方调休上班">
            班
          </span>
        )}
        {mark && (
          <span
            className="day-badge personal"
            title={
              mark.note ?? (mark.kind === "rest" ? "个人休息" : "个人加班")
            }
          >
            {mark.kind === "rest" ? "歇" : "加"}
          </span>
        )}
      </>
    );
  }
  return (
    <div
      className={`app-shell ${settings.animations_enabled ? "" : "no-motion"}`}
      data-appearance={settings.appearance_mode}
      data-text-size={textPreview ?? settings.text_size}
      data-header-layout={headerPreview ?? settings.header_layout}
      data-frost={frostState}
      style={style}
    >
      <div className="app-header">
        <header className="titlebar">
          <div className="brand">
            <span className="brand-icon">
              <Orbit size={26} />
            </span>
            <span>
              星轨日历<small>STARRY LIST</small>
            </span>
          </div>
          <div className="drag-space" data-tauri-drag-region />
          <div className="window-buttons">
            <button
              aria-label={settings.always_on_top ? "取消置顶" : "始终置顶"}
              title="始终置顶"
              aria-pressed={settings.always_on_top}
              className={settings.always_on_top ? "is-pinned" : ""}
              onClick={() =>
                void safe(() =>
                  saveSetting({ always_on_top: !settings.always_on_top }),
                )
              }
              disabled={loading || pending > 0}
            >
              <Pin size={15} />
            </button>
            <button
              aria-label="设置"
              onClick={() => void guard(() => setSettingsOpen(true))}
            >
              <SettingsIcon size={16} />
            </button>
            <span className="window-divider" />
            <button
              aria-label="最小化"
              onClick={() => void safe(() => windowAction("minimize"))}
            >
              <Minus size={17} />
            </button>
            <button
              className="window-close"
              aria-label="关闭应用"
              onClick={() => void safe(() => windowAction("close"))}
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="topbar">
          <div className="view-switch" role="group" aria-label="工作模式">
            <button
              className={settings.active_view === "overview" ? "active" : ""}
              aria-pressed={settings.active_view === "overview"}
              aria-label="统筹总览"
              title="统筹总览"
              onClick={() => changeView("overview")}
            >
              <CalendarDays size={16} />
              <span className="view-label">统筹总览</span>
            </button>
            <button
              className={settings.active_view === "focus" ? "active" : ""}
              aria-pressed={settings.active_view === "focus"}
              aria-label="专注编辑"
              title="专注编辑"
              onClick={() => changeView("focus")}
            >
              <ListTodo size={16} />
              <span className="view-label">专注编辑</span>
            </button>
          </div>
          <span className="topbar-caption">把日子，过成喜欢的样子。</span>
        </div>
      </div>
      {error && !settingsOpen && !backup && !deleteTarget && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={store.dismissError} aria-label="关闭错误提示">
            <X size={14} />
          </button>
        </div>
      )}
      {loading ? (
        <div className="loading">
          <Orbit className="loading-orbit" size={35} />
          <p>正在展开你的星轨…</p>
        </div>
      ) : !initialized ? (
        <div className="loading">
          <Orbit size={35} />
          <p>暂时无法读取本地数据，请检查上方错误提示。</p>
          <button className="primary" onClick={() => void store.load()}>
            重试连接
          </button>
        </div>
      ) : settings.active_view === "overview" ? (
        <main className="overview">
          <section className="calendar-panel" aria-label="月历">
            <div className="section-heading">
              <div>
                <span className="eyebrow">每一天，都有自己的光</span>
                <h1>
                  {pretty(month, "yyyy 年 M 月")}
                  <span className="month-english">
                    {pretty(month, "MMM").replace("月", "")} /{" "}
                    {month.slice(0, 4)}
                  </span>
                </h1>
              </div>
              <div className="nav-buttons">
                <button
                  aria-label="上个月"
                  onClick={() => setMonth((m) => shiftMonth(m, -1))}
                >
                  <ChevronLeft size={17} />
                </button>
                <button className="today-button" onClick={goToday}>
                  今天
                </button>
                <button
                  aria-label="下个月"
                  onClick={() => setMonth((m) => shiftMonth(m, 1))}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
            <div className="week-labels">
              {["一", "二", "三", "四", "五", "六", "日"].map((w, i) => (
                <span
                  key={w}
                  className={
                    i > 4 && settings.show_weekends ? "weekend-label" : ""
                  }
                >
                  {w}
                </span>
              ))}
            </div>
            <div
              ref={calendarGrid}
              className={`month-grid ${previewLimit === 0 ? "markers-only" : ""}`}
              style={{ "--weeks": monthGrid.length / 7 } as CSSProperties}
            >
              {monthGrid.map((date) => {
                const dayTasks = byDate.get(date) ?? [];
                const preview = previewTasks(dayTasks, previewLimit);
                const info = dayInfo(date);
                const outside = date.slice(0, 7) !== month.slice(0, 7);
                return (
                  <div
                    key={date}
                    className={`day-cell ${outside ? "outside" : ""} ${date === selected ? "selected" : ""} ${date === today ? "today" : ""} ${settings.show_weekends && info.weekend ? "weekend" : ""} ${settings.show_holidays && info.holiday ? "is-holiday" : ""} ${settings.show_holidays && info.workday ? "is-workday" : ""}`}
                  >
                    <button
                      className="date-select"
                      aria-label={`选择 ${date}`}
                      aria-description={`${dayTasks.length} 项任务`}
                      aria-pressed={date === selected}
                      onClick={() => select(date)}
                      onKeyDown={(e) => {
                        const delta = (
                          {
                            ArrowLeft: -1,
                            ArrowRight: 1,
                            ArrowUp: -7,
                            ArrowDown: 7,
                          } as Record<string, number>
                        )[e.key];
                        if (delta) {
                          e.preventDefault();
                          const next = shiftDay(date, delta);
                          select(next);
                          setTimeout(
                            () =>
                              document
                                .querySelector<HTMLButtonElement>(
                                  `[aria-label="选择 ${next}"]`,
                                )
                                ?.focus(),
                            0,
                          );
                        }
                      }}
                    >
                      <span className="date-number">
                        {Number(date.slice(-2))}
                      </span>
                      <span className="day-badges">
                        {dateBadges(date)}
                        {preview.more > 0 && (
                          <span
                            className="calendar-extra"
                            title={`还有 ${preview.more} 项任务`}
                          >
                            +{preview.more}
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="calendar-previews">
                      {preview.visible.map((task) => (
                        <button
                          key={task.id}
                          className={`calendar-task ${task.completed ? "done" : ""}`}
                          onClick={() => openTask(task)}
                          title={task.title}
                        >
                          <Priority value={task.priority} />
                          <span>{taskLabel(task)}</span>
                        </button>
                      ))}
                    </div>
                    {dayTasks.length > 0 && (
                      <button
                        className="compact-tasks"
                        onClick={() => select(date)}
                        aria-label={`${date} ${dayTasks.length} 项任务`}
                      >
                        <span
                          className={
                            dayTasks.some((t) => !t.completed && t.priority > 0)
                              ? "important-dot"
                              : "task-dot"
                          }
                        />
                        <span className="task-total">{dayTasks.length}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="calendar-bottom">
              <span className="legend-today" />
              今天
              <span className="legend-selected" />
              选中日期
              <span className="legend-star" />
              <span>重要任务</span>
            </div>
            {!monthKnown && settings.show_holidays && (
              <p className="year-notice">
                {month.slice(0, 4)} 年官方安排尚未录入，仅显示普通周末。
              </p>
            )}
            <div className="day-mark-control">
              <span>{pretty(selected, "M 月 d 日")} · 个人标记</span>
              <select
                aria-label="个人日期标记"
                value={day_marks.find((m) => m.date === selected)?.kind ?? ""}
                disabled={pending > 0}
                onChange={(e) =>
                  void safe(() =>
                    store.mark(
                      selected,
                      e.target.value
                        ? {
                            date: selected,
                            kind: e.target.value as "rest" | "overtime",
                            note: null,
                          }
                        : null,
                    ),
                  )
                }
              >
                <option value="">无</option>
                <option value="rest">个人休息</option>
                <option value="overtime">个人加班</option>
              </select>
            </div>
          </section>
          <section className="agenda-panel" aria-label="七天日程">
            <div className="agenda-heading">
              <h2
                aria-label={agendaRange === "week" ? "本周日程" : "接下来七天"}
              >
                <select
                  className="agenda-range-select"
                  aria-label="日程范围"
                  aria-describedby="agenda-range-description"
                  aria-busy={agendaSaving}
                  value={agendaRange}
                  disabled={agendaSaving}
                  title="本周显示选中日期所在的周一至周日"
                  onChange={(e) =>
                    changeAgendaRange(e.target.value as AgendaRange)
                  }
                >
                  <option value="rolling">接下来七天</option>
                  <option value="week">本周</option>
                </select>
              </h2>
              <div className="nav-buttons">
                <button
                  aria-label="上一周"
                  title={agendaRange === "week" ? "上一自然周" : "向前七天"}
                  onClick={() => select(shiftDay(selected, -7))}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  aria-label="七天日程回到今天"
                  title="回到今天"
                  onClick={goToday}
                >
                  <CalendarDays size={15} />
                </button>
                <button
                  aria-label="下一周"
                  title={agendaRange === "week" ? "下一自然周" : "向后七天"}
                  onClick={() => select(shiftDay(selected, 7))}
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  className="agenda-add"
                  data-quick-add-trigger
                  aria-label="新增任务"
                  title="为选中日期新增任务"
                  onClick={() => startAdding(selected)}
                >
                  <Plus size={14} />
                  <span>新增</span>
                </button>
              </div>
              <span
                id="agenda-range-description"
                className="range-label agenda-range-description"
                aria-live="polite"
              >
                {agendaRange === "week" ? "选中日期所在周 · " : ""}
                {pretty(seven[0], "yyyy.M.d")} — {pretty(seven[6], "yyyy.M.d")}
              </span>
              <span className="visually-hidden" role="status">
                {agendaSaving ? "正在保存日程范围…" : ""}
              </span>
            </div>
            <div className="agenda-scroll">
              {seven.map((date) => {
                const list = displayTasks(byDate.get(date) ?? []);
                return (
                  <div
                    key={date}
                    className={`agenda-day ${list.length === 0 && quickDraft?.date !== date ? "agenda-empty-day" : ""} ${date === today ? "agenda-today" : ""}`}
                  >
                    <div className="agenda-date">
                      <button onClick={() => select(date)}>
                        <span>{pretty(date, "M 月 d 日")}</span>
                        <small>
                          {date === today ? "今天" : pretty(date, "EEEE")}
                        </small>
                      </button>
                      <span className="day-badges">{dateBadges(date)}</span>
                      <span className="task-count">
                        {list.filter((t) => !t.completed).length}{" "}
                        {list.length ? "项待办" : "项"}
                      </span>
                      <button
                        className="agenda-day-add"
                        ref={(button) => {
                          if (button) dayAddButtons.current.set(date, button);
                          else dayAddButtons.current.delete(date);
                        }}
                        data-quick-add-trigger
                        aria-label={`为 ${date} 添加任务`}
                        title="添加任务"
                        aria-expanded={quickDraft?.date === date}
                        aria-controls={`agenda-input-${date}`}
                        onClick={() => startAdding(date)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    {list.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        categories={categories}
                        onQuickEdit={() =>
                          void guard(() => setInlineId(task.id))
                        }
                        inlineEditor={
                          inlineId === task.id ? (
                            <InlineTitleEditor
                              ref={inline}
                              task={task}
                              onClose={() => setInlineId(null)}
                            />
                          ) : undefined
                        }
                        onOpen={() => openTask(task)}
                        onEdit={() => editTask(task)}
                        onDelete={() => requestDelete(task.id)}
                      />
                    ))}
                    {quickDraft?.date === date && (
                      <div id={`agenda-input-${date}`}>
                        {quickInput(date, true)}
                      </div>
                    )}
                    {list.length > 0 && <Progress tasks={list} />}
                  </div>
                );
              })}
              {seven.every((date) => !byDate.get(date)?.length) && (
                <p className="agenda-empty-hint">
                  {agendaRange === "week" ? "这一周" : "这七天"}
                  还没有任务，点日期旁的加号开始安排。
                </p>
              )}
            </div>
            {settings.show_holidays &&
              seven.some((date) => !dayInfo(date).known) && (
                <p className="year-notice agenda-year-notice">
                  部分日期尚未录入该年份官方节假日安排。
                </p>
              )}
          </section>
        </main>
      ) : (
        <main className="focus">
          <div className="focus-heading">
            <div>
              <span className="eyebrow">专注此刻的小小进展</span>
              <h1>
                {pretty(selected, "M 月 d 日")}
                <small>
                  {selected === today ? "今天" : pretty(selected, "EEEE")}
                </small>
                {dateBadges(selected)}
              </h1>
            </div>
            <div className="nav-buttons">
              <button
                aria-label="前一天"
                onClick={() => select(shiftDay(selected, -1))}
              >
                <ChevronLeft size={18} />
              </button>
              <button className="today-button" onClick={goToday}>
                今天
              </button>
              <button
                aria-label="后一天"
                onClick={() => select(shiftDay(selected, 1))}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <nav className="focus-week" aria-label="七天日期导航">
            {weekDays(shiftDay(selected, -3)).map((date) => (
              <button
                key={date}
                className={`${date === selected ? "active" : ""} ${date === today ? "is-today" : ""}`}
                aria-label={`专注 ${date}`}
                aria-current={date === selected ? "date" : undefined}
                onClick={() => select(date)}
              >
                <span>{pretty(date, "EEE")}</span>
                <strong>{Number(date.slice(-2))}</strong>
                <i className={byDate.has(date) ? "has-tasks" : ""} />
              </button>
            ))}
          </nav>
          <div className="focus-list-heading">
            <h2>
              当日清单 <span>{focusTasks.length}</span>
            </h2>
            <Progress tasks={focusTasks} />
          </div>
          <div className="focus-scroll">
            {focusTasks.length === 0 && <Empty />}
            {focusTasks.map((task, index) => (
              <div
                key={task.id}
                id={`task-${task.id}`}
                className={`${expanded === task.id ? "expanded-task" : ""} ${drag.source === task.id ? "task-dragging" : ""} ${drag.over?.id === task.id ? (drag.over.after ? "drop-after" : "drop-before") : ""}`}
                onDragOver={(e) => drag.overTask(e, task)}
                onDrop={(e) => drag.drop(e, task)}
              >
                <TaskRow
                  task={task}
                  categories={categories}
                  onOpen={() =>
                    void guard(() =>
                      setExpanded(expanded === task.id ? null : task.id),
                    )
                  }
                  order={{
                    first:
                      index === 0 ||
                      focusTasks[index - 1].completed !== task.completed,
                    last:
                      index === focusTasks.length - 1 ||
                      focusTasks[index + 1].completed !== task.completed,
                  }}
                  dragHandle={
                    <button
                      type="button"
                      className="task-drag-handle"
                      draggable={!sortSaving}
                      aria-label={`拖动排序 ${task.title}`}
                      title="拖动到同一完成状态组内；也可使用上下箭头"
                      onDragStart={(e) => drag.start(e, task)}
                      onDragEnd={drag.cancel}
                      onClick={() =>
                        setNotice(
                          "拖动把手可排序；键盘请使用任务旁的上移、下移按钮。",
                        )
                      }
                    >
                      <GripVertical size={14} />
                    </button>
                  }
                  onMove={(delta) => moveTask(task, delta)}
                  actionMode="delete"
                  onEdit={() => editTask(task)}
                  onDelete={() => requestDelete(task.id)}
                />
                {expanded === task.id && (
                  <TaskReader
                    task={task}
                    categories={categories}
                    onEdit={() => editTask(task)}
                    onClose={() => setExpanded(null)}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="focus-composer">{quickInput(selected)}</div>
        </main>
      )}
      <footer className="app-footer">
        <span>
          <ShieldCheck size={12} />
          {pending
            ? "正在保存…"
            : !initialized
              ? "等待本地数据库"
              : error
                ? "请查看错误提示"
                : "本地保存 · 安心离线"}
        </span>
        <span>
          Starry List <i>✦</i> 1.0.0
        </span>
        <button
          className="resize-grip"
          aria-label="调整窗口大小"
          onMouseDown={(e) => {
            e.preventDefault();
            void safe(() => windowAction("resize"));
          }}
        >
          <Grip size={13} />
        </button>
      </footer>
      {editing && tasks.find((t) => t.id === editing) && (
        <TaskEditor
          key={editing}
          ref={editor}
          task={tasks.find((t) => t.id === editing)!}
          categories={categories}
          onDelete={setDeleteTarget}
          onClose={() => closeEditor()}
          onSaved={() => {
            closeEditor(true);
            setNotice("修改已保存");
          }}
        />
      )}
      <div className="resize-edges" aria-hidden="true">
        {(
          [
            "North",
            "NorthEast",
            "East",
            "SouthEast",
            "South",
            "SouthWest",
            "West",
            "NorthWest",
          ] as const
        ).map((direction) => (
          <div
            key={direction}
            className={`resize-edge resize-${direction}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              void safe(() => resizeWindow(direction));
            }}
          />
        ))}
      </div>
      <NotificationRail
        count={undos.length + (notice ? 1 : 0)}
        suspended={Boolean(editing || deleteTarget || settingsOpen || backup)}
      >
        {undos.map((entry) => (
          <UndoToast
            key={entry.id}
            entry={entry}
            suspended={Boolean(
              editing || deleteTarget || settingsOpen || backup,
            )}
            onClose={() => closeUndo(entry.id)}
            onUndo={async () => {
              if (entry.kind === "deleted") {
                await store.restore(entry.task);
                setNotice("任务已恢复");
              } else {
                await store.remove(entry.task.id);
                setNotice("已撤销新增");
              }
            }}
          />
        ))}
        {notice && (
          <StatusToast
            key={notice}
            text={notice}
            onClose={() => setNotice("")}
            suspended={Boolean(
              editing || deleteTarget || settingsOpen || backup,
            )}
          />
        )}
      </NotificationRail>
      {deleteTarget && (
        <Dialog
          title="删除这件任务？"
          error={error}
          onClose={() => setDeleteTarget(null)}
        >
          <p className="dialog-copy">
            “{deleteTarget.title}”<br />
            删除后可以通过顶部通知撤销。
          </p>
          <div className="dialog-actions">
            <button onClick={() => setDeleteTarget(null)}>保留</button>
            <button
              className="danger"
              disabled={pending > 0}
              onClick={() =>
                void safe(async () => {
                  const removed = store
                    .getSnapshot()
                    .data.tasks.find((task) => task.id === deleteTarget.id);
                  if (!removed) {
                    setDeleteTarget(null);
                    return;
                  }
                  await store.remove(deleteTarget.id);
                  addUndo(removed, "deleted");
                  setDeleteTarget(null);
                  setExpanded(null);
                  setEditing(null);
                })
              }
            >
              删除任务
            </button>
          </div>
        </Dialog>
      )}
      {settingsOpen && !backup && (
        <Dialog
          title="让星轨更适合你"
          error={error}
          onClose={() => {
            if (fileBusy || importing) return;
            setSettingsOpen(false);
            if (opacity !== null) {
              void safe(() =>
                saveSetting({ background_opacity: opacity }),
              ).finally(() => setOpacity(null));
            }
          }}
        >
          <div className="settings-content">
            <fieldset
              className="appearance-setting"
              disabled={headerSaving || pending > 0}
            >
              <legend>顶部布局</legend>
              <div className="appearance-options">
                {(
                  [
                    [
                      "classic",
                      "经典顶部（默认）",
                      "舒展双行，保留工作模式文字",
                    ],
                    [
                      "compact",
                      "紧凑顶部",
                      "单行图标导航，为日历和任务留出空间",
                    ],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="header-layout"
                      value={value}
                      checked={
                        (headerPreview ?? settings.header_layout) === value
                      }
                      onChange={() => {
                        if (headerSave.current) return;
                        headerSave.current = true;
                        setHeaderPreview(value);
                        setHeaderSaving(true);
                        void safe(() =>
                          saveSetting({ header_layout: value }),
                        ).finally(() => {
                          setHeaderPreview(null);
                          setHeaderSaving(false);
                          headerSave.current = false;
                        });
                      }}
                    />
                    <span>
                      {label}
                      <small>{hint}</small>
                    </span>
                  </label>
                ))}
              </div>
              <p>即时预览，重启后保留；不影响字号与外观。</p>
              <p className="text-size-status" role="status" aria-live="polite">
                {headerSaving ? "正在保存顶部布局…" : ""}
              </p>
            </fieldset>
            <fieldset
              className="text-size-setting"
              disabled={textSaving || pending > 0}
            >
              <legend>文字大小</legend>
              <div className="text-size-options">
                {(
                  [
                    ["small", "小"],
                    ["standard", "标准（默认）"],
                    ["large", "大"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="text-size"
                      value={value}
                      checked={(textPreview ?? settings.text_size) === value}
                      onChange={() => {
                        if (textSave.current) return;
                        textSave.current = true;
                        setTextPreview(value);
                        setTextSaving(true);
                        void safe(() =>
                          saveSetting({ text_size: value }),
                        ).finally(() => {
                          setTextPreview(null);
                          setTextSaving(false);
                          textSave.current = false;
                        });
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p>按阅读习惯选择，日历预览保持紧凑。即时预览，重启后保留。</p>
              <p className="text-size-status" role="status" aria-live="polite">
                {textSaving ? "正在保存文字大小…" : ""}
              </p>
            </fieldset>
            <div className="setting-opacity">
              <fieldset className="appearance-setting" disabled={pending > 0}>
                <legend>外观模式</legend>
                <div className="appearance-options">
                  {(
                    [
                      ["reading", "阅读优先", "稳定奶油衬底，适合长时间阅读"],
                      ["glass", "轻玻璃", "通透清亮，任务保留局部衬底"],
                      ["frosted", "梦幻毛玻璃", "柔紫星光，系统支持时模糊桌面"],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="appearance"
                        value={value}
                        checked={settings.appearance_mode === value}
                        onChange={() => {
                          void safe(() =>
                            saveSetting({
                              appearance_mode: value as Appearance,
                            }),
                          );
                        }}
                      />
                      <span>
                        {label}
                        <small>{hint}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <p>
                  外观决定材质，下面的滑块调整通透程度。文字和输入保持清晰。
                </p>
                {settings.appearance_mode === "frosted" && (
                  <p className="material-hint">
                    {!nativeTransparent || settings.opaque_fallback
                      ? "实色回退保留柔紫配色，关闭桌面模糊与透视。"
                      : (opacity ?? settings.background_opacity) === 1
                        ? "100% 使用实色材质，关闭桌面模糊。"
                        : frostState === "applied"
                          ? "已启用稳定毛玻璃；Windows 透明效果、电源与硬件策略仍可能影响材质。"
                          : frostState === "pending"
                            ? "正在应用材质，阅读衬底保持保护。"
                            : "本机未启用原生毛玻璃，已使用更清晰的柔紫玻璃衬底。"}
                  </p>
                )}
              </fieldset>
              <label htmlFor="opacity">
                背景不透明度{" "}
                <strong>
                  {Math.round(
                    (nativeTransparent
                      ? (opacity ?? settings.background_opacity)
                      : 1) * 100,
                  )}
                  %
                </strong>
              </label>
              <input
                id="opacity"
                type="range"
                min="40"
                max="100"
                value={Math.round(
                  (opacity ?? settings.background_opacity) * 100,
                )}
                disabled={settings.opaque_fallback || !nativeTransparent}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                onPointerUp={(e) => {
                  const value = Number(e.currentTarget.value) / 100;
                  void safe(() =>
                    saveSetting({ background_opacity: value }),
                  ).finally(() => setOpacity(null));
                }}
                onKeyUp={(e) => {
                  const value = Number(e.currentTarget.value) / 100;
                  void safe(() =>
                    saveSetting({ background_opacity: value }),
                  ).finally(() => setOpacity(null));
                }}
              />
              <p>
                {nativeTransparent
                  ? "外壳随透明度融入桌面，阅读区保留稳定衬底。"
                  : "此版本使用原生不透明窗口，背景不会透视桌面。"}
              </p>
            </div>
            {(
              [
                ["always_on_top", "始终置顶", "让日历留在其他窗口上方"],
                ["animations_enabled", "柔和动画", "完成与展开时的小小反馈"],
                [
                  "show_holidays",
                  "官方节假日",
                  "内置 2026 年中国大陆假期与补班",
                ],
                ["show_weekends", "周末底色", "给普通周末一点温柔的区别"],
                [
                  "opaque_fallback",
                  "实色背景回退",
                  "透明显示异常时，使用完全不透明背景",
                ],
              ] as const
            ).map(([key, label, hint]) => (
              <label className="setting-row" key={key}>
                <span>
                  {label}
                  <small>{hint}</small>
                </span>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={settings[key]}
                  disabled={pending > 0}
                  onChange={(e) =>
                    void safe(() => saveSetting({ [key]: e.target.checked }))
                  }
                />
              </label>
            ))}
            <div className="backup-section">
              <h3>数据备份</h3>
              <p>一份属于你的 JSON。导入默认合并，不覆盖已有任务。</p>
              <div className="backup-buttons">
                <button
                  disabled={fileBusy || pending > 0}
                  onClick={() =>
                    void safe(async () => {
                      setFileBusy(true);
                      try {
                        if (await repository.exportBackup())
                          setNotice("备份已导出");
                      } finally {
                        setFileBusy(false);
                      }
                    })
                  }
                >
                  <Download size={15} />
                  导出 JSON
                </button>
                <button
                  disabled={fileBusy || pending > 0}
                  onClick={() =>
                    void safe(async () => {
                      setFileBusy(true);
                      try {
                        const b = await repository.readBackup();
                        if (b) {
                          setBackup(b);
                          setReplace(false);
                          setReplaceWord("");
                        }
                      } finally {
                        setFileBusy(false);
                      }
                    })
                  }
                >
                  <Upload size={15} />
                  导入 JSON
                </button>
              </div>
            </div>
            <div className="about">
              <Orbit size={27} />
              <div>
                <strong>星轨日历 · Starry List</strong>
                <span>版本 1.0.0 · MIT 开源</span>
                <p>
                  美观，舒适，方便。无需账号，无联网请求。
                  <br />
                  数据存储于系统应用数据目录，请定期导出备份。
                </p>
              </div>
            </div>
          </div>
        </Dialog>
      )}
      {backup && (
        <Dialog
          title="确认导入备份"
          error={error}
          onClose={() => {
            if (!importing) setBackup(null);
          }}
        >
          <p className="dialog-copy">
            已校验 V{backup.version} 备份：{backup.tasks.length} 项任务，
            {backup.categories.length} 个分类，{backup.day_marks.length}{" "}
            个个人标记。
          </p>
          <label className="import-choice">
            <input
              type="checkbox"
              checked={replace}
              disabled={importing}
              onChange={(e) => setReplace(e.target.checked)}
            />
            覆盖现有全部数据与设置
          </label>
          <p className="dialog-copy">
            {replace
              ? "覆盖会删除当前任务、分类及日期标记，请先导出备份。"
              : "合并保留已有记录。相同任务 ID 将生成新 ID；相同日期的个人标记保留现有值。设置不变。"}
          </p>
          {replace && (
            <label className="field">
              输入“覆盖”确认
              <input
                value={replaceWord}
                onChange={(e) => setReplaceWord(e.target.value)}
                disabled={importing}
              />
            </label>
          )}
          <div className="dialog-actions">
            <button disabled={importing} onClick={() => setBackup(null)}>
              取消
            </button>
            <button
              className={replace ? "danger" : "primary"}
              disabled={importing || (replace && replaceWord !== "覆盖")}
              onClick={() =>
                void safe(async () => {
                  setImporting(true);
                  setEditing(null);
                  setExpanded(null);
                  setUndos([]);
                  try {
                    await store.importBackup(backup, replace);
                    await setTop(
                      store.getSnapshot().data.settings.always_on_top,
                    );
                    setBackup(null);
                    setNotice("备份已完整导入");
                  } finally {
                    setImporting(false);
                  }
                })
              }
            >
              {importing ? "正在导入…" : replace ? "确认覆盖" : "合并导入"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
