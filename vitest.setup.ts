import { createRequire } from "node:module";
import "fake-indexeddb/auto";
import { setPdfWorkerSrc } from "./packages/core/src/attachments/parse.ts";

const require = createRequire(import.meta.url);
setPdfWorkerSrc(`file://${require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs")}`);
