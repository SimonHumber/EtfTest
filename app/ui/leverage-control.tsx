"use client";

import { useState } from "react";
import { ChevronDown, LoaderCircle, Zap } from "lucide-react";
import { defaultLeverageSettings, indexWarning } from "../lib/leverage";
import type { MarketSeries } from "../lib/market-types";
import { useMarketData } from "./market-data-provider";

export function LeverageControl({ sourceIds, onApplied, disabled = false }: { sourceIds: string[]; onApplied: (items: MarketSeries[]) => void | Promise<void>; disabled?: boolean }) {
  const { series, applyLeverage } = useMarketData();
  const [leverage, setLeverage] = useState(String(defaultLeverageSettings.leverage));
  const [custom, setCustom] = useState(false);
  const [expense, setExpense] = useState("0.95");
  const [spread, setSpread] = useState("0.50");
  const [target, setTarget] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sources = [...new Set(sourceIds.map(id => series[id]?.simulation?.underlyingId ?? id))].filter(id => series[id]);
  const selected = target === "all" || !sources.includes(target) ? sources : [target];
  const warnings = selected.map(id => indexWarning(series[id])).filter(Boolean);
  const run = async () => {
    setBusy(true); setError("");
    try {
      if (![leverage, expense, spread].every(value => value.trim())) throw new Error("Enter leverage, annual expense ratio, and financing spread.");
      const items = await applyLeverage(selected, { leverage: Number(leverage), expenseRatio: Number(expense) / 100, financingSpread: Number(spread) / 100 });
      await onApplied(items);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to apply leverage."); }
    finally { setBusy(false); }
  };
  const known = ["3", "2", "1.5", "-1", "-2", "-3"];
  return <div className="space-y-3">
    <div className="flex flex-wrap items-start gap-3">
      <button type="button" onClick={() => void run()} disabled={disabled || busy || !sources.length} title={!sources.length ? "Load ticker prices first" : "Create a daily-reset leveraged simulation"} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-[#21674f] px-3 text-xs font-semibold text-white hover:bg-[#18503d] disabled:opacity-50">
        {busy ? <LoaderCircle size={15} className="animate-spin"/> : <Zap size={15}/>} {busy ? "Applying..." : "Apply Leverage"}
      </button>
      <details className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white">
        <summary className="flex h-9 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold text-slate-600"><ChevronDown size={14}/>Advanced</summary>
        <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">
          {sources.length > 1 && <label className="min-w-0 text-xs text-slate-500">Underlying<select value={sources.includes(target) ? target : "all"} onChange={event => setTarget(event.target.value)} className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-slate-800"><option value="all">All loaded holdings</option>{sources.map(id => <option key={id} value={id}>{series[id].name}</option>)}</select></label>}
          <label className="min-w-0 text-xs text-slate-500">Leverage<select value={custom ? "custom" : leverage} onChange={event => { setCustom(event.target.value === "custom"); if (event.target.value !== "custom") setLeverage(event.target.value); }} className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-slate-800">{known.map(value => <option value={value} key={value}>{value}x{value === "3" ? " (default)" : ""}</option>)}<option value="custom">Custom</option></select>{custom && <input type="number" step="any" value={leverage} onChange={event => setLeverage(event.target.value)} aria-label="Custom leverage" className="mt-2 h-9 w-full rounded border border-slate-200 px-2 text-slate-800"/>}</label>
          <label className="min-w-0 text-xs text-slate-500">Expense ratio (%/yr)<input type="number" min="0" step="any" value={expense} onChange={event => setExpense(event.target.value)} className="mt-1 h-9 w-full rounded border border-slate-200 px-2 text-slate-800"/></label>
          <label className="min-w-0 text-xs text-slate-500">Financing spread (%/yr)<input type="number" min="0" step="any" value={spread} onChange={event => setSpread(event.target.value)} className="mt-1 h-9 w-full rounded border border-slate-200 px-2 text-slate-800"/></label>
          <div className="text-xs text-slate-500">Risk-free rate<p className="mt-2 font-medium text-slate-700">^IRX / 100 (automatic)</p></div>
        </div>
      </details>
    </div>
    {warnings.map(warning => <p key={warning} className="text-xs leading-5 text-amber-700">{warning}</p>)}
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </div>;
}
