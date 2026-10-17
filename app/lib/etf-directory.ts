export type EtfRecord = {
  ticker: string;
  yahooSymbol?: string | null;
  name: string | null;
  aum: number | null;
  mer: number | null;
  inceptionDate: string | null;
};
export type EtfListing = EtfRecord & { market: "Canada" | "U.S."; id: string; symbol: string | null };
export type EtfSortKey = "ticker" | "name" | "market" | "aum" | "mer" | "inceptionDate";
export type TickerSelection = { id: string; symbol: string; ticker?: string };

export function directoryListings(canada: EtfRecord[], usa: EtfRecord[]): EtfListing[] {
  return [
    ...canada.map(row => ({ ...row, market: "Canada" as const, id: `CA:${row.ticker}`, symbol: row.yahooSymbol || null })),
    ...usa.map(row => ({ ...row, market: "U.S." as const, id: `US:${row.ticker}`, symbol: row.yahooSymbol || row.ticker })),
  ];
}

export function filterEtfs(rows: EtfListing[], query: string, market: string, key: EtfSortKey, direction: "asc" | "desc") {
  const text = query.trim().toLocaleLowerCase();
  return rows.filter(row => (market === "All" || row.market === market)
    && (!text || [row.ticker, row.name, row.symbol].some(value => value?.toLocaleLowerCase().includes(text))))
    .sort((a, b) => {
      const left = a[key], right = b[key];
      // Keep unavailable values last in both directions.
      if (left === null && right === null) return a.id.localeCompare(b.id);
      if (left === null) return 1;
      if (right === null) return -1;
      const value = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
      return (direction === "asc" ? value : -value) || a.id.localeCompare(b.id);
    });
}

export function etfAum(value: number | null) {
  return value === null || !Number.isFinite(value) ? "-" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export function etfDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}
