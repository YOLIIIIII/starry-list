export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** All coordinates are physical pixels; never mix monitor pixels with CSS pixels. */
export function visibleBounds(saved: Bounds, workAreas: Bounds[]): Bounds {
  if (!workAreas.length) return saved;
  const containing = workAreas.find(
    (a) =>
      saved.x + Math.min(saved.width, 180) > a.x &&
      saved.x < a.x + a.width - 80 &&
      saved.y >= a.y &&
      saved.y + 40 < a.y + a.height,
  );
  const area = containing ?? workAreas[0];
  const width = Math.min(saved.width, area.width),
    height = Math.min(saved.height, area.height);
  return {
    width,
    height,
    x: containing
      ? Math.max(area.x, Math.min(saved.x, area.x + area.width - width))
      : area.x + Math.floor((area.width - width) / 2),
    y: containing
      ? Math.max(area.y, Math.min(saved.y, area.y + area.height - height))
      : area.y + Math.floor((area.height - height) / 2),
  };
}
