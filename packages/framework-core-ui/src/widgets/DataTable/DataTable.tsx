import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

import { useEventBusClient } from "../../EventBusContext";
import type { WireEvent } from "../../client";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "../../components/ui/table";
import "./DataTable.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Column definition for the {@link DataTableComponent}.
 *
 * Describes how to extract and display a single column from the row payload.
 */
export interface ColumnDef {
  /** Key matching a field in the row payload (e.g. `"residual"`). */
  key: string;
  /** Display name shown in the table header. */
  header: string;
  /**
   * Hint used for sort order. `"number"` sorts numerically; `"string"` sorts
   * lexicographically. Defaults to `"string"`.
   */
  type?: "string" | "number";
}

/**
 * Props for the {@link DataTableComponent}.
 *
 * All props correspond to the `parameters` schema declared in `DATA_TABLE`,
 * except `columns` which is passed directly in the layout JSON (too complex
 * for the flat parameter schema).
 */
export interface DataTableProps {
  /**
   * EventBus channel pattern to subscribe to. Supports fnmatch glob patterns.
   * Default: `"table/*"`
   */
  channel?: string;
  /** Title displayed above the toolbar. */
  title?: string;
  /**
   * Column definitions. When omitted, columns are auto-derived from the keys
   * of the first received row. Auto-derived columns use the key as both `key`
   * and `header` with `type` defaulting to `"string"`.
   */
  columns?: ColumnDef[];
  /**
   * Number of rows shown per page.
   * Default: `20`
   */
  pageSize?: number;
  /**
   * Maximum number of rows retained in the rolling buffer. When exceeded, the
   * oldest rows are trimmed. Changes take effect on the next incoming row —
   * they do not reset existing history.
   * Default: `1000`
   */
  maxRows?: number;
}

/** A single table row — the event payload cast as a flat-or-nested object. */
type RowData = Record<string, unknown>;

type SortDir = "asc" | "desc";

interface SortState {
  key: string;
  dir: SortDir;
}

const DATA_TABLE_PREFIX = "sct-DataTable";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function compareRows(a: RowData, b: RowData, col: ColumnDef): number {
  const av = a[col.key];
  const bv = b[col.key];
  if (col.type === "number") {
    const an = Number(av);
    const bn = Number(bv);
    return isFinite(an) && isFinite(bn)
      ? an - bn
      : String(av).localeCompare(String(bv));
  }
  return cellString(av).localeCompare(cellString(bv));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Displays a live, paginated, sortable, searchable table of row objects
 * streamed from an EventBus channel.
 *
 * Subscribes to `channel` via {@link useEventBusClient} and accumulates
 * object payloads into a rolling row buffer. Column definitions can be
 * declared explicitly via `columns` or auto-derived from the first received
 * row. Client-side filter, sort, and pagination are applied on every render.
 *
 * **Subscription lifecycle:** created on mount, torn down on unmount or when
 * `channel` / the client instance changes. Changing `maxRows`, `pageSize`,
 * `columns`, or `title` does NOT resubscribe or reset the row buffer.
 *
 * Styles are applied via deterministic CSS class names prefixed with
 * `sct-DataTable-`, defined in `DataTable.css`.
 *
 * @param props Component props — see {@link DataTableProps}.
 * @returns A live data table element.
 * @example
 * ```tsx
 * <DataTableComponent
 *   channel="table/results"
 *   title="Solver Results"
 *   columns={[
 *     { key: "step", header: "Step", type: "number" },
 *     { key: "residual", header: "Residual", type: "number" },
 *   ]}
 * />
 * ```
 */
export const DataTableComponent: ComponentType<DataTableProps> = ({
  channel = "table/*",
  title,
  columns: columnsProp,
  pageSize = 20,
  maxRows = 1000,
}) => {
  const client = useEventBusClient();
  const [rows, setRows] = useState<RowData[]>([]);
  const [derivedColumns, setDerivedColumns] = useState<ColumnDef[] | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(0);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  /**
   * Mirrors `maxRows` so the subscription callback reads the latest limit
   * without `maxRows` being a subscription dependency.
   */
  const maxRowsRef = useRef(maxRows);
  useEffect(() => {
    maxRowsRef.current = maxRows;
  }, [maxRows]);

  /**
   * Tracks whether the first row has been received for column auto-derivation.
   * Using a ref avoids making it a subscription dependency.
   */
  const firstRowRef = useRef(true);

  /**
   * Subscribe on mount; reset rows and derived columns on each
   * (re)subscription so stale data from a previous channel is not shown.
   */
  useEffect(() => {
    setRows([]);
    setDerivedColumns(null);
    setSearch("");
    setSort(null);
    setPage(0);
    setHiddenKeys(new Set());
    firstRowRef.current = true;

    return client.subscribe(channel, (event: WireEvent) => {
      const payload = event.payload;
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        return;
      }
      const row = payload as RowData;

      if (firstRowRef.current) {
        firstRowRef.current = false;
        setDerivedColumns(
          Object.keys(row).map((k) => ({ key: k, header: k, type: "string" as const })),
        );
      }

      setRows((prev) => {
        const next = [...prev, row];
        const limit = maxRowsRef.current;
        return next.length > limit ? next.slice(next.length - limit) : next;
      });
    });
  }, [channel, client]); // maxRows intentionally excluded — use maxRowsRef

  const columns = columnsProp ?? derivedColumns ?? [];
  const visibleColumns = columns.filter((c) => !hiddenKeys.has(c.key));

  // Filter
  const filtered =
    search.trim() === ""
      ? rows
      : rows.filter((row) =>
          visibleColumns.some((col) =>
            cellString(row[col.key]).toLowerCase().includes(search.toLowerCase()),
          ),
        );

  // Sort
  const sorted =
    sort === null
      ? filtered
      : [...filtered].sort((a, b) => {
          const col = columns.find((c) => c.key === sort.key);
          if (!col) return 0;
          const cmp = compareRows(a, b, col);
          return sort.dir === "asc" ? cmp : -cmp;
        });

  // Paginate
  const totalPages = Math.ceil(sorted.length / pageSize);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const pageRows = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  function handleHeaderClick(key: string) {
    setSort((prev) => {
      if (prev?.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
    setPage(0);
  }

  function handleSearch(value: string) {
    setSearch(value);
    setPage(0);
  }

  function toggleColumn(key: string) {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div className={`${DATA_TABLE_PREFIX}-empty`}>Waiting for data on {channel}…</div>
    );
  }

  return (
    <div className={`${DATA_TABLE_PREFIX}-container`}>
      {title && <div className={`${DATA_TABLE_PREFIX}-title`}>{title}</div>}

      <div className={`${DATA_TABLE_PREFIX}-toolbar`}>
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className={`${DATA_TABLE_PREFIX}-search`}
        />
        <div className={`${DATA_TABLE_PREFIX}-col-toggles`}>
          {columns.map((col) => (
            <Button
              key={col.key}
              variant={hiddenKeys.has(col.key) ? "outline" : "secondary"}
              size="xs"
              onClick={() => toggleColumn(col.key)}
            >
              {col.header}
            </Button>
          ))}
        </div>
      </div>

      <div className={`${DATA_TABLE_PREFIX}-table-wrapper`}>
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((col) => (
                <TableHead
                  key={col.key}
                  className={`${DATA_TABLE_PREFIX}-th`}
                  onClick={() => handleHeaderClick(col.key)}
                >
                  {col.header}
                  {sort?.key === col.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row, i) => (
              <TableRow key={i}>
                {visibleColumns.map((col) => (
                  <TableCell key={col.key}>{cellString(row[col.key])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className={`${DATA_TABLE_PREFIX}-pagination`}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
          >
            Previous
          </Button>
          <span className={`${DATA_TABLE_PREFIX}-page-info`}>
            {safePage + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage === totalPages - 1}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
};
