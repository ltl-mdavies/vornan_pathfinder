import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { environmentBytes } from "./intake-storage-template.mjs";

export function checkCandidateEnvironment(variables) {
  const bytes = environmentBytes(variables);
  if (bytes > 4096) throw new Error(`Candidate environment exceeds Lambda's 4096-byte limit (${bytes} bytes)`);
  return { bytes, remaining_bytes: 4096 - bytes, variable_count: Object.keys(variables).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/intake-environment-preflight.mjs <complete-candidate-variables.json>");
    let variables;
    try { variables = JSON.parse(readFileSync(process.argv[2], "utf8")); }
    catch { throw new Error("Cannot read candidate environment JSON"); }
    console.log(JSON.stringify(checkCandidateEnvironment(variables)));
  } catch (error) {
    // Do not print environment names, values, JSON parser excerpts or file contents.
    console.error(error.message);
    process.exitCode = 1;
  }
}
