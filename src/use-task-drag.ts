import { useEffect, useRef, useState, type DragEvent } from "react";
import type { Task } from "./domain";
import { dropOrder, orderSignature } from "./task-order";

export function useTaskDrag(
  tasks: Task[],
  date: string,
  view: string,
  blocked: boolean,
  save: (ids: string[], signature: string) => Promise<void>,
  message: (text: string) => void,
) {
  const active = useRef<{ id: string; signature: string } | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const preview = useRef<HTMLElement | null>(null);
  const signature = orderSignature(tasks);
  function cancel() {
    active.current = null;
    pointer.current = null;
    setSource(null);
    setOver(null);
    preview.current?.remove();
    preview.current = null;
  }
  useEffect(() => {
    cancel();
  }, [signature, date, view, blocked]); // invalidation, never commits
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    const outside = (e: globalThis.DragEvent) => {
      if (
        active.current ||
        e.dataTransfer?.types?.includes("application/x-starry-list-task") ||
        e.dataTransfer?.types?.includes("Files")
      ) {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("drop", outside);
    const track = (e: globalThis.DragEvent) => {
      if (active.current) pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("dragover", track);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("drop", outside);
      window.removeEventListener("dragover", track);
      preview.current?.remove();
    };
  }, []);
  useEffect(() => {
    if (!source) return;
    let frame: number;
    const tick = () => {
      const scroll = document.querySelector<HTMLElement>(".focus-scroll"),
        p = pointer.current;
      if (scroll && p) {
        const r = scroll.getBoundingClientRect();
        if (
          p.x >= r.left &&
          p.x <= r.right &&
          p.y >= r.top &&
          p.y <= r.bottom
        ) {
          const speed = p.y < r.top + 36 ? -8 : p.y > r.bottom - 36 ? 8 : 0;
          if (speed) scroll.scrollBy(0, speed);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [source]);
  function target(e: DragEvent, task: Task) {
    if (!active.current) return null;
    pointer.current = { x: e.clientX, y: e.clientY };
    const from = tasks.find((t) => t.id === active.current!.id);
    if (!from || from.completed !== task.completed) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
      setOver(null);
      return null;
    }
    const rect = e.currentTarget
      .querySelector(".task-row")!
      .getBoundingClientRect();
    const next = {
      id: task.id,
      after: e.clientY >= rect.top + rect.height / 2,
    };
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(next);
    return next;
  }
  return {
    source,
    over,
    start(e: DragEvent, task: Task) {
      if (blocked || active.current || tasks.length < 2) {
        e.preventDefault();
        message("请先保存或取消草稿，等待当前操作完成后再拖动。");
        return;
      }
      active.current = { id: task.id, signature };
      setSource(task.id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-starry-list-task", task.id);
      const image = document.createElement("div");
      image.className = "task-drag-preview";
      image.textContent = task.title;
      document.body.append(image);
      preview.current = image;
      e.dataTransfer.setDragImage(image, 12, 12);
    },
    overTask: target,
    drop(e: DragEvent, task: Task) {
      const next = target(e, task),
        drag = active.current;
      e.preventDefault();
      e.stopPropagation();
      if (!next || !drag) {
        if (drag) message("只能在相同完成状态的任务组内排序。");
        cancel();
        return;
      }
      const ids = dropOrder(tasks, drag.id, next.id, next.after);
      cancel();
      if (ids && drag.signature === signature) void save(ids, drag.signature);
    },
    cancel,
  };
}
