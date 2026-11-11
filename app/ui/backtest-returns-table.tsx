import type { AnnualInvestments, BacktestPerformance } from "../lib/backtest-performance";

type Comparison = { id: string; name: string; color: string };

function dateLabel(value: string, year = false) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
}

function ReturnCell({ value }: { value: number | null }) {
  return <td className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums ${value === null ? "text-slate-400" : value < 0 ? "text-rose-600" : "text-[#17724a]"}`}>{value === null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`}</td>;
}

function ComparisonHeader({ portfolios, label }: { portfolios: Comparison[]; label: string }) {
  return <thead className="border-y border-slate-200 bg-slate-50"><tr><th scope="col" className="min-w-[150px] px-5 py-3 text-xs font-semibold text-slate-500 sm:px-6">{label}</th>{portfolios.map(portfolio => <th scope="col" key={portfolio.id} className="min-w-[140px] max-w-[220px] px-4 py-3 text-right text-xs font-semibold text-slate-700"><span className="inline-flex max-w-full items-center justify-end gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: portfolio.color }}/><span title={portfolio.name} className="block min-w-0 max-w-[160px] truncate">{portfolio.name}</span></span></th>)}</tr></thead>;
}

export function BacktestInvestmentsTable({ annual, portfolios }: { annual: AnnualInvestments[]; portfolios: Comparison[] }) {
  if (!annual.length || !portfolios.length) return null;
  return <div className="min-w-0 border-t border-slate-200">
    <div className="px-5 py-4 sm:px-6"><h2 className="text-sm font-semibold text-slate-900">Annual ATH investments</h2><p className="mt-1 text-xs text-slate-500">Number of investments | Starting balance excluded</p></div>
    <div role="region" aria-label="Annual ATH investments" tabIndex={0} className="max-w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full border-collapse text-left" aria-label="Portfolio annual ATH investment counts">
        <ComparisonHeader portfolios={portfolios} label="Year"/>
        <tbody className="divide-y divide-slate-100">
          <tr className="bg-slate-50"><th scope="row" className="px-5 py-3 text-xs font-semibold text-slate-800 sm:px-6">Total</th>{portfolios.map(portfolio => <td key={portfolio.id} className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-800">{annual.reduce((total, period) => total + (period.counts[portfolio.id] ?? 0), 0).toLocaleString("en-US")}</td>)}</tr>
          {annual.map(period => <tr key={period.year}><th scope="row" className="px-5 py-3 text-xs font-semibold text-slate-700 sm:px-6">{period.year}</th>{portfolios.map(portfolio => <td key={portfolio.id} className="px-4 py-3 text-right text-sm tabular-nums text-slate-700">{(period.counts[portfolio.id] ?? 0).toLocaleString("en-US")}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}

export function BacktestReturnsTable({ performance, portfolios }: { performance: BacktestPerformance; portfolios: Comparison[] }) {
  if (!performance.startDate || !performance.endDate || !portfolios.length) return null;
  return <div className="min-w-0 border-t border-slate-200">
    <div className="px-5 py-4 sm:px-6"><h2 id={`returns-${portfolios[0].id}`} className="text-sm font-semibold text-slate-900">Annual returns &amp; CAGR</h2><p className="mt-1 text-xs text-slate-500">Time-weighted returns | {dateLabel(performance.startDate, true)} - {dateLabel(performance.endDate, true)}</p></div>
    <div role="region" aria-label="Annual returns and CAGR" tabIndex={0} className="max-w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full border-collapse text-left" aria-label="Portfolio annual returns and CAGR">
        <ComparisonHeader portfolios={portfolios} label="Period"/>
        <tbody className="divide-y divide-slate-100">
          <tr className="bg-slate-50"><th scope="row" className="px-5 py-3 text-xs font-semibold text-slate-800 sm:px-6">CAGR<span className="mt-1 block font-normal text-slate-500">Since investment start</span></th>{portfolios.map(portfolio => <ReturnCell key={portfolio.id} value={performance.cagr[portfolio.id] ?? null}/>)}</tr>
          {performance.annual.map(period => <tr key={period.year}><th scope="row" className="px-5 py-3 text-xs font-semibold text-slate-700 sm:px-6">{period.year}<span className="mt-1 block whitespace-nowrap font-normal text-slate-400">{dateLabel(period.from)} - {dateLabel(period.to)}</span></th>{portfolios.map(portfolio => <ReturnCell key={portfolio.id} value={period.returns[portfolio.id] ?? null}/>)}</tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}
