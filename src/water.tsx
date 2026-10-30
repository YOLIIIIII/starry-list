import { useEffect, useId, useRef, useState } from "react";
import { format } from "date-fns";
import { Droplets, Star, Trash2, Undo2 } from "lucide-react";
import { dayKey, waterEntrySchema, type WaterEntry } from "./domain";
import { store, useStore } from "./store";
import { Dialog } from "./components";

export function cupLevels(total: number, goal: number) {
  return Array.from({ length: Math.ceil(goal / 500) }, (_, i) => ({
    fill: Math.min(1, Math.max(0, (total - i * 500) / 500)),
    target: Math.min(500, goal - i * 500),
  }));
}
export function WaterSettings() {
  const {
    data: { settings },
    pending,
  } = useStore();
  const [goal, setGoal] = useState(String(settings.water_goal));
  const [error, setError] = useState("");
  return (
    <fieldset className="water-settings" disabled={pending > 0}>
      <legend>喝水小组件</legend>
      <label>
        <input
          className="toggle"
          type="checkbox"
          checked={settings.water_enabled}
          onChange={(e) => {
            void store
              .saveSettings({ water_enabled: e.target.checked })
              .catch(() => {});
          }}
        />{" "}
        显示喝水卡片
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = Number(goal);
          if (!Number.isInteger(value) || value < 1 || value > 20000) {
            setError("请输入 1–20000 的整数目标（mL）");
            return;
          }
          setError("");
          void store.saveSettings({ water_goal: value }).catch(() => {});
        }}
      >
        <label>
          每日目标（mL）
          <input
            aria-label="每日饮水目标"
            type="number"
            min="1"
            max="20000"
            step="1"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <button type="submit">保存目标</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <p>手动设置，全日期共用。关闭只隐藏，记录仍保留。不是医疗建议。</p>
    </fieldset>
  );
}
export function WaterCup({
  fill,
  target = 500,
}: {
  fill: number;
  target?: number;
}) {
  const id = useId().replace(/:/g, "");
  const top = 46 - fill * 32;
  return (
    <svg className="water-cup" viewBox="0 0 64 56" aria-hidden="true">
      <defs>
        <clipPath id={`cup-${id}`}>
          <path d="M10 13 C10 7 47 7 47 13 C48 23 47 36 43 42 C38 51 18 51 13 42 C9 35 9 22 10 13Z" />
        </clipPath>
        <linearGradient id={`water-${id}`} x2="0" y2="1">
          <stop stopColor="#c7def3" />
          <stop offset="1" stopColor="#b6ade1" />
        </linearGradient>
      </defs>
      <path
        d="M47 18 C64 12 65 39 46 37"
        fill="none"
        stroke="#b29dcc"
        strokeWidth="3"
      />
      <path
        d="M10 13 C10 7 47 7 47 13 C48 23 47 36 43 42 C38 51 18 51 13 42 C9 35 9 22 10 13Z"
        fill="#fffcf6"
        stroke="#b9a4cf"
        strokeWidth="2"
      />
      <g clipPath={`url(#cup-${id})`}>
        {fill > 0 && (
          <path
            className="water-fill"
            d={`M9 ${top} Q18 ${top - 3} 29 ${top} T49 ${top} V52 H9Z`}
            fill={`url(#water-${id})`}
          />
        )}
        <path
          d="M16 22 Q15 30 18 35"
          stroke="white"
          strokeOpacity=".8"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {target < 500 && (
          <path
            d={`M13 ${46 - (target / 500) * 32} H46`}
            stroke="#8d75b1"
            strokeDasharray="2 3"
            strokeWidth="1.5"
          />
        )}
      </g>
      <path
        d="M10 13 C14 19 43 19 47 13 M10 13 C14 7 43 7 47 13"
        fill="none"
        stroke="#b9a4cf"
        strokeWidth="1.4"
      />
      {fill >= 1 && (
        <path
          d="M54 2 L55.2 6.8 L60 8 L55.2 9.2 L54 14 L52.8 9.2 L48 8 L52.8 6.8Z"
          fill="#e4bd5e"
        />
      )}
    </svg>
  );
}
export function WaterCard({
  date,
  compact = false,
}: {
  date: string;
  compact?: boolean;
}) {
  const { data, pending } = useStore();
  const [detail, setDetail] = useState(false);
  const composing = useRef(false);
  const customTrigger = useRef<HTMLButtonElement>(null);
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<WaterEntry | null>(null);
  const lock = useRef(false);
  const card = useRef<HTMLElement>(null);
  const [summary, setSummary] = useState(false);
  useEffect(() => {
    const el = card.current;
    const focus = el?.closest<HTMLElement>(".focus");
    if (!compact || !el || !focus || typeof ResizeObserver === "undefined")
      return;
    const parts = [
      ".focus-heading",
      ".focus-week",
      ".focus-list-heading",
      ".focus-composer",
    ]
      .map((s) => focus.querySelector<HTMLElement>(s))
      .filter((e): e is HTMLElement => Boolean(e));
    const measure = () => {
      const occupied = parts.reduce((sum, part) => {
        const css = getComputedStyle(part);
        return (
          sum +
          part.getBoundingClientRect().height +
          parseFloat(css.marginTop) +
          parseFloat(css.marginBottom)
        );
      }, 0);
      const large = data.settings.text_size === "large";
      const narrow = el.clientWidth < 580;
      const full = narrow ? (large ? 218 : 195) : large ? 164 : 126;
      setSummary(focus.clientHeight - occupied - 12 < full + 70);
    };
    const observer = new ResizeObserver(measure);
    [focus, el, ...parts].forEach((part) => observer.observe(part));
    measure();
    return () => observer.disconnect();
  }, [compact, data.settings.text_size, data.settings.water_goal]);
  const entries = (data.water_entries ?? [])
    .filter((e) => e.date === date)
    .sort(
      (a, b) =>
        b.recorded_at.localeCompare(a.recorded_at) || b.id.localeCompare(a.id),
    );
  const total = entries.reduce((sum, e) => sum + e.amount, 0);
  const goal = data.settings.water_goal;
  const future = date > dayKey(new Date());
  async function act(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setError("");
    try {
      await operation();
    } catch {
      setError("未能保存饮水记录，请重试；原有记录已保留。");
    } finally {
      lock.current = false;
    }
  }
  function add(value: number, keepOpen = false) {
    const result = waterEntrySchema.safeParse({
      id: crypto.randomUUID(),
      date,
      amount: value,
      recorded_at: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
    });
    if (!result.success) {
      setError("请输入 1–10000 的整数容量（mL）");
      return;
    }
    if (date > dayKey(new Date())) return;
    void act(async () => {
      await store.addWater(result.data);
      setAmount("");
      setCustom(false);
      setDetail(keepOpen);
    });
  }
  const levels = cupLevels(total, goal);
  const visible =
    levels.length > 6
      ? [...levels.slice(0, 5), levels[levels.length - 1]]
      : levels;
  function closeDetail() {
    if (lock.current || composing.current) return;
    setDetail(false);
    setCustom(false);
    setError("");
  }
  return (
    <>
      <section
        ref={card}
        data-water-summary={compact && summary}
        className={`water-card ${compact ? "water-compact" : ""}`}
        aria-label="喝水记录"
      >
        <div className="water-layout">
          <div className="water-heading">
            <span className="water-icon">
              <Droplets size={18} />
            </span>
            <div>
              <h3>今日补水</h3>
              <small>
                {date} ·{" "}
                {future
                  ? "未来日期仅查看"
                  : date === dayKey(new Date())
                    ? "记录到今天"
                    : "可补录这一天"}
              </small>
            </div>
            {total >= goal && (
              <span className="water-achieved" role="status">
                <Star size={12} fill="currentColor" /> 补水达标
              </span>
            )}
          </div>
          <div className="water-progress" aria-live="polite">
            <strong>
              {total.toLocaleString()} <span>/ {goal.toLocaleString()} mL</span>
            </strong>
            <small>
              {total > goal ? `多记录了 ${total - goal} mL` : "每杯 500 mL"}
            </small>
          </div>
          <div
            className="water-cups"
            role="img"
            aria-label={`饮水 ${total} / ${goal} mL，每杯 500 mL`}
          >
            {visible.map((cup, i) => (
              <span
                key={i}
                title={`第 ${levels.length > 6 && i === 5 ? levels.length : i + 1} 杯 · 目标 ${cup.target} mL`}
              >
                <WaterCup {...cup} />
              </span>
            ))}
            {levels.length > 6 && (
              <small>中间省略 {levels.length - 6} 杯</small>
            )}
          </div>
          <fieldset className="water-actions" disabled={pending > 0 || future}>
            {[150, 250, 500].map((value) => (
              <button
                key={value}
                className={value === 500 ? "water-favorite" : ""}
                onClick={() => add(value)}
              >
                +{value}
                <small> mL</small>
              </button>
            ))}
            <button
              ref={customTrigger}
              aria-expanded={detail && custom}
              onClick={() => {
                setError("");
                setCustom(true);
                setDetail(true);
              }}
            >
              自定义
            </button>
          </fieldset>
          <button
            className="water-details-button"
            onClick={() => {
              setCustom(false);
              setDetail(true);
            }}
          >
            时间记录 · {entries.length} 次
          </button>
          <button
            className="water-expand"
            onClick={() => {
              setCustom(false);
              setDetail(true);
            }}
          >
            展开补水
          </button>
          {error && !detail && <p role="alert">{error}</p>}
          {removed && !detail && (
            <button
              className="water-restore"
              disabled={pending > 0}
              onClick={() =>
                void act(async () => {
                  await store.addWater(removed);
                  setRemoved(null);
                })
              }
            >
              <Undo2 size={13} /> 恢复刚删除的 {removed.amount} mL
            </button>
          )}
        </div>
      </section>
      {detail && (
        <Dialog
          title="补水记录"
          className="water-dialog"
          isolateBackground
          onClose={closeDetail}
        >
          <div className="water-detail-content">
            <p className="water-date">
              {date} ·{" "}
              {future
                ? "未来日期仅查看"
                : date === dayKey(new Date())
                  ? "记录到今天"
                  : "补录到这一天，保存实际操作时间"}
            </p>
            <p className="water-detail-total" aria-live="polite">
              {total.toLocaleString()} / {goal.toLocaleString()} mL{" "}
              {total >= goal && (
                <span className="water-achieved">
                  <Star size={12} /> 补水达标
                </span>
              )}
            </p>
            <div
              className="water-meter"
              role="img"
              aria-label={`饮水进度 ${total} / ${goal} mL`}
            >
              <span
                style={{ width: `${Math.min(100, (total / goal) * 100)}%` }}
              />
            </div>
            <fieldset
              className="water-actions water-dialog-quick"
              disabled={pending > 0 || future}
            >
              {[150, 250, 500].map((value) => (
                <button
                  key={value}
                  className={value === 500 ? "water-favorite" : ""}
                  aria-label={`记录 ${value} mL`}
                  onClick={() => add(value, true)}
                >
                  +{value} mL
                </button>
              ))}
              <button
                aria-label="自定义容量"
                onClick={() => {
                  setError("");
                  setCustom(true);
                }}
              >
                自定义
              </button>
            </fieldset>
            {custom && !future && (
              <form
                className="water-custom"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!composing.current) add(Number(amount));
                }}
              >
                <h4>记录其他容量</h4>
                <label className="water-amount">
                  <input
                    autoFocus
                    aria-label="自定义饮水容量"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "water-input-error" : undefined}
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onCompositionStart={() => {
                      composing.current = true;
                    }}
                    onCompositionEnd={() => {
                      composing.current = false;
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        (composing.current ||
                          e.nativeEvent.isComposing ||
                          e.keyCode === 229)
                      ) {
                        e.preventDefault();
                        return;
                      }
                      if (e.key === "Escape" && !composing.current) {
                        e.preventDefault();
                        e.stopPropagation();
                        closeDetail();
                        customTrigger.current?.focus();
                      }
                    }}
                  />
                  <span>mL</span>
                </label>
                <p className="water-input-hint">1–10000 mL · 记录到 {date}</p>
                <div className="water-custom-actions">
                  <button
                    type="button"
                    disabled={pending > 0}
                    onClick={closeDetail}
                  >
                    取消
                  </button>
                  <button
                    className="primary"
                    disabled={pending > 0}
                    type="submit"
                  >
                    {pending > 0 ? "正在记录…" : "记录这杯"}
                  </button>
                </div>
              </form>
            )}
            {error && (
              <p id="water-input-error" role="alert">
                {error}
              </p>
            )}
            <div className="water-history">
              <h4>时间记录 · {entries.length} 次</h4>
              <ul>
                {entries.length === 0 && (
                  <li className="water-history-empty">还没有饮水记录</li>
                )}
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <time
                      dateTime={entry.recorded_at}
                      title={`实际记录于 ${entry.recorded_at}`}
                    >
                      {entry.recorded_at.slice(11, 16)}
                    </time>
                    <span>{entry.amount} mL</span>
                    <button
                      aria-label={`删除 ${entry.recorded_at.slice(11, 16)} 的 ${entry.amount} mL 记录`}
                      disabled={pending > 0}
                      onClick={() =>
                        void act(async () => {
                          await store.deleteWater(entry.id);
                          setRemoved(entry);
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {removed && (
              <button
                className="water-restore"
                disabled={pending > 0}
                onClick={() =>
                  void act(async () => {
                    await store.addWater(removed);
                    setRemoved(null);
                  })
                }
              >
                <Undo2 size={13} /> 恢复刚删除的 {removed.amount} mL
              </button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
