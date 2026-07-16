import {
  buildBarSeries,
  detectNumericColumns,
  filterTableRows,
  rowsToCsv,
  sortTableRows,
  tableToJson,
} from "@combo-x/core";
import { useMemo, useState } from "react";

export type DataTableProps = {
  rows: string[][];
  title?: string;
  maxRows?: number;
  onExport?: (filename: string, text: string, mime: string) => void | Promise<void>;
  onOpenInViews?: (title: string, rows: string[][]) => void;
  onSaveView?: (title: string, rows: string[][]) => void;
  showChart?: boolean;
};

export function DataTable({
  rows: inputRows,
  title = "Table",
  maxRows = 500,
  onExport,
  onOpenInViews,
  onSaveView,
  showChart = true,
}: DataTableProps) {
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [chartCol, setChartCol] = useState<number | null>(null);
  const [chartType, setChartType] = useState<"bar" | "line">("bar");

  const processed = useMemo(() => {
    let rows = inputRows;
    if (filter.trim()) rows = filterTableRows(rows, filter);
    if (sortCol != null) rows = sortTableRows(rows, sortCol, sortDir);
    return rows;
  }, [inputRows, filter, sortCol, sortDir]);

  const numericCols = useMemo(() => detectNumericColumns(inputRows), [inputRows]);
  const activeChartCol = chartCol ?? numericCols[0] ?? null;
  const series = useMemo(() => {
    if (activeChartCol == null || !showChart) return [];
    return buildBarSeries(processed, activeChartCol, 0, 40);
  }, [processed, activeChartCol, showChart]);

  const display = processed.slice(0, maxRows + 1); // + header
  const header = display[0] ?? [];
  const body = display.slice(1);

  const toggleSort = (c: number) => {
    if (sortCol === c) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(c);
      setSortDir("asc");
    }
  };

  const exportCsv = () => {
    void onExport?.(
      `${slug(title)}.csv`,
      rowsToCsv(processed),
      "text/csv",
    );
  };
  const exportJson = () => {
    void onExport?.(
      `${slug(title)}.json`,
      JSON.stringify(tableToJson(processed), null, 2),
      "application/json",
    );
  };

  if (!inputRows.length) {
    return <p className="hint">No rows</p>;
  }

  const maxVal = Math.max(1, ...series.map((p) => p.value));

  return (
    <div className="data-table">
      <div className="data-table-toolbar row">
        <input
          className="grow"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rows…"
        />
        {onExport ? (
          <>
            <button type="button" onClick={exportCsv}>
              CSV
            </button>
            <button type="button" onClick={exportJson}>
              JSON
            </button>
          </>
        ) : null}
        {onOpenInViews ? (
          <button type="button" onClick={() => onOpenInViews(title, processed)}>
            Views
          </button>
        ) : null}
        {onSaveView ? (
          <button type="button" className="primary" onClick={() => onSaveView(title, processed)}>
            Save view
          </button>
        ) : null}
      </div>

      {showChart && numericCols.length > 0 ? (
        <div className="chart-panel">
          <div className="row">
            <label className="hint">
              Chart{" "}
              <select
                value={activeChartCol ?? ""}
                onChange={(e) => setChartCol(Number(e.target.value))}
              >
                {numericCols.map((c) => (
                  <option key={c} value={c}>
                    {header[c] || `col ${c}`}
                  </option>
                ))}
              </select>
            </label>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value as "bar" | "line")}
            >
              <option value="bar">Bar</option>
              <option value="line">Line</option>
            </select>
          </div>
          {series.length > 0 ? (
            <svg
              className="chart-svg"
              viewBox={`0 0 ${Math.max(200, series.length * 28)} 120`}
              role="img"
              aria-label={`${chartType} chart`}
            >
              {chartType === "bar"
                ? series.map((p, i) => {
                    const h = (p.value / maxVal) * 90;
                    const x = 8 + i * 28;
                    return (
                      <g key={i}>
                        <rect
                          x={x}
                          y={100 - h}
                          width={18}
                          height={h}
                          fill="currentColor"
                          opacity={0.75}
                        />
                        <title>{`${p.label}: ${p.value}`}</title>
                      </g>
                    );
                  })
                : (
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      points={series
                        .map((p, i) => {
                          const x = 16 + i * 28;
                          const y = 100 - (p.value / maxVal) * 90;
                          return `${x},${y}`;
                        })
                        .join(" ")}
                    />
                  )}
            </svg>
          ) : (
            <p className="hint">No numeric points in filtered rows</p>
          )}
        </div>
      ) : null}

      <div className="preview-table-wrap">
        <table className="preview-table">
          <thead>
            <tr>
              {header.map((cell, ci) => (
                <th key={ci}>
                  <button type="button" className="th-sort" onClick={() => toggleSort(ci)}>
                    {cell || `col_${ci}`}
                    {sortCol === ci ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>
                {header.map((_, ci) => (
                  <td key={ci}>{row[ci] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {processed.length - 1 > maxRows ? (
        <p className="hint">
          Showing {maxRows} of {processed.length - 1} rows
        </p>
      ) : (
        <p className="hint">{Math.max(0, processed.length - 1)} rows</p>
      )}
    </div>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "export";
}
