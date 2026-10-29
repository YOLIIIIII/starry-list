import { useRef, useState } from "react";
import { format } from "date-fns";
import { Droplets, Star, Trash2, Undo2 } from "lucide-react";
import { dayKey, waterEntrySchema, type WaterEntry } from "./domain";
import { store, useStore } from "./store";

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
export function WaterCard({ date }: { date: string }) {
  const { data, pending } = useStore();
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<WaterEntry | null>(null);
  const lock = useRef(false);
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
  function add(value: number) {
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
    });
  }
  return (
    <section className="water-card" aria-label="喝水记录">
      <div className="water-heading">
        <span className="water-icon">
          <Droplets size={19} />
        </span>
        <div>
          <h3>喝口水，慢慢来</h3>
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
            <Star size={14} fill="currentColor" /> 好好照顾了自己
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
        {cupLevels(total, goal).map((cup, i) => (
          <span
            className="water-cup"
            key={i}
            title={`第 ${i + 1} 杯 · 目标 ${cup.target} mL`}
          >
            <span
              className="water-fill"
              style={{ height: `${cup.fill * 100}%` }}
            />
            <span className="water-shine" />
            {cup.target < 500 && (
              <span
                className="water-target"
                style={{ bottom: `${cup.target / 5}%` }}
              />
            )}
          </span>
        ))}
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
        <button aria-expanded={custom} onClick={() => setCustom(!custom)}>
          自定义
        </button>
      </fieldset>
      {custom && !future && (
        <form
          className="water-custom"
          onSubmit={(e) => {
            e.preventDefault();
            add(Number(amount));
          }}
        >
          <label>
            容量（mL）
            <input
              autoFocus
              aria-label="自定义饮水容量"
              type="number"
              min="1"
              max="10000"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <button disabled={pending > 0}>记录</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <details className="water-history">
        <summary>时间记录 · {entries.length} 次</summary>
        <ul>
          {entries.length === 0 && <li>还没有记录，按自己的节奏来。</li>}
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
      </details>
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
    </section>
  );
}
