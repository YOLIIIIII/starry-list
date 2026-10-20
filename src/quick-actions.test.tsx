import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NotificationRail, UndoToast, StatusToast } from "./quick-actions";
import { makeTask } from "./test-fixtures";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("独立撤销提示计时", () => {
  it("普通恢复通知五秒、悬停/焦点/弹窗暂停，关闭位于 DOM 最末", () => {
    const close = vi.fn();
    const { rerender } = render(
      <StatusToast text="任务已恢复" onClose={close} suspended={false} />,
    );
    const toast = screen.getByRole("status"),
      button = screen.getByRole("button", { name: "关闭通知" });
    expect(toast.lastElementChild).toBe(button);
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(6000));
    expect(close).not.toHaveBeenCalled();
    fireEvent.focus(button);
    fireEvent.pointerLeave(toast);
    act(() => vi.advanceTimersByTime(6000));
    expect(close).not.toHaveBeenCalled();
    fireEvent.blur(toast, { relatedTarget: document.body });
    rerender(
      <StatusToast text="任务已恢复" onClose={close} suspended={true} />,
    );
    act(() => vi.advanceTimersByTime(6000));
    expect(close).not.toHaveBeenCalled();
    rerender(
      <StatusToast text="任务已恢复" onClose={close} suspended={false} />,
    );
    act(() => vi.advanceTimersByTime(2999));
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(close).toHaveBeenCalledOnce();
  });
  function setup(undo = vi.fn(async () => {})) {
    const close = vi.fn();
    render(
      <UndoToast
        entry={{ id: "notice", kind: "deleted", task: makeTask() }}
        onUndo={undo}
        onClose={close}
      />,
    );
    return { close, undo, toast: screen.getByRole("status") };
  }
  it("五秒后结束操作窗口，不执行数据库撤销", () => {
    const { close, undo } = setup();
    act(() => vi.advanceTimersByTime(4999));
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(close).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
  });
  it("悬停和键盘焦点分别暂停，离开后按剩余时间恢复", () => {
    const { close, toast } = setup();
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(12000));
    expect(close).not.toHaveBeenCalled();
    fireEvent.focus(screen.getByRole("button", { name: "撤销" }));
    fireEvent.pointerLeave(toast);
    act(() => vi.advanceTimersByTime(12000));
    expect(close).not.toHaveBeenCalled();
    fireEvent.blur(toast, { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(1999));
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(close).toHaveBeenCalledOnce();
  });
  it("弹窗隐藏通知时暂停，恢复后继续剩余时间", () => {
    const close = vi.fn();
    const entry = { id: "pause", kind: "added" as const, task: makeTask() };
    const ui = (suspended: boolean) => (
      <NotificationRail count={1} suspended={suspended}>
        <UndoToast
          entry={entry}
          onUndo={async () => {}}
          onClose={close}
          suspended={suspended}
        />
      </NotificationRail>
    );
    const { rerender } = render(ui(false));
    act(() => vi.advanceTimersByTime(2000));
    rerender(ui(true));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(20000));
    expect(close).not.toHaveBeenCalled();
    rerender(ui(false));
    act(() => vi.advanceTimersByTime(2999));
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(close).toHaveBeenCalledOnce();
  });
  it("手动关闭、卸载清除计时器", () => {
    const { close } = setup();
    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(close).toHaveBeenCalledOnce();
    cleanup();
    act(() => vi.advanceTimersByTime(9000));
    expect(close).toHaveBeenCalledOnce();
  });
  it("撤销失败保留重试，持久化成功后才关闭", async () => {
    const undo = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(undefined);
    const { close } = setup(undo);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "撤销" })),
    );
    expect(screen.getByText("撤销失败，请重试")).toBeDefined();
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(9000));
    expect(close).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "撤销" })),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(undo).toHaveBeenCalledTimes(2);
  });
});
