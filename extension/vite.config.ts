import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import manifest from "./manifest.json";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function copyPdfWorkerPlugin(): Plugin {
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

/**
 * CRXJS emits hashed `content.ts-loader-<hash>.js`. Rename to a stable path and
 * rewrite dist/manifest.json so reinject survives watch rebuilds.
 */
function stabilizeContentLoaderPlugin(): Plugin {
  return {
    name: "stabilize-content-loader",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist");
      const assets = path.join(dist, "assets");
      const manifestPath = path.join(dist, "manifest.json");
      if (!existsSync(assets) || !existsSync(manifestPath)) return;

      const loaders = readdirSync(assets).filter(
        (f) => f.startsWith("content.ts-loader-") && f.endsWith(".js"),
      );
      if (loaders.length === 0) return;

      const stable = "content-loader.js";
      const stablePath = path.join(assets, stable);
      // Prefer the newest loader if multiple (shouldn't happen after emptyOutDir).
      const srcName = loaders.sort().at(-1)!;
      const srcPath = path.join(assets, srcName);
      if (existsSync(stablePath)) {
        try {
          renameSync(stablePath, `${stablePath}.bak`);
        } catch {
          /* ignore */
        }
      }
      renameSync(srcPath, stablePath);
      for (const extra of loaders) {
        if (extra === srcName) continue;
        try {
          const p = path.join(assets, extra);
          if (existsSync(p)) renameSync(p, path.join(assets, `${extra}.orphaned`));
        } catch {
          /* ignore */
        }
      }

      const man = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        content_scripts?: Array<{ js?: string[] }>;
        web_accessible_resources?: Array<{ resources?: string[] }>;
      };
      for (const cs of man.content_scripts ?? []) {
        cs.js = (cs.js ?? []).map((j) =>
          /content\.ts-loader-|content-loader\.js$/.test(j) ? `assets/${stable}` : j,
        );
      }
      for (const war of man.web_accessible_resources ?? []) {
        war.resources = (war.resources ?? []).map((r) =>
          /content\.ts-loader-/.test(r) ? `assets/${stable}` : r,
        );
      }
      writeFileSync(manifestPath, `${JSON.stringify(man, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), copyPdfWorkerPlugin(), stabilizeContentLoaderPlugin()],
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
        // Stable content-script names so watch rebuilds do not orphan open tabs
        // (hashed content.ts-loader-* was deleted by emptyOutDir → "Could not load file").
        entryFileNames: (chunkInfo) => {
          const id = chunkInfo.facadeModuleId ?? "";
          const name = chunkInfo.name ?? "";
          if (id.includes("offscreen") || name.includes("offscreen")) {
            return "assets/offscreen-[hash].js";
          }
          if (
            id.includes("/content/content") ||
            name === "content.ts" ||
            name === "content" ||
            /content\.ts-loader/i.test(name)
          ) {
            if (/loader/i.test(name) || /loader/i.test(id)) {
              return "assets/content-loader.js";
            }
            return "assets/content.js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: (chunkInfo) => {
          const name = chunkInfo.name ?? "";
          if (name === "content.ts" || name === "content" || /content\.ts/i.test(name)) {
            return "assets/content.js";
          }
          if (/content\.ts-loader/i.test(name) || name === "content-loader") {
            return "assets/content-loader.js";
          }
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
});
