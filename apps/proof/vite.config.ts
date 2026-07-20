import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/public/proof": "http://127.0.0.1:3109"
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/lucide-react/")) return "icons";
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          return undefined;
        }
      }
    }
  }
});
