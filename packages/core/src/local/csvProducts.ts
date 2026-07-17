/**
 * Deterministic CSV helpers for order/product attachments.
 * Avoids worker-LLM truncation when extracting SAP/index + name from BaseLinker-style CSVs.
 */

/** Split one CSV line respecting double-quoted fields ("" escapes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]!).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => splitCsvLine(l));
  return { headers, rows };
}

export type CsvProductRow = {
  name: string;
  sap: string;
  quantity?: string;
  unit_net_price?: string;
  tax_value?: string;
  relation_id?: string;
  row_id?: string;
};

function tryParsePosition(raw: string): { name?: string; index?: string } | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const obj = JSON.parse(t) as { name?: unknown; index?: unknown };
    if (obj && typeof obj === "object") {
      return {
        name: typeof obj.name === "string" ? obj.name : undefined,
        index: obj.index != null ? String(obj.index) : undefined,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Extract product name + SAP (catalog index) from order-line CSVs where
 * `position` is a JSON blob `{name,index,...}` (BaseLinker / FoodWell B2B exports).
 */
export function extractProductsFromOrderCsv(text: string): {
  rows: CsvProductRow[];
  notes: string;
} {
  const { headers, rows } = parseCsv(text);
  if (!headers.length) return { rows: [], notes: "empty csv" };

  const idx = (name: string) =>
    headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iPos = idx("position");
  const iQty = idx("quantity");
  const iPrice = idx("unit_net_price");
  const iTax = idx("tax_value");
  const iRel = idx("relation_id");
  const iId = idx("id");

  const products: CsvProductRow[] = [];

  if (iPos >= 0) {
    for (const cells of rows) {
      const pos = tryParsePosition(cells[iPos] ?? "");
      if (!pos?.name && !pos?.index) continue;
      products.push({
        name: pos.name ?? "",
        sap: pos.index ?? "",
        quantity: iQty >= 0 ? cells[iQty] : undefined,
        unit_net_price: iPrice >= 0 ? cells[iPrice] : undefined,
        tax_value: iTax >= 0 ? cells[iTax] : undefined,
        relation_id: iRel >= 0 ? cells[iRel] : undefined,
        row_id: iId >= 0 ? cells[iId] : undefined,
      });
    }
    return {
      rows: products,
      notes: `deterministic: ${products.length} products from position JSON (${rows.length} csv data rows)`,
    };
  }

  // Fallback: columns named name + index/sap
  const iName = idx("name");
  const iSap = ["sap", "index", "catalog", "sku"].map(idx).find((i) => i >= 0) ?? -1;
  if (iName >= 0 && iSap >= 0) {
    for (const cells of rows) {
      const name = (cells[iName] ?? "").trim();
      const sap = (cells[iSap] ?? "").trim();
      if (!name && !sap) continue;
      products.push({ name, sap });
    }
    return {
      rows: products,
      notes: `deterministic: ${products.length} products from name+sap columns`,
    };
  }

  return {
    rows: [],
    notes: `no position/name+sap columns (headers: ${headers.slice(0, 12).join(",")})`,
  };
}

/** True when intent looks like a full product/SAP list from an order CSV. */
export function wantsProductListFromCsv(intent: string): boolean {
  const q = intent.toLowerCase();
  return (
    (q.includes("product") || q.includes("produkt") || q.includes("sap") || q.includes("index")) &&
    (q.includes("csv") ||
      q.includes("all") ||
      q.includes("every") ||
      q.includes("pełn") ||
      q.includes("list") ||
      q.includes("ean") ||
      q.includes("scrape"))
  );
}
