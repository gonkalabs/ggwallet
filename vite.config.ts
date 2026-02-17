import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";
import path from "path";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        approval: "src/popup/approval.html",
        // Build the inpage script as a standalone entry so it can be
        // injected into the page's main world via <script> tag.
        "src/provider/inpage": "src/provider/inpage.ts",
      },
      output: {
        // Keep the inpage script name predictable (no hash) so the
        // content script can reference it via chrome.runtime.getURL.
        entryFileNames(chunkInfo) {
          if (chunkInfo.name === "src/provider/inpage") {
            return "src/provider/inpage.js";
          }
          return "[name]-[hash].js";
        },
      },
    },
  },
  define: {
    global: "globalThis",
  },
});
