import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Real Proof bootstrap, synthetic intercepted API only. No production proxy.
export default defineConfig({
  root: fileURLToPath(new URL("../../../apps/proof", import.meta.url)),
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5191, strictPort: true },
  define: { "import.meta.env.VITE_PROOF_DEMO": JSON.stringify("false") }
});
