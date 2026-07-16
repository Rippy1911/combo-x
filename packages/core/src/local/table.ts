/** Pure helpers for Views DataTable (sort / filter / charts / export). */

export interface BarSeriesPoint {
  label: string;
  value: number;
}

function isNumericCell(s: string): boolean {
  const t = s.trim().replace(/,/g, "");
  if (!t) return false;
  return Number.isFinite(Number(t));
}

/** Column indices (excluding header) that are mostly numeric. */
export function detectNumericColumns(rows: string[][]): number[] {
  if (rows.length < 2) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const out: number[] = [];
  for (let c = 0; c < width; c++) {
    let n = 0;
    let total = 0;
    for (let r = 1; r < rows.length; r++) {
      const cell = rows[r]?.[c];
      if (cell == null || cell === "") continue;
      total += 1;
      if (isNumericCell(cell)) n += 1;
    }
    if (total > 0 && n / total >= 0.7) out.push(c);
  }
  return out;
}

export function sortTableRows(
  rows: string[][],
  column: number,
  dir: "asc" | "desc" = "asc",
): string[][] {
  if (rows.length < 2) return rows;
  const [header, ...body] = rows;
  const numeric = body.every((r) => {
    const v = r[column];
    return v == null || v === "" || isNumericCell(v);
  });
  const sorted = [...body].sort((a, b) => {
    const av = a[column] ?? "";
    const bv = b[column] ?? "";
    let cmp: number;
    if (numeric) {
      cmp = (Number(String(av).replace(/,/g, "")) || 0) - (Number(String(bv).replace(/,/g, "")) || 0);
    } else {
      cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return [header!, ...sorted];
}

export function filterTableRows(rows: string[][], query: string): string[][] {
  if (rows.length < 2 || !query.trim()) return rows;
  const q = query.trim().toLowerCase();
  const [header, ...body] = rows;
  const filtered = body.filter((r) => r.some((c) => String(c).toLowerCase().includes(q)));
  return [header!, ...filtered];
}

export function buildBarSeries(
  rows: string[][],
  valueColumn: number,
  labelColumn = 0,
  maxPoints = 40,
): BarSeriesPoint[] {
  if (rows.length < 2) return [];
  const points: BarSeriesPoint[] = [];
  for (let r = 1; r < rows.length && points.length < maxPoints; r++) {
    const raw = rows[r]?.[valueColumn] ?? "";
    if (!isNumericCell(raw)) continue;
    const label = String(rows[r]?.[labelColumn] ?? `#${r}`);
    points.push({ label, value: Number(String(raw).replace(/,/g, "")) });
  }
  return points;
}

export function tableToJson(rows: string[][]): Record<string, string>[] {
  if (rows.length < 1) return [];
  const header = rows[0]!.map((h, i) => h || `col_${i}`);
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) obj[header[i]!] = r[i] ?? "";
    return obj;
  });
}
