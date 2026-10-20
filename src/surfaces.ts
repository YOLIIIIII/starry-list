import type { Appearance } from "./domain";
// Material changes local surfaces; the slider always controls the actual shell.
export function surfaceAlphas(
  opacity: number,
  opaque: boolean,
  mode: Appearance = "reading",
  nativeFrost = false,
) {
  const shell = opaque ? 1 : Math.max(0.4, Math.min(1, opacity));
  const floors =
    mode === "reading"
      ? [0.94, 0.9, 0.985, 0.55]
      : mode === "glass"
        ? [0.64, 0.58, 0.7, 0.44]
        : nativeFrost
          ? [0.42, 0.35, 0.54, 0.25]
          : [0.64, 0.6, 0.74, 0.42];
  const local = (floor: number) => floor + (1 - floor) * ((shell - 0.4) / 0.6);
  return {
    "--background-alpha": shell,
    "--header-alpha":
      mode === "reading" ? 0.94 + shell * 0.06 : local(floors[0]),
    "--readability-alpha":
      mode === "reading" ? 0.9 + shell * 0.1 : local(floors[1]),
    "--panel-alpha":
      mode === "reading" ? 0.985 + shell * 0.015 : local(floors[2]),
    "--cell-alpha": mode === "reading" ? 0.55 + shell * 0.45 : local(floors[3]),
    "--task-alpha":
      mode === "reading" ? 1 : local(mode === "glass" ? 0.67 : 0.78),
  };
}
