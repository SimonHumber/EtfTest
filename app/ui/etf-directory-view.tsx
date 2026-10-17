"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FolderPlus, Search, X } from "lucide-react";
import canada from "../../public/iShareCan.json";
import usa from "../../public/iShareUsa.json";
import { directoryListings, etfAum, etfDate, filterEtfs, type EtfSortKey } from "../lib/etf-directory";

const listings = directoryListings(canada, usa);
const columns: { key: EtfSortKey; label: string; numeric?: boolean }[] = [
  { key: "ticker", label: "Ticker" }, { key: "name", label: "Fund name" },
  { key: "market", label: "Market" }, { key: "aum", label: "AUM", numeric: true },
  { key: "mer", label: "MER", numeric: true }, { key: "inceptionDate", label: "Inception date" },
];

export function EtfDirectoryView({ onResearch, onBacktest }: { onResearch: (symbol: string) => void; onBacktest: (symbol: string, ticker: string) => void }) {
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("All");
  const [sort, setSort] = useState<{ key: EtfSortKey; direction: "asc" | "desc" }>({ key: "ticker", direction: "asc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const rows = useMemo(() => filterEtfs(listings, query, market, sort.key, sort.direction), [query, market, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * pageSize, (current + 1) * pageSize);
  const sortBy = (key: EtfSortKey) => {
    setSort(value => ({ key, direction: value.key === key && value.direction === "asc" ? "desc" : "asc" }));
    setPage(0);
  };
  return <div className="mx-auto min-w-0 w-full max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8">
    <div className="mb-6 flex flex-wrap items-baseline gap-3"><h1 className="text-2xl font-bold text-slate-900">iShares ETFs</h1><span className="text-sm tabular-nums text-slate-500">{listings.length} funds</span></div>
    <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div role="group" aria-label="ETF market" className="inline-flex w-fit rounded-md border border-slate-200 bg-white p-0.5">{["All", "Canada", "U.S."].map(value => <button type="button" key={value} aria-pressed={market === value} onClick={() => { setMarket(value); setPage(0); }} className={`h-9 rounded px-4 text-sm font-medium ${market === value ? "bg-[#15233c] text-white" : "text-slate-600 hover:bg-slate-100"}`}>{value}</button>)}</div>
      <div className="relative w-full sm:max-w-sm"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400"/><input type="search" aria-label="Search ETFs" placeholder="Search ticker or fund name" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-10 text-sm text-slate-800 outline-none focus:border-[#397a62] focus:ring-1 focus:ring-[#397a62] [&::-webkit-search-cancel-button]:appearance-none"/>{query && <button type="button" onClick={() => { setQuery(""); setPage(0); }} title="Clear ETF search" aria-label="Clear ETF search" className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={15}/></button>}</div>
    </div>
    <div className="border border-slate-200 bg-white">
      <div className="min-w-0 w-full max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="iShares ETF table">
        <table className="w-full min-w-[830px] table-fixed text-sm">
          <caption className="sr-only">Canadian and U.S. iShares ETFs</caption>
          <colgroup><col className="w-[100px]"/><col/><col className="w-[90px]"/><col className="w-[110px]"/><col className="w-[90px]"/><col className="w-[135px]"/><col className="w-[96px]"/></colgroup>
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr>{columns.map(column => <th scope="col" key={column.key} aria-sort={sort.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="px-3 py-3 font-medium first:pl-5"><button type="button" onClick={() => sortBy(column.key)} aria-label={`Sort by ${column.label}`} className={`flex w-full items-center gap-1.5 ${column.numeric ? "justify-end" : "justify-start"}`}><span>{column.label}</span>{sort.key === column.key ? sort.direction === "asc" ? <ArrowUp size={13}/> : <ArrowDown size={13}/> : <ArrowUpDown size={13} className="text-slate-300"/>}</button></th>)}<th scope="col" className="sticky right-0 border-l border-slate-200 bg-slate-50 px-3 text-center font-medium">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{visible.map(row => <tr key={row.id} className="group hover:bg-slate-50/70">
            <th scope="row" className="break-words py-3 pl-5 pr-3 text-left font-semibold text-slate-900">{row.ticker}</th>
            <td className="px-3 py-3 leading-5 text-slate-700"><span className="block break-words">{row.name ?? "-"}</span></td>
            <td className="px-3 py-3 text-xs text-slate-500">{row.market}</td>
            <td className="px-3 py-3 text-right tabular-nums text-slate-700" title={row.aum === null ? "Unavailable" : new Intl.NumberFormat("en-US").format(row.aum)}>{etfAum(row.aum)}</td>
            <td className="px-3 py-3 text-right tabular-nums text-slate-700">{row.mer === null ? "-" : `${row.mer.toFixed(2)}%`}</td>
            <td className="px-3 py-3 text-xs tabular-nums text-slate-600">{etfDate(row.inceptionDate)}</td>
            <td className="sticky right-0 border-l border-slate-100 bg-white px-2 py-3 group-hover:bg-slate-50"><div className="flex justify-center gap-1">
              <button type="button" disabled={!row.symbol} title={row.symbol ? `Research ${row.symbol}` : "Yahoo listing unavailable"} aria-label={`Research ${row.ticker} (${row.market})`} onClick={() => row.symbol && onResearch(row.symbol)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[#21674f] hover:bg-emerald-50 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-30"><Search size={17}/></button>
              <button type="button" disabled={!row.symbol} title={row.symbol ? `Add ${row.symbol} to Backtest` : "Yahoo listing unavailable"} aria-label={`Add ${row.ticker} (${row.market}) to Backtest`} onClick={() => row.symbol && onBacktest(row.symbol, row.ticker)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-blue-700 hover:bg-blue-50 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-30"><FolderPlus size={17}/></button>
            </div></td>
          </tr>)}</tbody>
        </table>
        {!rows.length && <div role="status" className="py-14 text-center text-sm text-slate-500">No ETFs found.</div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        <span role="status" aria-live="polite" className="tabular-nums">{rows.length ? current * pageSize + 1 : 0}-{Math.min((current + 1) * pageSize, rows.length)} of {rows.length} funds</span>
        <div className="flex items-center gap-3"><label className="flex items-center gap-2">Rows<select aria-label="ETFs per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-8 rounded border border-slate-200 bg-white px-2 text-slate-700">{[25, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}</select></label><div className="flex items-center gap-1"><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous ETF page" title="Previous page" className="grid h-8 w-8 place-items-center rounded hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft size={16}/></button><span className="min-w-12 text-center tabular-nums">{current + 1} / {pages}</span><button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)} aria-label="Next ETF page" title="Next page" className="grid h-8 w-8 place-items-center rounded hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"><ChevronRight size={16}/></button></div></div>
      </div>
    </div>
    <p className="mt-3 text-xs leading-5 text-slate-400">Yahoo Finance snapshot. AUM uses each fund&apos;s reporting currency; values are not currency-converted. MER is Yahoo&apos;s expense ratio and may differ from the issuer&apos;s published MER.</p>
  </div>;
}
