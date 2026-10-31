export function focusWaterSummary(
  available: number,
  fullHeight: number,
  width: number,
  large: boolean,
  wasSummary: boolean,
): boolean {
  // A narrow multi-row card also needs a fair share of the reading space.
  const reserve = large ? 160 : 128;
  const limit = Math.min(
    available - reserve,
    width < 740 ? available * 0.42 : Infinity,
  );
  return fullHeight > limit - (wasSummary ? 20 : 0);
}
