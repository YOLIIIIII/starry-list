// The slider controls the shell. Reading surfaces strengthen monotonically
// without changing text opacity or depending on native blur/GPU effects.
export function surfaceAlphas(opacity: number, opaque: boolean) {
  const shell = opaque ? 1 : Math.max(0.4, Math.min(1, opacity));
  return {
    "--background-alpha": shell,
    "--header-alpha": 0.94 + shell * 0.06,
    "--readability-alpha": 0.9 + shell * 0.1,
    "--panel-alpha": 0.985 + shell * 0.015,
    "--cell-alpha": 0.55 + shell * 0.45,
  };
}
