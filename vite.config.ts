import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { cloudflare } from "@cloudflare/vite-plugin"

const cryptoShim = fileURLToPath(new URL("./src/lib/crypto-shim.ts", import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: {
      "@": "/src",
      // E2B SDKs import Node's crypto.randomBytes; shim it for the browser.
      crypto: cryptoShim,
    },
  },
  // Keep the E2B SDKs out of esbuild dep pre-bundling so the crypto alias
  // applies through vite's resolver (esbuild resolves aliases differently).
  optimizeDeps: { exclude: ["@e2b/desktop", "@e2b/code-interpreter", "e2b"] },
})
