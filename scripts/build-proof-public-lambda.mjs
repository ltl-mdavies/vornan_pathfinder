import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outdir = resolve("outputs/proof-lambdas");
const publicOutfile = resolve(outdir, "public-lambda.mjs");
const syncOutfile = resolve(outdir, "sync-lambda.mjs");

await mkdir(dirname(publicOutfile), { recursive: true });
const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  minify: false,
  banner: {
    js: ["import { createRequire } from 'node:module';", "const require = createRequire(import.meta.url);"].join("\n")
  }
};
await Promise.all([
  build({ ...shared, entryPoints: ["apps/api/src/proof-public-lambda.ts"], outfile: publicOutfile }),
  build({ ...shared, entryPoints: ["apps/api/src/proof-sync-lambda.ts"], outfile: syncOutfile })
]);
await writeFile(resolve(outdir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);
console.log(`Vornan Proof Lambda artifacts written to ${outdir}`);
