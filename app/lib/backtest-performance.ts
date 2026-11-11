type PerformancePoint = {
  date: string;
  values: Record<string, number>;
  contributions: number;
  appliedContributions?: Record<string, number>;
  athPurchases?: Record<string, number>;
};

type Accumulator = { logReturn: number; observations: number };
export type BacktestPerformance = {
  startDate: string | null;
  endDate: string | null;
  annual: { year: string; from: string; to: string; returns: Record<string, number | null> }[];
  cagr: Record<string, number | null>;
};

export type AnnualInvestments = { year: string; counts: Record<string, number> };

export function calculateAnnualInvestments(points: readonly Pick<PerformancePoint, "date" | "athPurchases">[], portfolioIds: readonly string[]): AnnualInvestments[] {
  const years = new Map<string, Record<string, number>>();
  for (const point of points) {
    const year = point.date.slice(0, 4);
    let counts = years.get(year);
    if (!counts) {
      counts = Object.fromEntries(portfolioIds.map(id => [id, 0]));
      years.set(year, counts);
    }
    for (const id of portfolioIds) counts[id] += point.athPurchases?.[id] ?? 0;
  }
  return [...years].map(([year, counts]) => ({ year, counts }));
}

export function calculateBacktestPerformance(points: readonly PerformancePoint[], portfolioIds: readonly string[]): BacktestPerformance {
  const startDate = points[0]?.date ?? null;
  const endDate = points.at(-1)?.date ?? null;
  const accumulator = () => Object.fromEntries(portfolioIds.map(id => [id, { logReturn: 0, observations: 0 } as Accumulator]));
  const total = accumulator();
  const years = new Map<string, { from: string; to: string; values: Record<string, Accumulator> }>();
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const year = current.date.slice(0, 4);
    let period = years.get(year);
    if (!period) {
      period = { from: current.date, to: current.date, values: accumulator() };
      years.set(year, period);
    }
    period.to = current.date;
    const previous = points[i - 1];
    if (!previous) continue;
    for (const id of portfolioIds) {
      const before = previous.values[id];
      const after = current.values[id];
      const cashFlow = current.appliedContributions?.[id] ?? current.contributions;
      if (!(before > 0) || ![before, after, cashFlow].every(Number.isFinite)) continue;
      // Cash flows occur after market returns, so subtract them before linking returns.
      const logReturn = Math.log(Math.max(0, (after - cashFlow) / before));
      for (const value of [total[id], period.values[id]]) {
        value.logReturn += logReturn;
        value.observations += 1;
      }
    }
  }
  const percent = (value: Accumulator, scale = 1) => {
    if (!value.observations) return null;
    const result = Math.expm1(value.logReturn * scale) * 100;
    return Number.isFinite(result) ? result : null;
  };
  const days = startDate && endDate ? (Date.parse(endDate) - Date.parse(startDate)) / 86400000 : 0;
  return {
    startDate, endDate,
    annual: [...years].map(([year, period]) => ({ year, from: period.from, to: period.to, returns: Object.fromEntries(portfolioIds.map(id => [id, percent(period.values[id])])) })),
    cagr: Object.fromEntries(portfolioIds.map(id => [id, days > 0 ? percent(total[id], 365.25 / days) : null])),
  };
}
