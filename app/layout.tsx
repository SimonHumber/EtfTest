import type { Metadata } from "next";
import "./globals.css";
import { MarketDataProvider } from "./ui/market-data-provider";

export const metadata: Metadata = {
  title: "Atlas | Investment research",
  description: "Ticker research and portfolio backtesting powered by yfinance.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><MarketDataProvider>{children}</MarketDataProvider></body>
    </html>
  );
}
