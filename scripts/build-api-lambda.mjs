import { build } from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outdir = resolve("outputs/api-lambda");
const outfile = resolve(outdir, "lambda.mjs");

await mkdir(dirname(outfile), { recursive: true });
await mkdir(resolve(outdir, "data"), { recursive: true });

await build({
  entryPoints: ["apps/api/src/lambda.ts"],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  minify: false,
  banner: {
    js: [
      "import { createRequire } from 'node:module';",
      "const require = createRequire(import.meta.url);"
    ].join("\n")
  }
});

await copyFile("data/lift-customers.sample.csv", resolve(outdir, "data/lift-customers.sample.csv"));
await writeFile(
  resolve(outdir, "package.json"),
  JSON.stringify(
    {
      type: "module",
      main: "lambda.mjs"
    },
    null,
    2
  )
);

console.log(`Pathfinder API Lambda artifact written to ${outdir}`);
