"use client";

import React, { useMemo, useEffect, useRef } from "react";
import { useTable, useSortBy, usePagination, Column } from "react-table";
import type { EnrichedStock } from "@/types/unified";
import { TrendBadge } from "@/components/ui/TrendBadge";
import { EmptyState } from "@/components/ui/EmptyState";

interface ScreenerTableProps {
  stocks: EnrichedStock[];
  onSort: (field: string) => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  locale?: string;
  onStockClick: (stock: EnrichedStock) => void;
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}

const ScoreBar = ({ score, type }: { score: number; type: "ai" | "gov" }) => {
  const width = Math.min(Math.max(score, 0), 100);
  const color = score >= 70 ? "bg-[--color-positive]" : score >= 40 ? "bg-[--color-warning]" : "bg-[--color-negative]";
  return (
    <div className="flex flex-col gap-1 w-24">
      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${width}%` }} />
      </div>
      <span className="font-label text-[10px] tabular-nums text-on-surface-variant text-right">{score.toFixed(0)}</span>
    </div>
  );
};

const TierBadge = ({ tier }: { tier: string }) => {
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-label uppercase tracking-wider bg-white/5 text-on-surface-variant border border-white/10">
      {tier || "N/A"}
    </span>
  );
};

export function ScreenerTable({
  stocks,
  onSort,
  sortBy,
  sortOrder,
  locale = "en",
  onStockClick,
  page,
  total,
  onPageChange
}: ScreenerTableProps) {
  const formatNum = (v: any) => v != null ? Number(v).toLocaleString(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 2 }) : "-";

  const columns: Column<EnrichedStock>[] = useMemo(
    () => [
      {
        Header: "Ticker",
        accessor: "code",
        Cell: ({ row }) => (
          <div className="flex flex-col min-w-[80px]">
            <span className="font-label text-sm font-semibold">{row.original.code}</span>
            <span className="font-body text-[10px] text-on-surface-variant line-clamp-1">{row.original.issuer || "-"}</span>
          </div>
        )
      },
      {
        Header: "Price",
        accessor: "price",
        Cell: ({ value }: { value: any }) => <span className="font-label text-sm tabular-nums text-right">{formatNum(value)}</span>
      },
      {
        Header: "Change",
        accessor: "change",
        Cell: ({ value }: { value: any }) => <div className="text-right w-full flex justify-end"><TrendBadge value={value ?? 0} /></div>
      },
      {
        Header: "Volume",
        accessor: "volume",
        Cell: ({ value }: { value: any }) => <span className="font-label text-sm tabular-nums text-right text-on-surface-variant">{value ? (value / 1000000).toFixed(1) + "M" : "-"}</span>
      },
      {
        Header: "AI Score",
        id: "composite",
        accessor: (row) => row.scores?.composite,
        Cell: ({ value }: { value: any }) => <ScoreBar score={value ?? 0} type="ai" />
      },
      {
        Header: "AI Tier",
        id: "aiTier",
        accessor: (row) => row.aiTier?.label,
        Cell: ({ value }: { value: any }) => <TierBadge tier={value ?? "N/A"} />
      }
    ],
    [locale]
  );

  const {
    getTableProps,
    getTableBodyProps,
    headerGroups,
    page: tablePage,
    prepareRow,
    state: tableState,
  } = useTable(
    {
      columns,
      data: stocks,
      initialState: { pageSize: 50, sortBy: [{ id: sortBy, desc: sortOrder === "desc" }] },
      manualPagination: true,
      pageCount: Math.ceil(total / 50),
      manualSortBy: true,
    },
    useSortBy,
    usePagination
  );

  // Propagate react-table sort state changes to parent via onSort
  const prevSortRef = useRef(tableState.sortBy);
  useEffect(() => {
    const current = tableState.sortBy;
    if (current !== prevSortRef.current && current.length > 0) {
      prevSortRef.current = current;
      onSort(current[0].id);
    }
  }, [tableState.sortBy, onSort]);

  if (stocks.length === 0) {
    return <EmptyState message="No stocks found" subMessage="Try adjusting filters" icon="search_off" />;
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="w-full flex flex-col h-full">
      <div className="w-full overflow-x-auto flex-1 border border-border-subtle rounded-t-xl bg-surface-card">
        <table {...getTableProps()} className="w-full text-left min-w-[600px]">
          <thead className="bg-surface-elevated border-b border-border-subtle sticky top-0 z-10">
            {headerGroups.map(hg => (
              <tr {...hg.getHeaderGroupProps()}>
                {hg.headers.map(column => (
                  <th 
                    {...column.getHeaderProps(column.getSortByToggleProps())} 
                    className="p-3 font-label text-xs uppercase tracking-widest text-on-surface-variant cursor-pointer hover:bg-white/5 transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-2">
                       {column.render("Header")}
                       {column.isSorted ? (
                        <span className="material-symbols-outlined text-[14px]">
                          {column.isSortedDesc ? "arrow_downward" : "arrow_upward"}
                        </span>
                       ) : (
                         <span className="material-symbols-outlined text-[14px] opacity-20 hover:opacity-100">
                          unfold_more
                         </span>
                       )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody {...getTableBodyProps()}>
            {tablePage.map(row => {
              prepareRow(row);
              return (
                <tr 
                  {...row.getRowProps()} 
                  className="border-b border-border-subtle/30 hover:bg-white/5 transition-colors cursor-pointer group"
                  onClick={() => onStockClick(row.original)}
                >
                  {row.cells.map(cell => (
                    <td {...cell.getCellProps()} className="p-3 group-hover:text-primary transition-colors whitespace-nowrap">
                      {cell.render("Cell")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between p-3 border border-t-0 border-border-subtle rounded-b-xl bg-surface-base text-sm">
        <div className="text-on-surface-variant">
          Showing <span className="font-bold text-on-surface">{Math.min((page - 1) * 50 + 1, total)}</span> to <span className="font-bold text-on-surface">{Math.min(page * 50, total)}</span> of <span className="font-bold text-on-surface">{total}</span> results
        </div>
        <div className="flex gap-2">
          <button 
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
            className="px-3 py-1.5 rounded-md bg-surface-elevated border border-border-subtle disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10 transition-colors"
          >
            Prev
          </button>
          <div className="flex items-center px-2">Page {page} of {totalPages || 1}</div>
          <button 
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="px-3 py-1.5 rounded-md bg-surface-elevated border border-border-subtle disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
