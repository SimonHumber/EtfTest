"use client";

import { useState } from "react";

type ChartPoint = { date: string; values: { name: string; value: number; color: string }[] };

export function ChartHover({ points, min, max, formatValue }: { points: ChartPoint[]; min: number; max: number; formatValue: (value: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const index = active === null ? null : Math.min(active, points.length - 1);
  const point = index === null ? undefined : points[index];
  const x = index === null ? 0 : index / Math.max(points.length - 1, 1) * 100;
  const describeDate = (value: string) => new Date(value.includes("T") ? value : `${value}T00:00:00`).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric", ...(value.includes("T") ? { hour: "numeric", minute: "2-digit" } as const : {}),
  });

  return <div className="absolute inset-0 select-none cursor-crosshair touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
    role="slider" tabIndex={0} aria-label="Chart timeline" aria-valuemin={0} aria-valuemax={Math.max(points.length - 1, 0)} aria-valuenow={index ?? 0}
    aria-valuetext={point ? `${describeDate(point.date)}, ${point.values.map(item => `${item.name}: ${formatValue(item.value)}`).join(", ")}` : undefined}
    onPointerMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      setActive(Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(bounds.width, 1))) * (points.length - 1)));
    }}
    onPointerDown={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      setActive(Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(bounds.width, 1))) * (points.length - 1)));
    }}
    onPointerLeave={() => setActive(null)} onPointerCancel={() => setActive(null)}
    onFocus={() => setActive(current => current ?? 0)} onBlur={() => setActive(null)}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Escape") setActive(null);
      else if (event.key === "Home") setActive(0);
      else if (event.key === "End") setActive(points.length - 1);
      else setActive(current => Math.max(0, Math.min(points.length - 1, (current ?? 0) + (event.key === "ArrowRight" ? 1 : -1))));
    }}>
    {point && <>
      <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-slate-400" style={{ left: `${x}%` }}/>
      {point.values.filter(item => Number.isFinite(item.value)).map((item, i) => <span key={i} className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ left: `${x}%`, top: `${Math.max(0, Math.min(100, (max - item.value) / Math.max(max - min, .000001) * 100))}%`, backgroundColor: item.color }}/>) }
      <div className="pointer-events-none absolute top-2 z-10 w-max max-w-[calc(100%-1rem)] rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md" style={x > 50 ? { right: 8 } : { left: 8 }}>
        <p className="mb-1 font-medium text-slate-500">{describeDate(point.date)}</p>
        {point.values.map((item, i) => <div key={i} className="flex items-center justify-between gap-3 py-0.5"><span className="flex min-w-0 items-center gap-1.5 text-slate-600"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }}/><span className="break-words">{item.name}</span></span><span className="shrink-0 font-semibold tabular-nums text-slate-900">{formatValue(item.value)}</span></div>)}
      </div>
    </>}
  </div>;
}
