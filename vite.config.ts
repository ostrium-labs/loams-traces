import { defineConfig } from "vite-plus";
export default defineConfig({
  base: "/traces/",
  server: { host: "127.0.0.1", port: 3002 },
  build: { target: "es2022", copyPublicDir: false },
  test: { include: ["src/**/*.test.ts"] },
});
