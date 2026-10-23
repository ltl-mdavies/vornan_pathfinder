import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../apps/web/public", import.meta.url)),
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5194, strictPort: true, fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } }
});
