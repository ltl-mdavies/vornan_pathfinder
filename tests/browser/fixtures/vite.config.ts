import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const fixtureRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  root: fixtureRoot,
  publicDir: fileURLToPath(new URL("../../../apps/proof/public", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5190,
    strictPort: true,
    fs: {
      allow: [repositoryRoot]
    }
  },
  define: {
    "import.meta.env.VITE_PROOF_DEMO": JSON.stringify("true")
  }
});
