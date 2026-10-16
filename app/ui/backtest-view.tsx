"use client";

import { useMemo, useRef, useState } from "react";
import { CalendarDays, CirclePlus, Download, GripVertical, Minus, Play, Plus, Trash2, X } from "lucide-react";
import { ChartHover } from "./chart-hover";
import { BacktestTickerInput } from "./backtest-ticker-input";
import { useMarketData } from "./market-data-provider";
import { PortfolioLeverageOptions } from "./portfolio-leverage-options";
import { combineSeries, createPortfolioBasket, indexWarning, simulateLeverage } from "../lib/leverage";
import type { MarketSeries, PortfolioLeverageConfig, RatePoint } from "../lib/market-types";

type Holding = { id: string; symbol: string; weight: number };
type Portfolio = { id: string; name: string; color: string; holdings: Holding[]; leverage?: PortfolioLeverageConfig };
type CashFlow = { id: string; type: "initial" | "recurring" | "one-time"; amount: number; date: string; frequency?: "monthly" | "weekly" | "quarterly" };
type Result = { date: string; values: Record<string, number>; contributions: number };
type PriceRow = { date: string; prices: Record<string, number> };
type ChartRange = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "10Y" | "Max";
const chartRanges: ChartRange[] = ["1D", "5D", "1M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "Max"];

const colors = ["#17724a", "#266ad1", "#b35f24", "#9a3d85"];
export function BacktestView() {
  const { series, loadSeries, getRiskFreeRates } = useMarketData();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([
    { id: "core", name: "Portfolio", color: colors[0], holdings: [{ id: "h1", symbol: "VTI", weight: 60 }, { id: "h2", symbol: "VXUS", weight: 30 }, { id: "h3", symbol: "BND", weight: 10 }] },
    { id: "alternative", name: "Portfolio 2", color: colors[1], holdings: [{ id: "h4", symbol: "VOO", weight: 100 }] },
  ]);
  const [flows, setFlows] = useState<CashFlow[]>([
    { id: "initial", type: "initial", amount: 10000, date: "2022-01-03" },
    { id: "monthly", type: "recurring", amount: 0, date: "2022-02-01", frequency: "monthly" },
  ]);
  const [flowAmountDrafts, setFlowAmountDrafts] = useState<Record<string, string>>({});
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [priceHistory, setPriceHistory] = useState<PriceRow[] | null>(null);
  const [testedPortfolios, setTestedPortfolios] = useState<Portfolio[]>([]);
  const [intradayPriceHistory, setIntradayPriceHistory] = useState<Partial<Record<"5m" | "30m", PriceRow[]>>>({});
  const [chartRange, setChartRange] = useState<ChartRange>("Max");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [portfolioWarnings, setPortfolioWarnings] = useState<string[]>([]);
  const sourceSnapshot = useRef<{ portfolios: Portfolio[]; sources: MarketSeries[] } | null>(null);
  const leverageEdits = useRef<Record<string, PortfolioLeverageConfig>>({});
  const rateSnapshot = useRef<RatePoint[]>([]);
  const calculationVersion = useRef(0);
  const displayPortfolios = useMemo(() => {
    const metadata = new Map(portfolios.map(portfolio => [portfolio.id, { name: portfolio.name, color: portfolio.color }]));
    return testedPortfolios.map(portfolio => ({ ...portfolio, ...metadata.get(portfolio.id) }));
  }, [portfolios, testedPortfolios]);
  const updatePortfolio = (id: string, patch: Partial<Portfolio>) => setPortfolios(items => items.map(p => p.id === id ? { ...p, ...patch } : p));
  const updateHolding = (portfolioId: string, holdingId: string, patch: Partial<Holding>) => setPortfolios(items => items.map(p => p.id === portfolioId ? { ...p, holdings: p.holdings.map(h => h.id === holdingId ? { ...h, ...patch } : h) } : p));
  const withLeverageEdits = (items: Portfolio[]) => items.map(portfolio => ({ ...portfolio, leverage: leverageEdits.current[portfolio.id] ?? portfolio.leverage }));
  const commitBacktest = (prepared: ReturnType<typeof prepareBacktest>) => {
    setPriceHistory(prepared.priceHistory);
    setIntradayPriceHistory(prepared.intradayPriceHistory);
    setTestedPortfolios(prepared.portfolios);
    setPortfolioWarnings(prepared.warnings);
    setError("");
  };
  const updateLeverage = async (id: string, leverage: PortfolioLeverageConfig) => {
    updatePortfolio(id, { leverage });
    leverageEdits.current = { ...leverageEdits.current, [id]: leverage };
    const snapshot = sourceSnapshot.current;
    if (!snapshot?.portfolios.some(portfolio => portfolio.id === id)) return;
    const version = ++calculationVersion.current;
    const current = withLeverageEdits(snapshot.portfolios);
    // Keep the last valid graph while a numeric field is temporarily empty.
    if (current.some(portfolio => portfolio.leverage?.enabled && !Object.values(portfolio.leverage.settings).every(Number.isFinite))) return;
    try {
      if (current.some(portfolio => portfolio.leverage?.enabled) && !rateSnapshot.current.length) rateSnapshot.current = await getRiskFreeRates();
      if (version !== calculationVersion.current || sourceSnapshot.current !== snapshot) return;
      commitBacktest(prepareBacktest(current, snapshot.sources, rateSnapshot.current, series));
    } catch (err) {
      if (version === calculationVersion.current) setError(err instanceof Error ? err.message : "Could not update leverage.");
    }
  };
  const commitFlowAmount = (flow: CashFlow) => {
    const draft = flowAmountDrafts[flow.id];
    if (draft === undefined) return;
    const amount = Number(draft);
    if (draft.trim() && Number.isFinite(amount) && amount >= 0) {
      setFlows(items => items.map(item => item.id === flow.id ? { ...item, amount } : item));
    }
    setFlowAmountDrafts(items => { const next = { ...items }; delete next[flow.id]; return next; });
  };
  const run = async (submittedPortfolios: Portfolio[] = portfolios) => {
    calculationVersion.current += 1;
    setLoading(true); setError("");
    try {
      const symbols = [...new Set(submittedPortfolios.flatMap(portfolio => portfolio.holdings.map(holding => holding.symbol.trim().toUpperCase()).filter(Boolean)))];
      if (!symbols.length) throw new Error("Add at least one ticker.");
      const loaded = await Promise.all(symbols.map(symbol => loadSeries(symbol)));
      if (withLeverageEdits(submittedPortfolios).some(portfolio => portfolio.leverage?.enabled)) rateSnapshot.current = await getRiskFreeRates();
      const prepared = prepareBacktest(withLeverageEdits(submittedPortfolios), loaded, rateSnapshot.current, series);
      calculationVersion.current += 1;
      sourceSnapshot.current = { portfolios: submittedPortfolios, sources: loaded };
      commitBacktest(prepared);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not run backtest."); }
    finally { setLoading(false); }
  };
  const simulationWarnings = [...new Set(testedPortfolios.flatMap(portfolio => portfolio.holdings.flatMap(holding => {
    const item = series[holding.symbol];
    if (!item?.simulation) return [];
    return [indexWarning(item, series[item.simulation.underlyingId]), item.simulation.coverageWarning].filter((warning): warning is string => Boolean(warning));
  })))];
  const exportResults = () => {
    const header = ["Date", ...displayPortfolios.map(portfolio => portfolio.name), "Cash flow"];
    const rows = results.map(row => [row.date, ...displayPortfolios.map(portfolio => (row.values[portfolio.id] ?? "").toString()), row.contributions.toString()]);
    const csv = [header, ...rows].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "atlas-backtest.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const results = useMemo(() => calculateResults(priceHistory, testedPortfolios, flows, start, end), [priceHistory, testedPortfolios, flows, start, end]);
  const summary = useMemo(() => displayPortfolios.map(p => ({ portfolio: p, start: results[0]?.values[p.id] ?? 0, end: results.at(-1)?.values[p.id] ?? 0, drawdown: portfolioDrawdown(results, p.id) })), [displayPortfolios, results]);
  const visibleResults = useMemo(() => chartRange === "1D" || chartRange === "5D"
    ? intradayResultsForRange(priceHistory, intradayPriceHistory[chartRange === "1D" ? "5m" : "30m"] ?? [], results, testedPortfolios, flows, start, end, chartRange)
    : resultsForRange(results, chartRange), [priceHistory, intradayPriceHistory, results, testedPortfolios, flows, start, end, chartRange]);
  return <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8">
    <div className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div><p className="mb-1 text-sm font-semibold text-[#397a62]">Portfolio lab</p><h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Compare your investing ideas.</h1><p className="mt-2 text-sm text-slate-500">Model holdings, deposits, and historical performance in one place.</p></div>
      <div className="flex flex-wrap items-center gap-2"><DateInput value={start} onChange={setStart}/><span className="text-slate-400">to</span><DateInput value={end} onChange={setEnd}/><button onClick={() => void run()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#15233c] px-4 text-sm font-semibold text-white hover:bg-[#22375c] disabled:opacity-70"><Play size={15} fill="currentColor"/>{loading ? "Running..." : "Run backtest"}</button></div>
    </div>
    {error && <div className="mb-5 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
    <div className="grid items-start gap-6 xl:grid-cols-[410px_minmax(0,1fr)]">
      <aside className="space-y-5">
        <section className="border border-slate-200 bg-white shadow-panel"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold text-slate-900">Portfolios</h2><p className="mt-0.5 text-xs text-slate-500">Weights rebalance daily</p></div><button onClick={() => setPortfolios(p => [...p, { id: crypto.randomUUID(), name: `Portfolio ${p.length + 1}`, color: colors[p.length % colors.length], holdings: [{ id: crypto.randomUUID(), symbol: "", weight: 100 }] }])} aria-label="Add portfolio" title="Add portfolio" className="grid h-8 w-8 place-items-center rounded-md text-[#21674f] hover:bg-[#edf5f0]"><CirclePlus size={20}/></button></div>
          <div className="divide-y divide-slate-100">{portfolios.map((portfolio, pIndex) => <div key={portfolio.id} className="p-4"><div className="mb-3 flex items-center gap-2"><input type="color" value={portfolio.color} onChange={event => updatePortfolio(portfolio.id, { color: event.target.value })} aria-label={`${portfolio.name || "Portfolio"} line colour`} title="Portfolio line colour" className="h-7 w-7 shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0.5"/><label className="min-w-0 flex-1"><span className="sr-only">Portfolio name</span><input value={portfolio.name} onChange={e => updatePortfolio(portfolio.id, { name: e.target.value })} placeholder="Portfolio" aria-label="Portfolio name" className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#397a62] focus:ring-1 focus:ring-[#397a62]"/></label><button onClick={() => setPortfolios(items => items.filter(p => p.id !== portfolio.id))} disabled={portfolios.length === 1} title="Remove portfolio" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 size={15}/></button></div>
            <div className="space-y-1">{portfolio.holdings.map(holding => <div key={holding.id} className="grid grid-cols-[15px_minmax(0,1fr)_76px_24px] items-center gap-1.5"><GripVertical size={14} className="text-slate-300"/><BacktestTickerInput value={holding.symbol} onChange={symbol => updateHolding(portfolio.id, holding.id, { symbol })}/><label className="relative"><input type="number" min="0" max="100" value={holding.weight} onChange={e => updateHolding(portfolio.id, holding.id, { weight: Number(e.target.value) })} className="h-8 w-full rounded border border-slate-200 px-2 pr-5 text-right text-xs outline-none focus:border-[#397a62]"/><span className="absolute right-2 top-2 text-xs text-slate-400">%</span></label><button onClick={() => updatePortfolio(portfolio.id, { holdings: portfolio.holdings.filter(h => h.id !== holding.id) })} aria-label="Remove holding" className="text-slate-300 hover:text-rose-500"><Minus size={15}/></button></div>)}</div>
            <div className="mt-3 flex justify-between"><button onClick={() => updatePortfolio(portfolio.id, { holdings: [...portfolio.holdings, { id: crypto.randomUUID(), symbol: "", weight: 0 }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#21674f] hover:underline"><Plus size={14}/> Add holding</button><span className={`text-xs font-medium ${totalWeight(portfolio) === 100 ? "text-slate-400" : "text-amber-600"}`}>{totalWeight(portfolio)}% total</span></div>
            <PortfolioLeverageOptions name={portfolio.name} value={portfolio.leverage} onChange={leverage => { void updateLeverage(portfolio.id, leverage); }}/>
          </div>)}</div>
        </section>
        <section className="border border-slate-200 bg-white shadow-panel"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold text-slate-900">Cash flows</h2><p className="mt-0.5 text-xs text-slate-500">Applied to every portfolio</p></div><button onClick={() => setFlows(items => [...items, { id: crypto.randomUUID(), type: "one-time", amount: 1000, date: start }])} title="Add cash flow" aria-label="Add cash flow" className="grid h-8 w-8 place-items-center rounded-md text-[#21674f] hover:bg-[#edf5f0]"><CirclePlus size={20}/></button></div>
          <div className="divide-y divide-slate-100">{flows.map(flow => <div key={flow.id} className="p-4"><div className="grid grid-cols-[minmax(0,1fr)_96px_26px] gap-2"><select value={flow.type} onChange={e => setFlows(items => items.map(f => f.id === flow.id ? { ...f, type: e.target.value as CashFlow["type"] } : f))} className="h-8 min-w-0 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700"><option value="initial">Starting balance</option><option value="recurring">Recurring</option><option value="one-time">One-time</option></select><label className="relative"><span className="absolute left-2 top-2 text-xs text-slate-400">$</span><input type="number" min="0" value={flowAmountDrafts[flow.id] ?? String(flow.amount)} onChange={e => setFlowAmountDrafts(items => ({ ...items, [flow.id]: e.target.value }))} onBlur={() => commitFlowAmount(flow)} className="h-8 w-full rounded border border-slate-200 pl-5 pr-1 text-right text-xs outline-none focus:border-[#397a62]"/></label><button onClick={() => setFlows(items => items.filter(f => f.id !== flow.id))} className="text-slate-300 hover:text-rose-500"><Trash2 size={15}/></button></div><div className="mt-2 grid grid-cols-2 gap-2">{flow.type === "initial" ? <span className="flex h-8 items-center text-xs text-slate-400">At beginning of date range</span> : <input type="date" value={flow.date} onChange={e => setFlows(items => items.map(f => f.id === flow.id ? { ...f, date: e.target.value } : f))} className="h-8 min-w-0 rounded border border-slate-200 px-2 text-xs text-slate-600"/>}{flow.type === "recurring" ? <select value={flow.frequency} onChange={e => setFlows(items => items.map(f => f.id === flow.id ? { ...f, frequency: e.target.value as CashFlow["frequency"] } : f))} className="h-8 rounded border border-slate-200 bg-white px-2 text-xs text-slate-600"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="quarterly">Quarterly</option></select> : <span/>}</div></div>)}</div>
        </section>
      </aside>
      <section className="min-w-0 border border-slate-200 bg-white shadow-panel"><div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-5 sm:p-6"><div><h2 className="font-semibold text-slate-900">Growth of $10,000</h2><p className="mt-1 text-sm text-slate-500">Includes every modeled cash flow</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex max-w-full overflow-x-auto rounded-md border border-slate-200 p-0.5">{chartRanges.map(option => <button key={option} onClick={() => setChartRange(option)} className={`h-7 shrink-0 rounded px-2 text-xs font-semibold ${chartRange === option ? "bg-[#15233c] text-white" : "text-slate-500 hover:bg-slate-100"}`}>{option}</button>)}</div><button onClick={exportResults} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Download size={15}/> Export</button></div></div>
        {priceHistory ? <PerformanceChart key={chartRange} portfolios={displayPortfolios} results={visibleResults} range={chartRange}/> : <div className="grid min-h-[300px] place-items-center px-5 text-center text-sm text-slate-500">Run backtest to load daily adjusted prices. Cash flows and date ranges will recalculate instantly from that data.</div>}
        <div className="grid border-t border-slate-200 sm:grid-cols-2">{summary.map(({ portfolio, start: starting, end: ending, drawdown }) => { const ret = starting ? ((ending - starting) / starting) * 100 : 0; return <div key={portfolio.id} className="border-b border-slate-100 p-5 last:border-b-0 sm:border-b-0 sm:[&:nth-child(even)]:border-l sm:p-6"><div className="mb-3 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: portfolio.color }}/><span className="text-sm font-semibold text-slate-800">{portfolio.name}</span></div><div className="flex items-end justify-between gap-3"><div><p className="text-2xl font-bold tabular-nums text-slate-900">{dollars(ending)}</p><p className="mt-1 text-xs text-slate-400">Ending value</p></div><span className={`text-sm font-bold tabular-nums ${ret >= 0 ? "text-[#17724a]" : "text-rose-600"}`}>{ret >= 0 ? "+" : ""}{ret.toFixed(1)}%</span></div><p className="mt-3 text-xs text-slate-500">Max drawdown <span className="font-semibold tabular-nums text-rose-600">{drawdown.toFixed(2)}%</span></p></div>; })}</div>
        {[...new Set([...portfolioWarnings, ...simulationWarnings])].map(warning => <p key={warning} className="border-t border-amber-100 bg-amber-50 px-5 py-3 text-xs text-amber-800">{warning}</p>)}
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-500">Historical performance is illustrative and does not guarantee future results. Prices are adjusted close data from Yahoo Finance.</div>
      </section>
    </div>
  </div>;
}

function prepareBacktest(portfolios: Portfolio[], sources: MarketSeries[], rates: RatePoint[], knownSeries: Record<string, MarketSeries>) {
  const byId = new Map(sources.map(item => [item.id, item]));
  const warnings: string[] = [];
  const prepared = portfolios.map(portfolio => {
    if (!portfolio.leverage?.enabled) return portfolio;
    const holdings = portfolio.holdings.filter(holding => holding.symbol.trim()).map(holding => ({ series: byId.get(holding.symbol.trim().toUpperCase())!, weight: holding.weight }));
    const basket = createPortfolioBasket(portfolio.id, portfolio.name, holdings);
    const simulation = simulateLeverage(basket, portfolio.leverage.settings, rates);
    byId.set(simulation.id, simulation);
    for (const holding of holdings) {
      const warning = indexWarning(holding.series, knownSeries[holding.series.simulation?.underlyingId ?? ""]);
      if (warning) warnings.push(`${portfolio.name}: ${warning}`);
    }
    if (simulation.simulation?.coverageWarning) warnings.push(`${portfolio.name}: ${simulation.simulation.coverageWarning}`);
    return { ...portfolio, holdings: [{ id: `leveraged-${portfolio.id}`, symbol: simulation.id, weight: 100 }] };
  });
  const used = [...new Set(prepared.flatMap(portfolio => portfolio.holdings.map(holding => holding.symbol.trim().toUpperCase()).filter(Boolean)))];
  return { ...combineSeries(used.map(id => byId.get(id)!)), portfolios: prepared, warnings: [...new Set(warnings)] };
}

function PerformanceChart({ portfolios, results, range }: { portfolios: Portfolio[]; results: Result[]; range: ChartRange }) {
  if (results.length < 2) return <div className="grid min-h-[300px] place-items-center px-5 text-center text-sm text-slate-500">No price history is available for this date range.</div>;
  const values = results.flatMap(row => portfolios.map(p => row.values[p.id]).filter((v): v is number => typeof v === "number"));
  const low = Math.min(...values); const high = Math.max(...values);
  const padding = Math.max((high - low) * .08, high * .001, 1);
  const min = Math.max(0, low - padding); const max = high + padding; const width = 720; const height = 315;
  const coordinates = (portfolio: Portfolio) => results.map((row, i) => { const x = (i / Math.max(results.length - 1, 1)) * width; const y = height - ((row.values[portfolio.id] - min) / Math.max(max - min, 1)) * height; return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
  return <div className="px-5 pb-4 pt-6 sm:px-6"><div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">{portfolios.map(p => <div className="flex items-center gap-2 text-xs font-medium text-slate-600" key={p.id}><span className="h-2.5 w-2.5 rounded-full" style={{background:p.color}}/>{p.name}</div>)}</div><div className="relative h-[300px] pl-20"><div className="chart-grid absolute bottom-7 left-20 right-0 top-0"/><div className="absolute bottom-7 left-0 top-0 flex flex-col justify-between text-right text-[11px] tabular-nums text-slate-400"><span>{dollars(max)}</span><span>{dollars((max + min) / 2)}</span><span>{dollars(min)}</span></div><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute left-20 top-0 h-[calc(100%-1.75rem)] w-[calc(100%-5rem)] overflow-visible">{portfolios.map(p => <polyline key={p.id} points={coordinates(p)} fill="none" stroke={p.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"/>)}</svg><div className="absolute bottom-7 left-20 right-0 top-0"><ChartHover points={results.map(row => ({ date: row.date, values: portfolios.map(portfolio => ({ name: portfolio.name, value: row.values[portfolio.id], color: portfolio.color })) }))} min={min} max={max} formatValue={value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}/></div><div className="absolute bottom-0 left-20 right-0 flex justify-between text-[11px] text-slate-400"><span>{labelDate(results[0]?.date, range)}</span><span>{labelDate(results[Math.floor(results.length / 2)]?.date, range)}</span><span>{labelDate(results.at(-1)?.date, range)}</span></div></div></div>;
}
function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <div className="flex h-10 items-center gap-1 rounded-md border border-slate-300 bg-white px-2"><label className="flex items-center gap-2"><CalendarDays size={15} className="text-slate-400"/><input type="date" value={value} onChange={e => onChange(e.target.value)} className="w-[112px] border-0 bg-transparent p-0 text-xs text-slate-600 outline-none"/></label>{value && <button type="button" onClick={() => onChange("")} aria-label="Clear date" title="Clear date" className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={15}/></button>}</div>; }
function totalWeight(portfolio: Portfolio) { return portfolio.holdings.reduce((sum, h) => sum + (Number(h.weight) || 0), 0); }
function portfolioDrawdown(results: Result[], id: string) {
  let nav = 1; let peak = 1; let worst = 0;
  for (let i = 1; i < results.length; i += 1) {
    const previous = results[i - 1].values[id];
    if (previous > 0) nav *= Math.max(0, (results[i].values[id] - results[i].contributions) / previous);
    peak = Math.max(peak, nav);
    worst = Math.min(worst, (nav / peak - 1) * 100);
  }
  return worst;
}
function calculateResults(priceHistory: PriceRow[] | null, portfolios: Portfolio[], flows: CashFlow[], start: string, end: string): Result[] {
  if (!priceHistory?.length) return [];
  const effectiveStart = start || priceHistory[0].date;
  const effectiveEnd = end || new Date().toLocaleDateString("sv-SE", { timeZone: "America/New_York" });
  if (effectiveStart > effectiveEnd) return [];
  const symbols = new Set(Object.keys(priceHistory[0].prices));
  if (portfolios.some(portfolio => portfolio.holdings.some(holding => holding.symbol.trim() && !symbols.has(holding.symbol.trim().toUpperCase())))) return [];

  const contributions = new Map<string, number>();
  const addContribution = (date: string, amount: number) => {
    let low = 0;
    let high = priceHistory.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (priceHistory[mid].date < date) low = mid + 1;
      else high = mid;
    }
    const row = priceHistory[low];
    if (row) contributions.set(row.date, (contributions.get(row.date) ?? 0) + amount);
  };
  const lastDate = priceHistory.at(-1)!.date;
  for (const flow of flows) {
    const amount = Number(flow.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (flow.type === "initial") {
      addContribution(effectiveStart, amount);
      continue;
    }
    if (!flow.date) continue;
    if (flow.type !== "recurring") {
      addContribution(flow.date, amount);
      continue;
    }
    let date = parseLocalDate(flow.date);
    const last = parseLocalDate(lastDate);
    while (date <= last) {
      addContribution(formatDate(date), amount);
      if (flow.frequency === "weekly") date.setDate(date.getDate() + 7);
      else date = addMonths(date, flow.frequency === "quarterly" ? 3 : 1);
    }
  }

  const values: Record<string, number> = Object.fromEntries(portfolios.map(portfolio => [portfolio.id, 0]));
  const rows: Result[] = [];
  for (let index = 0; index < priceHistory.length; index += 1) {
    const current = priceHistory[index];
    const previous = priceHistory[index - 1];
    const contribution = contributions.get(current.date) ?? 0;
    for (const portfolio of portfolios) {
      const holdings = portfolio.holdings.filter(holding => symbols.has(holding.symbol.trim().toUpperCase()) && Number(holding.weight) > 0);
      const weightTotal = holdings.reduce((sum, holding) => sum + Number(holding.weight), 0);
      const dailyReturn = previous && weightTotal > 0
        ? holdings.reduce((sum, holding) => {
            const symbol = holding.symbol.trim().toUpperCase();
            const before = previous.prices[symbol];
            const now = current.prices[symbol];
            return sum + (before > 0 && now >= 0 ? now / before - 1 : 0) * Number(holding.weight) / weightTotal;
          }, 0)
        : 0;
      values[portfolio.id] = values[portfolio.id] * (1 + dailyReturn) + contribution;
    }
    if (current.date >= effectiveStart && current.date <= effectiveEnd) rows.push({ date: current.date, values: { ...values }, contributions: contribution });
    if (current.date > effectiveEnd) break;
  }
  return rows;
}
function parseLocalDate(value: string) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function formatDate(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
function addMonths(value: Date, count: number) { const day = value.getDate(); const month = value.getMonth() + count; const next = new Date(value.getFullYear(), month, 1); const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(); next.setDate(Math.min(day, maxDay)); return next; }
function resultsForRange(results: Result[], range: ChartRange) {
  if (range === "Max" || results.length < 2) return results;
  const end = new Date(`${results.at(-1)!.date}T00:00:00`);
  const start = new Date(end);
  if (range === "1M") start.setMonth(start.getMonth() - 1);
  else if (range === "6M") start.setMonth(start.getMonth() - 6);
  else if (range === "YTD") start.setMonth(0, 1);
  else if (range === "1Y") start.setFullYear(start.getFullYear() - 1);
  else if (range === "3Y") start.setFullYear(start.getFullYear() - 3);
  else if (range === "5Y") start.setFullYear(start.getFullYear() - 5);
  else start.setFullYear(start.getFullYear() - 10);
  const key = formatDate(start);
  const from = results.findIndex(row => row.date >= key);
  return results.slice(Math.max(0, from - 1));
}
function intradayResultsForRange(priceHistory: PriceRow[] | null, intraday: PriceRow[], results: Result[], portfolios: Portfolio[], flows: CashFlow[], start: string, end: string, range: "1D" | "5D"): Result[] {
  if (!priceHistory?.length || !intraday.length || !results.length) return [];
  const effectiveStart = start || priceHistory[0].date;
  const effectiveEnd = end || new Date().toLocaleDateString("sv-SE", { timeZone: "America/New_York" });
  const available = intraday.filter(row => row.date.slice(0, 10) >= effectiveStart && row.date.slice(0, 10) <= effectiveEnd);
  const sessions = [...new Set(available.map(row => row.date.slice(0, 10)))].slice(range === "1D" ? -1 : -5);
  const selected = available.filter(row => sessions.includes(row.date.slice(0, 10)));
  if (!selected.length) return [];

  // Include a live session even when Yahoo's daily series has not caught up yet.
  const dailyByDate = new Map(priceHistory.map(row => [row.date, row]));
  const missing = new Map<string, PriceRow>();
  for (const row of selected) {
    const day = row.date.slice(0, 10);
    if (!dailyByDate.has(day)) missing.set(day, { ...row, date: day });
  }
  const daily = missing.size ? [...priceHistory, ...missing.values()].sort((a, b) => a.date.localeCompare(b.date)) : priceHistory;
  const dailyResults = missing.size ? calculateResults(daily, portfolios, flows, start, end) : results;
  const rows: Result[] = [];
  for (const session of sessions) {
    const sessionRows = selected.filter(row => row.date.startsWith(session));
    const previousPrice = daily.findLast(row => row.date < session);
    const previousResult = dailyResults.findLast(row => row.date < session);
    const contribution = dailyResults.find(row => row.date === session)?.contributions ?? 0;
    if (!rows.length) {
      const before = new Date(sessionRows[0].date);
      before.setMinutes(before.getMinutes() - (range === "1D" ? 5 : 30));
      rows.push({ date: `${session}T${String(before.getHours()).padStart(2, "0")}:${String(before.getMinutes()).padStart(2, "0")}:00`, values: Object.fromEntries(portfolios.map(p => [p.id, previousResult?.values[p.id] ?? contribution])), contributions: 0 });
    }
    for (const [index, row] of sessionRows.entries()) {
      const values = Object.fromEntries(portfolios.map(portfolio => {
        const holdings = portfolio.holdings.filter(h => h.symbol.trim() && h.weight > 0);
        const total = holdings.reduce((sum, h) => sum + h.weight, 0);
        const change = holdings.reduce((sum, h) => {
          const symbol = h.symbol.trim().toUpperCase();
          const base = previousPrice?.prices[symbol] ?? sessionRows[0].prices[symbol];
          const current = row.prices[symbol];
          return sum + (base > 0 && current >= 0 && total > 0 ? (current / base - 1) * h.weight / total : 0);
        }, 0);
        return [portfolio.id, (previousResult?.values[portfolio.id] ?? 0) * (1 + change) + contribution];
      }));
      rows.push({ date: row.date, values, contributions: index === 0 ? contribution : 0 });
    }
  }
  return rows;
}
function dollars(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0); }
function labelDate(value: string | undefined, range: ChartRange) {
  if (!value) return "-";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (range === "1D") return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString("en-US", range === "5D" ? { month: "short", day: "numeric" } : { year: "numeric", month: "short" });
}
