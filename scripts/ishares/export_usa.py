#!/usr/bin/env python3
"""Generate public/iShareUsa.json using tickers from public/iShareUsa.csv."""

from etf_export import main


if __name__ == "__main__":
    raise SystemExit(main("iShareUsa.csv", canadian=False))
