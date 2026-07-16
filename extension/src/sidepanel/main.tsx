import { setPdfWorkerSrc } from "@combo-x/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// pdf.js requires GlobalWorkerOptions.workerSrc in the browser.
// Vite copies pdf.worker.min.mjs into extension/public → dist/public/.
if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
  setPdfWorkerSrc(chrome.runtime.getURL("public/pdf.worker.min.mjs"));
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
