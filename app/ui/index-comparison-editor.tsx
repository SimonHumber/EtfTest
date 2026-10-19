"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Info, Plus, Search, Trash2, X } from "lucide-react";
import type { Portfolio } from "../lib/backtest-types";
import type { IndexListing } from "../lib/index-directory";
import type { PortfolioLeverageConfig } from "../lib/market-types";
import { PortfolioLeverageOptions } from "./portfolio-leverage-options";

export function IndexComparisonEditor({ listings, portfolios, onAdd, onUpdate, onRemove, onLeverage }: {
  listings: IndexListing[]; portfolios: Portfolio[];
  onAdd: (symbol: string, multiples: number[]) => void;
  onUpdate: (id: string, patch: Partial<Portfolio>) => void;
  onRemove: (id: string) => void;
  onLeverage: (id: string, value: PortfolioLeverageConfig) => void;
}) {
  const [description, setDescription] = useState<IndexListing | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (description) dialog.current?.showModal();
    else dialog.current?.close();
  }, [description]);
  const descriptionButton = (item: IndexListing) => <button type="button" aria-label={`About ${item.symbol}`} title={`About ${item.symbol}`} onClick={() => setDescription(item)} className="grid h-8 w-8 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-[#21674f]"><Info size={16}/></button>;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [multiples, setMultiples] = useState<number[]>([1]);
  const [custom, setCustom] = useState("");
  const [notice, setNotice] = useState("");
  const filtered = listings.filter(item => `${item.symbol} ${item.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedIndex = listings.find(item => item.symbol === selected);
  const customValid = custom.trim() !== "" && Number.isFinite(Number(custom));
  const choices = [...new Set([...multiples, ...(customValid ? [Number(custom)] : [])])];
  return <section className="min-w-0 border border-slate-200 bg-white shadow-panel">
    <details open className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between border-b border-slate-200 px-4 py-4 font-semibold text-slate-900">Index picker<ChevronDown size={16} className="shrink-0 text-slate-400 group-open:rotate-180"/></summary>
      <div className="space-y-3 p-4">
        <div className="relative"><Search size={16} className="absolute left-3 top-3 text-slate-400"/><input aria-label="Search indices" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or ticker" className="h-10 w-full min-w-0 rounded-md border border-slate-200 pl-9 pr-9 text-sm outline-none focus:border-[#397a62]"/>{query && <button title="Clear search" aria-label="Clear index search" onClick={() => setQuery("")} className="absolute right-1 top-1 grid h-8 w-8 place-items-center text-slate-400"><X size={15}/></button>}</div>
        <div role="listbox" aria-label="Available indices" onKeyDown={event => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]'));
          const position = options.indexOf(event.target as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (position + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
          event.preventDefault();
          options[next]?.focus();
        }} className="max-h-60 overflow-y-auto overscroll-contain border-y border-slate-100 lg:max-h-72">
          {filtered.map(item => <div key={item.symbol} className="flex items-center gap-1"><button type="button" role="option" aria-selected={selected === item.symbol} key={item.symbol} onClick={() => { setSelected(item.symbol); setNotice(""); }} className={`flex min-h-12 flex-1 min-w-0 items-center justify-between gap-2 px-2 py-2 text-left ${selected === item.symbol ? "bg-emerald-50 text-emerald-900" : "text-slate-700 hover:bg-slate-50"}`}><span className="min-w-0"><span className="block break-words text-sm font-medium">{item.name}</span><span className="block break-all text-xs text-slate-400">{item.symbol}</span></span></button>{descriptionButton(item)}</div>)}
          {!filtered.length && <p role="status" className="py-6 text-center text-sm text-slate-500">No indices found.</p>}
        </div>
        {selectedIndex && <fieldset className="min-w-0 space-y-3"><legend className="mb-2 break-words text-sm font-semibold text-slate-800">{selectedIndex.name}</legend><div className="flex flex-wrap gap-x-4 gap-y-3">{[1, 2, 3, -1, -2, -3].map(value => <label key={value} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700"><input type="checkbox" checked={multiples.includes(value)} onChange={event => setMultiples(items => event.target.checked ? [...items, value] : items.filter(item => item !== value))} className="h-4 w-4 accent-[#21674f]"/>{value}x</label>)}</div><label className="flex items-center justify-between gap-3 text-xs text-slate-500">Custom leverage<input aria-label="Custom index leverage" type="number" step="any" value={custom} onChange={event => setCustom(event.target.value)} placeholder="e.g. 1.5" className="h-9 w-28 rounded border border-slate-200 px-2 text-slate-800"/></label><button type="button" disabled={!choices.length} onClick={() => { onAdd(selected, choices); setNotice("Comparison selection saved."); }} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#21674f] px-3 text-sm font-semibold text-white disabled:opacity-40"><Plus size={16}/>Add comparisons</button></fieldset>}
        {notice && <p role="status" className="text-xs text-slate-500">{notice}</p>}
      </div>
    </details>
    <div className="border-t border-slate-200 px-4 py-3"><h2 className="text-sm font-semibold text-slate-900">Comparisons <span className="text-slate-400">({portfolios.length})</span></h2></div>
    <div className="divide-y divide-slate-100">{portfolios.map(portfolio => <div className="min-w-0 p-4" key={portfolio.id}>
      <div className="flex min-w-0 items-center gap-2"><input type="color" aria-label={`${portfolio.name} line colour`} title="Line colour" value={portfolio.color} onChange={event => onUpdate(portfolio.id, { color: event.target.value })} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0.5"/><input aria-label="Comparison name" value={portfolio.name} onChange={event => onUpdate(portfolio.id, { name: event.target.value })} className="h-9 min-w-0 flex-1 rounded border border-slate-200 px-2 text-sm font-semibold text-slate-800"/><button aria-label={`Remove ${portfolio.name}`} title="Remove comparison" onClick={() => onRemove(portfolio.id)} className="grid h-9 w-9 shrink-0 place-items-center text-slate-400 hover:text-rose-600"><Trash2 size={16}/></button></div>
      <div className="mt-2 flex items-center gap-1"><p className="min-w-0 break-words text-xs text-slate-500">{listings.find(item => item.symbol === portfolio.holdings[0].symbol)?.name} <span className="break-all">{portfolio.holdings[0].symbol}</span> · {portfolio.leverage?.enabled ? `${portfolio.leverage.settings.leverage}x (sim)` : "1x"}</p>{descriptionButton(listings.find(item => item.symbol === portfolio.holdings[0].symbol) ?? { symbol: portfolio.holdings[0].symbol, name: portfolio.holdings[0].symbol, description: "" })}</div>
      <PortfolioLeverageOptions name={portfolio.name} value={portfolio.leverage} onChange={value => onLeverage(portfolio.id, value)}/>
    </div>)}</div>
    <dialog ref={dialog} aria-labelledby="index-description-title" onCancel={() => setDescription(null)} onClose={() => setDescription(null)} onClick={event => { if (event.target === event.currentTarget) setDescription(null); }} className="fixed inset-0 m-auto max-h-[80vh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5"><div><h2 id="index-description-title" className="font-semibold text-slate-900">{description?.name}</h2><p className="mt-1 text-xs text-slate-500">{description?.symbol}</p></div><button type="button" autoFocus aria-label="Close description" onClick={() => setDescription(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-100"><X size={18}/></button></div>
      <p className="whitespace-pre-wrap p-5 text-sm leading-relaxed text-slate-600">{description?.description || "No description is available from Yahoo Finance for this index."}</p>
    </dialog>
  </section>;
}
