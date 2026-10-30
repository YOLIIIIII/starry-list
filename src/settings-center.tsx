import { useRef, useState, type ReactNode } from "react";
import { Palette, CalendarDays, Droplets, ShieldCheck } from "lucide-react";
const categories = [
  ["appearance", "外观与布局", Palette],
  ["usage", "日历与使用", CalendarDays],
  ["water", "喝水小组件", Droplets],
  ["data", "数据与关于", ShieldCheck],
] as const;
type Category = (typeof categories)[number][0];
export function SettingsCenter({
  sections,
}: {
  sections: Record<Category, ReactNode>;
}) {
  const [active, setActive] = useState<Category>("appearance");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const panel = useRef<HTMLDivElement>(null);
  function select(index: number) {
    setActive(categories[index][0]);
    tabs.current[index]?.focus();
    if (panel.current) panel.current.scrollTop = 0;
  }
  return (
    <div className="settings-center">
      <nav className="settings-nav" role="tablist" aria-label="设置分类">
        {categories.map(([id, label, Icon], i) => (
          <button
            key={id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            id={`settings-tab-${id}`}
            aria-controls={`settings-panel-${id}`}
            aria-selected={active === id}
            tabIndex={active === id ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => {
              let next = i;
              if (e.key === "ArrowRight" || e.key === "ArrowDown")
                next = (i + 1) % 4;
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
                next = (i + 3) % 4;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = 3;
              else return;
              e.preventDefault();
              select(next);
            }}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-panels" ref={panel}>
        {categories.map(([id, label]) => (
          <section
            className="settings-category"
            role="tabpanel"
            id={`settings-panel-${id}`}
            aria-labelledby={`settings-tab-${id}`}
            hidden={active !== id}
            key={id}
            tabIndex={0}
          >
            <h3>{label}</h3>
            {sections[id]}
          </section>
        ))}
      </div>
      <p className="settings-footnote">偏好自动保存 · 数据留在本机</p>
    </div>
  );
}
