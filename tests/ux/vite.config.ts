import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../apps/web/public", import.meta.url)), plugins:[react()],
  define: {
    "import.meta.env.VITE_ENABLE_OPERATIONS_WORKSPACE": JSON.stringify("true"),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://127.0.0.1:5210"),
    "import.meta.env.VITE_ENABLE_INTAKE_EXCEPTIONS": JSON.stringify("true"),
    "import.meta.env.VITE_INTAKE_EXCEPTIONS_CUSTOMER_ID": JSON.stringify("284619"),
    "import.meta.env.VITE_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED": JSON.stringify("true")
  },
  server:{host:"127.0.0.1",port:5210,strictPort:true,fs:{allow:[fileURLToPath(new URL("../..",import.meta.url))]}}
});
