// Synthetic browser-QA inputs only. Never upload customer artwork for these checks.
import { copyFile, mkdtemp, open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PDFDocument, StandardFonts } from "pdf-lib";

const directory = await mkdtemp(join(tmpdir(), "pathfinder-catalog-qa-"));
const png = fileURLToPath(new URL("../../apps/web/public/icons/pathfinder-icon-192.png", import.meta.url));
await copyFile(png, join(directory, "valid.png"));
await copyFile(new URL("../../apps/proof/public/brand/proof-placeholder.pdf", import.meta.url), join(directory, "valid.pdf"));
// Deliberately mixed page dimensions. These are QA text sheets, not production art.
const multi = await PDFDocument.create();
const font = await multi.embedFont(StandardFonts.Helvetica);
for (const [index, size] of [[720, 432], [432, 720], [360, 360]].entries()) {
  const page = multi.addPage(size);
  page.drawText(`Synthetic QA - Page ${index + 1} of 3`, { x: 36, y: size[1] - 60, size: 18, font });
  page.drawText(`${size[0] / 72} x ${size[1] / 72} inches - no customer artwork`, { x: 36, y: size[1] - 90, size: 12, font });
}
await writeFile(join(directory, "multipage.pdf"), await multi.save({ useObjectStreams: false }));
await writeFile(join(directory, "invalid.pdf"), "Synthetic invalid PDF for local recovery QA. No customer data.");
const oversized = await open(join(directory, "oversized.pdf"), "w");
try { await oversized.truncate(250 * 1024 * 1024 + 1); } finally { await oversized.close(); }
// Optional macOS fixture conversion; the PNG remains available on other hosts.
const converted = spawnSync("sips", ["-s", "format", "jpeg", png, "--out", join(directory, "valid.jpg")], { encoding: "utf8" });
console.log(JSON.stringify({ directory, jpegAvailable: converted.status === 0 }, null, 2));
