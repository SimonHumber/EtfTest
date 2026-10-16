"use client";

import { useEffect, useId, useState } from "react";
import { LoaderCircle } from "lucide-react";

type Suggestion = { symbol: string; name: string; type: string; exchange: string };

export function BacktestTickerInput({ value, onChange }: { value: string; onChange: (symbol: string) => void }) {
  const listId = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !query?.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/market/search?query=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload.error) throw new Error("Ticker search is unavailable.");
        if (!controller.signal.aborted) setSuggestions(payload.results ?? []);
      } catch {
        if (!controller.signal.aborted) setError("Ticker search is unavailable.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, open]);

  const close = () => { setOpen(false); setLoading(false); setActive(-1); };
  const select = (suggestion: Suggestion) => {
    onChange(suggestion.symbol);
    setQuery(null);
    setSuggestions([]);
    close();
  };

  return <div className="relative min-w-0" onBlur={close}>
    <input value={value} placeholder="Ticker" autoComplete="off" spellCheck={false}
      role="combobox" aria-label="Holding ticker" aria-autocomplete="list" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      onChange={event => {
        const next = event.target.value.toUpperCase();
        onChange(next);
        setQuery(next);
        setSuggestions([]);
        setActive(-1);
        setError("");
        setOpen(Boolean(next.trim()));
        setLoading(Boolean(next.trim()));
      }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        else if (open && suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          setActive(index => event.key === "ArrowDown" ? (index + 1) % suggestions.length : (index <= 0 ? suggestions.length - 1 : index - 1));
        } else if (open && event.key === "Enter" && active >= 0 && suggestions[active]) {
          event.preventDefault(); select(suggestions[active]);
        }
      }}
      className="h-8 w-full min-w-0 rounded border border-slate-200 py-0 pl-2 pr-7 text-xs font-semibold uppercase outline-none focus:border-[#397a62]"/>
    {open && loading && <LoaderCircle size={14} aria-label="Searching tickers" className="pointer-events-none absolute right-2 top-2 animate-spin text-[#397a62]"/>}
    {open && <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
      <ul id={listId} role="listbox" aria-label="Ticker suggestions">
        {suggestions.map((suggestion, index) => <li key={`${suggestion.symbol}-${suggestion.exchange}`}>
          <button type="button" role="option" id={`${listId}-${index}`} aria-selected={active === index} tabIndex={-1}
            onPointerDown={event => event.preventDefault()} onClick={() => select(suggestion)}
            className={`block w-full px-3 py-2 text-left hover:bg-[#edf5f0] ${active === index ? "bg-[#edf5f0]" : ""}`}>
            <span className="flex flex-wrap items-baseline justify-between gap-x-2"><span className="text-xs font-bold text-slate-800">{suggestion.symbol}</span><span className="text-[10px] text-slate-400">{suggestion.exchange}</span></span>
            <span className="block truncate text-xs text-slate-500" title={suggestion.name}>{suggestion.name}</span>
          </button>
        </li>)}
      </ul>
      {!suggestions.length && <p role="status" className="px-3 py-2 text-xs text-slate-500">{loading ? "Searching..." : error || "No matching tickers."}</p>}
    </div>}
  </div>;
}
