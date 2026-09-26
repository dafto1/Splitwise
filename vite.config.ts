import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = Number(env.PORT) || 3000;

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": { target: env.SERVER4_URL || `http://localhost:${apiPort}`, changeOrigin: true }
      }
    }
  };
});
