import { defaultLeverageSettings } from "./leverage";
import type { PortfolioLeverageConfig } from "./market-types";

export type IndexListing = { symbol: string; name: string; region: string };

// Labels are presentation only. indices.txt remains the source of selectable symbols.
const labels: Record<string, [string, string]> = {
  "^GSPTSE": ["S&P/TSX Composite", "Canada"], "^GSPC": ["S&P 500", "U.S."],
  "^DJI": ["Dow Jones Industrial Average", "U.S."], "^NDX": ["Nasdaq-100", "U.S."],
  "^IXIC": ["Nasdaq Composite", "U.S."], "^NYA": ["NYSE Composite", "U.S."],
  "^XAX": ["NYSE American Composite", "U.S."], "^RUT": ["Russell 2000", "U.S."],
  "^VIX": ["CBOE Volatility Index", "U.S."], "^FTSE": ["FTSE 100", "Europe"],
  "^HSI": ["Hang Seng", "Asia Pacific"], "^AXJO": ["S&P/ASX 200", "Asia Pacific"],
  "^NZ50": ["S&P/NZX 50", "Asia Pacific"], "^N225": ["Nikkei 225", "Asia Pacific"],
  "^GDAXI": ["DAX", "Europe"], "^FCHI": ["CAC 40", "Europe"],
  "^STOXX50E": ["EURO STOXX 50", "Europe"], "^SSMI": ["Swiss Market Index", "Europe"],
  "^IBEX": ["IBEX 35", "Europe"], "FTSEMIB.MI": ["FTSE MIB", "Europe"],
  "^AEX": ["AEX", "Europe"], "^BFX": ["BEL 20", "Europe"],
  "^N100": ["Euronext 100", "Europe"], "^OMXC20": ["OMX Copenhagen 20", "Europe"],
  "^ATX": ["Austrian Traded Index", "Europe"], "000001.SS": ["Shanghai Composite", "Asia Pacific"],
  "^NSEI": ["Nifty 50", "Asia Pacific"], "^BSESN": ["S&P BSE Sensex", "Asia Pacific"],
  "^KS11": ["KOSPI", "Asia Pacific"], "^TWII": ["Taiwan Weighted Index", "Asia Pacific"],
  "^STI": ["Straits Times Index", "Asia Pacific"], "^JKSE": ["Jakarta Composite", "Asia Pacific"],
  "^KLSE": ["FTSE Bursa Malaysia KLCI", "Asia Pacific"], "^AORD": ["All Ordinaries", "Asia Pacific"],
  "^SOX": ["Philadelphia Semiconductor Index", "U.S."], "^MID": ["S&P MidCap 400", "U.S."],
  "^SPG1200": ["S&P Global 1200", "Global"], "^BVSP": ["Ibovespa", "Latin America"],
  "^MXX": ["S&P/BMV IPC", "Latin America"], "^J203.JO": ["FTSE/JSE All Share", "Africa & Middle East"],
  "^TASI.SR": ["Tadawul All Share", "Africa & Middle East"], "000300.SS": ["CSI 300", "Asia Pacific"],
  "^OMX": ["OMX Stockholm 30", "Europe"], "399001.SZ": ["Shenzhen Component", "Asia Pacific"],
};

export function parseIndexDirectory(text: string): IndexListing[] {
  return [...new Set(text.replace(/^\uFEFF/, "").split(/\r?\n/).map(line => line.trim().toUpperCase()).filter(Boolean))]
    .map(symbol => ({ symbol, name: labels[symbol]?.[0] ?? symbol, region: labels[symbol]?.[1] ?? "Other" }));
}

export function indexLeverage(multiplier: number): PortfolioLeverageConfig {
  return { enabled: multiplier !== 1, settings: { ...defaultLeverageSettings, leverage: multiplier === 1 ? 3 : multiplier } };
}

export function indexComparisonName(symbol: string, leverage?: PortfolioLeverageConfig) {
  return `${symbol} ${leverage?.enabled ? `${leverage.settings.leverage}x (sim)` : "1x"}`;
}

export function indexComparisonKey(symbol: string, leverage?: PortfolioLeverageConfig) {
  return JSON.stringify([symbol.toUpperCase(), leverage?.enabled ? [leverage.settings.leverage, leverage.settings.expenseRatio, leverage.settings.financingSpread] : null]);
}
