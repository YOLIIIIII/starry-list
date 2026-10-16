import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
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
export function UndoToast({
  entry,
  onUndo,
  onClose,
}: {
  entry: UndoEntry;
  onUndo(): Promise<void>;
  onClose(): void;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const remaining = useRef(8000);
  const close = useRef(onClose);
  close.current = onClose;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (hover || focus || busy || failed) return;
    const start = performance.now();
    const timer = setTimeout(() => close.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - start),
      );
    };
  }, [hover, focus, busy, failed]);
  return (
    <div
      className="toast undo-toast"
      role="status"
      data-paused={hover || focus || busy || failed}
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
      <button disabled={busy} aria-label="关闭通知" onClick={onClose}>
        <X size={13} />
      </button>
    </div>
  );
}
