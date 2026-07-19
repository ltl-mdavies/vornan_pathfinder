import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/lucide-react/")) {
            return "icons";
          }
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react";
          }
          if (id.includes("/node_modules/firebase/") || id.includes("/node_modules/@firebase/")) {
            return "firebase";
          }
          return undefined;
        }
      }
    }
  }
});
