import labels from "../../public/indices.json";
import { defaultLeverageSettings } from "./leverage";
import type { PortfolioLeverageConfig } from "./market-types";

export type IndexListing = { symbol: string; name: string; description: string };

export const indexListings: IndexListing[] = Object.entries(labels)
  .map(([symbol, metadata]) => ({ symbol, name: metadata.name, description: metadata.description }));

export function indexLeverage(multiplier: number): PortfolioLeverageConfig {
  return { enabled: multiplier !== 1, settings: { ...defaultLeverageSettings, leverage: multiplier === 1 ? 3 : multiplier } };
}

export function indexComparisonName(symbol: string, leverage?: PortfolioLeverageConfig) {
  return `${symbol} ${leverage?.enabled ? `${leverage.settings.leverage}x (sim)` : "1x"}`;
}

export function indexComparisonKey(symbol: string, leverage?: PortfolioLeverageConfig) {
  return JSON.stringify([symbol.toUpperCase(), leverage?.enabled ? [leverage.settings.leverage, leverage.settings.expenseRatio, leverage.settings.financingSpread] : null]);
}
