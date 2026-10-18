"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { parseIndexDirectory, type IndexListing } from "../lib/index-directory";
import { BacktestView } from "./backtest-view";

export function IndicesView({ active }: { active: boolean }) {
  const [listings, setListings] = useState<IndexListing[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || listings) return;
    const controller = new AbortController();
    setError("");
    void fetch("/indices.txt", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load the index list.");
      const items = parseIndexDirectory(await response.text());
      if (!items.length) throw new Error("The index list is empty.");
      if (!controller.signal.aborted) setListings(items);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load the index list."); });
    return () => controller.abort();
  }, [active, listings, attempt]);
  if (listings) return <BacktestView indices={listings}/>;
  return <div className="mx-auto max-w-[1440px] px-4 py-12 text-center text-sm text-slate-500">{error ? <><p role="alert">{error}</p><button onClick={() => setAttempt(value => value + 1)} className="mx-auto mt-4 inline-flex h-10 items-center gap-2 rounded border border-slate-200 px-4"><RotateCcw size={16}/>Retry</button></> : <LoaderCircle aria-label="Loading index list" className="mx-auto animate-spin"/>}</div>;
}
