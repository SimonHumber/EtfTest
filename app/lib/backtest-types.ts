import type { PortfolioLeverageConfig } from "./market-types";

export type Holding = { id: string; symbol: string; weight: number };
export type Portfolio = { id: string; name: string; color: string; holdings: Holding[]; leverage?: PortfolioLeverageConfig };
