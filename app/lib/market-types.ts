export type PricePoint = { date: string; close: number };
export type HistoryPoint = PricePoint & { return: number };
export type MarketHistory = {
  symbol: string;
  points: HistoryPoint[];
  performance: Record<string, number | null>;
  intradayPoints?: Partial<Record<"5m" | "30m", PricePoint[]>>;
  sessionBases?: Record<string, number>;
  currency?: string;
  quoteType?: string;
};
export type Quote = {
  symbol: string; name: string; price?: number; change?: number; changePercent?: number;
  currency: string; exchange: string; quoteType?: string; sector?: string; industry?: string;
  marketCap?: number; aum?: number | null; expenseRatio?: number | null; pe?: number;
  dividendYield?: number; fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number; description?: string;
};
export type LeverageSettings = { leverage: number; expenseRatio: number; financingSpread: number };
export type PortfolioLeverageConfig = { enabled: boolean; settings: LeverageSettings };
export type RatePoint = { date: string; rate: number };
export type RateHistory = { symbol: "^IRX"; points: RatePoint[] };
export type MarketSeries = {
  id: string;
  name: string;
  currency: string;
  history: MarketHistory;
  quote?: Quote;
  simulation?: { underlyingId: string; settings: LeverageSettings; coverageWarning?: string };
};
export type PriceRow = { date: string; prices: Record<string, number> };
