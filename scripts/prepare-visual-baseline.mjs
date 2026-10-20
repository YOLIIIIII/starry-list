// Compile the pinned UX2.3 stylesheet without checking out or changing Git state.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  copyFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
const root = resolve(".cache/ux30");
await mkdir(root, { recursive: true });
const output = resolve(root, "ux23-baseline.css");
if (!existsSync(output)) {
  const source = execFileSync("git", [
    "show",
    "d50af114c655a91d2bc52481008c5ec201d84197:src/styles.css",
  ]);
  const input = resolve(root, "baseline-source.css");
  if (existsSync(input)) {
    if (!(await readFile(input)).equals(source))
      throw Error("Existing baseline source differs; refusing to replace it");
  } else await writeFile(input, source, { flag: "wx" });
  const outDir = resolve(root, "baseline-build");
  await build({
    configFile: false,
    plugins: [tailwindcss()],
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: false,
      rollupOptions: {
        input,
        output: { assetFileNames: "baseline-[name][extname]" },
      },
    },
  });
  const files = (await readdir(outDir)).filter((file) => file.endsWith(".css"));
  if (files.length !== 1)
    throw Error("Expected one compiled baseline stylesheet");
  await copyFile(resolve(outDir, files[0]), output, 1);
}
