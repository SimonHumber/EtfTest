"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Building2, ExternalLink, LoaderCircle, Search, TrendingUp } from "lucide-react";
import { ChartHover } from "./chart-hover";
import { useMarketData } from "./market-data-provider";
import { indexWarning, maximumDrawdown, quoteForSeries } from "../lib/leverage";
import type { HistoryPoint, MarketHistory as History, Quote } from "../lib/market-types";
import type { TickerSelection } from "../lib/etf-directory";

type Suggestion = { symbol: string; name: string; type: string; exchange: string };
type Range = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "10Y" | "Max";
const ranges: Range[] = ["1D", "5D", "1M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "Max"];

const initial: Quote = { symbol: "VOO", name: "Vanguard S&P 500 ETF", price: 618.71, change: 2.98, changePercent: 0.48, currency: "USD", exchange: "NYSE Arca", sector: "Large Blend", industry: "Exchange Traded Fund", marketCap: 759_000_000_000, pe: 25.05, dividendYield: 1.18, fiftyTwoWeekHigh: 626.44, fiftyTwoWeekLow: 442.8, description: "Seeks to track the performance of the S&P 500 Index, representing large-capitalization companies in the United States." };

export function TickerView({ selection }: { selection?: TickerSelection } = {}) {
  const { series, loadSeries } = useMarketData();
  const [query, setQuery] = useState("");
  const [baseQuote, setQuote] = useState<Quote>(initial);
  const [activeId, setActiveId] = useState("");
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState("");
  const [range, setRange] = useState<Range>("1Y");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const searchVersion = useRef(0);
  const handledSelection = useRef<string | null>(null);
  const activeSeries = series[activeId];
  const history = activeSeries?.history ?? null;
  const quote = activeSeries ? quoteForSeries(activeSeries) : baseQuote;
  const activate = (id: string) => {
    setActiveId(id); setQuery(series[id]?.name ?? id); setSuggestions([]); setFocused(false); setHistoryError("");
  };
  useEffect(() => {
    const text = query.trim();
    if (!text || !focused) { setSuggestions([]); return; }
    let stale = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/market/search?query=${encodeURIComponent(text)}`);
        const payload = await response.json();
        if (!stale && response.ok) setSuggestions(payload.results ?? []);
      } catch { if (!stale) setSuggestions([]); }
    }, 220);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [query, focused]);
  const search = async (symbol = query) => {
    const requested = symbol.trim().toUpperCase();
    if (!requested) return;
    const version = ++searchVersion.current;
    const local = series[requested] ?? Object.values(series).find(item => item.name.toUpperCase() === requested);
    if (local?.simulation || local?.quote) { setError(""); setLoading(false); setHistoryLoading(false); activate(local.id); return; }
    setQuery(requested);
    setLoading(true);
    setError("");
    setSuggestions([]);
    setFocused(false);
    try {
      const response = await fetch(`/api/market/lookup?symbol=${encodeURIComponent(requested)}`);
      const payload = await response.json();
      if (version !== searchVersion.current) return;
      if (!response.ok || payload.error) throw new Error(payload.error || "No data was found for that ticker.");
      setQuote(payload);
      setQuery(payload.symbol || requested);
      setActiveId("");
      setHistoryLoading(true); setHistoryError("");
      try {
        const loaded = await loadSeries(requested, payload);
        if (version === searchVersion.current) setActiveId(loaded.id);
      } catch (err) { if (version === searchVersion.current) setHistoryError(err instanceof Error ? err.message : "Unable to load price history."); }
    } catch (requestError) { if (version === searchVersion.current) setError(requestError instanceof Error ? requestError.message : "Live data is unavailable. Check the yfinance service and try again."); }
    finally { if (version === searchVersion.current) { setLoading(false); setHistoryLoading(false); } }
  };
  useEffect(() => {
    if (!selection || handledSelection.current === selection.id) return;
    handledSelection.current = selection.id;
    void search(selection.symbol);
  }, [selection]);
  const change = hasNumber(quote.change) ? quote.change : 0;
  const changePercent = hasNumber(quote.changePercent) ? quote.changePercent : 0;
  const positive = change >= 0;
  const chartPoints = history ? pointsForRange(history, range) : [];
  const returnRows = ranges.map(period => ({ period, ...(history && !historyLoading && !historyError
    ? returnsForRange(history, period) : { total: null, annualized: null, drawdown: null }) }));
  const localSuggestions = focused && query.trim() ? Object.values(series).filter(item => item.simulation && item.name.toUpperCase().includes(query.trim().toUpperCase())) : [];
  const warning = indexWarning(activeSeries, series[activeSeries?.simulation?.underlyingId ?? ""]);
  const displaySuggestions = [...localSuggestions.map(item => ({ symbol: item.id, name: item.name, type: "Simulation", exchange: "Local" })), ...suggestions];
  return <div className="mx-auto min-w-0 w-full max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8">
    <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div><p className="mb-1 text-sm font-semibold text-[#397a62]">Market research</p><h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Know what you own.</h1><p className="mt-2 text-sm text-slate-500">Explore company fundamentals, prices, and historical context.</p></div>
      <form onSubmit={event => { event.preventDefault(); void search(); }} className="flex min-w-0 w-full max-w-md gap-2"><label className="relative block min-w-0 flex-1"><Search size={17} className="absolute left-3 top-3 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value.toUpperCase())} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setSuggestions([]); }} placeholder="Search symbol, e.g. VOO" autoComplete="off" className="h-11 min-w-0 w-full rounded-md border border-slate-300 bg-white pl-9 pr-10 text-sm outline-none ring-[#397a62] focus:ring-2" />{loading ? <LoaderCircle size={17} className="absolute right-3 top-3 animate-spin text-[#397a62]" aria-label="Searching" /> : displaySuggestions.length > 0 && <span className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">{displaySuggestions.map(item => <button type="button" key={`${item.symbol}-${item.exchange}`} onMouseDown={event => event.preventDefault()} onClick={() => void search(item.symbol)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[#edf5f0]"><span className="min-w-0"><span className="block text-sm font-bold text-slate-800">{series[item.symbol]?.name ?? item.symbol}</span><span className="block truncate text-xs text-slate-500">{item.name}</span></span><span className="shrink-0 text-right text-[11px] text-slate-400">{item.type}<br/>{item.exchange}</span></button>)}</span>}</label><button disabled={loading} className="rounded-md bg-[#15233c] px-4 text-sm font-semibold text-white hover:bg-[#22375c] disabled:opacity-70">Search</button></form>
    </div>
    {error && <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}
    <section className="min-w-0 w-full max-w-full border border-slate-200 bg-white shadow-panel">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:p-7"><div className="flex min-w-0 gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#edf3ef] text-[#397a62]"><TrendingUp size={23} /></span><div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><h2 className="min-w-0 text-xl [overflow-wrap:anywhere] font-bold text-slate-900">{quote.symbol}</h2><span className="min-w-0 text-sm text-slate-500 [overflow-wrap:anywhere]">{quote.name}</span></div><p className="mt-1 break-words text-xs font-medium uppercase tracking-wide text-slate-400">{quote.exchange} · {quote.currency}</p></div></div><div className="sm:text-right"><div className="text-2xl font-bold tabular-nums text-slate-900">{money(quote.price, quote.currency)}</div><div className={`mt-1 inline-flex items-center gap-1 text-sm font-semibold ${positive ? "text-[#17724a]" : "text-[#c44747]"}`}>{positive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}{signed(change)} ({signed(changePercent)}%)</div></div></div>
      <div className="grid min-w-0 grid-cols-1 gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">{[
        ["Market cap", compact(quote.marketCap)], ["AUM", compactMoney(quote.aum, quote.currency)], ["MER / Expense ratio", hasNumber(quote.expenseRatio) ? `${quote.expenseRatio.toFixed(2)}%` : "-"], ["P/E ratio", fixed(quote.pe)], ["Dividend yield", hasNumber(quote.dividendYield) ? `${quote.dividendYield.toFixed(2)}%` : "-"], ["52 week range", `${money(quote.fiftyTwoWeekLow, quote.currency)} - ${money(quote.fiftyTwoWeekHigh, quote.currency)}`]
      ].map(([label, value]) => <div className="min-w-0 bg-white p-5" key={label}><p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-base font-semibold tabular-nums text-slate-800 [overflow-wrap:anywhere]">{value}</p></div>)}</div>
    </section>
    <div className="mt-5 min-w-0 sm:max-w-md">
      <label className="min-w-0 text-xs font-medium text-slate-500">Loaded series<select aria-label="Research series" value={activeId} onChange={event => activate(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800"><option value="" disabled>Select a loaded ticker</option>{Object.values(series).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    {activeSeries?.simulation && warning && <p className="mt-3 text-xs text-amber-700">{warning}</p>}
    {activeSeries?.simulation?.coverageWarning && <p className="mt-3 text-xs text-amber-700">{activeSeries.simulation.coverageWarning}</p>}
    <div className="mt-6 grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section className="min-w-0 w-full max-w-full border border-slate-200 bg-white p-5 shadow-panel sm:p-7"><div className="mb-5 flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><h2 className="font-semibold text-slate-900">Historical price</h2><p className="mt-1 text-sm text-slate-500">5-minute prices for 1D; 30-minute prices for 5D</p></div><div className="min-w-0 max-w-full overflow-x-auto sm:flex-1"><div className="flex w-max rounded-md border border-slate-200 p-0.5">{ranges.map(option => <button key={option} onClick={() => setRange(option)} className={`h-7 shrink-0 rounded px-2.5 text-xs font-semibold ${range === option ? "bg-[#15233c] text-white" : "text-slate-500 hover:bg-slate-100"}`}>{option}</button>)}</div></div></div><MiniChart key={`${quote.symbol}-${range}`} points={chartPoints} range={range} currency={quote.currency} loading={historyLoading} error={historyError} /><div className="mt-5 border-t border-slate-100 pt-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Annualized returns</h3>
        <div className="min-w-0 w-full max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Research returns table"><table className="w-full min-w-[440px] table-fixed text-sm">
          <thead className="border-b border-slate-200 text-xs text-slate-500">
            <tr><th scope="col" className="w-1/5 pb-3 text-left font-medium">Range</th><th scope="col" className="pb-3 text-right font-medium">Total return</th><th scope="col" className="pb-3 pl-2 text-right font-medium" title="Compounded yearly equivalent using elapsed calendar days. Periods under one year are extrapolated.">Annualized return</th><th scope="col" className="pb-3 pl-2 text-right font-medium">Max drawdown</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">{returnRows.map(row => <tr key={row.period}>
            <th scope="row" className="py-2.5 text-left font-medium text-slate-700">{row.period}</th>
            {[row.total, row.annualized, row.drawdown].map((value, index) => <td key={index} className={`break-words py-2.5 pl-2 text-right font-semibold tabular-nums ${!hasNumber(value) ? "text-slate-400" : value < 0 ? "text-rose-600" : "text-[#17724a]"}`}>{percent(value)}</td>)}
          </tr>)}</tbody>
        </table></div>
      </div></section>
      <section className="min-w-0 w-full max-w-full border border-slate-200 bg-white p-5 shadow-panel sm:p-7"><div className="mb-6 flex items-center gap-2"><Building2 size={18} className="text-[#397a62]" /><h2 className="font-semibold text-slate-900">Profile</h2></div><dl className="space-y-4 text-sm"><Data label="Category" value={quote.sector || "-"}/><Data label="Classification" value={quote.industry || "-"}/></dl><p className="mt-7 border-t border-slate-100 pt-5 text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{quote.description || "No business summary is available for this symbol."}</p><a href={`https://finance.yahoo.com/quote/${encodeURIComponent(activeSeries?.simulation?.underlyingId ?? quote.symbol)}`} target="_blank" rel="noreferrer" className="mt-5 inline-flex max-w-full items-center gap-1 text-sm font-semibold text-[#21674f] hover:underline">{activeSeries?.simulation ? "Underlying on Yahoo Finance" : "Open on Yahoo Finance"} <ExternalLink size={14}/></a></section>
    </div>
  </div>;
}
function Data({ label, value }: { label: string; value: string }) { return <div className="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4"><dt className="min-w-0 break-words text-slate-500">{label}</dt><dd className="min-w-0 text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{value}</dd></div>; }
function MiniChart({ points, range, currency, loading, error }: { points: HistoryPoint[]; range: Range; currency: string; loading: boolean; error: string }) {
  if (loading) return <div className="grid h-56 place-items-center border-y border-slate-100 text-sm text-slate-400">Loading prices...</div>;
  if (error) return <div className="grid h-56 place-items-center border-y border-slate-100 px-6 text-center text-sm text-amber-700">{error}</div>;
  if (points.length < 2) return <div className="grid h-56 place-items-center border-y border-slate-100 text-sm text-slate-400">No price history is available for this range.</div>;
  const values = points.map(point => point.close);
  const rawLow = Math.min(...values);
  const rawHigh = Math.max(...values);
  const padding = Math.max((rawHigh - rawLow) * 0.12, rawHigh * .001, .01);
  const low = Math.max(0, rawLow - padding);
  const high = rawHigh + padding;
  const width = 640;
  const height = 190;
  const line = points.map((point, index) => `${(index / (points.length - 1) * width).toFixed(2)},${(height - ((point.close - low) / (high - low)) * height).toFixed(2)}`).join(" ");
  const positive = points.at(-1)!.close >= points[0].close;
  const middle = points[Math.floor(points.length / 2)];
  return <div className="relative h-64 pl-20"><div className="chart-grid absolute bottom-7 left-20 right-0 top-0"/><div className="absolute bottom-7 left-0 top-0 flex flex-col justify-between text-right text-[11px] tabular-nums text-slate-400"><span>{money(high, currency)}</span><span>{money((high + low) / 2, currency)}</span><span>{money(low, currency)}</span></div><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute left-20 top-0 h-[calc(100%-1.75rem)] w-[calc(100%-5rem)] overflow-visible"><defs><linearGradient id="return-area" x1="0" x2="0" y1="0" y2="1"><stop stopColor={positive ? "#4f9d78" : "#d96b6b"} stopOpacity=".2"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient></defs><path d={`M ${line} L ${width},${height} L 0,${height} Z`} fill="url(#return-area)"/><polyline points={line} fill="none" stroke={positive ? "#247154" : "#c44747"} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"/></svg><div className="absolute bottom-7 left-20 right-0 top-0"><ChartHover points={points.map(point => ({ date: point.date, values: [{ name: "Share price", value: point.close, color: positive ? "#247154" : "#c44747" }] }))} min={low} max={high} formatValue={value => money(value, currency)}/></div><div className="absolute bottom-0 left-20 right-0 flex justify-between text-[11px] text-slate-400"><span>{shortDate(points[0].date, range)}</span><span>{shortDate(middle.date, range)}</span><span>{shortDate(points.at(-1)!.date, range)}</span></div></div>;
}
function hasNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function money(value?: number, currency = "USD") { return hasNumber(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value) : "-"; }
function compact(value?: number) { return hasNumber(value) ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value) : "-"; }
function compactMoney(value: number | null | undefined, currency: string) { return hasNumber(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value) : "-"; }
function fixed(value?: number) { return hasNumber(value) ? value.toFixed(2) : "-"; }
function signed(value?: number) { return hasNumber(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}` : "-"; }
function percent(value?: number | null) { return hasNumber(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "-"; }
function shortDate(value: string, range: Range) {
  if (range === "1D") return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (range === "5D" && value.includes("T")) return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function pointsForRange(history: History, range: Range): HistoryPoint[] {
  if (range === "1D" || range === "5D") return intradayPointsForRange(history, range);
  const points = history.points;
  if (range === "Max") return rebasePoints(points);
  const start = rangeStartDate(range, points.at(-1)?.date ?? new Date().toISOString().slice(0, 10));
  const visible = points.filter(point => point.date >= start);
  return rebasePoints(visible);
}
function rangeStartDate(range: Range, end: string): string {
  const start = new Date(`${end.slice(0, 10)}T00:00:00Z`);
  if (range === "YTD") start.setUTCMonth(0, 1);
  else {
    const months = range === "1M" ? 1 : range === "6M" ? 6 : range === "1Y" ? 12 : range === "3Y" ? 36 : range === "5Y" ? 60 : 120;
    const day = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(day, lastDay));
  }
  return start.toISOString().slice(0, 10);
}
function returnsForRange(history: History, range: Range): { total: number | null; annualized: number | null; drawdown: number | null } {
  const unavailable = { total: null, annualized: null, drawdown: null };
  let first: { date: string; close: number } | undefined;
  let last: { date: string; close: number } | undefined;
  if (range === "1D" || range === "5D") {
    const points = intradayPointsForRange(history, range);
    if (!points.length) return unavailable;
    last = points.at(-1);
    first = history.points.findLast(point => point.date < points[0].date.slice(0, 10));
    // A newly listed ticker may not have a previous daily close.
    first ??= points[0];
  } else {
    last = history.points.at(-1);
    if (!last) return unavailable;
    const target = rangeStartDate(range, last.date);
    first = range === "Max" ? history.points[0] : history.points.findLast(point => range === "YTD" ? point.date < target : point.date <= target);
  }
  if (!first || !last || !hasNumber(first.close) || !hasNumber(last.close) || first.close <= 0 || last.close < 0) return unavailable;
  const days = (Date.parse(`${last.date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${first.date.slice(0, 10)}T00:00:00Z`)) / 86400000;
  if (days <= 0) return unavailable;
  const total = (last.close / first.close - 1) * 100;
  const annualized = Math.expm1(Math.log(last.close / first.close) * 365.25 / days) * 100;
  const path = range === "1D" || range === "5D" ? intradayPointsForRange(history, range) : history.points.filter(point => point.date >= first!.date && point.date <= last!.date);
  const drawdown = maximumDrawdown([first, ...path]);
  return { total: Number.isFinite(total) ? total : null, annualized: Number.isFinite(annualized) ? annualized : null, drawdown };
}
function rebasePoints(points: HistoryPoint[]) { if (points.length < 2) return points; const firstClose = points[0].close; return points.map(point => ({ ...point, return: firstClose > 0 ? (point.close / firstClose - 1) * 100 : 0 })); }
function intradayPointsForRange(history: History, range: Range): HistoryPoint[] {
  const source = history.intradayPoints?.[range === "1D" ? "5m" : "30m"] ?? [];
  if (!source.length) return [];
  const sessions = [...new Set(source.map(point => point.date.slice(0, 10)))];
  const selected = range === "1D" ? source.filter(point => point.date.startsWith(sessions.at(-1)!)) : source;
  if (!selected.length) return [];
  const session = selected[0].date.slice(0, 10);
  const base = history.sessionBases?.[session] ?? selected[0].close;
  return selected.map(point => ({ ...point, return: base > 0 ? (point.close / base - 1) * 100 : 0 }));
}
