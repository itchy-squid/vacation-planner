import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin from the browser's point of view, so local dev needs no
    // CORS handling at all -- see backend/app/main.py and
    // infra/modules/container-app-backend.bicep's corsPolicy for the one
    // place CORS is actually enforced (production, at the Container App
    // ingress).
    proxy: {
      "/api": "http://localhost:8000",
      "/healthz": "http://localhost:8000",
    },
  },
});
