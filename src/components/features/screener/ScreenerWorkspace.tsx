"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import ReactModal from "react-modal";

import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { Navbar } from "@/components/layout/Navbar";
import { FilterSidebar } from "@/components/features/screener/FilterSidebar";
import { ResultsHeader } from "@/components/features/screener/ResultsHeader";
import { ScreenerTable } from "@/components/features/screener/ScreenerTable";
import { StockCard } from "@/components/features/screener/StockCard";
import { StockDetailPanel } from "@/components/features/screener/StockDetailPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchBar } from "@/components/ui/SearchBar";
import { StockCardSkeleton, TableRowSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";

import type { EnrichedStock } from "@/types/unified";

const sectors = [
  { id: "Finance", label: "Finance" },
  { id: "Energy", label: "Energy" },
  { id: "Technology", label: "Technology" },
  { id: "Consumer", label: "Consumer" },
  { id: "Industrial", label: "Industrial" },
  { id: "Property", label: "Property" },
  { id: "Infrastructure", label: "Infrastructure" },
  { id: "Miscellaneous Industry", label: "Miscellaneous Industry" },
  { id: "Mining", label: "Mining" },
];

export function ScreenerWorkspace(): React.ReactElement {
  const t = useTranslations("screenerPage");
  const { data: session } = useSession();
  const userPlan = (session?.user as { plan?: string } | undefined)?.plan ?? "free";
  const canExport = userPlan === "premium" || userPlan === "pro";

  const [stocks, setStocks] = useState<EnrichedStock[]>([]);
  const [totalStocks, setTotalStocks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "cards">("table");
  const [exportLoading, setExportLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  
  const [page, setPage] = useState(1);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 15000]);

  const [sortBy, setSortBy] = useState("composite");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [selectedStock, setSelectedStock] = useState<EnrichedStock | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);

  const handleExportCSV = async () => {
    setExportLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedSectors.length > 0) params.append("sector", selectedSectors[0]);
      if (priceRange[0] > 0) params.append("minPrice", priceRange[0].toString());
      if (priceRange[1] < 15000) params.append("maxPrice", priceRange[1].toString());
      if (searchQuery) params.append("search", searchQuery);
      params.append("sortBy", sortBy);
      params.append("sortOrder", sortOrder);

      const res = await fetch(`/api/export/csv?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stockscope-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExportLoading(false);
    }
  };

  const [marketData, setMarketData] = useState<{
    advancing: number;
    declining: number;
    marketCap: string | null;
  } | null>(null);

  useEffect(() => {
    fetch("/api/market-summary")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.success) setMarketData(data);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    // Need to set app element for react-modal to prevent screen reader warnings
    ReactModal.setAppElement("body");
    
    const handleResize = () => {
      setView(window.innerWidth < 1024 ? "cards" : "table");
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();

    params.append("page", page.toString());
    
    if (selectedSectors.length > 0) {
      params.append("sector", selectedSectors[0]); // sending top sector
    }
    
    // Send price filters
    if (priceRange[0] > 0) params.append("minPrice", priceRange[0].toString());
    if (priceRange[1] < 15000) params.append("maxPrice", priceRange[1].toString());

    if (searchQuery) params.append("search", searchQuery);
    params.append("sortBy", sortBy);
    params.append("sortOrder", sortOrder);

    queueMicrotask(() => setLoading(true));

    fetch(`/api/screen?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          // Transform API response shape to EnrichedStock shape expected by components
          const transformed = (data.data as any[]).map((s: any): EnrichedStock => ({
            hhi: s.hhi,
            floatPercentage: s.floatPercentage,
            c1: s.c1,
            c3: s.c3,
            code: s.code,
            issuer: s.issuer,
            tier: s.tier,
            sector: s.sector,
            price: s.price,
            change: s.change,
            volume: s.volume,
            marketCap: s.marketCap,
            pe: s.pe,
            pb: s.pb,
            roe: s.roe,
            dividendYield: s.dividendYield,
            scores: s.scores,
            aiTier: s.aiTier,
          }));
          setStocks(transformed);
          setTotalStocks(data.total);
          setError(null);
        } else {
          setError(data.error || "Failed to load data");
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Failed to load data");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [page, searchQuery, selectedSectors, priceRange, sortBy, sortOrder]);

  const handleResetFilters = () => {
    setSearchQuery("");
    setSelectedSectors([]);
    setPriceRange([0, 15000]);
    setPage(1);
  };

  const handleStockClick = (stock: EnrichedStock) => {
    setSelectedStock(stock);
    setIsPanelOpen(true);
  };

  const handlePanelClose = () => {
    setIsPanelOpen(false);
    setTimeout(() => setSelectedStock(null), 250);
  };

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-surface-base text-text-primary">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(1200px_500px_at_85%_-10%,rgba(59,130,246,0.22),transparent),radial-gradient(900px_400px_at_10%_25%,rgba(16,185,129,0.12),transparent)]" />

      <Navbar />

      <div className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6 lg:px-8">
        {/* Mobile Header / Quick Actions */}
        <div className="md:hidden flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Stock Screener</h1>
          <button 
            onClick={() => setIsMobileFilterOpen(true)}
            className="flex items-center gap-1 bg-surface-elevated px-3 py-1.5 rounded-lg border border-border-subtle"
          >
            <span className="material-symbols-outlined text-sm">tune</span>
            <span className="text-sm font-medium">Filters</span>
          </button>
        </div>

        <section className="hidden md:block mb-5 rounded-2xl border border-border-subtle bg-surface-card/70 p-4 backdrop-blur-sm md:p-6">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="label mb-1">Indonesia Equity Intelligence</p>
              <h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-3xl">
                Screener Control Center
              </h1>
              <p className="mt-1 text-sm text-text-secondary">
                Filter governance and valuation signals in one operational workspace.
              </p>
            </div>
            <div className="w-full max-w-xl">
              <SearchBar onSearch={setSearchQuery} placeholder="Search ticker or company" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="JCI Index" value="IDX Composite" />
            <StatCard label="Market Cap" value={marketData?.marketCap ?? "—"} />
            <StatCard label="Advancing" value={marketData?.advancing ?? "—"} deltaType="positive" />
            <StatCard label="Declining" value={marketData?.declining ?? "—"} deltaType="negative" />
          </div>
        </section>

        <section className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
          {/* Desktop Sidebar */}
          <div className="hidden md:block rounded-2xl border border-border-subtle bg-surface-card/50 p-3 backdrop-blur-sm">
            <FilterSidebar
              sectors={sectors}
              activeSectors={selectedSectors}
              onSectorChange={(id) => {
                setSelectedSectors(id ? [id] : []);
                setPage(1);
              }}
              priceRange={priceRange}
              onPriceRangeChange={(min, max) => {
                setPriceRange([min, max]);
                setPage(1);
              }}
              onResetFilters={handleResetFilters}
            />
          </div>

          <main className="rounded-2xl border border-border-subtle bg-surface-card p-3 md:p-5 flex flex-col min-h-[600px]">
            <div className="mb-3 rounded-xl border border-border-subtle bg-surface-elevated/40 flex items-center justify-between">
              <div className="flex-1">
                <ResultsHeader view={view} onViewChange={setView} totalResults={totalStocks} />
              </div>
              {canExport && (
                <div className="pr-4">
                  <button
                    onClick={handleExportCSV}
                    disabled={exportLoading || loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-elevated border border-border-subtle hover:border-brand hover:text-brand transition-colors disabled:opacity-50"
                    title="Export results as CSV"
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    {exportLoading ? "Exporting…" : "CSV"}
                  </button>
                </div>
              )}
            </div>

            {error && <EmptyState type="error" onAction={handleResetFilters} />}

            {loading ? (
               <div className="flex-1 w-full bg-surface-elevated/20 animate-pulse rounded-xl" />
            ) : stocks.length === 0 ? (
               <EmptyState type="filter" onAction={handleResetFilters} />
            ) : view === "cards" ? (
              <div className="space-y-3">
                {stocks.map((stock) => (
                  <StockCard key={stock.code} stock={stock} onClick={() => handleStockClick(stock)} />
                ))}
                {/* Mobile barebones pagination */}
                <div className="flex justify-between items-center px-2 py-4">
                  <button disabled={page === 1} onClick={() => setPage(page-1)} className="px-3 py-1 bg-surface-elevated rounded border border-border disabled:opacity-50">Prev</button>
                  <span className="text-sm">Page {page}</span>
                  <button disabled={stocks.length < 50} onClick={() => setPage(page+1)} className="px-3 py-1 bg-surface-elevated rounded border border-border disabled:opacity-50">Next</button>
                </div>
              </div>
            ) : (
              <div className="flex-1 w-full flex flex-col h-full min-h-[500px]">
                <ScreenerTable
                  stocks={stocks}
                  total={totalStocks}
                  page={page}
                  onPageChange={setPage}
                  onSort={(field) => {
                    if (sortBy === field) setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                    else { setSortBy(field); setSortOrder("desc"); }
                  }}
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onStockClick={handleStockClick}
                />
              </div>
            )}
          </main>
        </section>
      </div>

      {/* Mobile Modal Filter */}
      <ReactModal
        isOpen={isMobileFilterOpen}
        onRequestClose={() => setIsMobileFilterOpen(false)}
        className="absolute top-0 right-0 h-full w-[85vw] max-w-[320px] bg-surface-card border-l border-border-subtle p-4 shadow-2xl focus:outline-none overflow-y-auto z-50 transform transition-transform"
        overlayClassName="fixed inset-0 bg-black/60 z-40"
        closeTimeoutMS={200}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold">Filters</h2>
          <button onClick={() => setIsMobileFilterOpen(false)} className="text-text-muted hover:text-white">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <FilterSidebar
          isMobile={true}
          sectors={sectors}
          activeSectors={selectedSectors}
          onSectorChange={(id) => {
            setSelectedSectors(id ? [id] : []);
            setPage(1);
          }}
          priceRange={priceRange}
          onPriceRangeChange={(min, max) => {
            setPriceRange([min, max]);
            setPage(1);
          }}
          onResetFilters={handleResetFilters}
        />
        <div className="mt-8">
          <button onClick={() => setIsMobileFilterOpen(false)} className="w-full bg-brand text-white py-3 rounded-xl font-bold">View {totalStocks} Results</button>
        </div>
      </ReactModal>

      <StockDetailPanel stock={selectedStock} isOpen={isPanelOpen} onClose={handlePanelClose} />
      <BottomTabBar />
    </div>
  );
}
