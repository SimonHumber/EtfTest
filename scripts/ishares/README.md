# iShares ETF exports

Run from the repository root after installing `requirements.txt` in `.venv`:

```bash
.venv/bin/python scripts/ishares/export_canada.py
.venv/bin/python scripts/ishares/export_usa.py
```

These generate `public/iShareCan.json` and `public/iShareUsa.json`. Paths are resolved relative to the repository, so the scripts also work from another working directory. These are manual data-generation tools, not part of the backend or Vercel build.

Only `Ticker` is read from either CSV. All other values come from yfinance. Canadian lookup symbols use Yahoo's Toronto suffix and unit-class format (`XUU.U` becomes `XUU-U.TO`). If the TSX lookup fails after retries or has no fund metadata, the Canadian exporter tries Cboe Canada using `.NE` (`CWO.TO` then `CWO.NE`, or `CLU-C.TO` then `CLU-C.NE`). A successful TSX result is kept even if optional fields are missing; fields from different listings are not mixed. Explicit `.NE` tickers are queried directly. Output tickers retain their CSV spelling. Duplicate tickers are exported once, in CSV order. U.S. lookups are unchanged.

Each output is an array of objects with these fields:

| Field | Meaning |
| --- | --- |
| `ticker` | Ticker from the CSV |
| `yahooSymbol` | Resolved Yahoo listing, including `.TO` or `.NE` for Canada; used by Research and Backtest actions |
| `name` | Yahoo long name, falling back to its short name |
| `aum` | Total assets in Yahoo's fund reporting currency, not converted or scaled |
| `mer` | Yahoo net expense ratio, or annual-report expense ratio converted to percentage points; `0.03` means 0.03% per year |
| `inceptionDate` | Yahoo fund inception date, formatted `YYYY-MM-DD` in UTC |

Yahoo's expense ratio is used as the MER proxy; it is not guaranteed to match the Canadian issuer's published MER. Missing fields are `null`, never copied from other CSV columns or inferred from the first available trading day. No Yahoo API key or `YFINANCE_API_TOKEN` is needed.

Lookups run sequentially with a 0.5-second pause and two retries on failures. Individual failures produce a row with the ticker and null metadata, print diagnostics, and exit with status 1 after writing the other results. Missing optional fields also print warnings but do not count as failed lookups. Rate limiting, five consecutive failures, or no successful lookups abort without replacing an existing output. JSON replacement is atomic.

Options: `--input PATH`, `--output PATH`, `--delay SECONDS`, `--retries N`, and `--limit N`. Use a different output for a limited test so it does not replace the full export:

```bash
.venv/bin/python scripts/ishares/export_canada.py --limit 3 --output /tmp/ishares-canada-sample.json
```
