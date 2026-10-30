import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
const port = Number(process.env.PATHFINDER_UX_PORT ?? 5210);
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../apps/web/public", import.meta.url)), plugins:[react()],
  define: {
    "import.meta.env.VITE_ENABLE_OPERATIONS_WORKSPACE": JSON.stringify("true"),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(`http://127.0.0.1:${port}`),
    "import.meta.env.VITE_ENABLE_INTAKE_EXCEPTIONS": JSON.stringify("true"),
    "import.meta.env.VITE_INTAKE_EXCEPTIONS_CUSTOMER_ID": JSON.stringify("284619"),
    "import.meta.env.VITE_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED": JSON.stringify("true"),
    // Isolated synthetic review only; absent by default, never a production grant.
    "import.meta.env.VITE_ENABLE_CUSTOMER_CATALOG": JSON.stringify(process.env.PATHFINDER_UX_CATALOG === "true" ? "true" : "false"),
    "import.meta.env.VITE_CUSTOMER_CATALOG_IDS": JSON.stringify(process.env.PATHFINDER_UX_CATALOG === "true" ? "284619,174094" : "")
  },
  server:{host:"127.0.0.1",port,strictPort:true,fs:{allow:[fileURLToPath(new URL("../..",import.meta.url))]}}
});
