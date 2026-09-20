import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors tsconfig's `paths` — Vite does not read tsconfig for this, so the
    // two have to be kept in step by hand. Every `@/lib/...` and
    // `@/components/...` import in the app resolves through here.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  server: {
    port: 3000,
    // Dev only. In production Nginx serves this app and proxies /api to uvicorn
    // on the same origin, so no proxy config exists (or is wanted) there — see
    // nginx/balkan-fleet.conf.example. This just reproduces that arrangement
    // locally, which is why NEXT_PUBLIC_API_BASE/VITE_API_BASE can stay unset
    // in dev and still behave exactly like production.
    proxy: { "/api": { target: "http://127.0.0.1:8001", changeOrigin: true } },
  },
  // `vite preview` serves the real production build. Same proxy, so the built
  // bundle can be exercised exactly as Nginx will serve it.
  preview: {
    port: 3000,
    proxy: { "/api": { target: "http://127.0.0.1:8001", changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: true },
});
