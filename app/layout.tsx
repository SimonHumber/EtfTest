import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas | Investment research",
  description: "Ticker research and portfolio backtesting powered by yfinance.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
