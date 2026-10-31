import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { validStatusReviewerConfig } from "./src/status-reviewer-config";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  if (env.VITE_PROOF_STATUS_REVIEWER_SIGNIN === "true" && !validStatusReviewerConfig(env)) {
    throw new Error("Reviewer sign-in requires complete Firebase configuration and the canonical project auth domain.");
  }
  return {
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
  };
});
