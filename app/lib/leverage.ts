import type { LeverageSettings, MarketSeries, PricePoint, PriceRow, Quote, RatePoint } from "./market-types";

export const defaultLeverageSettings: LeverageSettings = { leverage: 3, expenseRatio: .0095, financingSpread: .005 };

export function simulationId(underlyingId: string, settings: LeverageSettings) {
  return `SIM|${underlyingId}|${settings.leverage}|${settings.expenseRatio}|${settings.financingSpread}`.toUpperCase();
}

export function financingRate(leverage: number, riskFree: number, spread: number) {
  if (leverage >= 1) return (leverage - 1) * (riskFree + spread);
  if (leverage < 0) return -Math.abs(leverage) * (riskFree - spread);
  return 0;
}

export function simulateLeverage(source: MarketSeries, settings: LeverageSettings, rates: RatePoint[]): MarketSeries {
  const { leverage, expenseRatio, financingSpread } = settings;
  if (![leverage, expenseRatio, financingSpread].every(Number.isFinite) || expenseRatio < 0 || financingSpread < 0) throw new Error("Enter finite leverage and non-negative annual fees and spread.");
  if (source.simulation) throw new Error("Choose the original underlying to apply leverage.");
  if (!rates.length || rates.some((point, i) => !Number.isFinite(point.rate) || (i > 0 && point.date <= rates[i - 1].date))) throw new Error("Valid historical ^IRX rates are required.");
  const original = source.history.points;
  if (original.some((point, i) => !Number.isFinite(point.close) || point.close <= 0 || (i > 0 && point.date <= original[i - 1].date))) throw new Error("The underlying must have positive, ordered adjusted prices.");
  const needsFinancing = leverage > 1 || leverage < 0;
  const start = needsFinancing ? original.findIndex(point => point.date >= rates[0].date) : 0;
  const prices = original.slice(Math.max(start, 0));
  if (start < 0 || prices.length < 2) throw new Error("Not enough overlapping price and financing-rate history to simulate leverage.");

  // Vectorize return and fee arithmetic, then compound once across the daily vector.
  const returns = Float64Array.from(prices, (point, i) => i === 0 ? 0 : point.close / prices[i - 1].close - 1);
  const costs = new Float64Array(prices.length);
  let rateIndex = 0;
  for (let i = 1; i < prices.length; i += 1) {
    // Only use rates observed before this return date; weekends carry the last observation.
    while (rateIndex + 1 < rates.length && rates[rateIndex + 1].date < prices[i].date) rateIndex += 1;
    costs[i] = (expenseRatio + financingRate(leverage, rates[rateIndex].rate, financingSpread)) / 252;
  }
  const leveragedReturns = returns.map((value, i) => i === 0 ? 0 : Math.max(-1, leverage * value - costs[i]));
  let compounded = prices[0].close;
  const nav = leveragedReturns.map(value => {
    compounded *= 1 + value;
    if (!Number.isFinite(compounded)) throw new Error("These settings overflow the simulated price series. Reduce leverage.");
    return compounded;
  });
  const id = simulationId(source.id, settings);
  const name = `${source.name} ${leverage}x (sim)`;
  const points = prices.map((point, i) => ({ date: point.date, close: nav[i], return: (nav[i] / nav[0] - 1) * 100 }));
  const dailyIndex = new Map(prices.map((point, i) => [point.date, i]));
  const intradayPoints: Partial<Record<"5m" | "30m", PricePoint[]>> = {};
  const sessionBases: Record<string, number> = {};
  for (const interval of ["5m", "30m"] as const) {
    const sessions = new Map<string, PricePoint[]>();
    for (const point of source.history.intradayPoints?.[interval] ?? []) {
      const day = point.date.slice(0, 10);
      const session = sessions.get(day) ?? [];
      session.push(point);
      sessions.set(day, session);
    }
    intradayPoints[interval] = [];
    for (const [day, session] of sessions) {
      const current = dailyIndex.get(day);
      const previous = current === undefined ? prices.findLastIndex(point => point.date < day) : current - 1;
      if (previous < 0) continue;
      const base = nav[previous];
      sessionBases[day] = base;
      let dailyCost = current === undefined ? 0 : costs[current];
      if (current === undefined) {
        const rate = rates.findLast(point => point.date < day)?.rate;
        if (rate === undefined && needsFinancing) continue;
        dailyCost = (expenseRatio + financingRate(leverage, rate ?? 0, financingSpread)) / 252;
      }
      // Intraday marks use the previous daily close, never the previous intraday bar.
      session.forEach((point, i) => {
        const fraction = (i + 1) / session.length;
        const change = leverage * (point.close / prices[previous].close - 1) - dailyCost * fraction;
        intradayPoints[interval]!.push({ date: point.date, close: base * (1 + Math.max(-1, change)) });
      });
    }
  }
  return {
    id, name, currency: source.currency,
    simulation: { underlyingId: source.id, settings: { ...settings }, coverageWarning: start > 0 ? `Simulation begins ${prices[0].date}; earlier ^IRX financing rates are unavailable.` : undefined },
    history: { symbol: id, points, performance: {}, intradayPoints, sessionBases, currency: source.currency, quoteType: "SIMULATION" },
  };
}

export function maximumDrawdown(points: readonly { close: number }[]) {
  let peak = 0;
  let worst = 0;
  for (const point of points) {
    peak = Math.max(peak, point.close);
    if (peak > 0) worst = Math.min(worst, (point.close / peak - 1) * 100);
  }
  return worst;
}

export function quoteForSeries(series: MarketSeries): Quote {
  if (series.quote) return series.quote;
  const last = series.history.points.at(-1)!;
  const previous = series.history.points.at(-2) ?? last;
  const change = last.close - previous.close;
  const recent = series.history.points.filter(point => point.date >= new Date(Date.parse(last.date) - 366 * 86400000).toISOString().slice(0, 10));
  return {
    symbol: series.name, name: series.simulation ? "Daily-reset simulation" : series.name,
    currency: series.currency, exchange: series.simulation ? "Simulated" : "Yahoo Finance", quoteType: series.history.quoteType,
    price: last.close, change, changePercent: previous.close > 0 ? change / previous.close * 100 : 0,
    expenseRatio: series.simulation ? series.simulation.settings.expenseRatio * 100 : undefined,
    fiftyTwoWeekHigh: Math.max(...recent.map(point => point.close)), fiftyTwoWeekLow: Math.min(...recent.map(point => point.close)),
    description: series.simulation ? `Daily-reset ${series.simulation.settings.leverage}x exposure to ${series.simulation.underlyingId}, net of annual expenses and ^IRX-based financing.` : undefined,
  };
}

export function combineSeries(series: MarketSeries[]): { priceHistory: PriceRow[]; intradayPriceHistory: Partial<Record<"5m" | "30m", PriceRow[]>> } {
  if (!series.length) throw new Error("Add at least one holding.");
  const align = (sources: { id: string; points: PricePoint[] }[]): PriceRow[] => {
    if (sources.some(source => !source.points.length)) return [];
    const dates = [...new Set(sources.flatMap(source => source.points.map(point => point.date)))].sort();
    const positions = sources.map(() => 0);
    const last: Record<string, number> = {};
    const rows: PriceRow[] = [];
    for (const date of dates) {
      sources.forEach((source, i) => {
        while (positions[i] < source.points.length && source.points[positions[i]].date <= date) {
          last[source.id] = source.points[positions[i]++].close;
        }
      });
      if (sources.every(source => last[source.id] !== undefined)) rows.push({ date, prices: { ...last } });
    }
    return rows;
  };
  const priceHistory = align(series.map(item => ({ id: item.id, points: item.history.points })));
  if (priceHistory.length < 2) throw new Error("The selected holdings do not have enough overlapping history.");
  const intradayPriceHistory = Object.fromEntries((["5m", "30m"] as const).map(interval => [interval, align(series.map(item => ({ id: item.id, points: item.history.intradayPoints?.[interval] ?? [] })))]));
  return { priceHistory, intradayPriceHistory };
}

export function createPortfolioBasket(id: string, name: string, holdings: { series: MarketSeries; weight: number }[]): MarketSeries {
  if (holdings.some(holding => !Number.isFinite(holding.weight) || holding.weight < 0)) throw new Error("Portfolio weights must be finite and non-negative.");
  const active = holdings.filter(holding => holding.weight > 0);
  const total = active.reduce((sum, holding) => sum + holding.weight, 0);
  if (!total) throw new Error("Add at least one holding with a positive weight before applying leverage.");
  const aligned = combineSeries([...new Map(active.map(holding => [holding.series.id, holding.series])).values()]);
  const weightedReturn = (current: PriceRow, previous: PriceRow) => active.reduce((sum, holding) => {
    const before = previous.prices[holding.series.id];
    return sum + (before > 0 ? current.prices[holding.series.id] / before - 1 : 0) * holding.weight / total;
  }, 0);
  let nav = 100;
  const points = aligned.priceHistory.map((row, i) => {
    if (i > 0) nav *= 1 + weightedReturn(row, aligned.priceHistory[i - 1]);
    return { date: row.date, close: nav, return: nav - 100 };
  });
  const dailyIndex = new Map(points.map((point, i) => [point.date, i]));
  const intradayPoints: Partial<Record<"5m" | "30m", PricePoint[]>> = {};
  for (const interval of ["5m", "30m"] as const) {
    intradayPoints[interval] = (aligned.intradayPriceHistory[interval] ?? []).flatMap(row => {
      const day = row.date.slice(0, 10);
      const index = dailyIndex.get(day);
      const previous = index === undefined ? points.findLastIndex(point => point.date < day) : index - 1;
      if (previous < 0) return [];
      return [{ date: row.date, close: points[previous].close * (1 + weightedReturn(row, aligned.priceHistory[previous])) }];
    });
  }
  const symbol = `PORTFOLIO|${id}`.toUpperCase();
  return { id: symbol, name, currency: active[0].series.currency, history: { symbol, points, performance: {}, intradayPoints } };
}

export function indexWarning(series: MarketSeries | undefined, underlying?: MarketSeries) {
  const source = underlying ?? series;
  if (!source) return undefined;
  if (source.id === "^VIX") return "Spot VIX is not an investable asset. This simulation does not represent VIX futures or a VIX futures fund.";
  if (source.id === "^GSPC") return "^GSPC excludes dividends. Consider S&P 500 Total Return (^SP500TR) for dividend-inclusive exposure.";
  if (source.id === "^NDX") return "^NDX excludes dividends. Consider Nasdaq-100 Total Return (^XNDX) for dividend-inclusive exposure.";
  if (source.history.quoteType === "INDEX") return "Index prices may exclude dividends. Use a total-return version where available.";
  return undefined;
}
