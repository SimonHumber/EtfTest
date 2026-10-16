"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { defaultLeverageSettings } from "../lib/leverage";
import type { PortfolioLeverageConfig } from "../lib/market-types";

export function PortfolioLeverageOptions({ value, onChange, name }: { value?: PortfolioLeverageConfig; onChange: (value: PortfolioLeverageConfig) => void; name: string }) {
  const settings = value?.settings ?? defaultLeverageSettings;
  const enabled = value?.enabled ?? false;
  const presets = [3, 2, 1.5, -1, -2, -3];
  const [custom, setCustom] = useState(!presets.includes(settings.leverage));
  const update = (patch: Partial<typeof settings>) => onChange({ enabled, settings: { ...settings, ...patch } });
  const number = (text: string) => text.trim() ? Number(text) : NaN;
  const display = (number: number) => Number.isFinite(number) ? number : "";
  return <div className="mt-4 border-t border-slate-100 pt-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
        <input type="checkbox" checked={enabled} onChange={event => onChange({ enabled: event.target.checked, settings: { ...settings } })} aria-label={`Apply leverage to ${name || "portfolio"}`} className="h-4 w-4 rounded border-slate-300 accent-[#21674f]"/>Apply leverage
      </label>
      {enabled && <label className="flex items-center gap-2 text-xs text-slate-500">Leverage
        <select value={custom ? "custom" : settings.leverage} aria-label={`Leverage for ${name || "portfolio"}`} onChange={event => { setCustom(event.target.value === "custom"); if (event.target.value !== "custom") update({ leverage: Number(event.target.value) }); }} className="h-8 rounded border border-slate-200 bg-white px-2 text-slate-800">
          {presets.map(leverage => <option value={leverage} key={leverage}>{leverage}x</option>)}<option value="custom">Custom</option>
        </select>
      </label>}
    </div>
    {enabled && <div className="mt-3 space-y-3">
      {custom && <label className="block text-xs text-slate-500">Custom leverage<input type="number" step="any" value={display(settings.leverage)} onChange={event => update({ leverage: number(event.target.value) })} className="mt-1 h-8 w-full rounded border border-slate-200 px-2 text-slate-800"/></label>}
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-slate-500"><ChevronDown size={13}/>Advanced</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="min-w-0 text-xs text-slate-500">Expense ratio (%/yr)<input type="number" min="0" step="any" value={display(settings.expenseRatio * 100)} onChange={event => update({ expenseRatio: number(event.target.value) / 100 })} className="mt-1 h-8 w-full rounded border border-slate-200 px-2 text-slate-800"/></label>
          <label className="min-w-0 text-xs text-slate-500">Financing spread (%/yr)<input type="number" min="0" step="any" value={display(settings.financingSpread * 100)} onChange={event => update({ financingSpread: number(event.target.value) / 100 })} className="mt-1 h-8 w-full rounded border border-slate-200 px-2 text-slate-800"/></label>
          <p className="col-span-2 text-xs text-slate-500">Risk-free rate: ^IRX / 100 (automatic)</p>
        </div>
      </details>
    </div>}
  </div>;
}
