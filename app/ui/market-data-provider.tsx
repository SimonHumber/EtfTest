"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { simulateLeverage } from "../lib/leverage";
import type { LeverageSettings, MarketSeries, Quote, RateHistory, RatePoint } from "../lib/market-types";

type MarketData = {
  series: Record<string, MarketSeries>;
  loadSeries: (symbol: string, quote?: Quote) => Promise<MarketSeries>;
  applyLeverage: (sourceIds: string[], settings: LeverageSettings) => Promise<MarketSeries[]>;
  getRiskFreeRates: () => Promise<RatePoint[]>;
};
const MarketDataContext = createContext<MarketData | null>(null);

export function MarketDataProvider({ children }: { children: React.ReactNode }) {
  const [series, setSeries] = useState<Record<string, MarketSeries>>({});
  const stored = useRef<Record<string, MarketSeries>>({});
  const pending = useRef(new Map<string, Promise<MarketSeries>>());
  const rates = useRef<{ data: RateHistory; time: number } | null>(null);
  const pendingRates = useRef<Promise<RateHistory> | null>(null);
  const save = useCallback((items: MarketSeries[]) => {
    stored.current = { ...stored.current, ...Object.fromEntries(items.map(item => [item.id, item])) };
    setSeries(stored.current);
  }, []);

  const loadSeries = useCallback(async (symbol: string, quote?: Quote) => {
    const id = symbol.trim().toUpperCase();
    const cached = stored.current[id];
    if (cached) {
      if (quote && !cached.simulation) {
        const updated = { ...cached, quote, currency: quote.currency };
        save([updated]);
        return updated;
      }
      return cached;
    }
    if (id.startsWith("SIM|")) throw new Error("This simulated ticker is no longer loaded. Apply leverage to its underlying again.");
    let request = pending.current.get(id);
    if (!request) {
      request = (async () => {
        const response = await fetch(`/api/market/history?symbol=${encodeURIComponent(id)}`);
        const history = await response.json();
        if (!response.ok || history.error) throw new Error(history.error || `Could not load ${id}.`);
        const item: MarketSeries = { id, name: id, currency: quote?.currency ?? history.currency ?? "USD", history, quote };
        save([item]);
        return item;
      })().finally(() => pending.current.delete(id));
      pending.current.set(id, request);
    }
    return request;
  }, [save]);

  const getRiskFreeRates = useCallback(async () => {
    if (!rates.current || Date.now() - rates.current.time > 86400000) {
      pendingRates.current ??= (async () => {
        const response = await fetch("/api/market/rates");
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || "Could not load ^IRX financing rates.");
        rates.current = { data, time: Date.now() };
        return data;
      })().finally(() => { pendingRates.current = null; });
      await pendingRates.current;
    }
    return rates.current!.data.points;
  }, []);

  const applyLeverage = useCallback(async (sourceIds: string[], settings: LeverageSettings) => {
    // Resolve only loaded sources; this action never downloads an underlying price series.
    const sources = [...new Set(sourceIds.map(id => stored.current[id]?.simulation?.underlyingId ?? id))].map(id => {
      const source = stored.current[id];
      if (!source) throw new Error(`Load ${id} before applying leverage.`);
      return source;
    });
    if (!sources.length) throw new Error("Load a ticker before applying leverage.");
    const points = await getRiskFreeRates();
    const simulations = sources.map(source => simulateLeverage(source, settings, points));
    save(simulations);
    return simulations;
  }, [save, getRiskFreeRates]);

  return <MarketDataContext.Provider value={{ series, loadSeries, applyLeverage, getRiskFreeRates }}>{children}</MarketDataContext.Provider>;
}

export function useMarketData() {
  const context = useContext(MarketDataContext);
  if (!context) throw new Error("MarketDataProvider is required.");
  return context;
}
