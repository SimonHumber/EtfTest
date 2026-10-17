"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, LineChart, LoaderCircle, Search, Table2, TrendingUp } from "lucide-react";
import { BacktestView } from "./ui/backtest-view";
import { TickerView } from "./ui/ticker-view";
import { EtfDirectoryView } from "./ui/etf-directory-view";
import type { TickerSelection } from "./lib/etf-directory";

type Tab = "research" | "backtest" | "etfs";

export default function Home() {
  return <Suspense fallback={<main className="min-h-screen bg-[#f7f8fa]" aria-busy="true"><div className="flex h-16 items-center gap-2 border-b border-slate-200 bg-white px-6 font-bold text-[#15233c]"><TrendingUp size={18}/>atlas</div><div role="status" aria-label="Loading workspace" className="mx-auto flex max-w-[1440px] justify-center p-12"><LoaderCircle size={24} className="animate-spin text-[#397a62]"/></div></main>}><Workspace /></Suspense>;
}

function Workspace() {
  const params = useSearchParams();
  const router = useRouter();
  const view = params.get("view");
  const tab: Tab = view === "research" || view === "etfs" ? view : "backtest";
  const [researchSelection, setResearchSelection] = useState<TickerSelection>();
  const [portfolioSelection, setPortfolioSelection] = useState<TickerSelection>();
  const setTab = (next: Tab) => router.push(`/?view=${next}`);
  const researchEtf = (symbol: string) => {
    setResearchSelection({ id: crypto.randomUUID(), symbol });
    setTab("research");
  };
  const backtestEtf = (symbol: string, ticker = symbol) => {
    setPortfolioSelection({ id: crypto.randomUUID(), symbol, ticker });
    setTab("backtest");
  };

  return (
    <main className="min-h-screen bg-[#f7f8fa]">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button onClick={() => setTab("backtest")} className="flex items-center gap-2.5 pr-3" aria-label="Atlas home">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#15233c] text-white"><TrendingUp size={18} strokeWidth={2.5} /></span>
            <span className="text-lg font-bold tracking-tight text-[#15233c]">atlas</span>
          </button>
          <nav className="hidden h-full items-center gap-1 sm:flex">
            <NavButton active={tab === "research"} onClick={() => setTab("research")} icon={<Search size={16} />} label="Research" />
            <NavButton active={tab === "backtest"} onClick={() => setTab("backtest")} icon={<LineChart size={16} />} label="Backtest" />
            <NavButton active={tab === "etfs"} onClick={() => setTab("etfs")} icon={<Table2 size={16} />} label="ETFs" />
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <button className="hidden items-center gap-2 rounded-md px-3 py-2 text-slate-500 hover:bg-slate-100 sm:flex"><CalendarDays size={16} />{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</button>
          </div>
        </div>
        <nav className="flex border-t border-slate-100 px-3 sm:hidden">
          <NavButton active={tab === "research"} onClick={() => setTab("research")} icon={<Search size={16} />} label="Research" />
          <NavButton active={tab === "backtest"} onClick={() => setTab("backtest")} icon={<LineChart size={16} />} label="Backtest" />
          <NavButton active={tab === "etfs"} onClick={() => setTab("etfs")} icon={<Table2 size={16} />} label="ETFs" />
        </nav>
      </header>
      <div hidden={tab !== "research"}><TickerView selection={researchSelection}/></div>
      <div hidden={tab !== "backtest"}><BacktestView portfolioSelection={portfolioSelection}/></div>
      <div hidden={tab !== "etfs"}><EtfDirectoryView onResearch={researchEtf} onBacktest={backtestEtf}/></div>
    </main>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button aria-current={active ? "page" : undefined} onClick={onClick} className={`flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition ${active ? "border-[#397a62] text-[#1b614b]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{icon}{label}</button>;
}
