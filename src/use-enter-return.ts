import { useCallback, useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

// A keyboard submission owns a cancellable return ticket, not the window focus.
export function useEnterReturn(view: string) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const currentView = useRef(view);
  currentView.current = view;
  const epoch = useRef(0);
  const held = useRef(false);
  const alive = useRef(true);
  const frame = useRef<number | null>(null);
  const pending = useRef<{ date: string; epoch: number } | null>(null);
  const cancel = useCallback(() => {
    epoch.current++;
    pending.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const flush = useCallback(() => {
    if (!pending.current || held.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const ticket = pending.current;
      if (!ticket) return;
      void (async () => {
        let focused = false;
        try {
          focused = isTauri()
            ? await getCurrentWindow().isFocused()
            : document.hasFocus();
        } catch {
          /* A failed focus check never activates the window. */
        }
        if (
          !alive.current ||
          pending.current !== ticket ||
          ticket.epoch !== epoch.current ||
          currentView.current !== "overview"
        )
          return;
        pending.current = null;
        const button = buttons.current.get(ticket.date);
        if (focused && button?.isConnected)
          button.focus({ preventScroll: true });
      })();
    });
  }, []);
  useEffect(() => {
    alive.current = true;
    const keydown = (event: KeyboardEvent) => {
      if (!(event.key === "Enter" && event.repeat && held.current)) cancel();
      if (event.key === "Enter") held.current = true;
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        held.current = false;
        flush();
      }
    };
    const focus = (event: FocusEvent) => {
      if (!(event.target as Element).closest?.(".quick-add-area")) cancel();
    };
    const blur = () => {
      held.current = false;
      cancel();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("keyup", keyup, true);
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("wheel", cancel, {
      capture: true,
      passive: true,
    });
    document.addEventListener("focusin", focus, true);
    window.addEventListener("blur", blur);
    return () => {
      alive.current = false;
      cancel();
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("keyup", keyup, true);
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("wheel", cancel, true);
      document.removeEventListener("focusin", focus, true);
      window.removeEventListener("blur", blur);
    };
  }, [cancel, flush]);
  function prepare(date: string) {
    if (currentView.current !== "overview") return;
    const ticket = { date, epoch: epoch.current };
    return () => {
      if (!alive.current || ticket.epoch !== epoch.current) return;
      pending.current = ticket;
      flush();
    };
  }
  return { buttons, prepare, cancel };
}
