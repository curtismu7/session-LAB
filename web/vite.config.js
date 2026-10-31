import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 6880, npm start) and Vite on VITE_PORT (default 6881). /api is proxied, so the browser only ever
// talks to one origin (same-origin writes and the real session cookie). Ports stay inside 6880-6899.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 6880}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 6881, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js" },
});
