import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  optimizeDeps: { include: ["web-tree-sitter"] },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${process.env.GITUDIUM_PORT ?? "3000"}`, changeOrigin: true },
    },
  },
});
