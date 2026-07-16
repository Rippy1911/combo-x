import { describe, expect, it } from "vitest";
import { INSPECTABLE_DBS, inspectStore } from "./idbInspect.js";

describe("idbInspect privacy", () => {
  it("marks vault for value redaction", () => {
    const vault = INSPECTABLE_DBS.find((d) => d.name === "combo_x_vault");
    expect(vault?.redactValues).toBe(true);
  });

  it("inspectStore never returns vault ciphertext values", async () => {
    const dbName = "combo_x_vault";
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("entries")) {
          db.createObjectStore("entries", { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("entries", "readwrite");
        tx.objectStore("entries").put({
          id: "t1",
          label: "site_profile:foodwell",
          ciphertext: "SECRET_BYTES",
          salt: "x",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const rows = await inspectStore(dbName, "entries", 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.value).toBeUndefined();
      expect(JSON.stringify(r)).not.toContain("SECRET_BYTES");
      expect(r.summary).toMatch(/ciphertext|redacted/i);
    }
  });
});
