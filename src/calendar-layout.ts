export function previewCapacity(
  width: number,
  available: number,
  row: number,
  gap: number,
  inset: number,
  ceiling = 2,
): 0 | 1 | 2 {
  for (const count of [2, 1] as const) {
    if (
      count <= ceiling &&
      width >= (count === 2 ? 65 : 50) &&
      available >= inset + count * row + (count - 1) * gap + 1
    )
      return count;
  }
  return 0;
}

// Measure the actual content box, including wrapped holiday/personal badges.
// A header-only change may demote density; promotion requires new geometry.
// This prevents +N wrapping from repeatedly showing/hiding the same preview.
export function observeCalendar(
  grid: HTMLElement,
  onLimit: (limit: 0 | 1 | 2) => void,
) {
  let frame = 0,
    geometry = "",
    ceiling = 2;
  const number = (style: CSSStyleDeclaration, key: string) =>
    parseFloat(style.getPropertyValue(key)) || 0;
  function measure() {
    const cells = [...grid.querySelectorAll<HTMLElement>(".day-cell")];
    if (!cells.length) return;
    const metrics = cells.map((cell) => {
      const style = getComputedStyle(cell),
        bounds = cell.getBoundingClientRect();
      const padding =
        number(style, "padding-top") + number(style, "padding-bottom");
      const border =
        number(style, "border-top-width") +
        number(style, "border-bottom-width");
      const header = cell
        .querySelector<HTMLElement>(".date-select")!
        .getBoundingClientRect().height;
      return {
        width: bounds.width,
        height: bounds.height,
        available: bounds.height - padding - border - header,
        minimum: header + padding + border + 4,
      };
    });
    const minimum = Math.ceil(Math.max(...metrics.map((m) => m.minimum)));
    const token = `${minimum}px`;
    if (grid.style.getPropertyValue("--calendar-row-min") !== token)
      grid.style.setProperty("--calendar-row-min", token);
    const nextGeometry = metrics
      .map((m) => `${m.width.toFixed(1)}:${m.height.toFixed(1)}`)
      .join(";");
    if (nextGeometry !== geometry) {
      geometry = nextGeometry;
      ceiling = 2;
    }
    const style = getComputedStyle(grid);
    const limit = previewCapacity(
      Math.min(...metrics.map((m) => m.width)),
      Math.min(...metrics.map((m) => m.available)),
      number(style, "--calendar-preview-height"),
      number(style, "--preview-gap"),
      number(style, "--calendar-preview-inset"),
      Math.min(ceiling, number(style, "--calendar-preview-capacity")),
    );
    ceiling = limit;
    onLimit(limit);
  }
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  });
  measure();
  observer.observe(grid);
  for (const header of grid.querySelectorAll<HTMLElement>(".date-select"))
    observer.observe(header);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
