"use client";

import { useState } from "react";
import { ArrowUpRight, BarChart3, CalendarDays, ChevronDown, Landmark, LineChart, Search, SlidersHorizontal, TrendingUp } from "lucide-react";
import { BacktestView } from "./ui/backtest-view";
import { TickerView } from "./ui/ticker-view";

type Tab = "research" | "backtest";

export default function Home() {
  const [tab, setTab] = useState<Tab>("backtest");

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
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <button className="hidden items-center gap-2 rounded-md px-3 py-2 text-slate-500 hover:bg-slate-100 sm:flex"><CalendarDays size={16} />{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</button>
          </div>
        </div>
        <nav className="flex border-t border-slate-100 px-3 sm:hidden">
          <NavButton active={tab === "research"} onClick={() => setTab("research")} icon={<Search size={16} />} label="Research" />
          <NavButton active={tab === "backtest"} onClick={() => setTab("backtest")} icon={<LineChart size={16} />} label="Backtest" />
        </nav>
      </header>
      <div hidden={tab !== "research"}><TickerView /></div>
      <div hidden={tab !== "backtest"}><BacktestView /></div>
    </main>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button onClick={onClick} className={`flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition ${active ? "border-[#397a62] text-[#1b614b]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{icon}{label}</button>;
}
