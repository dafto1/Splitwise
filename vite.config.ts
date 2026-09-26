import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = Number(env.PORT) || 3000;
  const rawServerUrl = env.SERVER4_URL?.trim();
  const serverTarget = (() => {
    if (!rawServerUrl) return `http://127.0.0.1:${apiPort}`;
    try {
      const parsed = new URL(rawServerUrl);
      if (parsed.hostname === "localhost" && (parsed.port === "5173" || !parsed.port)) {
        return `http://127.0.0.1:${apiPort}`;
      }
      return rawServerUrl.replace(/\/$/, "");
    } catch {
      return `http://127.0.0.1:${apiPort}`;
    }
  })();

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: serverTarget,
          changeOrigin: true,
          secure: false,
          configure: proxy => {
            proxy.on("error", (error, _req, _res) => {
              console.error("API proxy error:", error.message);
            });
          }
        }
      }
    }
  };
});