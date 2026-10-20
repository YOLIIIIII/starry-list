import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { Check, Save, X } from "lucide-react";
import { store } from "./store";
import type { Task } from "./domain";

export interface InlineTitleHandle {
  save(): Promise<boolean>;
  isComposing(): boolean;
}
export const InlineTitleEditor = forwardRef<
  InlineTitleHandle,
  { task: Task; onClose(): void }
>(function InlineTitleEditor({ task, onClose }, handle) {
  const [title, setTitle] = useState(task.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const done = useRef(false);
  const alive = useRef(true);
  async function save() {
    if (saving.current) return saving.current;
    if (composing.current) return false;
    if (done.current) return true;
    const value = title.trim();
    if (!value) {
      setError("任务标题不能为空，请填写后重试，或按 Esc 取消。");
      return false;
    }
    if (value === task.title) {
      done.current = true;
      onClose();
      return true;
    }
    setBusy(true);
    const operation = store
      .patchTask(task.id, { title: value })
      .then(() => {
        done.current = true;
        onClose();
        return true;
      })
      .catch(() => {
        if (alive.current) setError("保存失败，修改仍在这里。请重试。");
        return false;
      })
      .finally(() => {
        saving.current = null;
        if (alive.current) setBusy(false);
      });
    saving.current = operation;
    return operation;
  }
  const latestSave = useRef(save);
  latestSave.current = save;
  useImperativeHandle(handle, () => ({
    save,
    isComposing: () => composing.current,
  }));
  useEffect(() => {
    alive.current = true;
    input.current?.select();
    const outside = (e: MouseEvent) => {
      // The opening click can reach document after React mounts this editor.
      // Switching to another pencil is protected by App.guard instead.
      if ((e.target as Element).closest?.("[data-inline-title-trigger]"))
        return;
      if (
        !root.current?.contains(e.target as Node) &&
        !e.composedPath().includes(root.current as EventTarget)
      )
        void latestSave.current();
    };
    document.addEventListener("click", outside);
    return () => {
      alive.current = false;
      document.removeEventListener("click", outside);
    };
  }, []);
  return (
    <form
      ref={root}
      className="inline-title-editor"
      aria-label={`快速修改 ${task.title}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <input
          ref={input}
          autoFocus
          aria-label="快速修改任务标题"
          value={title}
          maxLength={500}
          disabled={busy}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            if (
              composing.current ||
              e.nativeEvent.isComposing ||
              e.keyCode === 229
            ) {
              if (e.key === "Enter" || e.key === "Escape") e.preventDefault();
              return;
            }
            if (e.key === "Escape" && !saving.current) {
              e.preventDefault();
              e.stopPropagation();
              done.current = true;
              onClose();
            }
          }}
        />
        <button
          type="submit"
          aria-label="保存标题"
          title="保存标题"
          disabled={busy}
        >
          <Save size={14} />
        </button>
        <button
          type="button"
          aria-label="取消修改标题"
          title="取消修改"
          disabled={busy}
          onClick={() => {
            done.current = true;
            onClose();
          }}
        >
          <X size={14} />
        </button>
      </div>
      {error && <span role="alert">{error}</span>}
    </form>
  );
});

export interface UndoEntry {
  id: string;
  kind: "added" | "deleted";
  task: Task;
}
function useToastLifetime(paused: boolean, onClose: () => void) {
  const remaining = useRef(5000);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const timer = setTimeout(() => close.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - start),
      );
    };
  }, [paused]);
}
export function StatusToast({
  text,
  onClose,
  suspended,
}: {
  text: string;
  onClose(): void;
  suspended: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  useToastLifetime(hover || focus || suspended, onClose);
  return (
    <div
      className="toast"
      role="status"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocus(false);
      }}
    >
      <Check size={15} />
      <span title={text}>{text}</span>
      <button className="toast-close" aria-label="关闭通知" onClick={onClose}>
        <X size={13} />
      </button>
    </div>
  );
}
// A single-row rail keeps independent undo opportunities without covering the list.
export function NotificationRail({
  children,
  count,
  suspended,
}: {
  children: ReactNode;
  count: number;
  suspended: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 70, below: false });
  useLayoutEffect(() => {
    const toolbar = document.querySelector(".topbar");
    if (!toolbar) return;
    const measure = () => {
      const rect = toolbar.getBoundingClientRect();
      const below = window.innerWidth < 860;
      setPosition({ top: below ? rect.bottom - 12 : rect.top + 4, below });
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(toolbar);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useLayoutEffect(() => {
    if (rail.current) rail.current.scrollTop = rail.current.scrollHeight;
  }, [count]);
  return (
    <div
      className={`notification-region ${position.below ? "below-toolbar" : ""}`}
      aria-label="操作通知"
      hidden={!count || suspended}
      style={{ top: position.top }}
    >
      <div ref={rail} className="toast-stack">
        {children}
      </div>
      {count > 1 && (
        <button
          className="notification-next"
          aria-label={`下一条通知（共 ${count} 条）`}
          title="逐条查看通知，也可用 Tab 访问撤销"
          onClick={() => {
            const element = rail.current;
            if (!element?.clientHeight) return;
            const index = Math.round(element.scrollTop / element.clientHeight);
            element.scrollTop = ((index + 1) % count) * element.clientHeight;
          }}
        >
          {count} ▾
        </button>
      )}
    </div>
  );
}
export function UndoToast({
  entry,
  onUndo,
  onClose,
  suspended = false,
}: {
  entry: UndoEntry;
  onUndo(): Promise<void>;
  onClose(): void;
  suspended?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useToastLifetime(hover || focus || busy || failed || suspended, onClose);
  return (
    <div
      className="toast undo-toast"
      role="status"
      data-paused={hover || focus || busy || failed || suspended}
      aria-label={`${entry.kind === "added" ? "已添加" : "已删除"} ${entry.task.title}`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocus(false);
      }}
    >
      <Check size={15} />
      <span title={entry.task.title}>
        {entry.kind === "added" ? "已添加任务" : "任务已删除"}
        <small>{entry.task.title}</small>
        {failed && <small role="alert">撤销失败，请重试</small>}
      </span>
      <button
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await onUndo();
            onClose();
          } catch {
            if (alive.current) setFailed(true);
          } finally {
            if (alive.current) setBusy(false);
          }
        }}
      >
        {busy ? "处理中" : "撤销"}
      </button>
      <button
        className="toast-close"
        disabled={busy}
        aria-label="关闭通知"
        onClick={onClose}
      >
        <X size={13} />
      </button>
    </div>
  );
}
