import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useId,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Crown,
  Star,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Save,
  X,
  Circle,
  Orbit,
  Sparkles,
  PencilLine,
  Ellipsis,
} from "lucide-react";
import { taskSchema, type Category, type Task, dayProgress } from "./domain";
import { store } from "./store";
export function Priority({ value }: { value: number }) {
  return value === 2 ? (
    <Crown size={15} className="priority crown" aria-label="非常重要" />
  ) : value === 1 ? (
    <Star size={14} className="priority star" aria-label="重要" />
  ) : null;
}
export function Progress({ tasks }: { tasks: Task[] }) {
  const { done, total } = dayProgress(tasks);
  return (
    <div
      className={`progress ${total > 0 && done === total ? "all-done" : ""}`}
    >
      <span>
        {total > 0 && done === total ? <Sparkles size={13} /> : null}
        {done} / {total} 已完成
      </span>
      <div className="progress-track">
        <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}
export function Empty({ small = false }: { small?: boolean }) {
  return (
    <div className={`empty ${small ? "small" : ""}`}>
      <div className="empty-orbit">
        <Orbit size={small ? 24 : 42} />
        <Star size={10} />
      </div>
      <span>{small ? "留一点空白给自己" : "今天的轨道，由你安排"}</span>
      {!small && <p>写下第一件小事，让计划轻轻落地。</p>}
    </div>
  );
}
export interface QuickAddHandle {
  save(): Promise<boolean>;
  isComposing(): boolean;
  isSaving(): boolean;
}
export const QuickAdd = forwardRef<
  QuickAddHandle,
  {
    date: string;
    autoFocus?: boolean;
    onAdded?: () => void;
    onCancel?: () => void;
    title: string;
    onTitleChange: (value: string) => void;
    confirmCancel?: boolean;
    onContinue?: () => void;
    onDiscard?: () => void;
    onOutside?: () => void;
  }
>(function QuickAdd(
  {
    date,
    autoFocus = false,
    onAdded,
    onCancel,
    title,
    onTitleChange,
    confirmCancel = false,
    onContinue,
    onDiscard,
    onOutside,
  },
  handle,
) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    function outside(e: PointerEvent) {
      const target = e.target as Element;
      if (
        !saving.current &&
        !composing.current &&
        !root.current?.contains(target) &&
        !target.closest?.("[data-quick-add-trigger]")
      )
        onOutside?.();
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onOutside]);
  async function save() {
    if (composing.current) return false;
    if (saving.current) return saving.current;
    if (!title.trim()) return true;
    setBusy(true);
    const now = new Date().toISOString();
    const tasks = store.getSnapshot().data.tasks.filter((t) => t.date === date);
    const operation = store
      .add({
        id: crypto.randomUUID(),
        date,
        title: title.trim(),
        short_label: null,
        description: null,
        completed: false,
        priority: 0,
        category_id: null,
        sort_order: Math.max(-1, ...tasks.map((t) => t.sort_order)) + 1,
        created_at: now,
        updated_at: now,
      })
      .then(() => {
        onTitleChange("");
        if (onAdded) onAdded();
        else ref.current?.focus();
        return true;
      })
      .catch(() => false)
      .finally(() => {
        saving.current = null;
        setBusy(false);
      });
    saving.current = operation;
    return operation;
  }
  useImperativeHandle(handle, () => ({
    save,
    isComposing: () => composing.current,
    isSaving: () => saving.current !== null,
  }));
  return (
    <div ref={root} className="quick-add-area">
      <form
        className="quick-add"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Plus size={15} />
        <input
          ref={ref}
          autoFocus={autoFocus}
          value={title}
          maxLength={500}
          onChange={(e) => onTitleChange(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            if (
              e.nativeEvent.isComposing ||
              composing.current ||
              e.keyCode === 229
            ) {
              if (e.key === "Enter" || e.key === "Escape") e.preventDefault();
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onCancel?.();
            }
          }}
          placeholder="添加一件小事…"
          aria-label={`${date} 新任务标题`}
          disabled={busy}
        />
        {title && (
          <button
            type="submit"
            disabled={busy || !title.trim()}
            aria-label={`添加到 ${date}`}
          >
            {busy ? "保存中" : "添加"}
          </button>
        )}
        <button
          type="button"
          className="quick-cancel"
          aria-label="取消快速新增"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={14} />
        </button>
      </form>
      {confirmCancel && (
        <div
          className="quick-draft-prompt"
          role="group"
          aria-label="处理未添加的任务"
        >
          <span>要放弃这条尚未添加的任务吗？</span>
          <div>
            <button type="button" onClick={onContinue} disabled={busy}>
              继续填写
            </button>
            <button
              type="button"
              className="danger subtle"
              onClick={onDiscard}
              disabled={busy}
            >
              放弃草稿
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
export function TaskRow({
  task,
  categories,
  onOpen,
  order,
  onMove,
  onEdit,
  onDelete,
  actionMode = "menu",
}: {
  task: Task;
  categories: Category[];
  onOpen: () => void;
  order?: { first: boolean; last: boolean };
  onMove?: (delta: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  actionMode?: "menu" | "delete";
}) {
  const [busy, setBusy] = useState(false);
  const category = categories.find((c) => c.id === task.category_id);
  return (
    <div className={`task-row ${task.completed ? "completed" : ""}`}>
      <button
        className="check-button"
        aria-label={
          task.completed ? `取消完成 ${task.title}` : `完成 ${task.title}`
        }
        aria-pressed={task.completed}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await store.patchTask(task.id, (t) => ({
              completed: !t.completed,
            }));
          } catch {
            /* store exposes error */
          } finally {
            setBusy(false);
          }
        }}
      >
        {task.completed ? <Check size={13} /> : <Circle size={17} />}
      </button>
      <button className="task-open" onClick={onOpen} title={task.title}>
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          <Priority value={task.priority} />
          {category && (
            <span className="category-label" style={{ color: category.color }}>
              {category.name}
            </span>
          )}
        </span>
      </button>
      {order && (
        <div className="order-buttons">
          <button
            aria-label={`上移 ${task.title}`}
            disabled={order.first || busy}
            onClick={() => onMove?.(-1)}
          >
            <ArrowUp size={13} />
          </button>
          <button
            aria-label={`下移 ${task.title}`}
            disabled={order.last || busy}
            onClick={() => onMove?.(1)}
          >
            <ArrowDown size={13} />
          </button>
        </div>
      )}
      {actionMode === "delete" ? (
        <button
          className="task-delete-trigger"
          aria-label="删除任务"
          aria-description={task.title}
          title={`删除 ${task.title}`}
          onClick={onDelete}
        >
          <Trash2 size={15} />
        </button>
      ) : (
        <TaskActions task={task} onEdit={onEdit} onDelete={onDelete} />
      )}
    </div>
  );
}
function TaskActions({
  task,
  onEdit,
  onDelete,
}: {
  task: Task;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  function close(restore = true) {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    const width = menu.current!.offsetWidth || 176;
    const height = menu.current!.offsetHeight || 100;
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.right - width, window.innerWidth - width - 8),
      ),
      top: Math.max(
        8,
        rect.bottom + height + 8 <= window.innerHeight
          ? rect.bottom + 5
          : rect.top - height - 5,
      ),
    });
    menu.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function outside(e: PointerEvent) {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        close(false);
    }
    function reposition(e: Event) {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight) {
        close(false);
        return;
      }
      const width = menu.current?.offsetWidth || 176;
      const height = menu.current?.offsetHeight || 100;
      setPosition({
        left: Math.max(
          8,
          Math.min(rect.right - width, window.innerWidth - width - 8),
        ),
        top: Math.max(
          8,
          rect.bottom + height + 8 <= window.innerHeight
            ? rect.bottom + 5
            : rect.top - height - 5,
        ),
      });
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="task-actions-trigger"
        aria-label={`任务操作 ${task.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="任务操作"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Ellipsis size={17} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            className="task-actions-menu"
            role="menu"
            aria-label={`${task.title} 操作菜单`}
            style={position}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              } else if (e.key === "Tab") {
                e.preventDefault();
                const buttons = Array.from(
                  document.querySelectorAll<HTMLElement>(
                    'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
                  ),
                ).filter(
                  (el) =>
                    !menu.current?.contains(el) &&
                    el.getClientRects().length > 0,
                );
                const index = buttons.indexOf(trigger.current!);
                close(false);
                buttons[index + (e.shiftKey ? -1 : 1)]?.focus();
              } else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
              ) {
                e.preventDefault();
                const buttons = Array.from(
                  menu.current!.querySelectorAll("button"),
                );
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                buttons[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length
                ]?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                close();
                onEdit();
              }}
            >
              <PencilLine size={15} />
              编辑任务
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                close();
                onDelete();
              }}
            >
              <Trash2 size={15} />
              删除任务
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
export function TaskReader({
  task,
  categories,
  onEdit,
  onClose,
}: {
  task: Task;
  categories: Category[];
  onEdit: () => void;
  onClose: () => void;
}) {
  const category = categories.find((c) => c.id === task.category_id);
  return (
    <section className="task-reader" aria-label="任务详情阅读">
      <div className="reader-heading">
        <h3>{task.title}</h3>
        <button className="reader-edit" onClick={onEdit}>
          <PencilLine size={14} />
          编辑
        </button>
        <button aria-label="收起任务详情" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="reader-meta">
        <span>{task.date}</span>
        {category && (
          <span className="category-label" style={{ color: category.color }}>
            {category.name}
          </span>
        )}
        <span>
          <Priority value={task.priority} />
          {["普通", "重要", "非常重要"][task.priority]}
        </span>
      </div>
      {task.description && (
        <div
          className="reader-description"
          role="region"
          aria-label="详细计划（只读）"
          tabIndex={0}
        >
          {task.description}
        </div>
      )}
    </section>
  );
}
export interface EditorHandle {
  save(): Promise<boolean>;
  isDirty(): boolean;
}
export const TaskEditor = forwardRef<
  EditorHandle,
  {
    task: Task;
    categories: Category[];
    onDelete: (task: Task) => void;
    onClose: () => void;
    onSaved: () => void;
  }
>(function TaskEditor({ task, categories, onDelete, onClose, onSaved }, ref) {
  const [draft, setDraft] = useState(task);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(340, Math.max(156, el.scrollHeight + 2))}px`;
  }, [draft.description]);
  const dirty = [
    "title",
    "description",
    "short_label",
    "date",
    "priority",
    "category_id",
  ].some((k) => draft[k as keyof Task] !== task[k as keyof Task]);
  const saving = useRef<Promise<boolean> | null>(null);
  async function saveDraft() {
    if (saving.current) return saving.current;
    if (!dirty) return true;
    const result = taskSchema.safeParse(draft);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return false;
    }
    setBusy(true);
    setError(null);
    const operation = store
      .patchTask(task.id, {
        title: draft.title.trim(),
        description: draft.description,
        short_label: draft.short_label?.trim() || null,
        date: draft.date,
        priority: draft.priority,
        category_id: draft.category_id,
      })
      .then(() => true)
      .catch(() => {
        setError("保存失败，你的输入仍保留在这里。");
        return false;
      })
      .finally(() => {
        setBusy(false);
        saving.current = null;
      });
    saving.current = operation;
    return operation;
  }
  useImperativeHandle(ref, () => ({ save: saveDraft, isDirty: () => dirty }));
  async function finish() {
    if (await saveDraft()) onSaved();
  }
  function requestCancel() {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }
  function patch(p: Partial<Task>) {
    setDraft((d) => ({ ...d, ...p }));
  }
  return (
    <>
      <Dialog
        title="编辑任务"
        className="drawer-dialog"
        onClose={requestCancel}
      >
        <section
          className="editor"
          aria-label="任务详情编辑"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void finish();
            }
          }}
        >
          <div className="editor-scroll">
            <p className="save-status" role="status">
              {busy
                ? "保存中…"
                : dirty
                  ? "未保存 · 切换时自动保存"
                  : "已保存到本机"}
            </p>
            <label className="field">
              任务标题
              <input
                autoFocus
                value={draft.title}
                maxLength={500}
                onChange={(e) => patch({ title: e.target.value })}
                disabled={busy}
              />
            </label>
            <label className="field">
              详细计划
              <textarea
                ref={descriptionRef}
                value={draft.description ?? ""}
                maxLength={100000}
                placeholder={
                  "想法、步骤、会议准备…\n在这里慢慢写，不必急着完成。"
                }
                onChange={(e) => patch({ description: e.target.value || null })}
                disabled={busy}
              />
            </label>
            <div className="editor-options">
              <label className="field">
                任务日期
                <input
                  type="date"
                  min="1900-01-01"
                  max="9999-12-31"
                  value={draft.date}
                  onChange={(e) => patch({ date: e.target.value })}
                  disabled={busy}
                />
              </label>
              <fieldset>
                <legend>重要程度</legend>
                <div className="pills">
                  {([0, 1, 2] as const).map((p) => (
                    <button
                      key={p}
                      aria-label={["普通", "重要", "非常重要"][p]}
                      aria-pressed={draft.priority === p}
                      className={draft.priority === p ? "selected" : ""}
                      onClick={() => patch({ priority: p })}
                      disabled={busy}
                    >
                      <Priority value={p} />
                      {["普通", "重要", "非常重要"][p]}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            <fieldset>
              <legend>
                分类 <span className="optional">可选</span>
              </legend>
              <div className="pills">
                <button
                  className={draft.category_id === null ? "selected" : ""}
                  aria-pressed={draft.category_id === null}
                  onClick={() => patch({ category_id: null })}
                  disabled={busy}
                >
                  不选择
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    className={draft.category_id === c.id ? "selected" : ""}
                    aria-pressed={draft.category_id === c.id}
                    onClick={() => patch({ category_id: c.id })}
                    disabled={busy}
                  >
                    <i style={{ background: c.color }} />
                    {c.name}
                  </button>
                ))}
              </div>
            </fieldset>
            <details className="advanced">
              <summary>更多选项</summary>
              <label className="field">
                日历简称 <span className="optional">留空时显示原标题</span>
                <input
                  value={draft.short_label ?? ""}
                  maxLength={100}
                  placeholder="例如：AI 调研"
                  onChange={(e) =>
                    patch({ short_label: e.target.value || null })
                  }
                  disabled={busy}
                />
              </label>
            </details>
            <button
              className="danger subtle editor-delete"
              onClick={() => onDelete(task)}
              disabled={busy}
            >
              <Trash2 size={14} />
              删除任务
            </button>
          </div>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="editor-footer">
            <span className="key-hint">Ctrl + Enter 保存</span>
            <button onClick={requestCancel} disabled={busy}>
              取消
            </button>
            <button
              className="primary"
              onClick={() => void finish()}
              disabled={busy}
            >
              <Save size={14} />
              {busy ? "保存中…" : "保存并收起"}
            </button>
          </div>
        </section>
      </Dialog>
      {confirmDiscard && (
        <Dialog title="保留这次修改？" onClose={() => setConfirmDiscard(false)}>
          <p className="dialog-copy">
            还有未保存的修改。你可以继续编辑、保存后收起，或明确放弃这次修改。
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setConfirmDiscard(false)}>
              继续编辑
            </button>
            <button className="danger subtle" disabled={busy} onClick={onClose}>
              放弃修改
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void finish()}
            >
              保存并收起
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
});
export function Dialog({
  title,
  children,
  onClose,
  error,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  error?: string | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    (
      el.querySelector<HTMLElement>(".editor input") ??
      el.querySelector<HTMLElement>("button,input,select")
    )?.focus();
    function key(e: KeyboardEvent) {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) !== el
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
      if (e.key === "Tab") {
        const nodes = [
          ...el.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,textarea,a,[tabindex="0"]',
          ),
        ].filter((n) => n.getClientRects().length);
        if (!nodes.length) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className={`modal-backdrop ${className === "drawer-dialog" ? "drawer-backdrop" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-heading">
          <h2>{title}</h2>
          <button aria-label="关闭对话框" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
