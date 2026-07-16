/** Re-export + CSV/MD parsers for Views / Preview (testable without React). */

export {
  sortTableRows,
  filterTableRows,
  detectNumericColumns,
  buildBarSeries,
  tableToJson,
} from "@combo-x/core";

export function parseCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

export function rowsFromMarkdownTables(md: string): string[][] | null {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^\s*\|.+\|\s*$/.test(l));
  if (start < 0) return null;
  const rows: string[][] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^\s*\|/.test(line)) break;
    if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)) continue;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length) rows.push(cells);
  }
  return rows.length ? rows : null;
}

export const VIEWS_PENDING_KEY = "combo_x_views_pending_table";

export function stashTableForViews(title: string, rows: string[][]): void {
  try {
    localStorage.setItem(
      VIEWS_PENDING_KEY,
      JSON.stringify({ title, rows, at: Date.now() }),
    );
  } catch {
    /* quota */
  }
}

export function takeStashedTable(): { title: string; rows: string[][] } | null {
  try {
    const raw = localStorage.getItem(VIEWS_PENDING_KEY);
    if (!raw) return null;
    localStorage.removeItem(VIEWS_PENDING_KEY);
    const parsed = JSON.parse(raw) as { title?: string; rows?: string[][] };
    if (!Array.isArray(parsed.rows) || !parsed.rows.length) return null;
    return { title: parsed.title || "Table", rows: parsed.rows };
  } catch {
    return null;
  }
}
