import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Settings the browser gets under their plain names instead of Vite's
// VITE_ prefix, read from frontend/.env* or the build's environment (see
// .github/workflows/deploy.yml). Each is listed by exact name rather than
// by a GOOGLE_MAPS_ prefix, so a server-side key named alike can never be
// baked into the public bundle by accident. Both are meant to be public:
// see README "Google Maps".
const PUBLIC_ENV = ["GOOGLE_MAPS_API_KEY", "GOOGLE_MAPS_MAP_ID"];
const ROOT = dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ROOT, "");
  return {
    plugins: [react()],
    define: Object.fromEntries(PUBLIC_ENV.map((name) => [`import.meta.env.${name}`, JSON.stringify(env[name] ?? "")])),
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
  };
});
