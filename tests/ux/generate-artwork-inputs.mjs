// Synthetic browser-QA inputs only. Never upload customer artwork for these checks.
import { copyFile, mkdtemp, open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "pathfinder-catalog-qa-"));
const png = fileURLToPath(new URL("../../apps/web/public/icons/pathfinder-icon-192.png", import.meta.url));
await copyFile(png, join(directory, "valid.png"));
await copyFile(new URL("../../apps/proof/public/brand/proof-placeholder.pdf", import.meta.url), join(directory, "valid.pdf"));
await writeFile(join(directory, "invalid.pdf"), "Synthetic invalid PDF for local recovery QA. No customer data.");
const oversized = await open(join(directory, "oversized.pdf"), "w");
try { await oversized.truncate(250 * 1024 * 1024 + 1); } finally { await oversized.close(); }
// Optional macOS fixture conversion; the PNG remains available on other hosts.
const converted = spawnSync("sips", ["-s", "format", "jpeg", png, "--out", join(directory, "valid.jpg")], { encoding: "utf8" });
console.log(JSON.stringify({ directory, jpegAvailable: converted.status === 0 }, null, 2));
