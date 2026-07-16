import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./manifest.json";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function copyPdfWorkerPlugin() {
  const copy = () => {
    const src = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
    const destDir = path.resolve(__dirname, "public");
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, path.join(destDir, "pdf.worker.min.mjs"));
  };
  return {
    name: "copy-pdf-worker",
    buildStart() {
      copy();
    },
    closeBundle() {
      // CRXJS / emptyOutDir can race publicDir copy — ensure worker lands in dist/public
      const destDir = path.resolve(__dirname, "dist/public");
      mkdirSync(destDir, { recursive: true });
      copyFileSync(
        path.resolve(__dirname, "public/pdf.worker.min.mjs"),
        path.join(destDir, "pdf.worker.min.mjs"),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), copyPdfWorkerPlugin()],
  resolve: {
    alias: {
      "@combo-x/core": path.resolve(__dirname, "../packages/core/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        setup: path.resolve(__dirname, "setup/index.html"),
        offscreen: path.resolve(__dirname, "src/offscreen/offscreen.html"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          const id = chunkInfo.facadeModuleId ?? "";
          if (id.includes("offscreen")) {
            return "assets/offscreen-[hash].js";
          }
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
});
